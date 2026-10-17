// Swap Row photo auto-fill: sends a listing photo to Google's Gemma model and returns
// suggested listing fields. Runs as a Supabase Edge Function so the Google key stays secret.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   GEMINI_API_KEY   required, from https://aistudio.google.com/apikey
//   GEMMA_MODEL      optional, defaults to gemma-4-26b-a4b-it
//   AI_DAILY_LIMIT   optional, auto-fills per student per day, defaults to 20
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const THEMES = ["Oktoberfest", "USA / Red, White & Blue", "Barn Dance / Western", "Country Club", "Kentucky Derby", "Neon / Glow", "Y2K", "'70s Disco", "'80s", "'90s", "Mardi Gras", "Tropical / Luau", "Beach / Coastal", "Après Ski", "Toga", "Masquerade", "White Party", "Black & White", "Halloween"];
const EVENTS = ["Date Party", "Formal", "Semi-Formal", "Game Day", "Bid Day", "Rush / Recruitment", "Philanthropy", "Theme Party", "Big/Little", "Everyday"];
const CATS = ["Dress", "Top", "Bottoms", "Set / Jumpsuit", "Shoes", "Accessories", "Jewelry", "Costume", "Outerwear", "Other"];
const SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "0", "2", "4", "6", "8", "10", "12", "14", "Shoe 5", "Shoe 6", "Shoe 7", "Shoe 8", "Shoe 9", "Shoe 10", "One size"];
const CONDS = ["New with tags", "Worn once", "Gently used", "Well loved"];

const MODEL = Deno.env.get("GEMMA_MODEL") || "gemma-4-26b-a4b-it";
const DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT") || 20);
const GEMINI_BASE = Deno.env.get("GEMINI_API_BASE") || "https://generativelanguage.googleapis.com";
const MAX_IMAGE_CHARS = 2_000_000; // ~1.5 MB of JPEG as base64

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const PROMPT = `You help college students in Greek life (sororities and fraternities) list clothes and accessories for sale on Swap Row, a campus marketplace.
Look at the photo and reply with ONLY one JSON object, no other text, with exactly these keys:
- "title": under 60 characters, specific: color, fabric or style, and item type. Example: "Red satin slip dress, midi".
- "category": one of ${JSON.stringify(CATS)}.
- "size": one of ${JSON.stringify(SIZES)} ONLY if a size tag is clearly readable in the photo, otherwise "".
- "condition": one of ${JSON.stringify(CONDS)}. Use "Gently used" if you can't tell.
- "events": 1 to 3 values from ${JSON.stringify(EVENTS)} that this item would suit.
- "themes": 0 to 3 values from ${JSON.stringify(THEMES)} whose party theme this item clearly fits (for example a flannel or cowboy boots for "Barn Dance / Western", a dirndl for "Oktoberfest"). Use [] if none clearly fit.
- "description": 1 or 2 short sentences on color, fabric, fit and style. Do not guess a brand or size you can't see. Do not mention price.
- "price": a fair price in whole US dollars for this item used, as a number.
If the photo does not show clothing, shoes, jewelry or an accessory, reply with {"error":"not_clothing"}.`;

// Gemma's reply as text, skipping any "thinking" parts.
function replyText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p: any) => typeof p.text === "string" && !p.thought).map((p: any) => p.text).join("\n");
}

// Pull the last JSON object out of the reply (models sometimes wrap it in ``` fences or add a sentence).
function extractJson(text: string): any {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

// Only pass through values the listing form accepts.
function sanitize(raw: any) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.error === "not_clothing") return { error: "not_clothing" };
  const pick = (v: unknown, list: string[]) => list.find(x => typeof v === "string" && x.toLowerCase() === v.trim().toLowerCase()) ?? "";
  const str = (v: unknown, max: number) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
  const price = Math.round(Number(raw.price));
  return {
    title: str(raw.title, 90),
    category: pick(raw.category, CATS),
    size: pick(raw.size, SIZES),
    condition: pick(raw.condition, CONDS),
    events: [...new Set((Array.isArray(raw.events) ? raw.events : []).map((e: unknown) => pick(e, EVENTS)).filter(Boolean))].slice(0, 3),
    themes: [...new Set((Array.isArray(raw.themes) ? raw.themes : []).map((t: unknown) => pick(t, THEMES)).filter(Boolean))].slice(0, 3),
    description: str(raw.description, 600),
    price: price >= 1 && price <= 9999 ? price : null,
  };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "not_configured" }, 503);

  // Signed-in students only.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;
  const { data: profile } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (!profile) return json({ error: "unauthorized" }, 401);

  let image = "";
  try { image = String((await req.json())?.image || ""); } catch { /* handled below */ }
  image = image.replace(/^data:image\/\w+;base64,/, "");
  if (!image || image.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/=]+$/.test(image)) return json({ error: "bad_image" }, 400);

  const { data: allowed, error: limitErr } = await admin.rpc("bump_ai_usage", { p_user: userId, p_limit: DAILY_LIMIT });
  if (limitErr) return json({ error: "server_error" }, 500);
  if (!allowed) return json({ error: "daily_limit", limit: DAILY_LIMIT }, 429);

  const res = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: "image/jpeg", data: image } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
    }),
  }).catch(() => null);
  if (!res) return json({ error: "ai_unavailable" }, 502);
  if (!res.ok) {
    console.error("Gemma error", res.status, (await res.text()).slice(0, 500));
    return json({ error: res.status === 429 ? "ai_busy" : "ai_unavailable" }, 502);
  }

  const result = sanitize(extractJson(replyText(await res.json())));
  if (!result) return json({ error: "ai_unreadable" }, 502);
  if ("error" in result) return json(result, 422);
  return json({ ...result, model: MODEL });
});
