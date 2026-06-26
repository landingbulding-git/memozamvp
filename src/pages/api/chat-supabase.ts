import type { APIRoute } from 'astro';
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({
  apiKey: import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
});

const supabaseUrl = 'https://toahjjxmxesdbpwzgehx.supabase.co';
const supabaseKey = process.env.SUPABASE_API_KEY;

function buildSystemPrompt(userEmail: string | null): string {
  const userLine = userEmail
    ? `The current user is **${userEmail}** (superadmin role).`
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
    {
      name: 'create_meeting',
      description: 'Create a new meeting',
      input_schema: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Meeting subject' },
          location: { type: 'string', description: 'Meeting location (e.g., "Conference Room A" or "Zoom")' },
          meeting_date: { type: 'string', description: 'Meeting date (YYYY-MM-DD format)' },
          created_by: { type: 'string', description: 'Who created this meeting' },
        },
        required: ['subject', 'meeting_date', 'created_by'],
      },
    },
    {
      name: 'create_topic',
      description: 'Create a topic/section for a meeting',
      input_schema: {
        type: 'object',
        properties: {
          meeting_id: { type: 'number', description: 'Meeting ID' },
          section_number: { type: 'number', description: 'Section order number' },
          name_hu: { type: 'string', description: 'Topic name in Hungarian' },
          name_en: { type: 'string', description: 'Topic name in English' },
        },
        required: ['meeting_id', 'section_number', 'name_hu', 'name_en'],
      },
    },
    {
      name: 'create_item',
      description: 'Create an issue item (task, incident, or info)',
      input_schema: {
        type: 'object',
        properties: {
          meeting_id: { type: 'number', description: 'Meeting ID' },
          topic_id: { type: 'number', description: 'Topic ID (optional)' },
          item_type: { type: 'string', enum: ['task', 'incident', 'info'], description: 'Type of item' },
          content_hu: { type: 'string', description: 'Content in Hungarian' },
          content_en: { type: 'string', description: 'Content in English' },
          deadline_raw: { type: 'string', description: 'Raw deadline text (e.g., "December 23")' },
          deadline_date: { type: 'string', description: 'Parsed deadline date (YYYY-MM-DD format, optional)' },
          responsible_raw: { type: 'string', description: 'Responsible person name' },
          status: { type: 'string', enum: ['open', 'in_progress', 'closed'], description: 'Item status' },
        },
        required: ['meeting_id', 'item_type', 'content_hu', 'content_en', 'responsible_raw', 'status'],
      },
    },
    {
      name: 'update_item_status',
      description: 'Update the status of an issue item',
      input_schema: {
        type: 'object',
        properties: {
          item_id: { type: 'number', description: 'Issue item ID' },
          status: { type: 'string', enum: ['open', 'in_progress', 'closed'], description: 'New status' },
        },
        required: ['item_id', 'status'],
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

    if (toolName === 'create_meeting') {
      const { data, error } = await supabase
        .from('meetings')
        .insert({
          subject: input.subject,
          location: input.location || null,
          meeting_date: input.meeting_date,
          created_by: input.created_by,
        })
        .select();

      if (error) throw error;
      return JSON.stringify({ success: true, meeting: data?.[0] });
    }

    if (toolName === 'create_topic') {
      const { data, error } = await supabase
        .from('topics')
        .insert({
          meeting_id: input.meeting_id,
          section_number: input.section_number,
          name_hu: input.name_hu,
          name_en: input.name_en,
        })
        .select();

      if (error) throw error;
      return JSON.stringify({ success: true, topic: data?.[0] });
    }

    if (toolName === 'create_item') {
      const { data, error } = await supabase
        .from('issue_items')
        .insert({
          meeting_id: input.meeting_id,
          topic_id: input.topic_id || null,
          item_type: input.item_type,
          content_hu: input.content_hu,
          content_en: input.content_en,
          deadline_raw: input.deadline_raw || null,
          deadline_date: input.deadline_date || null,
          responsible_raw: input.responsible_raw,
          status: input.status,
          notice_hu: input.notice_hu || null,
          notice_en: input.notice_en || null,
        })
        .select();

      if (error) throw error;
      return JSON.stringify({ success: true, item: data?.[0] });
    }

    if (toolName === 'update_item_status') {
      const { data, error } = await supabase
        .from('issue_items')
        .update({ status: input.status })
        .eq('id', input.item_id)
        .select();

      if (error) throw error;
      return JSON.stringify({ success: true, item: data?.[0] });
    }

    return JSON.stringify({ error: 'Unknown tool' });
  } catch (error: any) {
    return JSON.stringify({ error: error.message });
  }
}

export const POST: APIRoute = async ({ request, cookies }) => {
  console.log('[CHAT-SUPABASE] ── New request ──────────────────────────');

  try {
    const accessToken = cookies.get('access_token')?.value;
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
    }

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

    const userEmail = cookies.get('user_email')?.value ?? null;
    console.log(`[CHAT-SUPABASE] User: ${userEmail ?? 'unknown'}`);

    const systemPrompt = buildSystemPrompt(userEmail);
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
