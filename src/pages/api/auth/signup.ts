import type { APIRoute } from 'astro';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://toahjjxmxesdbpwzgehx.supabase.co';
const supabaseKey = process.env.SUPABASE_API_KEY;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400 });
    }

    if (password.length < 6) {
      return new Response(JSON.stringify({ error: 'Password must be at least 6 characters' }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey!);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    }

    return new Response(
      JSON.stringify({
        message: 'Signup successful',
        user: data.user,
      }),
      { status: 200 }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
