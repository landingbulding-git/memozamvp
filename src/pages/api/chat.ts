import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from 'path';

const anthropic = new Anthropic({
  apiKey: import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
});

function buildSystemPrompt(): string {
  return `You are Memoza, a Notion assistant with full access to the user's Notion workspace. Be brief, direct, and autonomous.

## Golden rule
NEVER ask the user for a database name, page name, ID, or any information you can look up yourself. Always use tools to find what you need. The user should never have to copy-paste IDs or explain their workspace structure to you.

## How to discover the workspace
- Don't know what databases exist? → call list_all_databases immediately.
- Looking for a specific page or database? → call search_notion with a relevant keyword.
- Need the properties/columns of a database before filtering or sorting? → call get_database_schema.

## Tool usage
- list_all_databases — first step whenever you need to explore the workspace.
- search_notion — find pages or databases by keyword.
- get_database_schema — get property names + types before querying or updating.
- query_database — fetch records; supports filter + sorts (Notion API format).
- get_page — read a single record's current property values.
- update_page_properties — edit properties on an existing record.
- create_page — create a new page or database record.

## Notion filter syntax (by property type)
- date:       { "property": "Due Date", "date": { "is_not_empty": true } }
- select:     { "property": "Status", "select": { "equals": "Done" } }
- rich_text:  { "property": "Name", "rich_text": { "contains": "keyword" } }
- Sorts: [{ "property": "Due Date", "direction": "ascending" }]

## update_page_properties format
- select/status: { "Status": { "select": { "name": "Done" } } }
- date:          { "Due Date": { "date": { "start": "2024-01-15" } } }
- checkbox:      { "Done": { "checkbox": true } }
- rich_text:     { "Notes": { "rich_text": [{ "text": { "content": "text" } }] } }
- title:         { "Name": { "title": [{ "text": { "content": "New name" } }] } }

## Response rules
- Never narrate tool calls. Only output the final answer.
- Always include Notion page URLs as markdown links: [Page Title](https://notion.so/...)
- After creating or updating something, end with a short summary and [Open in Notion →](url)
- Use simple markdown: **bold** for emphasis, bullet points for lists.
- No filler phrases.
- If something genuinely cannot be found after trying, say so in one sentence.`;
}

async function getMcpClient(userNotionToken: string) {
  const serverPath = path.resolve(process.cwd(), 'src/mcp/notion-server.js');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: { 
      ...process.env, 
      NOTION_API_KEY: userNotionToken 
    },
  });

  const mcpClient = new Client({
    name: "memoza-client",
    version: "1.0.0",
  }, {
    capabilities: {}
  });

  await mcpClient.connect(transport);
  return { mcpClient, transport };
}

export const POST: APIRoute = async ({ request, cookies }) => {
  let activeTransport: StdioClientTransport | null = null;
  let activeMcpClient: Client | null = null;

  console.log('[CHAT] ── New request ──────────────────────────');

  try {
    const notionToken = cookies.get('notion_access_token')?.value;

    if (!notionToken) {
      console.warn('[CHAT] No Notion token in cookies → 401');
      return new Response(JSON.stringify({ error: 'Unauthorized. Please connect your Notion account first.' }), { status: 401 });
    }

    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      console.warn('[CHAT] Invalid messages payload → 400');
      return new Response(JSON.stringify({ error: 'Messages array is required' }), { status: 400 });
    }

    const lastUserMsg = messages.filter((m: any) => m.role === 'user').at(-1)?.content ?? '';
    console.log(`[CHAT] User message: "${lastUserMsg}"`);
    console.log(`[CHAT] Conversation length: ${messages.length} message(s)`);

    const systemPrompt = buildSystemPrompt();

    console.log('[CHAT] Connecting to MCP / Notion server...');
    const { mcpClient, transport } = await getMcpClient(notionToken);
    activeTransport = transport;
    activeMcpClient = mcpClient;

    const { tools: mcpTools } = await activeMcpClient.listTools();
    console.log(`[CHAT] MCP connected. Tools available: ${mcpTools.map(t => t.name).join(', ')}`);

    const anthropicTools = mcpTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let finalMessages = [...messages];
          let isDone = false;
          let iteration = 0;

          while (!isDone) {
            iteration++;
            console.log(`[CHAT] Claude call #${iteration}...`);

            const response = await anthropic.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 2048,
              system: systemPrompt,
              messages: finalMessages,
              tools: anthropicTools,
            });

            console.log(`[CHAT] Claude stop_reason: ${response.stop_reason} | input_tokens: ${response.usage.input_tokens} | output_tokens: ${response.usage.output_tokens}`);

            finalMessages.push({ role: 'assistant', content: response.content });

            if (response.stop_reason === 'tool_use') {
              const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');
              const toolResults = [];

              for (const block of toolUseBlocks) {
                if (block.type === 'tool_use') {
                  console.log(`[CHAT] → Tool call: ${block.name}`, JSON.stringify(block.input));

                  let mcpResult;
                  try {
                    mcpResult = await activeMcpClient!.callTool({
                      name: block.name,
                      arguments: block.input as Record<string, any>,
                    });
                    console.log(`[CHAT] ← Tool result: ${block.name} OK (isError=${mcpResult.isError ?? false})`);
                  } catch (err: any) {
                    console.error(`[CHAT] ← Tool result: ${block.name} THREW`, err.message);
                    mcpResult = {
                      content: [{ type: "text", text: `Error executing tool: ${err.message}` }],
                      isError: true,
                    };
                  }

                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: typeof mcpResult.content === 'string' ? mcpResult.content : JSON.stringify(mcpResult.content),
                    is_error: mcpResult.isError || false,
                  });
                }
              }

              finalMessages.push({ role: 'user', content: toolResults as any });
            } else {
              const textBlocks = response.content.filter(block => block.type === 'text');
              const fullText = textBlocks.map((b: any) => b.text).join('');
              console.log(`[CHAT] Final response (${fullText.length} chars): "${fullText.slice(0, 120)}${fullText.length > 120 ? '…' : ''}"`);

              for (const block of textBlocks) {
                if (block.type === 'text') {
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: block.text })}\n\n`));
                }
              }
              isDone = true;
            }
          }

          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
          console.log(`[CHAT] Done. Total Claude calls: ${iteration}`);
        } catch (error: any) {
          console.error('[CHAT] Stream error:', error.message, error.stack);
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: `\n\n**Error:** ${error.message}` })}\n\n`));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        } finally {
          if (activeTransport) await activeTransport.close();
          console.log('[CHAT] MCP transport closed.');
        }
      }
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });

  } catch (error: any) {
    console.error('[CHAT] Unhandled error:', error.message, error.stack);
    if (activeTransport) await activeTransport.close();
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), { status: 500 });
  }
};
