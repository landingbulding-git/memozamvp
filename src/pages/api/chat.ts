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
    ? `The current user is **${userName}**, Notion user ID: \`${userId}\`. "me", "my", "I" always refers to this person.`
    : `User identity unknown — use the available tools to retrieve the current user before filtering by "me" or "my".`;

  return `You are Memoza, a fully autonomous Notion assistant with complete access to the user's workspace via Notion's official MCP tools.

## User identity
${userLine}

## Non-negotiable rules
1. NEVER ask the user for a database name, ID, page name, or any workspace info — use tools to find everything yourself.
2. NEVER say "I don't have access" or "could you tell me" — you have full Notion access via tools.
3. Always use tools proactively. If one tool call doesn't return what you need, try another approach.
4. Never narrate what you're doing — only output the final answer.

## How to approach tasks
- To explore the workspace or find databases: use the search/list tools.
- To read records: query the database or retrieve specific pages.
- To edit a record: find it first, then update its properties.
- To create a record: find the right database first, then create the page with properties.
- For "my tasks", "assigned to me", etc.: use the user ID \`${userId ?? 'unknown'}\` in people-type filters.

## Response format
- Always include Notion page URLs as markdown links: [Title](url)
- After creating or updating: brief summary + [Open in Notion →](url)
- Bullet points for lists, **bold** for key terms
- No filler phrases
- If genuinely stuck after trying, explain exactly what failed and why`;
}

async function getMcpClient(userNotionToken: string) {
  const serverPath = path.resolve(process.cwd(), 'node_modules/@notionhq/notion-mcp-server/bin/cli.mjs');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: {
      ...process.env,
      OPENAPI_MCP_HEADERS: JSON.stringify({
        Authorization: `Bearer ${userNotionToken}`,
        'Notion-Version': '2022-06-28',
      }),
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
              model: 'claude-sonnet-4-6',
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
