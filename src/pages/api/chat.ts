import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from 'path';

const anthropic = new Anthropic({
  apiKey: import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
});

function buildSystemPrompt(): string {
  return `You are Memoza, a Notion assistant. Keep responses brief, clear, and direct. No jargon.

Tool usage rules:
- To find pages or databases: use search_notion.
- To read or edit records in a database: ALWAYS call get_database_schema first to confirm exact property names and types.
- To query records: call query_database. Results include page IDs needed for get_page and update_page_properties.
- To read a single record's current properties: use get_page with its page ID.
- To update properties on an existing record: use update_page_properties with the page ID and a properties object in Notion API format.
- To create a new record: if parent_id is unknown, search_notion first, then create_page.
- Notion filter syntax:
  - date:        { "property": "Due Date", "date": { "is_not_empty": true } }
  - select:      { "property": "Status", "select": { "equals": "Done" } }
  - rich_text:   { "property": "Name", "rich_text": { "contains": "keyword" } }
- Notion sort syntax: [{ "property": "Due Date", "direction": "ascending" }]
- update_page_properties format by type:
  - select/status: { "Status": { "select": { "name": "Done" } } }
  - date:          { "Due Date": { "date": { "start": "2024-01-15" } } }
  - checkbox:      { "Done": { "checkbox": true } }
  - rich_text:     { "Notes": { "rich_text": [{ "text": { "content": "text" } }] } }
  - title:         { "Name": { "title": [{ "text": { "content": "New name" } }] } }

Response rules:
- Never narrate tool calls or describe what you are about to do. Only output the final answer.
- When referencing a Notion page, always include its direct URL as a markdown link: [Page Title](https://notion.so/...)
- When you create, update, or delete something, end with a short summary and [Open in Notion →](url)
- Use simple markdown: **bold** for key terms, bullet points for lists
- No filler phrases ("Sure!", "Of course!", "Great question!")
- If something isn't found or an error occurs, say so in one sentence`;
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
  
  try {
    const notionToken = cookies.get('notion_access_token')?.value;

    if (!notionToken) {
      return new Response(JSON.stringify({ error: 'Unauthorized. Please connect your Notion account first.' }), { status: 401 });
    }

    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), { status: 400 });
    }

    const systemPrompt = buildSystemPrompt();

    const { mcpClient, transport } = await getMcpClient(notionToken);
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
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 2048,
              system: systemPrompt,
              messages: finalMessages,
              tools: anthropicTools,
            });

            finalMessages.push({ role: 'assistant', content: response.content });

            if (response.stop_reason === 'tool_use') {
              // Intermediate step — suppress any text, it's internal narration

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

              finalMessages.push({ role: 'user', content: toolResults as any });
            } else {
              // Final response — stream all text blocks to the user
              const textBlocks = response.content.filter(block => block.type === 'text');
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
