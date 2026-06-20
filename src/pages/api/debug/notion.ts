import type { APIRoute } from 'astro';
import { Client } from "@notionhq/client";

export const GET: APIRoute = async ({ cookies }) => {
  const token = cookies.get('notion_access_token')?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const notion = new Client({ auth: token });

  // Fetch everything in one call
  const allSearch = await notion.search({ query: '', page_size: 100 }).catch(e => ({ results: [], error: e.message }));

  const allResults = (allSearch as any).results ?? [];

  const byType = allResults.reduce((acc: any, item: any) => {
    acc[item.object] = (acc[item.object] ?? 0) + 1;
    return acc;
  }, {});

  // Extract databases (data_source or database)
  const databases = allResults
    .filter((item: any) => item.object === 'data_source' || item.object === 'database')
    .map((item: any) => ({
      id: item.id,
      object: item.object,
      title: item.title?.map((t: any) => t.plain_text).join('') ?? '(untitled)',
      url: item.url,
    }));

  // Sample parent types from pages
  const parentTypes = [...new Set(
    allResults
      .filter((item: any) => item.object === 'page')
      .map((item: any) => `${item.parent?.type} → ${JSON.stringify(item.parent)}`)
      .slice(0, 5)
  )];

  return new Response(JSON.stringify({
    total: allResults.length,
    by_type: byType,
    databases,
    sample_page_parents: parentTypes,
  }, null, 2), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
