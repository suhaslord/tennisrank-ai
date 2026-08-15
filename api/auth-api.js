const crypto = require("node:crypto");
const {
  json,
  databaseConfig,
  serviceHeaders,
  authenticatedContext,
  rest,
  allowApi,
  parseBody,
} = require("./_supabase");

const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_BZji9SdA4yiH9Yv7NAv2Xg_trv0KYxx";

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function configRoute(req, res) {
  allowApi(res, "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." });

  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return json(res, 503, { error: "Login is not configured yet." });
  return json(res, 200, { supabaseUrl, publishableKey });
}

async function sessionRoute(req, res) {
  allowApi(res, "GET,PATCH,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const context = await authenticatedContext(req);
    if (req.method === "GET") return json(res, 200, { profile: context.profile });

    if (req.method === "PATCH") {
      const body = parseBody(req);
      if (body.passwordChanged !== true) return json(res, 400, { error: "Unsupported session update." });
      const result = await rest(context, `profiles?id=eq.${encodeURIComponent(context.profile.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ must_change_password: false, updated_at: new Date().toISOString() }),
      });
      if (!result.response.ok) {
        return json(res, result.response.status, { error: result.payload.message || "Account setup could not be completed." });
      }
      const profile = Array.isArray(result.payload) ? result.payload[0] : context.profile;
      return json(res, 200, { profile });
    }

    return json(res, 405, { error: "Method not allowed." });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || "Unexpected session error." });
  }
}

async function bootstrapRoute(req, res) {
  allowApi(res, "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  const { url, key } = databaseConfig();
  if (!url || !key) return json(res, 503, { error: "Backend is not configured." });
  const setupToken = process.env.BACKEND_WRITE_TOKEN || "";
  if (!setupToken || !safeEqual(req.headers["x-admin-token"], setupToken)) {
    return json(res, 401, { error: "The admin setup code is invalid." });
  }

  try {
    const existingResponse = await fetch(`${url}/rest/v1/profiles?role=eq.admin&select=id&limit=1`, {
      headers: serviceHeaders(key),
    });
    const existing = await readJson(existingResponse);
    if (!existingResponse.ok) return json(res, existingResponse.status, { error: existing.message || "Admin lookup failed." });
    if (Array.isArray(existing) && existing.length) return json(res, 409, { error: "The first admin account has already been created." });

    const body = parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: "Enter a valid admin email." });
    if (password.length < 10) return json(res, 400, { error: "Admin password must be at least 10 characters." });

    const authResponse = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: serviceHeaders(key),
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const authPayload = await readJson(authResponse);
    if (!authResponse.ok) {
      return json(res, authResponse.status, {
        error: authPayload.msg || authPayload.message || authPayload.error || "Admin auth account could not be created.",
      });
    }
    const user = authPayload.user || authPayload;
    if (!user?.id) return json(res, 500, { error: "Supabase did not return an admin user ID." });

    const displayName = email.split("@")[0]
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, char => char.toUpperCase()) || "Tennis Coach";
    const profileResponse = await fetch(`${url}/rest/v1/profiles`, {
      method: "POST",
      headers: serviceHeaders(key, { Prefer: "return=representation" }),
      body: JSON.stringify({
        id: user.id,
        email,
        full_name: displayName,
        player_name: null,
        role: "admin",
        must_change_password: false,
        updated_at: new Date().toISOString(),
      }),
    });
    const profilePayload = await readJson(profileResponse);
    if (!profileResponse.ok) {
      await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
        headers: serviceHeaders(key),
      }).catch(() => {});
      return json(res, profileResponse.status, { error: profilePayload.message || "Admin profile could not be created." });
    }

    return json(res, 201, { created: true });
  } catch (error) {
    return json(res, 500, { error: error.message || "Unexpected admin setup error." });
  }
}

module.exports = async function handler(req, res) {
  const route = String(req.query?.route || "").trim().toLowerCase();
  if (route === "config") return configRoute(req, res);
  if (route === "session") return sessionRoute(req, res);
  if (route === "bootstrap") return bootstrapRoute(req, res);
  return json(res, 404, { error: "Unknown auth route." });
};
