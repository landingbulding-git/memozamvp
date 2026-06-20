import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  console.log('[AUTH_NOTION] Initializing OAuth flow redirect...');
  const clientId = import.meta.env.NOTION_CLIENT_ID || process.env.NOTION_CLIENT_ID;
  const redirectUri = import.meta.env.NOTION_REDIRECT_URI || process.env.NOTION_REDIRECT_URI;
  
  if (!clientId || !redirectUri) {
    console.error('[AUTH_NOTION] Missing environment variables:', { clientId: !!clientId, redirectUri: !!redirectUri });
    return new Response('Notion Client ID or Redirect URI is missing from environment.', { status: 500 });
  }

  // Construct the Notion OAuth URL
  const authUrl = `https://api.notion.com/v1/oauth/authorize?client_id=${clientId}&response_type=code&owner=user&redirect_uri=${encodeURIComponent(redirectUri)}`;
  console.log('[AUTH_NOTION] Redirecting user to:', authUrl);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
    },
  });
};
