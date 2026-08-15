const { json, authenticatedContext, rest, allowApi, parseBody } = require("./_supabase");

module.exports = async function handler(req, res) {
  allowApi(res, "GET,PATCH,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const context = await authenticatedContext(req);

    if (req.method === "GET") {
      return json(res, 200, { profile: context.profile });
    }

    if (req.method === "PATCH") {
      const body = parseBody(req);
      if (body.passwordChanged !== true) return json(res, 400, { error: "Unsupported session update." });

      const result = await rest(context, `profiles?id=eq.${encodeURIComponent(context.profile.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ must_change_password: false, updated_at: new Date().toISOString() }),
      });
      if (!result.response.ok) return json(res, result.response.status, { error: result.payload.message || "Account setup could not be completed." });
      const profile = Array.isArray(result.payload) ? result.payload[0] : context.profile;
      return json(res, 200, { profile });
    }

    return json(res, 405, { error: "Method not allowed." });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || "Unexpected session error." });
  }
};
