const { json, allowApi } = require("./_supabase");

// Supabase publishable keys are intentionally safe for browser use. Keep the
// environment variable as the primary source, but retain the known-good
// project publishable key so direct Vercel deployments cannot break sign-in
// when the public-key env binding is missing.
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_BZji9SdA4yiH9Yv7NAv2Xg_trv0KYxx";

module.exports = async function handler(req, res) {
  allowApi(res, "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." });

  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return json(res, 503, { error: "Login is not configured yet." });

  return json(res, 200, { supabaseUrl, publishableKey });
};
