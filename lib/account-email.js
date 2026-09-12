const { serviceHeaders } = require('../api/_supabase');

// Never build authentication links from a request Host/Origin or user input.
function appOrigin() {
  const configured = process.env.APP_URL || 'https://tennisrank-ai.vercel.app';
  const url = new URL(configured);
  if (url.protocol !== 'https:') throw new Error('The account email return URL must use HTTPS.');
  return url.origin;
}

async function sendSetupEmail(context, email) {
  try {
    const redirect = `${appOrigin()}/player`;
    const response = await fetch(`${context.url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirect)}`, {
      method: 'POST',
      headers: serviceHeaders(context.key),
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return { method: 'email', status: 'accepted', message: `Password setup email requested for ${email}. Check the inbox and spam folder; the link lets them choose a password.` };
    const code = String(payload.code || payload.error_code || '');
    const reason = String(payload.msg || payload.message || payload.error_description || payload.error || '');
    let message = 'The email service could not send the setup link. Check the email sender settings, then use Send password email to retry.';
    if (response.status === 429 || /rate|too many|after .*seconds/i.test(reason)) message = 'The email service has reached its sending limit. Wait before using Send password email again.';
    else if (/email_address_not_authorized|not authorized|smtp|sending.*email/i.test(`${code} ${reason}`)) message = 'Email delivery is unavailable for this address. Configure a verified email sender in Supabase, then use Send password email to retry.';
    return { method: 'email', status: 'failed', message };
  } catch {
    return { method: 'email', status: 'unknown', message: 'The email request could not be confirmed. Check the inbox and spam folder before using Send password email to retry.' };
  }
}

module.exports = { sendSetupEmail };
