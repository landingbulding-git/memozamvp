import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@notionhq/client";

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const server = new Server({
  name: "notion-mcp-server",
  version: "1.0.0",
}, {
  capabilities: { tools: {} },
});

// Flatten a raw Notion property value into something readable for Claude
function extractPropertyValue(prop) {
  switch (prop.type) {
    case 'title':        return prop.title.map(t => t.plain_text).join('');
    case 'rich_text':    return prop.rich_text.map(t => t.plain_text).join('');
    case 'select':       return prop.select?.name ?? null;
    case 'multi_select': return prop.multi_select.map(o => o.name);
    case 'status':       return prop.status?.name ?? null;
    case 'date':         return prop.date ?? null;
    case 'people':       return prop.people.map(p => ({ id: p.id, name: p.name }));
    case 'checkbox':     return prop.checkbox;
    case 'number':       return prop.number;
    case 'url':          return prop.url;
    case 'email':        return prop.email;
    case 'phone_number': return prop.phone_number;
    case 'formula':      return prop.formula?.string ?? prop.formula?.number ?? prop.formula?.boolean ?? prop.formula?.date ?? null;
    case 'relation':     return prop.relation.map(r => r.id);
    case 'rollup':       return prop.rollup?.number ?? prop.rollup?.date ?? prop.rollup?.array ?? null;
    default:             return `[${prop.type}]`;
  }
}

function cleanPage(page) {
  return {
    id: page.id,
    url: page.url,
    properties: Object.fromEntries(
      Object.entries(page.properties).map(([key, prop]) => [key, extractPropertyValue(prop)])
    ),
  };
}

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
        name: "get_database_schema",
        description: "Retrieve the property names and types of a Notion database. Always call this before query_database with filters or sorts, and before update_page_properties, so you know exact property names and available options.",
        inputSchema: {
          type: "object",
          properties: {
            database_id: { type: "string", description: "The ID of the database." }
          },
          required: ["database_id"],
        },
      },
      {
        name: "query_database",
        description: "Query a Notion database and return its records with cleaned property values. Returns page IDs needed for get_page or update_page_properties.",
        inputSchema: {
          type: "object",
          properties: {
            database_id: { type: "string", description: "The ID of the database to query." },
            filter: { type: "object", description: "Optional filter object (Notion API format)." },
            sorts: { type: "array", description: "Optional sorts array (Notion API format)." },
          },
          required: ["database_id"],
        },
      },
      {
        name: "get_page",
        description: "Retrieve the current property values of a specific Notion page or database record by its ID.",
        inputSchema: {
          type: "object",
          properties: {
            page_id: { type: "string", description: "The ID of the page or record." }
          },
          required: ["page_id"],
        },
      },
      {
        name: "update_page_properties",
        description: "Update one or more properties of an existing Notion page or database record. Use get_database_schema first to confirm property names and types. Properties must use Notion API update format.",
        inputSchema: {
          type: "object",
          properties: {
            page_id: { type: "string", description: "The ID of the page to update." },
            properties: {
              type: "object",
              description: `Properties to update in Notion API format. Examples by type:
- select:       { "Status": { "select": { "name": "Done" } } }
- status:       { "Status": { "status": { "name": "In Progress" } } }
- date:         { "Due Date": { "date": { "start": "2024-01-15" } } }
- people:       { "Assignee": { "people": [{ "id": "user_id" }] } }
- checkbox:     { "Done": { "checkbox": true } }
- number:       { "Priority": { "number": 1 } }
- rich_text:    { "Notes": { "rich_text": [{ "text": { "content": "text here" } }] } }
- title:        { "Name": { "title": [{ "text": { "content": "New title" } }] } }
- multi_select: { "Tags": { "multi_select": [{ "name": "Tag1" }, { "name": "Tag2" }] } }
- url:          { "Link": { "url": "https://example.com" } }`
            },
          },
          required: ["page_id", "properties"],
        },
      },
      {
        name: "create_page",
        description: "Create a new page or database record in Notion. Requires a parent_id. For database records you can also pass additional properties.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "The title of the new page." },
            content: { type: "string", description: "Optional text content for the page body." },
            parent_id: { type: "string", description: "The ID of the parent page or database." },
            parent_type: { type: "string", enum: ["page", "database"], description: "Whether the parent is a page or a database." },
            properties: {
              type: "object",
              description: "Additional properties to set when creating inside a database (same Notion API update format as update_page_properties, excluding title)."
            },
          },
          required: ["title", "parent_id", "parent_type"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "search_notion") {
      const response = await notion.search({
        query: args.query,
        page_size: 10,
      });
      // Return just id, url, object type, and title for each result
      const results = response.results.map(item => {
        const title = item.object === 'database'
          ? item.title?.map(t => t.plain_text).join('') ?? '(untitled)'
          : item.properties?.title?.title?.map(t => t.plain_text).join('') ??
            Object.values(item.properties ?? {}).find(p => p.type === 'title')?.title?.map(t => t.plain_text).join('') ??
            '(untitled)';
        return { id: item.id, url: item.url, type: item.object, title };
      });
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }

    if (name === "get_database_schema") {
      const database = await notion.databases.retrieve({ database_id: args.database_id });
      const schema = Object.entries(database.properties).map(([propName, prop]) => {
        const entry = { name: propName, type: prop.type };
        if (prop.type === 'select') entry.options = prop.select.options.map(o => o.name);
        if (prop.type === 'multi_select') entry.options = prop.multi_select.options.map(o => o.name);
        if (prop.type === 'status') entry.options = prop.status.options.map(o => o.name);
        return entry;
      });
      return {
        content: [{ type: "text", text: JSON.stringify(schema, null, 2) }],
      };
    }

    if (name === "query_database") {
      const queryParams = { database_id: args.database_id, page_size: 20 };
      if (args.filter && Object.keys(args.filter).length > 0) queryParams.filter = args.filter;
      if (args.sorts && args.sorts.length > 0) queryParams.sorts = args.sorts;

      const response = await notion.databases.query(queryParams);
      const cleaned = response.results.map(cleanPage);
      return {
        content: [{ type: "text", text: JSON.stringify(cleaned, null, 2) }],
      };
    }

    if (name === "get_page") {
      const page = await notion.pages.retrieve({ page_id: args.page_id });
      return {
        content: [{ type: "text", text: JSON.stringify(cleanPage(page), null, 2) }],
      };
    }

    if (name === "update_page_properties") {
      const response = await notion.pages.update({
        page_id: args.page_id,
        properties: args.properties,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, id: response.id, url: response.url }, null, 2) }],
      };
    }

    if (name === "create_page") {
      const parent = args.parent_type === "database"
        ? { database_id: args.parent_id }
        : { page_id: args.parent_id };

      const properties = {
        ...(args.properties ?? {}),
        title: { title: [{ text: { content: args.title } }] },
      };

      const children = args.content ? [
        {
          object: "block",
          paragraph: {
            rich_text: [{ text: { content: args.content } }],
          },
        },
      ] : [];

      const response = await notion.pages.create({ parent, properties, children });
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, id: response.id, url: response.url }, null, 2) }],
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

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
