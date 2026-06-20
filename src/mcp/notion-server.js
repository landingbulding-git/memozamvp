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
        name: "query_database",
        description: "Query a specific Notion database to retrieve its records. You can optionally provide filter and sorts objects according to the Notion API syntax.",
        inputSchema: {
          type: "object",
          properties: {
            database_id: { type: "string", description: "The ID of the database to query." },
            filter: { type: "object", description: "Optional filter object (Notion API format)." },
            sorts: { type: "array", description: "Optional sorts array (Notion API format)." }
          },
          required: ["database_id"],
        },
      },
      {
        name: "create_page",
        description: "Create a new page or task in Notion. You must provide a parent_id.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "The title of the new page." },
            content: { type: "string", description: "The text content of the page." },
            parent_id: { type: "string", description: "The ID of the parent page or database." },
            parent_type: { type: "string", enum: ["page", "database"], description: "Whether the parent is a page or a database." }
          },
          required: ["title", "content", "parent_id", "parent_type"],
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

    if (name === "query_database") {
      const response = await notion.databases.query({
        database_id: args.database_id,
        filter: args.filter,
        sorts: args.sorts,
        page_size: 10,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response.results, null, 2) }],
      };
    } 
    
    if (name === "create_page") {
      const parent = args.parent_type === "database" 
        ? { database_id: args.parent_id } 
        : { page_id: args.parent_id };

      const response = await notion.pages.create({
        parent: parent,
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
