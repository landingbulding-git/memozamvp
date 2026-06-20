import type { APIRoute } from 'astro';
import db from '../../../db/index';

export const GET: APIRoute = async ({ cookies }) => {
  console.log('[USER_STATUS] Request received');
  const sessionId = cookies.get('memoza_session')?.value;
  
  console.log(`[USER_STATUS] Cookie session ID: ${sessionId || 'NONE'}`);

  if (!sessionId) {
    console.log('[USER_STATUS] No session ID. Returning unauthenticated.');
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log(`[USER_STATUS] Querying database for session ID: ${sessionId}`);
    const stmt = db.prepare('SELECT notion_workspace_name FROM sessions WHERE id = ?');
    const session = stmt.get(sessionId) as { notion_workspace_name: string } | undefined;

    if (!session) {
      console.warn(`[USER_STATUS] Session ID ${sessionId} found in cookie, but NOT found in database. Returning unauthenticated.`);
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`[USER_STATUS] Session found! Workspace: ${session.notion_workspace_name}. Returning authenticated.`);
    return new Response(JSON.stringify({ 
      authenticated: true, 
      workspace: session.notion_workspace_name 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[USER_STATUS] Database error while checking status:', error);
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
