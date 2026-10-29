// Single entry point for citizen-facing notifications: always writes the
// in-app notifications row, and optionally sends an SMS via PhilSMS when the
// feature is enabled and the citizen has a mobile number on file.
// Never throws — notification/SMS failures must not break the complaint flow.
import { sendSms, smsEnabled, normalizePhPhone } from './sms.js';

export async function notifyCitizen(supabase, citizenId, { title, message, sms } = {}) {
  if (!citizenId || !title || !message) {
    return { notified: false, sms: null };
  }

  let notified = false;
  try {
    const { error } = await supabase.from('notifications').insert({
      user_id: citizenId,
      title,
      message,
      is_read: false,
    });
    notified = !error;
    if (error) {
      console.warn(`notifyCitizen(${citizenId}) insert failed: ${error.message}`);
    }
  } catch (err) {
    console.warn(`notifyCitizen(${citizenId}) insert threw: ${err?.message}`);
  }

  let smsResult = null;
  if (sms && smsEnabled()) {
    try {
      const { data: user } = await supabase
        .from('users')
        .select('phone, full_name')
        .eq('id', citizenId)
        .single();
      const phone = normalizePhPhone(user?.phone);
      if (phone) {
        smsResult = await sendSms(phone, sms);
        if (!smsResult.ok) {
          console.warn(`notifyCitizen(${citizenId}) SMS failed: ${smsResult.error}`);
        }
      }
    } catch (err) {
      console.warn(`notifyCitizen(${citizenId}) SMS threw: ${err?.message}`);
    }
  }

  return { notified, sms: smsResult };
}
