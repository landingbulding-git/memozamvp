import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from 'path';

const anthropic = new Anthropic({
  apiKey: import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
});

function buildSystemPrompt(userName: string | null, userId: string | null): string {
  const userLine = userName
    ? `The current user is **${userName}** — Notion user ID: \`${userId}\`. When the user says "me", "my", "I", or "mine", this refers to this person. For people-type filters always use this ID.`
    : `User identity unknown — call get_current_user to retrieve it before filtering by "me" or "my".`;

  return `You are Memoza, a fully autonomous Notion assistant with complete access to the user's workspace.

## Identity
${userLine}

## NON-NEGOTIABLE RULES
1. NEVER ask the user for a database name, page name, ID, or any workspace detail — use tools to find everything yourself.
2. NEVER say "I don't have access", "I can't browse", or "could you tell me" — you have full access, just call the tools.
3. If the first approach fails, try another. Be persistent before giving up.
4. Only output the final answer — never narrate or describe what tools you are calling.

## Standard workflows

**Finding / listing records:**
1. list_all_databases → identify the right database by title
2. get_database_schema → learn exact property names and types
3. query_database → fetch with filters/sorts using exact property names from schema
4. Present results clearly with Notion links

**Updating a record:**
1. search_notion or query_database → locate the record, get its page ID
2. get_database_schema → confirm property name and type
3. update_page_properties → apply changes
4. Reply with what changed + [Open in Notion →](url)

**Creating a record:**
1. list_all_databases → find the target database, get its ID
2. get_database_schema → know which properties to set
3. create_page → create with correct properties
4. Reply with what was created + [Open in Notion →](url)

**"What do I have / show me everything":**
→ call list_all_databases immediately, then summarise what you find

## Tools
| Tool | When to use |
|------|-------------|
| list_all_databases | Start here whenever you need to discover databases |
| search_notion | Find a specific page or database by keyword |
| get_database_schema | ALWAYS call before query_database or update_page_properties |
| query_database | Fetch records; always get schema first for correct property names |
| get_page | Read one record's current property values by page ID |
| update_page_properties | Edit properties on an existing record |
| create_page | Create a new page or database entry |
| get_current_user | Get the current user's name and Notion ID |

## Filter syntax (use exact property names from get_database_schema)
- date:        { "property": "Due Date", "date": { "is_not_empty": true } }
- date before: { "property": "Due Date", "date": { "before": "2025-01-01" } }
- select:      { "property": "Status", "select": { "equals": "In Progress" } }
- people:      { "property": "Assignee", "people": { "contains": "${userId ?? '<user_id>'}" } }
- text:        { "property": "Name", "rich_text": { "contains": "keyword" } }
- checkbox:    { "property": "Done", "checkbox": { "equals": true } }
Sorts: [{ "property": "Due Date", "direction": "ascending" }]

## update_page_properties format
- select:    { "Status": { "select": { "name": "Done" } } }
- status:    { "Status": { "status": { "name": "In Progress" } } }
- date:      { "Due Date": { "date": { "start": "2024-01-15" } } }
- people:    { "Assignee": { "people": [{ "id": "user_id" }] } }
- checkbox:  { "Done": { "checkbox": true } }
- number:    { "Priority": { "number": 1 } }
- rich_text: { "Notes": { "rich_text": [{ "text": { "content": "text" } }] } }
- title:     { "Name": { "title": [{ "text": { "content": "New title" } }] } }

## Response format
- Include Notion links: [Page Title](url)
- After create/update: brief summary + [Open in Notion →](url)
- Bullet points for lists, **bold** for key terms
- No filler phrases ("Sure!", "Of course!")
- If genuinely stuck after trying all options, explain exactly what failed`;
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

    const userName = cookies.get('notion_user_name')?.value ?? null;
    const userId   = cookies.get('notion_user_id')?.value ?? null;
    console.log(`[CHAT] User identity: ${userName ?? 'unknown'} (${userId ?? 'no id'})`);
    const systemPrompt = buildSystemPrompt(userName, userId);

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
