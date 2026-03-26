/**
 * 單一 WebSocket Gateway（方案 B）
 * - 前端只連這一條 WS，發送：{ type: 'audio', data: base64 } 或 { type: 'text', text: '...' }
 * - 本服務收到 text 時，呼叫 MiniMax Chat + speech_output（SSE），把語音與轉寫經同一 WS 回傳
 * - 語音進（audio）：目前僅作轉發或留給 ASR 擴展；可先只用「文字發送」測試語音出
 */

import 'dotenv/config';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';

const PORT = Number(process.env.PORT) || 8765;
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
const MINIMAX_GROUP_ID = process.env.MINIMAX_GROUP_ID || ''; // 若官方要求則填
const CHAT_URL = process.env.MINIMAX_CHAT_URL || 'https://api.minimax.io/v1/text/chatcompletion_v2';

const conversations = new Map(); // ws -> messages[]

function getConversation(ws) {
  if (!conversations.has(ws)) {
    conversations.set(ws, [
      { role: 'system', content: '你是一個友善的語音助手，回答簡短、口語化。' },
    ]);
  }
  return conversations.get(ws);
}

function addToConversation(ws, role, content) {
  const conv = getConversation(ws);
  conv.push({ role, content });
  // 保留最近 N 輪，避免 context 過長
  while (conv.length > 20) {
    if (conv[1].role === 'system') break;
    conv.splice(1, 2);
  }
}

function sendToClient(ws, obj) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}

async function streamMiniMaxReply(ws, userText) {
  const conv = getConversation(ws);
  const messages = conv.map((m) => ({ role: m.role, content: m.content }));

  const body = {
    model: 'MiniMax-M2.1',
    stream: true,
    stream_options: { speech_output: true },
    voice_setting: {
      voice_id: 'female-tianmei',
      speed: 1,
      vol: 1,
      pitch: 0,
    },
    messages,
    max_tokens: 1024,
  };

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${MINIMAX_API_KEY}`,
  };
  if (MINIMAX_GROUP_ID) {
    headers['Group-Id'] = MINIMAX_GROUP_ID;
  }

  let fullText = '';
  try {
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      sendToClient(ws, { type: 'error', message: `MiniMax API ${res.status}: ${errText}` });
      return;
    }

    if (!res.body) {
      sendToClient(ws, { type: 'error', message: 'No response body' });
      return;
    }

    const reader = res.body;
    let buffer = '';
    for await (const chunk of reader) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') break;
        try {
          const json = JSON.parse(data);
          const choice = json.choices?.[0];
          const delta = choice?.delta;
          if (!delta) continue;

          if (delta.content) {
            fullText += delta.content;
            sendToClient(ws, { type: 'transcript', text: delta.content });
          }
          if (delta.audio_content && delta.audio_content !== '') {
            const buf = Buffer.from(delta.audio_content, 'hex');
            sendToClient(ws, { type: 'audio', data: buf.toString('base64') });
          }
        } catch (_) {
          // 忽略單行解析錯誤
        }
      }
    }

    if (fullText) {
      addToConversation(ws, 'assistant', fullText);
    }
  } catch (err) {
    sendToClient(ws, { type: 'error', message: err.message || 'MiniMax 請求失敗' });
  }
}

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Realtime Voice Gateway. Connect via WebSocket to ws://localhost:' + PORT);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : { type: 'audio', data: raw.toString('base64') };
      if (msg.type === 'text' && msg.text) {
        addToConversation(ws, 'user', msg.text);
        streamMiniMaxReply(ws, msg.text);
      } else if (msg.type === 'audio' && msg.data) {
        // 語音進：可在此接 ASR，再轉成 text 呼叫 streamMiniMaxReply
        // 目前僅回傳提示，實際 ASR 需自行接入（如 MiniMax/阿里/訊飛/Whisper）
        sendToClient(ws, { type: 'transcript', text: '[語音已收到，請使用「用文字發送」測試語音回覆]' });
      }
    } catch (e) {
      sendToClient(ws, { type: 'error', message: e.message });
    }
  });

  ws.on('close', () => {
    conversations.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log('Realtime Voice Gateway 運行於 ws://localhost:' + PORT);
  if (!MINIMAX_API_KEY) {
    console.warn('未設定 MINIMAX_API_KEY，請在 .env 中設定後重啟。');
  }
});
