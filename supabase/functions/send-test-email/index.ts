import { sendEmail } from '../_shared/email.ts';
import { CORS_HEADERS, corsResponse } from '../_shared/cors.ts';

function roleFromAuthHeader(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof claims.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  try {
    const role = roleFromAuthHeader(req.headers.get('Authorization'));
    if (role !== 'authenticated') {
      return new Response(JSON.stringify({ ok: false, provider: 'none', error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    let body: { to?: unknown };
    try {
      body = await req.json();
    } catch {
      return new Response('Invalid JSON', { status: 400, headers: CORS_HEADERS });
    }

    const to = typeof body.to === 'string' ? body.to.trim().toLowerCase() : '';
    if (!to) {
      return new Response(JSON.stringify({ ok: false, provider: 'none', error: 'to is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    const result = await sendEmail({
      to,
      displayName: 'DPL 2026',
      subject: 'DPL 2026 \u2014 email delivery test',
    });

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;background:#f5f8fb;padding:40px 20px;">
        <div style="max-width:520px;margin:auto;background:#fff;border-radius:16px;padding:36px;border:1px solid #e4ebf1;">
          <div style="font-size:12px;letter-spacing:2px;font-weight:800;color:#09c9d8;">DPL 2026 / DIGITATE PREMIER LEAGUE</div>
          <h1 style="font-size:34px;margin:14px 0 8px;color:#071426;">EMAIL TEST</h1>
          <p style="color:#526574;font-size:14px;line-height:1.6;">If you\u2019re reading this, email delivery is working. Provider: <b>${result.provider}</b></p>
        </div>
      </div>
    `;

    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return new Response(JSON.stringify({ ok: false, provider: 'none', error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
});
