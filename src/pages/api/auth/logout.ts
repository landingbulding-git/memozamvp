import type { APIRoute } from 'astro';
import db from '../../../db/index';

export const POST: APIRoute = async ({ cookies }) => {
  console.log('[LOGOUT] Logout request received');
  try {
    const sessionId = cookies.get('memoza_session')?.value;
    console.log(`[LOGOUT] Current session ID from cookie: ${sessionId || 'NONE'}`);

    if (sessionId) {
      console.log(`[LOGOUT] Attempting to delete session ${sessionId} from database...`);
      const deleteStmt = db.prepare('DELETE FROM sessions WHERE id = ?');
      const result = deleteStmt.run(sessionId);
      console.log(`[LOGOUT] Database delete result:`, result);
    } else {
      console.log('[LOGOUT] No session ID found in cookies. Skipping database deletion.');
    }

    console.log('[LOGOUT] Clearing memoza_session cookie...');
    cookies.delete('memoza_session', { path: '/' });

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
