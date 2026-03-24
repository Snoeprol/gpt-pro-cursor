require('dotenv').config();
const express = require('express');
const https = require('https');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3045;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TARGET_MODEL = process.env.TARGET_MODEL || 'gpt-4.5'; // override with e.g. gpt-5.4-pro when available

// ── helpers ──────────────────────────────────────────────────────────────────

function chatMessagesToResponsesInput(messages) {
  const systemParts = [];
  const inputMessages = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text ?? '').join(''));
    } else {
      const content = typeof msg.content === 'string'
        ? msg.content
        : msg.content; // pass arrays through (vision etc.)
      inputMessages.push({ role: msg.role, content });
    }
  }

  return { instructions: systemParts.join('\n\n') || undefined, input: inputMessages };
}

function responsesOutputToChoice(output) {
  const message = output.find(o => o.type === 'message');
  if (!message) return { message: { role: 'assistant', content: '' }, finish_reason: 'stop' };

  const text = message.content
    .filter(c => c.type === 'output_text')
    .map(c => c.text)
    .join('');

  return { message: { role: 'assistant', content: text }, finish_reason: 'stop' };
}

function makeOpenAIRequest(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/responses',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, resolve);
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/', (_req, res) => res.json({ status: 'ok', model: TARGET_MODEL }));

// Models endpoint — Cursor probes this
app.get('/v1/models', (_req, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: TARGET_MODEL,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'openai',
      },
    ],
  });
});

// Main completions proxy
app.post('/v1/chat/completions', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: { message: 'OPENAI_API_KEY not set in .env', type: 'server_error' } });
  }

  const {
    messages = [],
    model,
    stream = false,
    max_tokens,
    temperature,
    top_p,
    presence_penalty,
    frequency_penalty,
  } = req.body;

  const { instructions, input } = chatMessagesToResponsesInput(messages);

  const responsesBody = {
    model: TARGET_MODEL,
    input,
    ...(instructions && { instructions }),
    ...(max_tokens != null && { max_output_tokens: max_tokens }),
    ...(temperature != null && { temperature }),
    ...(top_p != null && { top_p }),
    stream,
  };

  const requestId = `chatcmpl-proxy-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  try {
    const upstream = await makeOpenAIRequest(responsesBody);

    if (!stream) {
      // ── non-streaming ────────────────────────────────────────────────────
      let raw = '';
      upstream.on('data', chunk => (raw += chunk));
      upstream.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return res.status(502).json({ error: { message: 'Invalid JSON from upstream', type: 'proxy_error', raw } });
        }

        if (parsed.error) {
          return res.status(upstream.statusCode ?? 502).json({ error: parsed.error });
        }

        const choice = responsesOutputToChoice(parsed.output ?? []);
        const usage = parsed.usage ?? {};

        res.json({
          id: requestId,
          object: 'chat.completion',
          created,
          model: TARGET_MODEL,
          choices: [{ index: 0, ...choice, logprobs: null }],
          usage: {
            prompt_tokens: usage.input_tokens ?? 0,
            completion_tokens: usage.output_tokens ?? 0,
            total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
          },
        });
      });

    } else {
      // ── streaming ────────────────────────────────────────────────────────
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      let buffer = '';
      let sentFirstChunk = false;

      upstream.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;

          let event;
          try { event = JSON.parse(data); } catch { continue; }

          // Translate Responses API stream events → Chat Completions deltas
          if (event.type === 'response.output_text.delta') {
            const delta = event.delta ?? '';
            if (!sentFirstChunk) {
              // role chunk first
              const roleChunk = {
                id: requestId, object: 'chat.completion.chunk', created, model: TARGET_MODEL,
                choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
              };
              res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);
              sentFirstChunk = true;
            }
            const textChunk = {
              id: requestId, object: 'chat.completion.chunk', created, model: TARGET_MODEL,
              choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
            };
            res.write(`data: ${JSON.stringify(textChunk)}\n\n`);
          }

          if (event.type === 'response.completed' || event.type === 'response.failed') {
            const doneChunk = {
              id: requestId, object: 'chat.completion.chunk', created, model: TARGET_MODEL,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            };
            res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          }
        }
      });

      upstream.on('end', () => {
        if (!res.writableEnded) {
          const doneChunk = {
            id: requestId, object: 'chat.completion.chunk', created, model: TARGET_MODEL,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          };
          res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      });

      upstream.on('error', err => {
        console.error('Upstream stream error:', err);
        if (!res.writableEnded) res.end();
      });
    }
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(502).json({ error: { message: err.message, type: 'proxy_error' } });
  }
});

// ── start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n✅  GPT-pro Cursor proxy running`);
  console.log(`   http://localhost:${PORT}/v1`);
  console.log(`   Model: ${TARGET_MODEL}`);
  console.log(`   Set this as your Cursor OpenAI base URL\n`);
});
