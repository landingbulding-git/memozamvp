import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ cookies }) => {
  console.log('[USER_STATUS] Request received');
  const token = cookies.get('notion_access_token')?.value;
  const workspace = cookies.get('notion_workspace_name')?.value;
  
  if (!token) {
    console.log('[USER_STATUS] No token found in cookies. Returning unauthenticated.');
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log(`[USER_STATUS] Token found! Workspace: ${workspace}. Returning authenticated.`);
  return new Response(JSON.stringify({ 
    authenticated: true, 
    workspace: workspace || 'Notion Workspace'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
