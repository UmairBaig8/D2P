export const HOSTINGER_MAIL_API_BASE = Deno.env.get('HOSTINGER_MAIL_API_BASE') ?? 'https://api.mail.hostinger.com';

export type SendEmailPayload = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  displayName?: string;
};

export type SendEmailResult = {
  ok: boolean;
  provider: 'hostinger' | 'resend' | 'none';
  error?: string;
};

function hostingerConfig() {
  return {
    token: Deno.env.get('HOSTINGER_MAIL_API_TOKEN'),
    mailboxId: Deno.env.get('HOSTINGER_MAILBOX_RESOURCE_ID'),
    fromEmail: Deno.env.get('HOSTINGER_FROM_EMAIL') ?? 'contact@umairbaig.in',
  };
}

let resolvedMailboxId: string | undefined;

async function getMailboxId(): Promise<string | undefined> {
  const { token, mailboxId } = hostingerConfig();
  if (!token) return undefined;
  if (mailboxId && !mailboxId.includes('@')) return mailboxId;
  if (resolvedMailboxId) return resolvedMailboxId;
  const response = await fetch(`${HOSTINGER_MAIL_API_BASE}/api/v1/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return undefined;
  const body = (await response.json().catch(() => null)) as { data?: { mailboxes?: { resourceId?: string }[] } } | null;
  resolvedMailboxId = body?.data?.mailboxes?.[0]?.resourceId;
  return resolvedMailboxId;
}

async function sendViaHostinger(payload: SendEmailPayload): Promise<SendEmailResult> {
  const { token, fromEmail } = hostingerConfig();
  const mailboxId = await getMailboxId();
  if (!token || !mailboxId) {
    return { ok: false, provider: 'hostinger', error: 'HOSTINGER_MAIL_API_TOKEN not configured or mailbox could not be resolved.' };
  }
  const response = await fetch(`${HOSTINGER_MAIL_API_BASE}/api/v1/mailboxes/${mailboxId}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: [payload.to],
      displayName: payload.displayName ?? fromEmail,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    }),
  });
  if (response.ok) return { ok: true, provider: 'hostinger' };
  const detail = await response.text().catch(() => '');
  return { ok: false, provider: 'hostinger', error: `Hostinger Mail API ${response.status}: ${detail.slice(0, 500)}` };
}

async function sendViaResend(payload: SendEmailPayload): Promise<SendEmailResult> {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    return { ok: false, provider: 'resend', error: 'RESEND_API_KEY not configured.' };
  }
  const from = Deno.env.get('CONFIRMATION_FROM_EMAIL') ?? 'DPL 2026 <contact@umairbaig.in>';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    }),
  });
  if (response.ok) return { ok: true, provider: 'resend' };
  const detail = await response.text().catch(() => '');
  return { ok: false, provider: 'resend', error: `Resend ${response.status}: ${detail.slice(0, 500)}` };
}

export async function sendEmail(payload: SendEmailPayload): Promise<SendEmailResult> {
  if (hostingerConfig().token) return sendViaHostinger(payload);
  return sendViaResend(payload);
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);
}
