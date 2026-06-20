import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from 'url';
import path from 'path';
import db from '../../db/index';

const anthropic = new Anthropic({
  apiKey: import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are Memoza, a Notion assistant. Keep responses brief, clear, and direct. No jargon.

Rules:
- When referencing a specific Notion page, database, or block, always include its direct URL as a markdown link, e.g. [Page Title](https://notion.so/...)
- When you create, update, or delete something in Notion, finish with a short summary of what changed and a direct link to the affected page formatted as [Open in Notion →](url)
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

    console.log("=== INCOMING MESSAGES FROM FRONTEND ===");
    console.log(JSON.stringify(messages, null, 2));

    // Initialize MCP client specifically for this request using the user's token
    const { mcpClient, transport } = await getMcpClient(session.notion_access_token);
    activeTransport = transport;
    activeMcpClient = mcpClient;

    const { tools: mcpTools } = await activeMcpClient.listTools();

    // Convert MCP tools to Anthropic tool format
    const anthropicTools = mcpTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));

    console.log("=== SENDING TO ANTHROPIC (FIRST CALL) ===");

    // First request to Claude
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: messages,
      tools: anthropicTools,
    });

    console.log("=== RESPONSE FROM ANTHROPIC ===");
    console.log(JSON.stringify(response, null, 2));

    let finalMessages = [...messages];
    finalMessages.push({ role: 'assistant', content: response.content });

    // Check if Claude wants to call a tool
    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');
      
      if (toolUseBlocks.length > 0) {
        const toolResults = [];

        // Execute all requested tools
        for (const block of toolUseBlocks) {
          if (block.type === 'tool_use') {
            let mcpResult;
            try {
              mcpResult = await activeMcpClient.callTool({
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

        // Add all tool results to the messages array as a single user message
        finalMessages.push({
          role: 'user',
          content: toolResults as any,
        });

        // Set up SSE stream for the final response after tool execution
        const stream = new ReadableStream({
          async start(controller) {
            try {
              const anthropicStream = await anthropic.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 2048,
                system: SYSTEM_PROMPT,
                messages: finalMessages,
                stream: true,
              });

              for await (const chunk of anthropicStream) {
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`));
                }
              }
              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
              controller.close();
            } catch (error) {
              console.error("Stream error after tool use:", error);
              controller.error(error);
            } finally {
              // Clean up process when stream is done
              if (activeTransport) await activeTransport.close();
            }
          }
        });

        return new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
        });
      }
    }

    // If no tool was used, close the transport immediately
    if (activeTransport) await activeTransport.close();

    const textContent = response.content.find(block => block.type === 'text');
    const text = textContent && textContent.type === 'text' ? textContent.text : '';

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text })}\n\n`));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
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
