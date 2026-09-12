const MAX_BYTES = 5 * 1024 * 1024;

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.status(status);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  return res.send(typeof body === "string" ? body : JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Method not allowed." });
  }

  const raw = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  if (!raw) return send(res, 400, { error: "Missing Google Sheet URL." });

  let target;
  try {
    target = new URL(raw);
  } catch {
    return send(res, 400, { error: "Invalid Google Sheet URL." });
  }

  if (target.protocol !== "https:" || target.hostname !== "docs.google.com" || !target.pathname.includes("/spreadsheets/")) {
    return send(res, 400, { error: "Only Google Sheets URLs are allowed." });
  }

  try {
    const upstream = await fetch(target.href, {
      redirect: "follow",
      headers: { "User-Agent": "TennisRank/1.0" },
    });

    if (!upstream.ok) {
      return send(res, upstream.status, { error: `Google Sheets returned ${upstream.status}.` });
    }

    const text = await upstream.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
      return send(res, 413, { error: "Spreadsheet export is too large." });
    }

    if (/^\s*<!doctype html/i.test(text) || /Sign in to continue/i.test(text)) {
      return send(res, 403, { error: "The sheet is not publicly readable. Set sharing to Anyone with the link - Viewer." });
    }

    return send(res, 200, text, "text/csv; charset=utf-8");
  } catch (error) {
    return send(res, 502, { error: error?.message || "Could not reach Google Sheets." });
  }
};
