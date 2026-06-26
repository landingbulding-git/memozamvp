import type { APIRoute } from 'astro';
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({
  apiKey: import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
});

const supabaseUrl = 'https://toahjjxmxesdbpwzgehx.supabase.co';
const supabaseKey = process.env.SUPABASE_API_KEY;

function buildSystemPrompt(userName: string | null, userId: string | null): string {
  const userLine = userName
    ? `The current user is **${userName}**, user ID: \`${userId}\`.`
    : `User identity unknown.`;

  return `You are Memoza, a meeting & task management assistant connected to a Supabase database.

## User identity
${userLine}

## Core capabilities
- Query meeting records, topics, and action items from Supabase
- Create, update, and manage meeting notes and tasks
- Track action items with deadlines and responsible parties
- Bilingual support (Hungarian & English)
- Provide summaries and status updates

## Available data
- Meetings: subject, location, date, created_by
- Topics: meeting sections with bilingual names
- Issue Items: tasks, incidents, info with deadlines, responsible parties, status tracking

## Response format
- Structured data as lists or tables
- **Bold** for key terms
- Clear, actionable responses
- Use actual data from the database when available`;
}

function getSupabaseTools() {
  return [
    {
      name: 'query_meetings',
      description: 'List all meetings from the database',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of results to return' },
        },
      },
    },
    {
      name: 'query_topics',
      description: 'Get topics for a specific meeting',
      input_schema: {
        type: 'object',
        properties: {
          meeting_id: { type: 'number', description: 'Meeting ID' },
        },
        required: ['meeting_id'],
      },
    },
    {
      name: 'query_items',
      description: 'Get issue items (tasks, incidents, info) for a meeting',
      input_schema: {
        type: 'object',
        properties: {
          meeting_id: { type: 'number', description: 'Meeting ID (optional)' },
          status: { type: 'string', enum: ['open', 'in_progress', 'closed'], description: 'Filter by status' },
        },
      },
    },
  ];
}

async function executeSupabaseTool(
  toolName: string,
  input: Record<string, any>,
  supabase: ReturnType<typeof createClient>
): Promise<string> {
  try {
    if (toolName === 'query_meetings') {
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .limit(input.limit || 10);

      if (error) throw error;
      return JSON.stringify(data || []);
    }

    if (toolName === 'query_topics') {
      const { data, error } = await supabase
        .from('topics')
        .select('*')
        .eq('meeting_id', input.meeting_id);

      if (error) throw error;
      return JSON.stringify(data || []);
    }

    if (toolName === 'query_items') {
      let query = supabase.from('issue_items').select('*');

      if (input.meeting_id) {
        query = query.eq('meeting_id', input.meeting_id);
      }
      if (input.status) {
        query = query.eq('status', input.status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return JSON.stringify(data || []);
    }

    return JSON.stringify({ error: 'Unknown tool' });
  } catch (error: any) {
    return JSON.stringify({ error: error.message });
  }
}

export const POST: APIRoute = async ({ request, cookies }) => {
  console.log('[CHAT-SUPABASE] ── New request ──────────────────────────');

  try {
    if (!supabaseKey) {
      return new Response(JSON.stringify({ error: 'SUPABASE_API_KEY not configured' }), { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), { status: 400 });
    }

    const lastUserMsg = messages.filter((m: any) => m.role === 'user').at(-1)?.content ?? '';
    console.log(`[CHAT-SUPABASE] User message: "${lastUserMsg}"`);

    const userName = cookies.get('user_name')?.value ?? null;
    const userId = cookies.get('user_id')?.value ?? null;
    console.log(`[CHAT-SUPABASE] User: ${userName ?? 'unknown'}`);

    const systemPrompt = buildSystemPrompt(userName, userId);
    const tools = getSupabaseTools();

    const anthropicTools = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let finalMessages = [...messages];
          let isDone = false;
          let iteration = 0;

          while (!isDone) {
            iteration++;
            console.log(`[CHAT-SUPABASE] Claude call #${iteration}...`);

            const response = await anthropic.messages.create({
              model: 'claude-opus-4-8',
              max_tokens: 2048,
              system: systemPrompt,
              messages: finalMessages,
              tools: anthropicTools,
            });

            console.log(`[CHAT-SUPABASE] Stop reason: ${response.stop_reason}`);

            finalMessages.push({ role: 'assistant', content: response.content });

            if (response.stop_reason === 'tool_use') {
              const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');
              const toolResults = [];

              for (const block of toolUseBlocks) {
                if (block.type === 'tool_use') {
                  console.log(`[CHAT-SUPABASE] → Tool: ${block.name}`);

                  const toolResult = await executeSupabaseTool(block.name, block.input as Record<string, any>, supabase);

                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: toolResult,
                  });
                }
              }

              finalMessages.push({ role: 'user', content: toolResults as any });
            } else {
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
          console.log(`[CHAT-SUPABASE] Done`);
        } catch (error: any) {
          console.error('[CHAT-SUPABASE] Stream error:', error.message);
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: `Error: ${error.message}` })}\n\n`));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });
  } catch (error: any) {
    console.error('[CHAT-SUPABASE] Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
