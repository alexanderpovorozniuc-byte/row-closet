// Supabase project connection (Project Settings → API Keys).
// The publishable key is meant to be public; the database rules in supabase/schema.sql protect the data.
window.SWAP_ROW_CONFIG = {
  supabaseUrl: "https://sdpkamzlrsjcawxmkxvb.supabase.co",
  supabaseAnonKey: "sb_publishable_B2K6YR68iMHntMA_AN2oXg_XWYNtHOA",
  // Turn on after deploying supabase/functions/autofill and adding GEMINI_API_KEY (see README).
  aiAutofill: false,
};
