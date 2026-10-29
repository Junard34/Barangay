// PhilSMS outbound SMS (POST /api/v3/sms/send).
// Tokens issued via dashboard.philsms.com authenticate against the dashboard
// host; the legacy app.philsms.com host rejects them ("Unauthenticated").
// Override with PHILSMS_API_URL if PhilSMS migrates endpoints again.
const PHILSMS_API_URL = process.env.PHILSMS_API_URL || 'https://dashboard.philsms.com/api/v3/sms/send';

export function smsEnabled() {
  return (
    String(process.env.PHILSMS_ENABLED || '').toLowerCase() === 'true' &&
    Boolean(process.env.PHILSMS_API_TOKEN)
  );
}

// Accepts 09XXXXXXXXX, +639XXXXXXXXX, 639XXXXXXXXX (spaces/dashes/dots ok).
// Returns the local 09 form or null when the value is not a PH mobile number.
export function normalizePhPhone(value) {
  if (!value) return null;
  const digits = String(value).replace(/[\s\-().+]/g, '');
  if (/^09\d{9}$/.test(digits)) return digits;
  if (/^\+639\d{9}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  return null;
}

// PhilSMS requires the 639XXXXXXXXX international format.
export function smsRecipient(phone) {
  const local = normalizePhPhone(phone);
  if (!local) return null;
  return `63${local.slice(1)}`;
}

// Fire-and-forget safe: always resolves with { ok, error? } and never throws.
export async function sendSms(phone, message, { timeoutMs = 10000 } = {}) {
  const recipient = smsRecipient(phone);
  if (!recipient) return { ok: false, error: 'invalid_phone' };
  if (!smsEnabled()) return { ok: false, error: 'sms_disabled' };
  if (!message || !String(message).trim()) return { ok: false, error: 'empty_message' };

  const token = process.env.PHILSMS_API_TOKEN;
  const senderId = process.env.PHILSMS_SENDER_ID;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload = { recipient, type: 'plain', message: String(message) };
    if (senderId) payload.sender_id = senderId;

    const response = await fetch(PHILSMS_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const body = await response.text().catch(() => '');
    if (!response.ok) {
      return { ok: false, error: `http_${response.status}`, body: body.slice(0, 300) };
    }
    return { ok: true, recipient };
  } catch (error) {
    return { ok: false, error: error?.message || 'send_failed' };
  } finally {
    clearTimeout(timer);
  }
}
