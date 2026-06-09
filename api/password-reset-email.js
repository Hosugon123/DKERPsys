function badRequest(res, message) {
  return res.status(400).json({ ok: false, error: message });
}

function upstreamError(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

function normalizeEmail(s) {
  return String(s || '').trim().toLowerCase();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  }

  const targetUrl = String(process.env.PASSWORD_RESET_EMAIL_URL || '').trim();
  if (!targetUrl) {
    return upstreamError(res, 503, 'password reset email service is not configured');
  }

  const body = typeof req.body === 'object' && req.body != null ? req.body : {};
  const email = normalizeEmail(body.email);
  const code = String(body.code || '').trim();
  const loginId = String(body.loginId || '').trim().toLowerCase();
  if (!email || !/^\d{6}$/.test(code) || !loginId) {
    return badRequest(res, 'invalid password reset payload');
  }

  const headers = { 'Content-Type': 'application/json' };
  const auth = String(process.env.PASSWORD_RESET_EMAIL_AUTH || '').trim();
  if (auth) headers.Authorization = auth;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email,
        code,
        loginId,
        purpose: 'password-reset',
        expiresInMinutes: 15,
      }),
      signal: ctrl.signal,
    });

    if (!upstream.ok) {
      let message = 'password reset email delivery failed';
      try {
        const j = await upstream.json();
        if (typeof j?.message === 'string' && j.message.trim()) message = j.message.trim();
        else if (typeof j?.error === 'string' && j.error.trim()) message = j.error.trim();
      } catch {
        /* keep generic message */
      }
      return upstreamError(res, 502, message);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return upstreamError(res, 504, 'password reset email delivery timed out');
    }
    const message = e instanceof Error ? e.message : 'unknown error';
    return upstreamError(res, 500, message);
  } finally {
    clearTimeout(timer);
  }
}
