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
  return messages.map(m => ({
    type: 'message',
    role: m.role,
    content: typeof m.content === 'string'
      ? [{ type: 'input_text', text: m.content }]
      : m.content,
  }));
}

// 從 messages 中提取 system prompt 作為 instructions
function extractInstructions(messages) {
  const sys = messages.find(m => m.role === 'system');
  return sys?.content || 'You are a helpful assistant.';
}

// 發送請求到 chatgpt.com/backend-api/codex/responses
// 回傳 Node.js IncomingMessage（SSE stream）
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

// 解析 SSE 事件流，收集所有 text delta，組成 chat completion 回應
async function collectSseResponse(stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let text = '';
    let responseId = null;
    let model = null;
    let usage = null;
    let finishReason = 'stop';

    stream.on('data', chunk => { buffer += chunk.toString(); });
    stream.on('error', reject);
    stream.on('end', () => {
      // 解析所有 SSE 行
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
          if (ev.type === 'response.completed') {
            usage = ev.response?.usage || null;
            model = ev.response?.model || model;
          }
        } catch { /* 忽略解析失敗的行 */ }
      }

      resolve({
        id: responseId || `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model || 'gpt-5.4-mini',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: finishReason,
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

// 將 Responses API SSE 轉為 Chat Completions SSE 格式並 pipe 到 res
function pipeStreamResponse(stream, res, model) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let buffer = '';
  const responseId = `chatcmpl-${Date.now()}`;

  stream.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // 保留不完整的最後一行

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const ev = JSON.parse(line.slice(6));

        if (ev.type === 'response.output_text.delta' && ev.delta) {
          const chunk = {
            id: responseId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: model || 'gpt-5.4-mini',
            choices: [{ index: 0, delta: { content: ev.delta }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        if (ev.type === 'response.completed') {
          const done = {
            id: responseId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: ev.response?.model || model || 'gpt-5.4-mini',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          };
          res.write(`data: ${JSON.stringify(done)}\n\n`);
          res.write('data: [DONE]\n\n');
        }
      } catch { /* 忽略 */ }
    }
  });

  stream.on('end', () => res.end());
  stream.on('error', () => res.end());
}

// 主入口：處理一個 chat completions 請求
async function callCodex(token, chatBody, res) {
  const messages = chatBody.messages || [];
  const isStream = chatBody.stream === true;

  const codexBody = {
    model: chatBody.model || 'gpt-5.4-mini',
    store: false,
    stream: true, // 端點強制要求 stream:true
    instructions: extractInstructions(messages.filter(m => m.role !== 'system')),
    input: toResponsesInput(messages.filter(m => m.role !== 'system')),
    reasoning: {},
    text: { verbosity: 'medium' },
    include: ['reasoning.encrypted_content'],
  };

  // 如果有 system message，用它當 instructions
  const sys = messages.find(m => m.role === 'system');
  if (sys) codexBody.instructions = sys.content;
  // input 不含 system
  codexBody.input = toResponsesInput(messages.filter(m => m.role !== 'system'));

  const stream = await requestCodex(token, codexBody);

  if (stream.statusCode !== 200) {
    let body = '';
    stream.on('data', d => body += d);
    await new Promise(r => stream.on('end', r));
    return { status: stream.statusCode, data: (() => { try { return JSON.parse(body); } catch { return { error: { message: body } }; } })() };
  }

  if (isStream) {
    pipeStreamResponse(stream, res, codexBody.model);
    return null; // 已直接 pipe，不需要再回應
  } else {
    const result = await collectSseResponse(stream);
    return { status: 200, data: result };
  }
}

module.exports = { callCodex, extractAccountId };
