const { json, allowApi } = require("./_supabase");

module.exports = async function handler(req, res) {
  allowApi(res, "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." });

  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (!supabaseUrl || !publishableKey) return json(res, 503, { error: "Login is not configured yet." });

  return json(res, 200, { supabaseUrl, publishableKey });
};
