// Supabase project settings: Dashboard -> Project Settings -> API (or "API Keys").
// The anon / publishable key is meant to be public; Row Level Security in supabase/schema.sql
// is what keeps each user's ledger private. Never put the service_role / secret key here.
window.TT_CONFIG = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  key: "YOUR_ANON_OR_PUBLISHABLE_KEY"
};
