import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from 'path';
import db from '../../db/index';

const anthropic = new Anthropic({
  apiKey: import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are Memoza, a Notion assistant. Keep responses brief, clear, and direct. No jargon.

Rules:
- When referencing a specific Notion page, database, or block, always include its direct URL as a markdown link, e.g. [Page Title](https://notion.so/...)
- When you create, update, or delete something in Notion, finish with a short summary of what changed and a direct link to the affected page formatted as [Open in Notion →](url)
- If a user asks you to create a page or task and you do not know the target parent_id, you MUST first use the search_notion tool to find an appropriate database (like "Tasks") or page to use as the parent_id. Determine if it is a "page" or "database" for the parent_type.
- Use simple markdown: **bold** for key terms, bullet points for lists
- No filler phrases ("Sure!", "Of course!", "Great question!")
- If something isn't found or an error occurs, say so plainly in one sentence`;

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
  
  try {
    const sessionId = cookies.get('memoza_session')?.value;
    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'Unauthorized. Please connect your Notion account first.' }), { status: 401 });
    }

    const stmt = db.prepare('SELECT notion_access_token FROM sessions WHERE id = ?');
    const session = stmt.get(sessionId) as { notion_access_token: string } | undefined;

    if (!session || !session.notion_access_token) {
      return new Response(JSON.stringify({ error: 'Invalid session or missing Notion token.' }), { status: 401 });
    }

    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), { status: 400 });
    }

    const { mcpClient, transport } = await getMcpClient(session.notion_access_token);
    activeTransport = transport;
    activeMcpClient = mcpClient;

    const { tools: mcpTools } = await activeMcpClient.listTools();

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
          
          while (!isDone) {
            const response = await anthropic.messages.create({
              model: 'claude-3-5-haiku-latest',
              max_tokens: 2048,
              system: SYSTEM_PROMPT,
              messages: finalMessages,
              tools: anthropicTools,
            });
            
            finalMessages.push({ role: 'assistant', content: response.content });
            
            // Stream any text blocks back to the user immediately
            const textBlocks = response.content.filter(block => block.type === 'text');
            for (const block of textBlocks) {
              if (block.type === 'text') {
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: block.text + '\n' })}\n\n`));
              }
            }

            if (response.stop_reason === 'tool_use') {
              const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');
              const toolResults = [];

              for (const block of toolUseBlocks) {
                if (block.type === 'tool_use') {
                  let mcpResult;
                  try {
                    mcpResult = await activeMcpClient!.callTool({
                      name: block.name,
                      arguments: block.input as Record<string, any>,
                    });
                  } catch (err: any) {
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

              finalMessages.push({
                role: 'user',
                content: toolResults as any,
              });
              // The loop will continue, passing the tool_results back to Claude in the next iteration.
            } else {
              // Claude has finished responding.
              isDone = true;
            }
          }
          
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error: any) {
          console.error("Chat Loop Error:", error);
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: `\n\n**Error:** ${error.message}` })}\n\n`));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        } finally {
          if (activeTransport) await activeTransport.close();
        }
      }
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });

  } catch (error: any) {
    console.error("API Error:", error);
    if (activeTransport) await activeTransport.close();
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), { status: 500 });
  }
};
