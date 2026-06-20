import type { APIRoute } from 'astro';
import { Client } from "@notionhq/client";

export const GET: APIRoute = async ({ cookies }) => {
  const token = cookies.get('notion_access_token')?.value;

  if (!token) {
    return new Response(JSON.stringify({ error: 'Not authenticated — no notion_access_token cookie found.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const notion = new Client({ auth: token });
  const results: Record<string, any> = {};

  // 1. List all databases
  try {
    const dbSearch = await notion.search({
      query: '',
      filter: { property: 'object', value: 'database' },
      page_size: 50,
    });
    results.databases = dbSearch.results.map((db: any) => ({
      id: db.id,
      title: db.title?.map((t: any) => t.plain_text).join('') ?? '(untitled)',
      url: db.url,
    }));
  } catch (e: any) {
    results.databases_error = e.message;
  }

  // 2. Search everything (pages + databases)
  try {
    const allSearch = await notion.search({ query: '', page_size: 20 });
    results.all_content_count = allSearch.results.length;
    results.all_content = allSearch.results.map((item: any) => ({
      id: item.id,
      object: item.object,
      url: item.url,
    }));
  } catch (e: any) {
    results.all_content_error = e.message;
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
