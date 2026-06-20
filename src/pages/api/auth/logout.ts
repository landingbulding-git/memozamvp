import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ cookies }) => {
  console.log('[LOGOUT] Logout request received');
  try {
    console.log('[LOGOUT] Clearing notion access cookies...');
    
    cookies.delete('notion_access_token', { path: '/' });
    cookies.delete('notion_workspace_name', { path: '/' });

    console.log('[LOGOUT] Logout successful');
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[LOGOUT] Error during logout:', error);
    return new Response(JSON.stringify({ error: 'Failed to sign out' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};