import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || 'https://eysqivwnqhsmsalngqyu.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabaseAnonKey
);

const clientUrl = supabaseUrl || window.location.origin;
const clientKey = supabaseAnonKey || 'missing-supabase-anon-key';

export const supabase = createClient(
  clientUrl,
  clientKey
);