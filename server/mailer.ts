import nodemailer, { Transporter } from 'nodemailer';

let cachedTransport: Transporter | null = null;

/**
 * Which SMTP provider is configured, in preference order. Brevo wins over
 * Gmail because its free tier reaches arbitrary recipients with only a
 * verified sender, and because it accepts port 2525.
 */
type SmtpProvider = 'brevo' | 'gmail';

function smtpProvider(): SmtpProvider | null {
  if (process.env.BREVO_USER && process.env.BREVO_PASS) return 'brevo';
  if (process.env.SMTP_USER && process.env.SMTP_PASS) return 'gmail';
  return null;
}

/**
 * SMTP transport. Brevo is the preferred SMTP path: its relay accepts port
 * 2525, which sidesteps the 465/587 egress blocks that make Gmail unusable on
 * sandboxed cloud hosts. Gmail remains as a legacy fallback.
 */
function getSmtpTransport(): Transporter | null {
  if (cachedTransport) return cachedTransport;

  const provider = smtpProvider();
  if (!provider) return null;

  // Without these the socket waits on the OS TCP timeout (~120s) when the
  // SMTP port is unreachable, which stalls the whole request. Fail fast.
  const timeouts = {
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  };

  if (provider === 'brevo') {
    cachedTransport = nodemailer.createTransport({
      // Host/port are overridable but default to Brevo's documented relay.
      host: process.env.BREVO_HOST || 'smtp-relay.brevo.com',
      port: Number(process.env.BREVO_PORT) || 2525,
      secure: false,
      requireTLS: true,
      auth: { user: process.env.BREVO_USER!, pass: process.env.BREVO_PASS! },
      ...timeouts,
    });
    return cachedTransport;
  }

  cachedTransport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    ...timeouts,
  });

  return cachedTransport;
}

/** True when any outbound mail provider is configured. */
export function isMailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY ||
      (process.env.BREVO_USER && process.env.BREVO_PASS) ||
      (process.env.SMTP_USER && process.env.SMTP_PASS)
  );
}

function brandName(): string {
  return process.env.MAIL_FROM_NAME || 'MindSync';
}

/**
 * Resolves the From: address. This is deliberately NOT the SMTP login: Brevo's
 * generated "…@smtp-brevo.com" login is not a real mailbox and is rejected as
 * a sender, so an explicit MAIL_FROM_ADDRESS is required there. Gmail's login
 * is a real address, so it can serve as its own sender.
 */
export function resolveFromAddress(): string | null {
  return process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER || null;
}

interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Delivers mail, preferring the Resend HTTP API. Resend talks over plain 443,
 * so it sidesteps the SMTP egress blocks that make Gmail unusable on sandboxed
 * hosts. Falls back to SMTP when Resend is absent or rejects the request.
 */
async function deliver(mail: OutboundMail): Promise<boolean> {
  const provider = smtpProvider();

  // Brevo is tried ahead of Resend: its free tier reaches arbitrary recipients
  // with only a verified sender address, whereas Resend's shared onboarding
  // sender is restricted to the account owner until a custom domain is
  // verified. A Brevo failure still falls through to Resend rather than giving
  // up outright.
  if (provider === 'brevo') {
    const transport = getSmtpTransport();
    if (transport && (await sendViaSmtp(transport, mail))) return true;
  }

  if (process.env.RESEND_API_KEY) {
    if (await sendViaResend(mail)) return true;
  }

  // Gmail SMTP, legacy fallback only.
  if (provider === 'gmail') {
    const transport = getSmtpTransport();
    if (transport) return sendViaSmtp(transport, mail);
  }

  return false;
}

async function sendViaResend(mail: OutboundMail): Promise<boolean> {
  // Resend's free tier can send from the shared onboarding address with no
  // domain verification. Set RESEND_FROM once a custom domain is confirmed.
  const from = process.env.RESEND_FROM || `${brandName()} <onboarding@resend.dev>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(
        `Resend rejected the email (${res.status}):`,
        detail.slice(0, 300)
      );
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('Resend send failed:', err?.message || err);
    return false;
  }
}

async function sendViaSmtp(
  transport: Transporter,
  mail: OutboundMail
): Promise<boolean> {
  // The From: address must be a VERIFIED SENDER on the provider — it is not the
  // SMTP login. In particular Brevo's login is a generated "…@smtp-brevo.com"
  // address that cannot receive replies and is not a valid sender, so
  // MAIL_FROM_ADDRESS is required there.
  const fromAddress = resolveFromAddress();
  if (!fromAddress) return false;

  try {
    await transport.sendMail({
      from: `"${brandName()}" <${fromAddress}>`,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return true;
  } catch (err: any) {
    console.error('SMTP send failed:', err?.message || err);
    return false;
  }
}

interface SendVerificationEmailArgs {
  to: string;
  name: string;
  verificationUrl: string;
}

/**
 * Sends the "confirm your email" message. Returns true on successful delivery.
 * Never throws — a failed send must not block account creation, and the
 * caller can always re-issue a link via the resend endpoint.
 */
export async function sendVerificationEmail({
  to,
  name,
  verificationUrl,
}: SendVerificationEmailArgs): Promise<boolean> {
  const brand = brandName();

  return deliver({
    to,
    subject: `Confirm your email to finish setting up ${brand}`,
    text: [
      `Hi ${name},`,
      '',
      'Thanks for creating an account. Please confirm your email address to activate access:',
      '',
      verificationUrl,
      '',
      'This link expires in 24 hours.',
      'If you did not create this account, you can safely ignore this email.',
    ].join('\n'),
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#0b0b12;padding:32px 16px;">
        <div style="max-width:520px;margin:0 auto;background:#12121c;border:1px solid #26263a;border-radius:16px;padding:32px;">
          <h1 style="margin:0 0 4px;font-size:20px;color:#f5f3ef;letter-spacing:-0.01em;">
            ${brand}
          </h1>
          <p style="margin:0 0 24px;font-size:13px;color:#8b8a99;">
            Confirm your email address
          </p>

          <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#c9c7d1;">
            Hi ${escapeHtml(name)}, thanks for creating an account. Please confirm your
            email address to activate access to your workspace.
          </p>

          <a href="${verificationUrl}"
             style="display:inline-block;background:linear-gradient(135deg,#6366f1,#818cf8);color:#ffffff;
                    text-decoration:none;font-weight:600;font-size:14px;padding:13px 26px;border-radius:12px;">
            Verify my email
          </a>

          <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#6f6e7d;">
            This link expires in 24 hours. If you did not create this account,
            you can safely ignore this email.
          </p>

          <hr style="border:none;border-top:1px solid #26263a;margin:24px 0 16px;" />
          <p style="margin:0;font-size:11px;color:#56555f;word-break:break-all;">
            If the button does not work, paste this link into your browser:<br />
            ${verificationUrl}
          </p>
        </div>
      </div>
    `,
  });
}

interface SendPasswordResetEmailArgs {
  to: string;
  name: string;
  resetUrl: string;
}

/**
 * Sends the "reset your password" message. Returns true on successful delivery.
 * Never throws — a failed send must not block the reset endpoint, and the
 * caller can always surface the link directly as a fallback.
 */
export async function sendPasswordResetEmail({
  to,
  name,
  resetUrl,
}: SendPasswordResetEmailArgs): Promise<boolean> {
  const brand = brandName();

  return deliver({
    to,
    subject: `Reset your ${brand} password`,
    text: [
      `Hi ${name},`,
      '',
      'We received a request to reset the password on your account. Choose a new password using the link below:',
      '',
      resetUrl,
      '',
      'This link expires in 1 hour.',
      'If you did not request a reset, you can safely ignore this email — your password will not change.',
    ].join('\n'),
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#0b0b12;padding:32px 16px;">
        <div style="max-width:520px;margin:0 auto;background:#12121c;border:1px solid #26263a;border-radius:16px;padding:32px;">
          <h1 style="margin:0 0 4px;font-size:20px;color:#f5f3ef;letter-spacing:-0.01em;">
            ${brand}
          </h1>
          <p style="margin:0 0 24px;font-size:13px;color:#8b8a99;">
            Password reset request
          </p>

          <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#c9c7d1;">
            Hi ${escapeHtml(name)}, we received a request to reset the password on your account.
            Choose a new password using the link below.
          </p>

          <a href="${resetUrl}"
             style="display:inline-block;background:linear-gradient(135deg,#6366f1,#818cf8);color:#ffffff;
                    text-decoration:none;font-weight:600;font-size:14px;padding:13px 26px;border-radius:12px;">
            Reset my password
          </a>

          <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#6f6e7d;">
            This link expires in 1 hour. If you did not request a reset, you can
            safely ignore this email — your password will not change.
          </p>

          <hr style="border:none;border-top:1px solid #26263a;margin:24px 0 16px;" />
          <p style="margin:0;font-size:11px;color:#56555f;word-break:break-all;">
            If the button does not work, paste this link into your browser:<br />
            ${resetUrl}
          </p>
        </div>
      </div>
    `,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
