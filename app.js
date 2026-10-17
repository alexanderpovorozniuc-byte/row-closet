const EVENTS = ["Date Party", "Formal", "Semi-Formal", "Game Day", "Bid Day", "Rush / Recruitment", "Philanthropy", "Theme Party", "Big/Little", "Everyday"];
const CATS = ["Dress", "Top", "Bottoms", "Set / Jumpsuit", "Shoes", "Accessories", "Jewelry", "Costume", "Outerwear", "Other"];
const SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "0", "2", "4", "6", "8", "10", "12", "14", "Shoe 5", "Shoe 6", "Shoe 7", "Shoe 8", "Shoe 9", "Shoe 10", "One size"];
const CONDS = ["New with tags", "Worn once", "Gently used", "Well loved"];
const BUCKET = "listing-photos";

const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
};

const CFG = window.SWAP_ROW_CONFIG || {};
const configured = !!CFG.supabaseUrl && !CFG.supabaseUrl.includes("YOUR-PROJECT") && !!window.supabase;
const sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
  auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true },
}) : null;

const S = {
  universities: [], providers: {}, choice: null, pendingEmail: "",
  session: null, profile: null, uni: null,
  listings: [], loaded: false,
  view: "all", event: "", q: "", cat: "", size: "",
  saved: new Set(),
};
try { S.saved = new Set(JSON.parse(localStorage.getItem("rc-saved") || "[]")); } catch {}
const persistSaved = () => { try { localStorage.setItem("rc-saved", JSON.stringify([...S.saved])); } catch {} };

let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2800); }
function show(id) { for (const s of ["gate", "onboard", "market", "inbox", "setupMsg"]) $("#" + s).hidden = s !== id; }

/* ---------- sign in ---------- */
const domainOf = email => (email.split("@")[1] || "").toLowerCase();
const domainOk = (email, uni) => uni.email_domains.some(d => domainOf(email) === d || domainOf(email).endsWith("." + d));
const gateErr = msg => { $("#gateErr").textContent = msg || ""; };

function friendlyAuthError(msg = "") {
  if (/database error|students only|saving new user/i.test(msg))
    return "That account isn't a student email we recognize. Sign in with your university email.";
  if (/admin|consent|approval/i.test(msg))
    return "Your school's login needs IT approval for Swap Row first. Use an email code for now.";
  if (/rate|too many/i.test(msg)) return "Too many tries. Wait a minute, then try again.";
  if (/expired|invalid/i.test(msg)) return "That code didn't work or has expired. Request a new one.";
  return msg || "Something went wrong signing in. Try again.";
}

function renderGate() {
  const featured = S.universities.filter(u => u.priority === 0);
  const others = S.universities.filter(u => u.priority !== 0).sort((a, b) => a.name.localeCompare(b.name));
  $("#featured").replaceChildren(...featured.map(u => h("button", {
    class: "school", type: "button", "aria-pressed": String(S.choice?.id === u.id), onclick: () => choose(u),
  }, h("span", { class: "mark", "aria-hidden": "true" }, u.short_name[0]), h("strong", {}, u.name),
     h("small", {}, u.sso_label && S.providers[u.sso_provider] === true ? `Sign in with ${u.sso_label} · @${u.email_domains[0]}` : `@${u.email_domains[0]}`))));
  const sel = $("#schoolSel");
  sel.replaceChildren(h("option", { value: "" }, "Pick your school"), ...others.map(u => h("option", { value: u.id }, u.name)));
  sel.value = S.choice && S.choice.priority !== 0 ? S.choice.id : "";
}
$("#schoolSel").addEventListener("change", e => { const u = S.universities.find(x => x.id === e.target.value); if (u) choose(u); });

function choose(uni, forceEmail = false) {
  S.choice = uni; gateErr(""); renderGate();
  // Only offer school SSO once it is switched on in Supabase; otherwise go straight to email codes.
  const ssoReady = !!uni.sso_provider && S.providers[uni.sso_provider] === true;
  const sso = ssoReady && !forceEmail;
  $("#ssoPanel").hidden = !sso;
  $("#emailPanel").hidden = sso;
  $("#codePanel").hidden = true;
  if (sso) {
    $("#ssoBtn").textContent = `Continue with ${uni.sso_label || uni.short_name + " login"}`;
    $("#ssoNote").textContent = `You'll sign in on ${uni.short_name}'s own login page with your @${uni.email_domains[0]} account. Swap Row never sees your password.`;
  } else {
    $("#email").placeholder = `you@${uni.email_domains[0]}`;
    $("#emailNote").textContent = `Use your @${uni.email_domains.join(" or @")} address. We'll email you a 6-digit code.`;
    $("#backToSso").hidden = !ssoReady;
    $("#email").focus();
  }
}

$("#ssoBtn").addEventListener("click", async () => {
  const uni = S.choice; gateErr("");
  const { error } = await sb.auth.signInWithOAuth({
    provider: uni.sso_provider,
    options: {
      scopes: "openid email profile",
      redirectTo: location.origin + location.pathname,
      queryParams: { domain_hint: uni.sso_domain_hint || "", prompt: "select_account" },
    },
  });
  if (error) gateErr(friendlyAuthError(error.message));
});
$("#useCode").addEventListener("click", () => choose(S.choice, true));
$("#backToSso").addEventListener("click", () => choose(S.choice));

$("#emailPanel").addEventListener("submit", async ev => {
  ev.preventDefault(); gateErr("");
  const email = $("#email").value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return gateErr("Enter your full school email address.");
  if (!domainOk(email, S.choice)) return gateErr(`Use your @${S.choice.email_domains[0]} student email. Personal and staff emails can't join.`);
  const btn = $("#sendBtn"); btn.disabled = true; btn.textContent = "Sending…";
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
  btn.disabled = false; btn.textContent = "Email me a sign-in code";
  if (error) return gateErr(friendlyAuthError(error.message));
  S.pendingEmail = email;
  $("#emailPanel").hidden = true; $("#codePanel").hidden = false;
  $("#codeSentTo").textContent = `We sent a code to ${email}. It can take a minute, so check your junk folder too.`;
  $("#code").value = ""; $("#code").focus();
});

$("#codePanel").addEventListener("submit", async ev => {
  ev.preventDefault(); gateErr("");
  const token = $("#code").value.replace(/\s/g, "");
  if (!/^\d{6,10}$/.test(token)) return gateErr("Enter the code from the email.");
  const btn = $("#verifyBtn"); btn.disabled = true; btn.textContent = "Checking…";
  const { error } = await sb.auth.verifyOtp({ email: S.pendingEmail, token, type: "email" });
  btn.disabled = false; btn.textContent = "Sign in";
  if (error) gateErr(friendlyAuthError(error.message));
});
$("#restart").addEventListener("click", () => choose(S.choice, true));

/* ---------- routing ---------- */
async function route() {
  const { data: { session } } = await sb.auth.getSession();
  S.session = session;
  if (!session) { S.profile = null; stopMessaging(); renderHeader(); show("gate"); if (S.choice) choose(S.choice); else renderGate(); return; }
  const { data: profile, error } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (error || !profile) {
    await sb.auth.signOut();
    gateErr("We couldn't verify that account as a student. Sign in with your university email.");
    return;
  }
  S.profile = profile;
  S.uni = S.universities.find(u => u.id === profile.university_id) || { id: profile.university_id, short_name: profile.university_id, name: profile.university_id };
  renderHeader();
  if (!profile.display_name || !profile.contact) { fillProfileForm(); show("onboard"); return; }
  show("market"); buildFilters(); render(); loadListings(); startMessaging();
}

function renderHeader() {
  const signedIn = !!(S.session && S.profile);
  $("#who").hidden = !signedIn; $("#listBtn").hidden = $("#msgBtn").hidden = !signedIn || !S.profile?.display_name;
  if (!signedIn) return;
  $("#who").replaceChildren(
    h("span", { class: "badge", title: `Verified ${S.uni.name} student` }, "✓ " + S.uni.short_name),
    h("b", {}, S.profile.display_name || S.session.user.email),
    h("button", { class: "linkish", type: "button", onclick: async () => { S.listings = []; S.loaded = false; await sb.auth.signOut(); } }, "Sign out"));
}

function fillProfileForm() {
  $("#pf-name").value = S.profile.display_name || (S.session.user.user_metadata?.full_name || "").split(" ")[0] || "";
  $("#pf-chapter").value = S.profile.chapter || "";
  $("#pf-contact").value = S.profile.contact || "";
}
$("#profileForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const display_name = $("#pf-name").value.trim(), chapter = $("#pf-chapter").value.trim(), contact = $("#pf-contact").value.trim();
  if (!display_name) return $("#pfErr").textContent = "Add your first name.";
  if (!contact) return $("#pfErr").textContent = "Add a way for buyers to reach you.";
  const { error } = await sb.from("profiles").update({ display_name, chapter, contact }).eq("id", S.profile.id);
  if (error) return $("#pfErr").textContent = "Couldn't save. Check your connection and try again.";
  route();
});

/* ---------- data ---------- */
const photoUrl = path => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
function normalize(r) {
  return {
    id: r.id, seller: r.seller_id, title: r.title, cat: r.category, size: r.size, cond: r.condition, price: r.price,
    events: r.events || [], desc: r.description, status: r.status, createdAt: Date.parse(r.created_at) || 0,
    photos: (r.photos || []).map(path => ({ path, url: photoUrl(path) })),
    name: r.seller?.display_name || "", chapter: r.seller?.chapter || "", contact: r.seller?.contact || "",
  };
}
async function loadListings() {
  const { data, error } = await sb.from("listings")
    .select("*, seller:profiles(display_name, chapter, contact)")
    .order("created_at", { ascending: false }).limit(500);
  if (error) { toast("Couldn't load listings. Check your connection"); return; }
  S.listings = data.map(normalize)
    .sort((a, b) => (a.status === "sold") - (b.status === "sold") || b.createdAt - a.createdAt);
  S.loaded = true; render();
  const dlg = $("#detail"); if (dlg.open && dlg.dataset.id) openDetail(dlg.dataset.id);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !S.profile?.display_name) return;
  if (!$("#market").hidden) loadListings();
  loadConversations(); if (M.open) refreshThread();
});

/* ---------- formatting ---------- */
const priceText = it => `$${it.price}`;
const sellerName = it => it.seller === S.profile?.id ? "You" : (it.name || "A student");
function photoEl(it, i = 0) {
  const p = it.photos[i];
  if (!p) return h("span", { class: "ph", "aria-hidden": "true" }, (it.cat || "?")[0]);
  const img = h("img", { alt: it.title, loading: "lazy" }); img.src = p.url; return img;
}

/* ---------- filters ---------- */
function buildFilters() {
  const mk = (label, val) => h("button", { class: "chip", type: "button", "aria-pressed": String(S.event === val), onclick: () => { S.event = val; buildFilters(); render(); } }, label);
  $("#eventChips").replaceChildren(mk("All events", ""), ...EVENTS.map(e => mk(e, e)));
  const opts = (sel, first, list) => { const cur = sel.value; sel.replaceChildren(h("option", { value: "" }, first), ...list.map(v => h("option", { value: v }, v))); sel.value = cur; };
  opts($("#fCat"), "Any category", CATS);
  opts($("#fSize"), "Any size", SIZES);
  $("#introText").textContent = `Buy outfits from people on the row at ${S.uni.short_name}, and sell the ones you're done with. Filter by the event you're dressing for, then message the seller to meet up on campus.`;
}
$("#q").addEventListener("input", e => { S.q = e.target.value.trim().toLowerCase(); render(); });
$("#fCat").addEventListener("change", e => { S.cat = e.target.value; render(); });
$("#fSize").addEventListener("change", e => { S.size = e.target.value; render(); });
document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => {
  S.view = b.dataset.view;
  document.querySelectorAll("[data-view]").forEach(x => x.classList.toggle("on", x === b));
  render();
}));

/* ---------- rack ---------- */
function render() {
  const rack = $("#rack");
  let items = S.listings;
  if (S.view === "mine") items = items.filter(i => i.seller === S.profile.id);
  if (S.view === "saved") items = items.filter(i => S.saved.has(i.id));
  if (S.event) items = items.filter(i => i.events.includes(S.event));
  if (S.cat) items = items.filter(i => i.cat === S.cat);
  if (S.size) items = items.filter(i => i.size === S.size);
  if (S.q) items = items.filter(i => [i.title, i.desc, i.cat, i.chapter, ...i.events].join(" ").toLowerCase().includes(S.q));

  const total = S.listings.filter(i => i.status !== "sold").length;
  $("#count").textContent = !S.loaded ? "Loading the rack…" : `${items.length} shown · ${total} available at ${S.uni.short_name}`;

  if (!items.length) {
    const filtered = S.event || S.cat || S.size || S.q;
    const empty = !S.loaded ? h("div", { class: "empty" }, h("h3", {}, "Loading…"))
      : S.view === "mine" ? h("div", { class: "empty" }, h("h3", {}, "Your closet is empty"), h("p", {}, "List the dress you wore once to formal, the boots from the western date party, or the jersey from game day."), h("button", { class: "btn primary", type: "button", onclick: () => openEditor() }, "+ List your first item"))
      : S.view === "saved" ? h("div", { class: "empty" }, h("h3", {}, "Nothing saved yet"), h("p", {}, "Tap the heart on any listing to keep it here."))
      : filtered ? h("div", { class: "empty" }, h("h3", {}, "No matches"), h("p", {}, "Try another size or event, or clear the search."))
      : h("div", { class: "empty" }, h("h3", {}, "The rack is empty, for now"), h("p", {}, `Be the first at ${S.uni.short_name} to post. Only verified students at your school can see listings.`), h("button", { class: "btn primary", type: "button", onclick: () => openEditor() }, "+ List the first item"));
    rack.replaceChildren(empty);
    return;
  }

  rack.replaceChildren(...items.map(it => {
    const saved = S.saved.has(it.id);
    return h("article", { class: "card" + (it.status === "sold" ? " sold" : "") },
      h("button", { class: "photo", type: "button", style: "border:0;padding:0;cursor:pointer", "aria-label": `Open ${it.title}`, onclick: () => openDetail(it.id) },
        photoEl(it),
        it.status !== "available" ? h("span", { class: "status" }, it.status === "sold" ? "Sold" : "On hold") : null),
      h("button", { class: "heart", type: "button", "aria-pressed": String(saved), "aria-label": saved ? "Remove from saved" : "Save", onclick: e => {
        e.stopPropagation(); saved ? S.saved.delete(it.id) : S.saved.add(it.id); persistSaved(); render();
      } }, saved ? "♥" : "♡"),
      h("div", { class: "body" },
        h("div", { class: "row" }, h("span", { class: "price" }, priceText(it)), it.size ? h("span", { class: "size" }, it.size) : null),
        h("h3", {}, it.title),
        h("div", { class: "seller" }, sellerName(it) + (it.chapter ? " · " + it.chapter : ""))));
  }));
}

/* ---------- detail ---------- */
function openDetail(id, photoIdx = 0) {
  const it = S.listings.find(i => i.id === id); const dlg = $("#detail");
  if (!it) { if (dlg.open) dlg.close(); return; }
  dlg.dataset.id = id;
  const mine = it.seller === S.profile.id;
  const thumbs = it.photos.length > 1 ? h("div", { class: "thumbs" }, it.photos.map((p, i) => h("button", { type: "button", "aria-current": String(i === photoIdx), "aria-label": `Photo ${i + 1}`, onclick: () => openDetail(id, i) }, photoEl(it, i)))) : null;

  let delArmed = false;
  const delBtn = h("button", { class: "btn", type: "button", onclick: async () => {
    if (!delArmed) { delArmed = true; delBtn.textContent = "Tap again to delete"; return; }
    const { error } = await sb.from("listings").delete().eq("id", id);
    if (error) return toast("Couldn't delete. Try again");
    if (it.photos.length) sb.storage.from(BUCKET).remove(it.photos.map(p => p.path));
    dlg.close(); toast("Listing deleted"); loadListings();
  } }, "Delete");

  const setStatus = async st => {
    const { error } = await sb.from("listings").update({ status: st }).eq("id", id);
    if (error) return toast("Couldn't update. Try again");
    toast(st === "sold" ? "Marked sold" : st === "pending" ? "Marked on hold" : "Back on the rack"); loadListings();
  };
  const statusBtns = ["available", "pending", "sold"].map(st => h("button", { class: "btn" + (it.status === st ? " on" : ""), type: "button", onclick: () => setStatus(st) }, st === "available" ? "Available" : st === "pending" ? "On hold" : "Sold"));

  const copyBtn = h("button", { class: "btn", type: "button", onclick: async () => {
    try { await navigator.clipboard.writeText(it.contact); toast("Copied"); }
    catch { const r = document.createRange(); r.selectNodeContents($(".handle", dlg)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Selected. Copy it from here"); }
  } }, "Copy");

  dlg.replaceChildren(h("div", { class: "sheet" },
    h("div", { class: "sheet-head" }, h("h2", {}, it.title), h("button", { class: "x", type: "button", "aria-label": "Close", onclick: () => dlg.close() }, "✕")),
    h("div", { class: "detail" },
      h("div", { class: "gallery" }, h("div", { class: "main" }, photoEl(it, photoIdx)), thumbs),
      h("div", { class: "facts" },
        h("div", { class: "row" }, h("span", { class: "big" }, priceText(it)), it.status !== "available" ? h("span", { class: "tag", style: "background:var(--line);color:var(--muted)" }, it.status === "sold" ? "Sold" : "On hold") : null),
        h("dl", { class: "spec" },
          it.size ? [h("dt", {}, "Size"), h("dd", {}, it.size)] : null,
          it.cat ? [h("dt", {}, "Type"), h("dd", {}, it.cat)] : null,
          it.cond ? [h("dt", {}, "Condition"), h("dd", {}, it.cond)] : null,
          it.events.length ? [h("dt", {}, "Good for"), h("dd", {}, it.events.join(", "))] : null,
          [h("dt", {}, "From"), h("dd", {}, sellerName(it) + (it.chapter ? " · " + it.chapter : ""))]),
        it.desc ? h("p", { class: "desc" }, it.desc) : null,
        mine ? h("div", { class: "contact" },
            h("div", { class: "label" }, "Listing status"), h("div", { class: "owner-actions" }, statusBtns),
            h("div", { class: "owner-actions" }, h("button", { class: "btn primary", type: "button", onclick: () => { dlg.close(); openEditor(it); } }, "Edit listing"), delBtn))
          : h("div", { class: "contact" },
            h("button", { class: "btn primary", type: "button", onclick: e => messageSeller(it.id, e.currentTarget) }, existingChat(it.id) ? "Open chat" : "Message seller"),
            it.contact ? [h("div", { class: "label" }, "Or reach them at"), h("div", { class: "row" }, h("span", { class: "handle" }, it.contact), copyBtn)] : null,
            h("small", { style: "color:var(--muted)" }, "Meet somewhere public on campus. Pay when you see it."))))));
  if (!dlg.open) dlg.showModal();
}

/* ---------- editor ---------- */
function openEditor(existing) {
  const dlg = $("#editor");
  const it = existing ? { ...existing, photos: [...existing.photos] } : { id: "", title: "", cat: "Dress", size: "", cond: "Worn once", price: "", events: [], desc: "", photos: [], status: "available" };
  const photos = it.photos.slice(); const added = []; let uploading = 0;

  const upWrap = h("div", { class: "uploads" });
  const fileIn = h("input", { type: "file", id: "ed-file", accept: "image/*", multiple: true, hidden: true });
  function drawUploads() {
    upWrap.replaceChildren(
      ...photos.map((p, i) => { const img = h("img", { alt: "" }); img.src = p.url; return h("div", { class: "u" }, img, h("button", { type: "button", "aria-label": "Remove photo", onclick: () => { photos.splice(i, 1); drawUploads(); } }, "✕")); }),
      ...Array.from({ length: uploading }, () => h("div", { class: "u" }, "Uploading…")),
      photos.length + uploading < 4 ? h("button", { class: "u add", type: "button", "aria-label": "Add photos", onclick: () => fileIn.click() }, "+") : null);
  }
  fileIn.addEventListener("change", async () => {
    const files = [...fileIn.files].slice(0, 4 - photos.length - uploading); fileIn.value = "";
    uploading += files.length; drawUploads();
    for (const f of files) {
      try {
        const blob = await shrink(f);
        const path = `${S.profile.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
        if (error) throw error;
        const p = { path, url: photoUrl(path) }; photos.push(p); added.push(path);
      } catch { toast("That photo didn't upload. Try a JPG or PNG"); }
      uploading--; drawUploads();
    }
  });
  drawUploads();

  const sel = (id, list, val) => { const s = h("select", { id }, list.map(([v, l]) => h("option", { value: v }, l))); s.value = val; return s; };
  const err = h("span", { class: "err", role: "alert" });
  const saveBtn = h("button", { class: "btn primary", type: "submit" }, existing ? "Save changes" : "Post listing");
  const form = h("form", { class: "sheet", novalidate: true },
    h("div", { class: "sheet-head" }, h("h2", {}, existing ? "Edit listing" : "List an item"), h("button", { class: "x", type: "button", "aria-label": "Close", onclick: () => dlg.close() }, "✕")),
    h("div", { class: "field" }, h("span", {}, "Photos (up to 4)"), upWrap, fileIn, h("small", {}, "Good light, full-length if it's a dress. The first photo is the cover.")),
    h("label", { class: "field" }, h("span", {}, "Title"), h("input", { id: "ed-title", type: "text", maxlength: "90", required: true, placeholder: "Red satin slip dress, midi", value: it.title })),
    h("div", { class: "grid2" },
      h("label", { class: "field" }, h("span", {}, "Category"), sel("ed-cat", CATS.map(c => [c, c]), it.cat)),
      h("label", { class: "field" }, h("span", {}, "Size"), sel("ed-size", [["", "Pick a size"], ...SIZES.map(s => [s, s])], it.size)),
      h("label", { class: "field" }, h("span", {}, "Condition"), sel("ed-cond", CONDS.map(c => [c, c]), it.cond)),
      h("label", { class: "field" }, h("span", {}, "Price ($)"), h("input", { id: "ed-price", type: "number", min: "1", max: "9999", step: "1", inputmode: "numeric", placeholder: "25", value: it.price === "" ? "" : String(it.price) }))),
    h("fieldset", { class: "field", style: "border:0;padding:0;margin:0" }, h("span", {}, "Good for"),
      h("div", { class: "pickset" }, EVENTS.map((e, i) => h("label", {}, h("input", { type: "checkbox", id: "ed-ev-" + i, value: e, checked: it.events.includes(e) }), h("span", {}, e))))),
    h("label", { class: "field" }, h("span", {}, "Details"), h("textarea", { id: "ed-desc", rows: "3", maxlength: "1200", placeholder: "Brand, fit notes, pickup spot, whether you'll hold it for a few days…" }, it.desc)),
    h("div", { class: "grid2" },
      h("label", { class: "field" }, h("span", {}, "Your chapter"), h("input", { id: "ed-chapter", type: "text", maxlength: "60", placeholder: "e.g. Alpha Chi Omega", value: S.profile.chapter })),
      h("label", { class: "field" }, h("span", {}, "How buyers reach you"), h("input", { id: "ed-contact", type: "text", maxlength: "80", placeholder: "IG @yourhandle or text 205-555-…", value: S.profile.contact }), h("small", {}, `Shown on your listings to verified ${S.uni.short_name} students.`))),
    h("div", { class: "formfoot" }, err, saveBtn));
  dlg.replaceChildren(form);
  // Clean up photos uploaded for a listing that was never saved.
  dlg.addEventListener("close", () => { if (added.length && !form.dataset.saved) sb.storage.from(BUCKET).remove(added); }, { once: true });

  form.addEventListener("submit", async ev => {
    ev.preventDefault(); err.textContent = "";
    const v = id => $("#" + id, form).value.trim();
    const title = v("ed-title"), price = Math.round(+v("ed-price") || 0), contact = v("ed-contact"), chapter = v("ed-chapter");
    if (!title) { err.textContent = "Add a title so people know what it is."; return; }
    if (!(price >= 1 && price <= 9999)) { err.textContent = "Add a price between $1 and $9,999."; return; }
    if (!contact) { err.textContent = "Add a way for buyers to reach you."; return; }
    if (uploading) { err.textContent = "Wait for photos to finish uploading."; return; }
    const row = {
      title, category: v("ed-cat"), size: v("ed-size"), condition: v("ed-cond"), price,
      events: [...form.querySelectorAll(".pickset input:checked")].map(x => x.value),
      description: v("ed-desc"), photos: photos.map(p => p.path),
    };
    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    if (contact !== S.profile.contact || chapter !== S.profile.chapter) {
      const { error } = await sb.from("profiles").update({ contact, chapter }).eq("id", S.profile.id);
      if (!error) Object.assign(S.profile, { contact, chapter });
    }
    const { error } = existing
      ? await sb.from("listings").update(row).eq("id", existing.id)
      : await sb.from("listings").insert(row);
    if (error) { saveBtn.disabled = false; saveBtn.textContent = existing ? "Save changes" : "Post listing"; err.textContent = "Couldn't save. Check your connection and try again."; return; }
    form.dataset.saved = "1";
    const removed = existing ? existing.photos.map(p => p.path).filter(p => !row.photos.includes(p)) : [];
    if (removed.length) sb.storage.from(BUCKET).remove(removed);
    dlg.close(); toast(existing ? "Listing updated" : "Posted to the rack"); loadListings();
  });
  dlg.showModal();
}
$("#listBtn").addEventListener("click", () => openEditor());

/* Downscale phone photos and convert to JPEG before upload so the rack loads fast. */
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("encode")), "image/jpeg", 0.85));
}

/* ---------- messages ---------- */
const M = { convs: [], names: {}, open: null, msgs: [], channel: null, poll: null };
const otherId = c => c.buyer_id === S.profile.id ? c.seller_id : c.buyer_id;
const myLastRead = c => c.buyer_id === S.profile.id ? c.buyer_last_read : c.seller_last_read;
const isUnread = c => !!c.last_sender_id && c.last_sender_id !== S.profile.id && (!myLastRead(c) || new Date(c.last_message_at) > new Date(myLastRead(c)));
const existingChat = listingId => M.convs.find(c => c.listing_id === listingId && c.buyer_id === S.profile.id);
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtWhen = iso => sameDay(iso, Date.now()) ? fmtTime(iso) : new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

function startMessaging() {
  loadConversations();
  if (M.channel) return;
  // Live delivery; the database rules only send this user their own chats.
  M.channel = sb.channel("inbox")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, ({ new: m }) => onNewMessage(m))
    .subscribe();
  // Backup in case live updates are blocked on this network.
  M.poll = setInterval(() => { if (!document.hidden) { loadConversations(); if (M.open) refreshThread(); } }, 20000);
}
function stopMessaging() {
  if (M.channel) sb.removeChannel(M.channel);
  clearInterval(M.poll);
  Object.assign(M, { convs: [], open: null, msgs: [], channel: null, poll: null });
  if ($("#thread").open) $("#thread").close();
  renderBadge();
}

async function loadConversations() {
  if (!S.profile) return;
  const { data, error } = await sb.from("conversations")
    .select("*, listing:listings(photos, price, status)")
    .order("last_message_at", { ascending: false }).limit(200);
  if (error) return;
  M.convs = data;
  const missing = [...new Set(data.map(otherId))].filter(id => !(id in M.names));
  if (missing.length) {
    const { data: ps } = await sb.from("profiles").select("id, display_name").in("id", missing);
    for (const p of ps || []) M.names[p.id] = p.display_name;
  }
  renderBadge();
  if (!$("#inbox").hidden) renderInbox();
}

function renderBadge() {
  const n = S.profile ? M.convs.filter(isUnread).length : 0;
  $("#msgBadge").hidden = !n; $("#msgBadge").textContent = n;
  $("#msgBtn").setAttribute("aria-label", n ? `Messages, ${n} unread` : "Messages");
}

function renderInbox() {
  const list = $("#convList");
  if (!M.convs.length) {
    list.replaceChildren(h("div", { class: "empty" }, h("h3", {}, "No messages yet"),
      h("p", {}, "Tap “Message seller” on any listing to ask about size, fit or pickup. Buyers who message you about your listings show up here too.")));
    return;
  }
  list.replaceChildren(...M.convs.map(c => {
    const photo = c.listing?.photos?.[0];
    const thumb = h("span", { class: "thumb", "aria-hidden": "true" });
    if (photo) { const img = h("img", { alt: "" }); img.src = photoUrl(photo); thumb.append(img); } else thumb.append(c.listing_title[0] || "?");
    const unread = isUnread(c);
    const selling = c.seller_id === S.profile.id;
    return h("button", { class: "conv" + (unread ? " unread" : ""), type: "button", onclick: () => openThread(c.id) },
      thumb,
      h("span", { style: "min-width:0" },
        h("span", { class: "who" }, M.names[otherId(c)] || "A student"),
        h("span", { class: "what" }, (selling ? "Your listing · " : "") + c.listing_title),
        h("span", { class: "last" }, c.last_message ? (c.last_sender_id === S.profile.id ? "You: " : "") + c.last_message : "No messages yet")),
      h("span", { class: "when" }, c.last_message ? fmtWhen(c.last_message_at) : "", unread ? h("span", { class: "dot", "aria-label": "Unread" }) : null));
  }));
}

function showInbox() { $("#detail").open && $("#detail").close(); show("inbox"); renderInbox(); loadConversations(); }
$("#msgBtn").addEventListener("click", showInbox);
$("#backToMarket").addEventListener("click", () => { show("market"); render(); });

async function messageSeller(listingId, btn) {
  if (btn) btn.disabled = true;
  const { data, error } = await sb.rpc("start_conversation", { p_listing: listingId });
  if (btn) btn.disabled = false;
  if (error) return toast("Couldn't open the chat. Try again");
  $("#detail").close();
  await loadConversations();
  openThread(data);
}

async function openThread(convId) {
  M.open = convId; M.msgs = [];
  drawThread(true);
  await refreshThread();
  markRead(convId);
}
async function refreshThread() {
  const id = M.open; if (!id) return;
  const { data, error } = await sb.from("messages").select("*").eq("conversation_id", id).order("created_at").limit(500);
  if (error || M.open !== id) return;
  const changed = data.length !== M.msgs.length;
  M.msgs = data;
  if (changed) { renderThreadMsgs(); if (data.at(-1)?.sender_id !== S.profile.id) markRead(id); }
}
async function markRead(convId) {
  await sb.rpc("mark_conversation_read", { p_conversation: convId });
  const c = M.convs.find(x => x.id === convId);
  if (c) { c[c.buyer_id === S.profile.id ? "buyer_last_read" : "seller_last_read"] = new Date().toISOString(); renderBadge(); if (!$("#inbox").hidden) renderInbox(); }
}
function onNewMessage(m) {
  if (m.conversation_id === M.open && !M.msgs.some(x => x.id === m.id)) {
    M.msgs.push(m); renderThreadMsgs();
    if (m.sender_id !== S.profile.id) markRead(m.conversation_id);
  }
  loadConversations();
}

function drawThread(fresh) {
  const dlg = $("#thread"); const c = M.convs.find(x => x.id === M.open); if (!c) return;
  const listing = c.listing_id && S.listings.find(l => l.id === c.listing_id);
  const sub = [c.listing_title, c.listing?.price ? `$${c.listing.price}` : null, c.listing?.status === "sold" ? "Sold" : c.listing_id ? null : "Listing removed"].filter(Boolean).join(" · ");
  const input = h("textarea", { id: "thread-input", rows: "1", maxlength: "1000", placeholder: "Message", "aria-label": "Message" });
  const send = h("button", { class: "btn primary", type: "submit" }, "Send");
  const form = h("form", { class: "composer" }, input, send);
  const grow = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; };
  input.addEventListener("input", grow);
  input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const body = input.value.trim(); if (!body) return;
    send.disabled = true;
    const { data, error } = await sb.from("messages").insert({ conversation_id: c.id, body }).select().single();
    send.disabled = false;
    if (error) return toast("Message didn't send. Try again");
    input.value = ""; grow(); input.focus();
    if (!M.msgs.some(x => x.id === data.id)) { M.msgs.push(data); renderThreadMsgs(); }
    loadConversations();
  });
  dlg.replaceChildren(
    h("div", { class: "thread-head" },
      h("button", { class: "x", type: "button", "aria-label": "Close chat", onclick: () => dlg.close() }, "←"),
      h("div", { class: "t" }, h("strong", {}, M.names[otherId(c)] || "A student"), h("small", {}, sub)),
      listing ? h("button", { class: "btn", type: "button", onclick: () => { dlg.close(); openDetail(listing.id); } }, "View") : null),
    h("div", { class: "msgs", id: "msgs" }),
    form);
  renderThreadMsgs();
  if (fresh) {
    if (c.buyer_id === S.profile.id && !c.last_message) input.value = `Hi! Is the ${c.listing_title} still available?`;
    if (!dlg.open) dlg.showModal();
    grow(); input.focus();
  }
}
$("#thread").addEventListener("close", () => { M.open = null; M.msgs = []; });

function renderThreadMsgs() {
  const box = $("#msgs"); if (!box) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  if (!M.msgs.length) { box.replaceChildren(h("p", { class: "hint" }, "Ask about fit, condition or a pickup spot. Keep payment for when you meet in person.")); return; }
  const out = []; let prev = null;
  for (const m of M.msgs) {
    if (!prev || !sameDay(prev.created_at, m.created_at)) out.push(h("div", { class: "day" }, sameDay(m.created_at, Date.now()) ? "Today" : new Date(m.created_at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })));
    out.push(h("div", { class: "bubble " + (m.sender_id === S.profile.id ? "me" : "them") }, m.body, h("time", {}, fmtTime(m.created_at))));
    prev = m;
  }
  box.replaceChildren(...out);
  if (atBottom || box.dataset.init !== M.open) { box.scrollTop = box.scrollHeight; box.dataset.init = M.open; }
}

/* ---------- boot ---------- */
(async () => {
  if (!sb) { show("setupMsg"); return; }
  const params = new URLSearchParams(location.search + "&" + location.hash.slice(1));
  const urlErr = params.get("error_description") || params.get("error");
  if (urlErr) history.replaceState(null, "", location.pathname);

  const { data } = await sb.from("universities").select("*").order("priority").order("name");
  S.universities = data || [];
  // Which sign-in providers are switched on (e.g. { azure: true }). Unknown → treated as off.
  try {
    const r = await fetch(CFG.supabaseUrl + "/auth/v1/settings", { headers: { apikey: CFG.supabaseAnonKey } });
    if (r.ok) S.providers = (await r.json()).external || {};
  } catch {}
  // Default the picker to the featured school.
  const featured = S.universities.find(u => u.priority === 0);
  if (featured) S.choice = featured;

  // Don't call Supabase inside the auth callback itself; defer to avoid a deadlock.
  sb.auth.onAuthStateChange(event => { if (["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) setTimeout(route, 0); });
  await route();
  if (urlErr) gateErr(friendlyAuthError(urlErr.replace(/\+/g, " ")));
})();
