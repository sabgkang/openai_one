const https = require('https');

const CODEX_HOST = 'chatgpt.com';
const CODEX_PATH = '/backend-api/codex/responses';

// 從 JWT payload 解出 chatgpt_account_id（無需驗簽，僅讀 payload）
function extractAccountId(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return payload['https://api.openai.com/auth']?.chatgpt_account_id || null;
  } catch {
    return null;
  }
}

// Chat Completions messages → Responses API input
function toResponsesInput(messages) {
  const result = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      result.push({
        type: 'function_call_output',
        call_id: m.tool_call_id,
        output: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      });
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      if (m.content) {
        result.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
        });
      }
      for (const tc of m.tool_calls) {
        result.push({
          type: 'function_call',
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
    } else {
      const contentType = m.role === 'assistant' ? 'output_text' : 'input_text';
      result.push({
        type: 'message',
        role: m.role,
        content: typeof m.content === 'string'
          ? [{ type: contentType, text: m.content }]
          : m.content,
      });
    }
  }
  return result;
}

// Chat Completions tools → Responses API tools
function toResponsesTools(tools) {
  if (!tools?.length) return undefined;
  return tools.map(t => ({
    type: 'function',
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
}

// 發送請求到 chatgpt.com/backend-api/codex/responses
function requestCodex(token, body) {
  return new Promise((resolve, reject) => {
    const accountId = extractAccountId(token);
    const payload = JSON.stringify(body);

    const req = https.request({
      hostname: CODEX_HOST,
      path: CODEX_PATH,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'chatgpt-account-id': accountId || '',
        'OpenAI-Beta': 'responses=experimental',
        'originator': 'codex_cli_rs',
        'accept': 'text/event-stream',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, resolve);

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// 解析 SSE 事件流，組成 chat completion 回應（含工具呼叫）
async function collectSseResponse(stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let text = '';
    let responseId = null;
    let model = null;
    let usage = null;
    const toolCallsMap = {}; // item_id → {call_id, name, arguments}

    stream.on('data', chunk => { buffer += chunk.toString(); });
    stream.on('error', reject);
    stream.on('end', () => {
      for (const line of buffer.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6));

          if (ev.type === 'response.created' || ev.type === 'response.in_progress') {
            responseId = ev.response?.id || responseId;
            model = ev.response?.model || model;
          }
          if (ev.type === 'response.output_text.delta') {
            text += ev.delta || '';
          }
          if (ev.type === 'response.output_item.added' && ev.item?.type === 'function_call') {
            toolCallsMap[ev.item.id] = { call_id: ev.item.call_id, name: ev.item.name, arguments: '' };
          }
          if (ev.type === 'response.function_call_arguments.delta' && toolCallsMap[ev.item_id]) {
            toolCallsMap[ev.item_id].arguments += ev.delta || '';
          }
          if (ev.type === 'response.completed') {
            usage = ev.response?.usage || null;
            model = ev.response?.model || model;
            // response.output が一番確実なソース
            for (const item of ev.response?.output || []) {
              if (item.type === 'function_call') {
                toolCallsMap[item.id] = { call_id: item.call_id, name: item.name, arguments: item.arguments || '' };
              }
              if (item.type === 'message') {
                for (const c of item.content || []) {
                  if (c.type === 'output_text' && c.text) text = c.text;
                }
              }
            }
          }
        } catch { /* 忽略解析失敗的行 */ }
      }

      const toolCallsList = Object.values(toolCallsMap);
      const hasToolCalls = toolCallsList.length > 0;

      resolve({
        id: responseId || `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model || 'gpt-5.4-mini',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: hasToolCalls ? null : text,
            ...(hasToolCalls && {
              tool_calls: toolCallsList.map((tc, i) => ({
                id: tc.call_id,
                type: 'function',
                function: { name: tc.name, arguments: tc.arguments },
              })),
            }),
          },
          finish_reason: hasToolCalls ? 'tool_calls' : 'stop',
        }],
        usage: usage ? {
          prompt_tokens: usage.input_tokens || 0,
          completion_tokens: usage.output_tokens || 0,
          total_tokens: usage.total_tokens || 0,
        } : undefined,
      });
    });
  });
}

// 將 Responses API SSE 轉為 Chat Completions SSE 格式並 pipe 到 res（含工具呼叫）
function pipeStreamResponse(stream, res, model) {
  return new Promise((resolve) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let buffer = '';
    const responseId = `chatcmpl-${Date.now()}`;
    const toolCallIndexMap = {}; // item_id → index

    const write = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const chunk = (delta, finishReason, evModel) => ({
      id: responseId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: evModel || model || 'gpt-5.4-mini',
      choices: [{ index: 0, delta, finish_reason: finishReason ?? null }],
    });

    stream.on('data', data => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6));

          if (ev.type === 'response.output_text.delta' && ev.delta) {
            write(chunk({ content: ev.delta }));
          }

          if (ev.type === 'response.output_item.added' && ev.item?.type === 'function_call') {
            const idx = Object.keys(toolCallIndexMap).length;
            toolCallIndexMap[ev.item.id] = idx;
            write(chunk({ tool_calls: [{ index: idx, id: ev.item.call_id, type: 'function', function: { name: ev.item.name, arguments: '' } }] }));
          }

          if (ev.type === 'response.function_call_arguments.delta' && ev.delta) {
            const idx = toolCallIndexMap[ev.item_id];
            if (idx !== undefined) {
              write(chunk({ tool_calls: [{ index: idx, function: { arguments: ev.delta } }] }));
            }
          }

          if (ev.type === 'response.completed') {
            const hasToolCalls = Object.keys(toolCallIndexMap).length > 0;
            write(chunk({}, hasToolCalls ? 'tool_calls' : 'stop', ev.response?.model));
            res.write('data: [DONE]\n\n');
          }
        } catch { /* 忽略 */ }
      }
    });

    stream.on('end', () => { res.end(); resolve(); });
    stream.on('error', () => { res.end(); resolve(); });
  });
}

// 主入口：處理一個 chat completions 請求
async function callCodex(token, chatBody, res) {
  const messages = chatBody.messages || [];
  const isStream = chatBody.stream === true;
  const sys = messages.find(m => m.role === 'system');

  const codexBody = {
    model: chatBody.model || 'gpt-5.4-mini',
    store: false,
    stream: true,
    instructions: sys?.content || 'You are a helpful assistant.',
    input: toResponsesInput(messages.filter(m => m.role !== 'system')),
    text: { verbosity: 'medium' },
  };

  const tools = toResponsesTools(chatBody.tools);
  if (tools) codexBody.tools = tools;
  if (chatBody.tool_choice) codexBody.tool_choice = chatBody.tool_choice;

  const stream = await requestCodex(token, codexBody);

  if (stream.statusCode !== 200) {
    let body = '';
    stream.on('data', d => body += d);
    await new Promise(r => stream.on('end', r));
    return { status: stream.statusCode, data: (() => { try { return JSON.parse(body); } catch { return { error: { message: body } }; } })() };
  }

  if (isStream) {
    await pipeStreamResponse(stream, res, codexBody.model);
    return null;
  } else {
    const result = await collectSseResponse(stream);
    return { status: 200, data: result };
  }
}

module.exports = { callCodex, extractAccountId };
