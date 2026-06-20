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
  const allSearch = await notion.search({ query: '', page_size: 100 }).catch((e: any) => ({ results: [], error: e.message }));
  const allResults = (allSearch as any).results ?? [];

  // Build data_source_id → database_id mapping
  const dsIdToDbId = new Map<string, string>();
  for (const item of allResults) {
    if (item.object === 'page' && item.parent?.type === 'data_source_id') {
      dsIdToDbId.set(item.parent.data_source_id, item.parent.database_id);
    }
  }

  const databases = allResults
    .filter((item: any) => item.object === 'data_source' || item.object === 'database')
    .map((item: any) => ({
      data_source_id: item.id,
      database_id: dsIdToDbId.get(item.id) ?? '(not found via pages)',
      title: item.title?.map((t: any) => t.plain_text).join('') ?? '(untitled)',
    }));

  return new Response(JSON.stringify({
    total_items: allResults.length,
    by_type: allResults.reduce((acc: any, i: any) => { acc[i.object] = (acc[i.object] ?? 0) + 1; return acc; }, {}),
    databases,
  }, null, 2), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
