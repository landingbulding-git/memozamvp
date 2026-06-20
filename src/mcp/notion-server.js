import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@notionhq/client";

// Initialize Notion Client
const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const server = new Server({
  name: "notion-mcp-server",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
  },
});

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_notion",
        description: "Search across the user's Notion workspace pages and databases.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query." }
          },
          required: ["query"],
        },
      },
      {
        name: "create_page",
        description: "Create a new page or task in Notion.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "The title of the new page." },
            content: { type: "string", description: "The text content of the page." }
          },
          required: ["title", "content"],
        },
      }
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    if (name === "search_notion") {
      const response = await notion.search({
        query: args.query,
        page_size: 5,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response.results, null, 2) }],
      };
    } 
    
    if (name === "create_page") {
      // NOTE: This requires a parent page ID to create a page in Notion.
      // For this MVP, if no PARENT_PAGE_ID is provided in env, it might fail.
      // We will assume process.env.NOTION_PARENT_PAGE_ID is set.
      if (!process.env.NOTION_PARENT_PAGE_ID) {
          return {
             content: [{ type: "text", text: "Error: NOTION_PARENT_PAGE_ID environment variable is missing. Cannot create page." }],
             isError: true,
          }
      }

      const response = await notion.pages.create({
        parent: { page_id: process.env.NOTION_PARENT_PAGE_ID },
        properties: {
          title: {
            title: [{ text: { content: args.title } }],
          },
        },
        children: [
          {
            object: "block",
            paragraph: {
              rich_text: [{ text: { content: args.content } }],
            },
          },
        ],
      });
      return {
        content: [{ type: "text", text: `Successfully created page with ID: ${response.id}` }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Notion API Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Start the server over stdio
const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
