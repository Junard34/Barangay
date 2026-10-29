import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { normalizePhPhone, smsRecipient, smsEnabled, sendSms } from './sms.js';
import { notifyCitizen } from './notifyCitizen.js';

const ENV_KEYS = ['PHILSMS_ENABLED', 'PHILSMS_API_TOKEN', 'PHILSMS_SENDER_ID'];

let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  delete process.env.PHILSMS_ENABLED;
  delete process.env.PHILSMS_API_TOKEN;
  delete process.env.PHILSMS_SENDER_ID;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
});

describe('normalizePhPhone', () => {
  it('accepts local 09 format', () => {
    expect(normalizePhPhone('09171234567')).toBe('09171234567');
  });

  it('accepts +63 format', () => {
    expect(normalizePhPhone('+639171234567')).toBe('09171234567');
  });

  it('accepts 63 format', () => {
    expect(normalizePhPhone('639171234567')).toBe('09171234567');
  });

  it('strips spaces and dashes', () => {
    expect(normalizePhPhone('0917 123-4567')).toBe('09171234567');
  });

  it('rejects invalid numbers', () => {
    expect(normalizePhPhone('12345')).toBeNull();
    expect(normalizePhPhone('08171234567')).toBeNull();
    expect(normalizePhPhone('0917123456')).toBeNull();
    expect(normalizePhPhone('')).toBeNull();
    expect(normalizePhPhone(null)).toBeNull();
    expect(normalizePhPhone(undefined)).toBeNull();
  });
});

describe('smsRecipient', () => {
  it('converts 09 numbers to 63 international format', () => {
    expect(smsRecipient('09171234567')).toBe('639171234567');
  });

  it('returns null for invalid numbers', () => {
    expect(smsRecipient('not-a-number')).toBeNull();
  });
});

describe('smsEnabled', () => {
  it('is disabled when the toggle is unset', () => {
    expect(smsEnabled()).toBe(false);
  });

  it('is disabled when the toggle is false', () => {
    process.env.PHILSMS_ENABLED = 'false';
    process.env.PHILSMS_API_TOKEN = 'token';
    expect(smsEnabled()).toBe(false);
  });

  it('is disabled when enabled without a token', () => {
    process.env.PHILSMS_ENABLED = 'true';
    expect(smsEnabled()).toBe(false);
  });

  it('is enabled with toggle and token', () => {
    process.env.PHILSMS_ENABLED = 'TRUE';
    process.env.PHILSMS_API_TOKEN = 'token';
    expect(smsEnabled()).toBe(true);
  });
});

describe('sendSms', () => {
  it('does not call the API when disabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendSms('09171234567', 'Hello');
    expect(result).toEqual({ ok: false, error: 'sms_disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid phones without calling the API', async () => {
    process.env.PHILSMS_ENABLED = 'true';
    process.env.PHILSMS_API_TOKEN = 'token';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendSms('123', 'Hello');
    expect(result).toEqual({ ok: false, error: 'invalid_phone' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the PhilSMS payload with a Bearer token', async () => {
    process.env.PHILSMS_ENABLED = 'true';
    process.env.PHILSMS_API_TOKEN = 'secret-token';
    process.env.PHILSMS_SENDER_ID = 'BarangaySaray';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"status":"success"}',
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendSms('+639171234567', 'Barangay Saray: status update');
    expect(result).toEqual({ ok: true, recipient: '639171234567' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dashboard.philsms.com/api/v3/sms/send');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer secret-token');
    expect(JSON.parse(options.body)).toEqual({
      recipient: '639171234567',
      sender_id: 'BarangaySaray',
      type: 'plain',
      message: 'Barangay Saray: status update',
    });
  });

  it('maps non-2xx responses to an error result', async () => {
    process.env.PHILSMS_ENABLED = 'true';
    process.env.PHILSMS_API_TOKEN = 'token';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    }));

    const result = await sendSms('09171234567', 'Hello');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('http_401');
  });

  it('never throws when the network call fails', async () => {
    process.env.PHILSMS_ENABLED = 'true';
    process.env.PHILSMS_API_TOKEN = 'token';

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await sendSms('09171234567', 'Hello');
    expect(result).toEqual({ ok: false, error: 'network down' });
  });
});

function makeSupabase({ insertError = null, phone = '09171234567' } = {}) {
  const inserted = [];
  return {
    inserted,
    from(table) {
      if (table === 'notifications') {
        return {
          insert: async (row) => {
            if (insertError) return { error: { message: insertError } };
            inserted.push(row);
            return { error: null };
          },
        };
      }
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { phone, full_name: 'Juan Cruz' } }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe('notifyCitizen', () => {
  it('inserts the in-app notification', async () => {
    const supabase = makeSupabase();
    const result = await notifyCitizen(supabase, 42, {
      title: 'Complaint Received',
      message: 'We received your complaint.',
    });

    expect(result.notified).toBe(true);
    expect(result.sms).toBeNull();
    expect(supabase.inserted).toEqual([
      { user_id: 42, title: 'Complaint Received', message: 'We received your complaint.', is_read: false },
    ]);
  });

  it('does not throw when the insert fails', async () => {
    const supabase = makeSupabase({ insertError: 'table missing' });
    const result = await notifyCitizen(supabase, 42, { title: 'T', message: 'M' });
    expect(result.notified).toBe(false);
  });

  it('returns early without a citizen id or message', async () => {
    const supabase = makeSupabase();
    expect(await notifyCitizen(supabase, null, { title: 'T', message: 'M' })).toEqual({ notified: false, sms: null });
    expect(await notifyCitizen(supabase, 1, { title: '', message: 'M' })).toEqual({ notified: false, sms: null });
    expect(supabase.inserted).toEqual([]);
  });

  it('skips SMS when the feature is disabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const supabase = makeSupabase();
    const result = await notifyCitizen(supabase, 42, { title: 'T', message: 'M', sms: 'Hello' });

    expect(result.notified).toBe(true);
    expect(result.sms).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends SMS when enabled and the citizen has a phone', async () => {
    process.env.PHILSMS_ENABLED = 'true';
    process.env.PHILSMS_API_TOKEN = 'token';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
    });
    vi.stubGlobal('fetch', fetchMock);

    const supabase = makeSupabase({ phone: '+639171234567' });
    const result = await notifyCitizen(supabase, 42, { title: 'T', message: 'M', sms: 'Barangay Saray: Hello' });

    expect(result.notified).toBe(true);
    expect(result.sms?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.recipient).toBe('639171234567');
    expect(body.message).toBe('Barangay Saray: Hello');
  });

  it('skips SMS when the citizen has no phone on file', async () => {
    process.env.PHILSMS_ENABLED = 'true';
    process.env.PHILSMS_API_TOKEN = 'token';

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const supabase = makeSupabase({ phone: null });
    const result = await notifyCitizen(supabase, 42, { title: 'T', message: 'M', sms: 'Hello' });

    expect(result.notified).toBe(true);
    expect(result.sms).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
