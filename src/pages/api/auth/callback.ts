import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, cookies }) => {
  console.log('[AUTH_CALLBACK] Received callback request');
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    console.error(`[AUTH_CALLBACK] Error from Notion: ${error}`);
    return new Response(`Error: ${error}`, { status: 400 });
  }

  if (!code) {
    console.warn('[AUTH_CALLBACK] No code provided in URL parameters');
    return new Response('No code provided', { status: 400 });
  }

  console.log('[AUTH_CALLBACK] Received authorization code. Proceeding to exchange for token...');

  const clientId = import.meta.env.NOTION_CLIENT_ID || process.env.NOTION_CLIENT_ID;
  const clientSecret = import.meta.env.NOTION_CLIENT_SECRET || process.env.NOTION_CLIENT_SECRET;
  const redirectUri = import.meta.env.NOTION_REDIRECT_URI || process.env.NOTION_REDIRECT_URI;

  // Basic auth required by Notion
  const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    console.log('[AUTH_CALLBACK] Sending POST request to https://api.notion.com/v1/oauth/token');
    const response = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${encoded}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[AUTH_CALLBACK] Notion OAuth token exchange failed:', data);
      return new Response(`Failed to authenticate with Notion: ${JSON.stringify(data)}`, { status: 500 });
    }

    console.log('[AUTH_CALLBACK] Token exchange successful. Setting secure cookies...');

    // Set secure HTTP-only cookies
    cookies.set('notion_access_token', data.access_token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    cookies.set('notion_workspace_name', data.workspace_name, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    console.log('[AUTH_CALLBACK] Redirecting back to root (/)');
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/',
      },
    });
  } catch (error: any) {
    console.error('[AUTH_CALLBACK] Unhandled error during callback:', error);
    return new Response(`Internal server error: ${error.message}`, { status: 500 });
  }
};
