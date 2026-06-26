import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://toahjjxmxesdbpwzgehx.supabase.co';
const supabaseKey = import.meta.env.SUPABASE_API_KEY || process.env.SUPABASE_API_KEY;

export function getSupabaseClient() {
  return createClient(supabaseUrl, supabaseKey!);
}

export async function signUp(email: string, password: string) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

export async function signIn(email: string, password: string) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  const supabase = getSupabaseClient();

  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser(token: string) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.auth.getUser(token);
  if (error) throw error;
  return data.user;
}
