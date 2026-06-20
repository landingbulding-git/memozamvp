import type { APIRoute } from 'astro';
import { Client } from "@notionhq/client";

export const GET: APIRoute = async ({ cookies }) => {
  const token = cookies.get('notion_access_token')?.value;

  if (!token) {
    return new Response(JSON.stringify({ error: 'Not authenticated — no notion_access_token cookie.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const notion = new Client({ auth: token });
  const results: Record<string, any> = {};

  // 1. Direct database search
  try {
    const dbSearch = await notion.search({
      query: '',
      filter: { property: 'object', value: 'database' },
      page_size: 50,
    });
    results.databases_direct = dbSearch.results.map((db: any) => ({
      id: db.id,
      title: db.title?.map((t: any) => t.plain_text).join('') ?? '(untitled)',
    }));
  } catch (e: any) {
    results.databases_direct_error = e.message;
  }

  // 2. All accessible content
  let allPages: any[] = [];
  try {
    const allSearch = await notion.search({ query: '', page_size: 100 });
    allPages = allSearch.results;
    results.all_content_count = allPages.length;
    results.all_content_types = allPages.reduce((acc: any, p: any) => {
      acc[p.object] = (acc[p.object] ?? 0) + 1;
      return acc;
    }, {});
  } catch (e: any) {
    results.all_content_error = e.message;
  }

  // 3. Databases discovered via page parents
  const parentDbIds = [...new Set(
    allPages
      .filter((p: any) => p.object === 'page' && p.parent?.type === 'database_id')
      .map((p: any) => p.parent.database_id)
  )];
  results.parent_database_ids_found = parentDbIds;

  const discovered: any[] = [];
  for (const dbId of parentDbIds) {
    try {
      const db: any = await notion.databases.retrieve({ database_id: dbId });
      discovered.push({
        id: db.id,
        title: db.title?.map((t: any) => t.plain_text).join('') ?? '(untitled)',
        url: db.url,
        properties: Object.keys(db.properties),
      });
    } catch (e: any) {
      discovered.push({ id: dbId, error: e.message });
    }
  }
  results.databases_via_parents = discovered;

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
