const MAX_BYTES = 10 * 1024 * 1024;
const ATTEMPT_TIMEOUT_MS = 18_000;
const MAX_ATTEMPTS = 2;
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

function spreadsheetIdFromUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new Error('Enter a valid Google Sheet link.'); }

  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') throw new Error('Only HTTPS Google Sheets links are allowed.');

  if (host === 'docs.google.com') {
    const match = url.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([^/]+)/i);
    if (match && match[1] !== 'e') return match[1];
  }

  if (host === 'drive.google.com') {
    const pathMatch = url.pathname.match(/\/file\/d\/([^/]+)/i);
    const id = pathMatch?.[1] || url.searchParams.get('id');
    if (id) return id;
  }

  throw new Error('Use a standard Google Sheets sharing link.');
}

function exportUrlFor(input) {
  const id = spreadsheetIdFromUrl(input);
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/export?format=xlsx`;
}

function allowedGoogleHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'docs.google.com' || host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com');
}

function transientNetworkError(error) {
  return error?.name === 'AbortError' || error?.name === 'TypeError' || error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT';
}

async function readLimitedBuffer(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error('This workbook is too large. Keep the import under 10 MB.');

  if (!response.body?.getReader) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) throw new Error('This workbook is too large. Keep the import under 10 MB.');
    return Buffer.from(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      try { await reader.cancel(); } catch {}
      throw new Error('This workbook is too large. Keep the import under 10 MB.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function fetchGoogleWorkbook(target, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : ATTEMPT_TIMEOUT_MS;
  const attempts = Math.max(1, Math.min(3, Number(options.attempts) || MAX_ATTEMPTS));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(target, {
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'TennisRank/1.0 spreadsheet workbook importer' },
      });

      const finalUrl = new URL(response.url);
      if (finalUrl.protocol !== 'https:' || !allowedGoogleHost(finalUrl.hostname)) {
        return { ok: false, status: 422, error: 'The sheet redirected outside Google’s spreadsheet export service. Check sharing permissions.', attempts: attempt };
      }

      if (!response.ok) {
        if (TRANSIENT_STATUS.has(response.status) && attempt < attempts) {
          lastError = Object.assign(new Error(`Google Sheets transient status ${response.status}.`), { status: response.status });
          continue;
        }
        return {
          ok: false,
          status: TRANSIENT_STATUS.has(response.status) ? 503 : 422,
          error: TRANSIENT_STATUS.has(response.status)
            ? `Google Sheets is temporarily unavailable (${response.status}). Try again.`
            : `Google Sheets returned ${response.status}. Set sharing to “Anyone with the link – Viewer” and try again.`,
          attempts: attempt,
        };
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('text/html')) {
        return { ok: false, status: 422, error: 'Google returned a sign-in page instead of workbook data. Make the sheet viewable by anyone with the link.', attempts: attempt };
      }

      const buffer = await readLimitedBuffer(response);
      if (!buffer.length) return { ok: false, status: 422, error: 'The workbook exported successfully but contained no data.', attempts: attempt };
      return { ok: true, buffer, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (transientNetworkError(error) && attempt < attempts) continue;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || Object.assign(new Error('Google Sheets did not respond.'), { name: 'AbortError' });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  let target;
  try { target = exportUrlFor(req.query?.url); }
  catch (error) { return res.status(400).json({ error: error.message }); }

  try {
    const result = await fetchGoogleWorkbook(target);
    res.setHeader('X-TennisRank-Sheet-Attempts', String(result.attempts || 1));
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'inline; filename="tennis-results.xlsx"');
    return res.status(200).send(result.buffer);
  } catch (error) {
    if (error?.name === 'AbortError') return res.status(504).json({ error: 'Google Sheets took too long to respond after retrying. Try again.' });
    return res.status(502).json({ error: error?.message || 'The workbook could not be loaded.' });
  }
};

module.exports.spreadsheetIdFromUrl = spreadsheetIdFromUrl;
module.exports.exportUrlFor = exportUrlFor;
module.exports.allowedGoogleHost = allowedGoogleHost;
module.exports.fetchGoogleWorkbook = fetchGoogleWorkbook;
module.exports.readLimitedBuffer = readLimitedBuffer;
