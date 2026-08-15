function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json").send(JSON.stringify(body));
}

function databaseConfig() {
  return {
    url: String(process.env.SUPABASE_URL || "").replace(/\/$/, ""),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

function serviceHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function authenticatedContext(req) {
  const { url, key } = databaseConfig();
  if (!url || !key) {
    const error = new Error("Backend is not configured.");
    error.status = 503;
    throw error;
  }

  const token = bearerToken(req);
  if (!token) {
    const error = new Error("Sign in is required.");
    error.status = 401;
    throw error;
  }

  const userResponse = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
    },
  });
  const user = await readJson(userResponse);
  if (!userResponse.ok || !user?.id) {
    const error = new Error("Your session is invalid or expired.");
    error.status = 401;
    throw error;
  }

  const profileResponse = await fetch(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,email,full_name,player_name,role,must_change_password&limit=1`,
    { headers: serviceHeaders(key) },
  );
  const profiles = await readJson(profileResponse);
  if (!profileResponse.ok) {
    const error = new Error(profiles.message || "Profile lookup failed.");
    error.status = profileResponse.status;
    throw error;
  }
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile) {
    const error = new Error("Your account is not connected to a TennisRank profile.");
    error.status = 403;
    throw error;
  }

  return { url, key, token, user, profile };
}

async function rest(context, path, options = {}) {
  const response = await fetch(`${context.url}/rest/v1/${path}`, {
    ...options,
    headers: serviceHeaders(context.key, options.headers || {}),
  });
  const payload = await readJson(response);
  return { response, payload };
}

async function rpc(context, name, body) {
  return rest(context, `rpc/${name}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body || {}),
  });
}

function allowApi(res, methods = "GET,POST,OPTIONS") {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return req.body;
}

module.exports = {
  json,
  databaseConfig,
  serviceHeaders,
  bearerToken,
  authenticatedContext,
  rest,
  rpc,
  allowApi,
  parseBody,
};
