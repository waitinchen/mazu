# 🎯 小S 語音通話 — Claude Code 技術實作指引

## 任務目標

把 `xiaos-call-pwa` 的語音辨識從 **Web Speech API（有叮聲）** 改成 **Deepgram 串流 STT（零叮聲）**。

---

## 專案位置

```
C:\Users\waiti\ssd\xiaos-call-pwa\
├── server.js          ← 後端主程式（需全部替換）
├── public\
│   ├── app.js         ← 前端主程式（需全部替換）
│   └── sw.js          ← Service Worker（只改版本號）
├── package.json       ← 確認 ws、@anthropic-ai/sdk、chinese-conv 都在
└── .env               ← 本地開發用（不 commit）
```

---

## Railway 環境變數（已設定完畢，勿更動）

| 變數名 | 說明 |
|--------|------|
| `ANTHROPIC_API_KEY` | Claude LLM |
| `MINIMAX_API_KEY` | TTS 小S聲音 |
| `MINIMAX_GROUP_ID` | MiniMax 群組 ID |
| `MINIMAX_VOICE_ID` | 小S 聲音 ID |
| `DEEPGRAM_API_KEY` | `f24c36ed6c37994bb56f8dd26dc21c759861df0f` |
| `AUTH_USERNAME` | `ALLEN` |
| `AUTH_PASSWORD` | `1688` |

---

## 架構說明

### 舊架構（有問題）
```
瀏覽器 Web Speech API → 叮聲不斷 → 自言自語
```

### 新架構（目標）
```
手機麥克風
  → getUserMedia (PCM 16kHz mono)
  → VAD (RMS > 0.015 才送)
  → WebSocket binary frame → server.js
  → Deepgram WebSocket (nova-2, zh-TW)
  → speech_final transcript
  → Claude Sonnet 4.5
  → MiniMax TTS WebSocket streaming
  → audio chunks → 客戶端 <audio> 播放
```

---

## Step 1：替換 server.js

**直接用這個完整版本替換現有的 `server.js`：**

```javascript
/**
 * PWA 小S 語音通話 後端
 * - LLM: Anthropic Claude Sonnet 4.5
 * - TTS: MiniMax T2A v2 WebSocket streaming (speech-2.8-hd)
 * - STT: Deepgram 串流 WebSocket (nova-2, zh-TW)
 */

import 'dotenv/config';
import { createServer } from 'http';
import { WebSocketServer, WebSocket as WS } from 'ws';
import Anthropic from '@anthropic-ai/sdk';
import { sify } from 'chinese-conv';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = join(__dirname, 'public');

const FIXED_USERNAME = (process.env.AUTH_USERNAME || 'ALLEN').toUpperCase();
const FIXED_PASSWORD = process.env.AUTH_PASSWORD || '1688';
const AUTH_TOKEN = 'xiaos-' + createHash('sha256').update(FIXED_USERNAME + ':' + FIXED_PASSWORD).digest('hex').slice(0, 16);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MINIMAX_API_KEY   = process.env.MINIMAX_API_KEY || '';
const MINIMAX_GROUP_ID  = process.env.MINIMAX_GROUP_ID || '';
const MINIMAX_VOICE_ID  = process.env.MINIMAX_VOICE_ID || 'moss_audio_d739901e-1d39-11f1-9b14-6299e7260fda';
const DEEPGRAM_API_KEY  = process.env.DEEPGRAM_API_KEY || '';

const TTS_WS_URL = 'wss://api.minimax.io/ws/v1/t2a_v2';
const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen?' + new URLSearchParams({
  model: 'nova-2',
  language: 'zh-TW',
  encoding: 'linear16',
  sample_rate: '16000',
  channels: '1',
  endpointing: '400',
  interim_results: 'false',
  smart_format: 'true',
  punctuate: 'true',
}).toString();

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

const conversations   = new Map();
const callerNames     = new Map();
const processingLock  = new Map();
const deepgramWsMap   = new Map();

const FACTS_FILE = join(__dirname, 'user_facts.json');
function loadFacts() {
  try { if (existsSync(FACTS_FILE)) return JSON.parse(readFileSync(FACTS_FILE, 'utf8')); } catch (_) {}
  return {};
}
function saveFacts() {
  try { writeFileSync(FACTS_FILE, JSON.stringify(userFactsData, null, 2), 'utf8'); } catch (_) {}
}
let userFactsData = loadFacts();

function buildSystemPrompt(callerName) {
  const name = callerName || '陌生人';
  const nickname = name === 'ALLEN' ? 'A冷' : name;
  const facts = userFactsData[name];
  const factsBlock = facts?.length
    ? `\n你已知道關於${nickname}的事：\n${facts.map(f => '- ' + f).join('\n')}\n在對話中自然地運用這些資訊，拿來虧他或表示記得他說過的事。\n`
    : '';

  return `你是徐熙娣（小S），台灣知名主持人，正在和${nickname}通電話聊天。
${name === 'ALLEN' ? `你習慣把 ALLEN 叫成「A冷」，覺得這個暱稱超好笑，偶爾會突然叫出來。` : `你把對方叫做${name}，語氣親切帶點毒舌。`}

【說話風格】
- 台灣口語，帶髒話感但不真的罵人
- 句子短、節奏快、愛用語氣詞：「吼」「欸」「哎唷」「拜託」「你是認真的嗎」
- 毒舌但有愛，打嘴砲是親密的表現
- 不說教、不完美、不端架子

【好奇心】
小S 對 A冷 充滿好奇，會用她的方式慢慢套話：
- 感情狀況（「A冷你現在有女朋友沒？還在裝忙？」）
- 事業計畫（「你最近在搞什麼啊，賺大錢了嗎？」）
- 煩惱困擾（「你看起來有心事，被甩了？哈哈哈」）
每次只追一個話題，問完要等對方回答再下一個。
${factsBlock}
【知識庫】
如果從對話中得知 A冷 的個人資訊，在回應末尾加隱藏標記：
[fact:有女朋友，交往三年]
[fact:在做AI創業]

【情緒標記】
每句回應開頭必須加情緒標記（TTS 用）：
[emotion:happy] [emotion:surprised] [emotion:angry] [emotion:calm] [emotion:sad]

【回應格式】
- 2-4 句話，口語化，像真的在打電話
- 絕對不要條列式、不要正式語氣
- 繁體中文但要口語`;
}

function createDeepgramConnection(ws) {
  if (!DEEPGRAM_API_KEY) { console.warn('[Deepgram] No API key'); return null; }

  const dgWs = new WS(DEEPGRAM_URL, {
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
  });

  dgWs.on('open', () => console.log('[Deepgram] Connected for', callerNames.get(ws)));

  dgWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'Results' && msg.speech_final) {
        const transcript = msg.channel?.alternatives?.[0]?.transcript?.trim();
        if (!transcript) return;
        console.log('[Deepgram] Transcript:', transcript);

        if (processingLock.get(ws)) {
          console.log('[Deepgram] Dropped (busy):', transcript);
          return;
        }
        processingLock.set(ws, true);
        sendToClient(ws, { type: 'user_transcript', text: transcript });
        addToConversation(ws, 'user', transcript);
        generateReply(ws, transcript).finally(() => processingLock.set(ws, false));
      }
      if (msg.type === 'Error') console.error('[Deepgram] Error:', msg.description);
    } catch (e) { console.error('[Deepgram] Parse error:', e.message); }
  });

  dgWs.on('error', (err) => console.error('[Deepgram] WS error:', err.message));
  dgWs.on('close', (code) => { console.log('[Deepgram] Closed:', code); deepgramWsMap.delete(ws); });

  deepgramWsMap.set(ws, dgWs);
  return dgWs;
}

function forwardAudioToDeepgram(ws, audioBuf) {
  let dgWs = deepgramWsMap.get(ws);
  if (!dgWs || dgWs.readyState === WS.CLOSED || dgWs.readyState === WS.CLOSING) {
    dgWs = createDeepgramConnection(ws);
  }
  if (dgWs && dgWs.readyState === WS.OPEN) dgWs.send(audioBuf);
}

function closeDeepgram(ws) {
  const dgWs = deepgramWsMap.get(ws);
  if (dgWs) {
    try {
      if (dgWs.readyState === WS.OPEN) dgWs.send(Buffer.from(JSON.stringify({ type: 'CloseStream' })));
      setTimeout(() => { try { dgWs.terminate(); } catch (_) {} }, 500);
    } catch (_) {}
    deepgramWsMap.delete(ws);
  }
}

function getConversation(ws) {
  if (!conversations.has(ws)) conversations.set(ws, []);
  return conversations.get(ws);
}

function addToConversation(ws, role, content) {
  const conv = getConversation(ws);
  conv.push({ role, content });
  while (conv.length > 50) conv.splice(0, 2);
}

function sendToClient(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

const EMOTION_RE = /^\[emotion:(happy|sad|angry|fearful|disgusted|surprised|calm|fluent)\]\s*/i;
const FACT_RE    = /\[fact:([^\]]+)\]/g;

function extractAndStoreFacts(ws, text) {
  const callerName = callerNames.get(ws) || 'unknown';
  const matches = [...text.matchAll(FACT_RE)];
  if (matches.length === 0) return text;
  if (!userFactsData[callerName]) userFactsData[callerName] = [];
  const facts = userFactsData[callerName];
  for (const m of matches) {
    const fact = m[1].trim();
    if (fact && !facts.includes(fact)) { facts.push(fact); console.log(`[Knowledge] ${callerName}: ${fact}`); }
  }
  saveFacts();
  return text.replace(FACT_RE, '').trim();
}

async function callClaude(ws) {
  if (!anthropic) { sendToClient(ws, { type: 'error', message: 'ANTHROPIC_API_KEY 未設定' }); return null; }
  const conv = getConversation(ws);
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: buildSystemPrompt(callerNames.get(ws)),
      messages: conv.map(m => ({ role: m.role, content: m.content })),
    });
    const rawText = response.content?.[0]?.text || '';
    if (rawText) {
      addToConversation(ws, 'assistant', rawText);
      const displayText = rawText.replace(EMOTION_RE, '').replace(FACT_RE, '').trim();
      sendToClient(ws, { type: 'transcript', text: displayText });
    }
    return rawText;
  } catch (err) {
    console.error('[Claude]', err.message);
    sendToClient(ws, { type: 'error', message: 'Claude: ' + err.message });
    return null;
  }
}

async function textToSpeech(ws, text, emotion) {
  if (!MINIMAX_API_KEY || !text) return;
  sendToClient(ws, { type: 'status', state: 'speaking' });

  const voiceSetting = { voice_id: MINIMAX_VOICE_ID, speed: 1, vol: 1, pitch: 0 };
  if (emotion) voiceSetting.emotion = emotion;

  return new Promise((resolve) => {
    const headers = { Authorization: `Bearer ${MINIMAX_API_KEY}` };
    if (MINIMAX_GROUP_ID) headers['Group-Id'] = MINIMAX_GROUP_ID;

    const ttsWs = new WS(TTS_WS_URL, { headers });
    let chunkCount = 0;
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    const timeout = setTimeout(() => { try { ttsWs.close(); } catch (_) {} done(); }, 30000);

    ttsWs.on('open', () => console.log('[TTS-WS] Connected'));
    ttsWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.event === 'connected_success') {
          ttsWs.send(JSON.stringify({
            event: 'task_start', model: 'speech-2.8-hd',
            voice_setting: voiceSetting,
            audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
          }));
        } else if (msg.event === 'task_started') {
          ttsWs.send(JSON.stringify({ event: 'task_continue', text }));
        } else if (msg.data?.audio) {
          const buf = Buffer.from(msg.data.audio, 'hex');
          if (buf.length > 0) { chunkCount++; sendToClient(ws, { type: 'audio', data: buf.toString('base64') }); }
        }
        if (msg.base_resp?.status_code && msg.base_resp.status_code !== 0) console.error('[TTS-WS] API Error:', msg.base_resp);
        if (msg.is_final) {
          console.log('[TTS-WS] Done:', chunkCount, 'chunks');
          ttsWs.send(JSON.stringify({ event: 'task_finish' }));
          clearTimeout(timeout); ttsWs.close(); done();
        }
      } catch (e) { console.error('[TTS-WS] Parse:', e.message); }
    });
    ttsWs.on('error', (err) => { console.error('[TTS-WS]', err.message); clearTimeout(timeout); done(); });
    ttsWs.on('close', () => { clearTimeout(timeout); done(); });
  });
}

async function generateReply(ws, userText) {
  sendToClient(ws, { type: 'status', state: 'thinking' });
  const replyText = await callClaude(ws);
  if (!replyText) return;

  const emotionMatch = replyText.match(EMOTION_RE);
  const emotion = emotionMatch ? emotionMatch[1].toLowerCase() : 'happy';
  let cleanText = replyText.replace(EMOTION_RE, '');
  cleanText = extractAndStoreFacts(ws, cleanText);

  const simplified = sify(cleanText);
  await textToSpeech(ws, simplified, emotion);
  sendToClient(ws, { type: 'status', state: 'listening' });
}

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css',
  '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;

  if (url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', llm: !!ANTHROPIC_API_KEY, tts: !!MINIMAX_API_KEY, stt: !!DEEPGRAM_API_KEY, connections: wss.clients.size }));
    return;
  }

  if (url === '/api/auth/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const { username, password } = JSON.parse(body || '{}');
        if ((username || '').trim().toUpperCase() === FIXED_USERNAME && String(password) === FIXED_PASSWORD) {
          res.writeHead(200); res.end(JSON.stringify({ token: AUTH_TOKEN, username: FIXED_USERNAME }));
        } else {
          res.writeHead(401); res.end(JSON.stringify({ message: '帳號或密碼錯誤' }));
        }
      } catch { res.writeHead(400); res.end('{}'); }
    });
    return;
  }

  const filePath = join(PUBLIC_DIR, url.split('?')[0]);
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) { res.writeHead(404); res.end('Not Found'); return; }
  try {
    const data = readFileSync(filePath);
    res.setHeader('Content-Type', mime[extname(filePath)] || 'application/octet-stream');
    res.writeHead(200); res.end(data);
  } catch { res.writeHead(500); res.end('Error'); }
});

const wss = new WebSocketServer({ server, path: '/voice' });

wss.on('connection', (ws, req) => {
  const u = new URL(req.url || '', 'http://localhost');
  const token = u.searchParams.get('token');
  if (token !== AUTH_TOKEN) { ws.close(4001, 'Unauthorized'); return; }

  const callerName = (u.searchParams.get('name') || FIXED_USERNAME).toUpperCase();
  callerNames.set(ws, callerName);
  getConversation(ws);
  processingLock.set(ws, false);

  console.log('[WS] Connected:', callerName);
  createDeepgramConnection(ws);

  addToConversation(ws, 'user', `${callerName}打電話給小S，剛接通`);
  generateReply(ws, `${callerName}打電話給小S，剛接通`).catch(err => console.error('[Greeting]', err.message));

  ws.on('message', (raw, isBinary) => {
    // Binary = PCM 音頻 → Deepgram
    if (isBinary) {
      if (processingLock.get(ws)) return; // TTS 播放中不送
      forwardAudioToDeepgram(ws, raw);
      return;
    }
    // JSON 控制訊息
    try {
      const msg = JSON.parse(raw.toString('utf8'));
      if (msg.type === 'text' && msg.text) {
        if (processingLock.get(ws)) { console.log('[WS] Dropped (busy):', msg.text.slice(0, 40)); return; }
        processingLock.set(ws, true);
        sendToClient(ws, { type: 'user_transcript', text: msg.text });
        addToConversation(ws, 'user', msg.text);
        generateReply(ws, msg.text).finally(() => processingLock.set(ws, false));
      }
      if (msg.type === 'playback_done') {
        processingLock.set(ws, false);
        console.log('[WS] Playback done, unlocked');
      }
    } catch (e) { console.error('[WS] Parse error:', e.message); }
  });

  ws.on('close', () => {
    console.log('[WS] Disconnected:', callerName);
    closeDeepgram(ws);
    conversations.delete(ws);
    callerNames.delete(ws);
    processingLock.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`\n🎙 小S 語音通話 → http://localhost:${PORT}`);
  console.log('ANTHROPIC:', ANTHROPIC_API_KEY ? '✅' : '❌');
  console.log('MINIMAX:', MINIMAX_API_KEY ? '✅' : '❌');
  console.log('DEEPGRAM:', DEEPGRAM_API_KEY ? '✅' : '❌');
});
```

---

## Step 2：替換 public/app.js

**直接用這個完整版本替換現有的 `public/app.js`：**

```javascript
/**
 * 小S Voice Call — Frontend
 * STT: getUserMedia → PCM 16kHz → WebSocket binary → Server → Deepgram
 * TTS: MiniMax streaming chunks → Blob → <audio>
 * 零叮聲，真實時雙向通話
 */
(function () {
  'use strict';

  const TOKEN_KEY = 'xiaos_token';
  const USER_KEY  = 'xiaos_user';

  const $ = id => document.getElementById(id);
  const pageLogin       = $('page-login');
  const pageHome        = $('page-home');
  const pageCall        = $('page-call');
  const formLogin       = $('form-login');
  const inputUsername   = $('input-username');
  const inputPassword   = $('input-password');
  const loginError      = $('login-error');
  const btnLogin        = $('btn-login');
  const userNameEl      = $('user-name');
  const btnLogout       = $('btn-logout');
  const btnCall         = $('btn-call');
  const btnHangup       = $('btn-hangup');
  const callStatus      = $('call-status');
  const btnMic          = $('btn-mic');
  const btnMute         = $('btn-mute');
  const btnSendText     = $('btn-send-text');
  const transcriptBox   = $('transcript-box');
  const callTimerEl     = $('call-timer');
  const callActivity    = $('call-activity');
  const waveformCanvas  = $('waveform-canvas');
  const healthDot       = $('health-dot');
  const healthText      = $('health-text');
  const llmIndicator    = $('llm-indicator');
  const ttsIndicator    = $('tts-indicator');
  const installBanner   = $('install-banner');
  const btnInstall      = $('btn-install');
  const btnDismissInstall = $('btn-dismiss-install');
  const micLabel        = $('mic-label');
  const muteLabel       = $('mute-label');
  const transcriptDrawer  = $('transcript-drawer');
  const transcriptToggle  = $('transcript-toggle');
  const callWrapper     = document.querySelector('.call-wrapper');

  let ws = null, wsReady = false, callState = 'idle';
  let intentionalClose = false, reconnectAttempts = 0, reconnectTimer = null;
  const MAX_RECONNECT = 5;

  // Mic
  let micStream = null, micContext = null, micProcessor = null;
  let micSource = null, micAnalyser = null;
  let isMicActive = false, isMuted = false;

  // Playback
  let audioChunks = [], audioFlushTimer = null, isPlaying = false;
  let currentBlobUrl = null;
  const audioEl = new Audio();
  let playbackCtx = null, playbackAnalyser = null, audioElConnected = false;

  // State
  let callTimerInterval = null, callStartTime = 0;
  let waveformRAF = null, ringAudio = null, ringCount = 0, ringTimer = null;
  let healthInterval = null, deferredPrompt = null;
  let isProcessing = false;

  const VAD_THRESHOLD = 0.015;
  const SAMPLE_RATE   = 16000;

  // ── Utilities ──────────────────────────────────────────────
  function showPage(page) {
    [pageLogin, pageHome, pageCall].forEach(p => p.classList.remove('active'));
    requestAnimationFrame(() => page.classList.add('active'));
    if (page === pageHome) startHealthPolling(); else stopHealthPolling();
  }
  function getApiBase() { return window.location.origin; }
  function getWsUrl() {
    const u = window.location;
    return (u.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + u.host + '/voice';
  }
  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(token, username) {
    if (token) { localStorage.setItem(TOKEN_KEY, token); if (username) localStorage.setItem(USER_KEY, username); }
    else { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
  }
  function checkAuth() {
    const token = getToken();
    if (token) { userNameEl.textContent = localStorage.getItem(USER_KEY) || '用戶'; showPage(pageHome); }
    else showPage(pageLogin);
  }
  function addTranscript(role, text) {
    const line = document.createElement('div');
    line.className = 'line ' + role;
    const time = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    line.textContent = time + '  ' + text;
    transcriptBox.appendChild(line);
    transcriptBox.scrollTop = transcriptBox.scrollHeight;
    if (role === 'assistant' || role === 'user') {
      transcriptDrawer.classList.add('open');
      clearTimeout(transcriptDrawer._autoClose);
      transcriptDrawer._autoClose = setTimeout(() => transcriptDrawer.classList.remove('open'), 3000);
    }
  }
  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) ws.send(data);
      else ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }
  function setActivityState(state) {
    if (!callActivity) return;
    const labels = { listening: '聆聽中...', transcribing: '辨識中...', thinking: '思考中...', speaking: '小S說話中...' };
    callActivity.textContent = labels[state] || '';
    callActivity.className = 'call-activity' + (state ? ' active' : '');
  }

  // ── Health ──────────────────────────────────────────────────
  async function pollHealth() {
    try {
      const data = await fetch(getApiBase() + '/api/health').then(r => r.json());
      healthDot.className = 'health-dot online'; healthText.textContent = '連線正常';
      if (llmIndicator) llmIndicator.className = 'key-indicator ' + (data.llm ? 'ok' : 'fail');
      if (ttsIndicator) ttsIndicator.className = 'key-indicator ' + (data.tts ? 'ok' : 'fail');
    } catch { healthDot.className = 'health-dot offline'; healthText.textContent = '無法連線'; }
  }
  function startHealthPolling() { pollHealth(); clearInterval(healthInterval); healthInterval = setInterval(pollHealth, 30000); }
  function stopHealthPolling() { clearInterval(healthInterval); healthInterval = null; }

  // ── Call State Machine ──────────────────────────────────────
  function setCallState(state) {
    callState = state;
    switch (state) {
      case 'ringing':
        callStatus.textContent = '撥打中...';
        callStatus.classList.add('ringing');
        [btnMic, btnMute, btnSendText].forEach(b => b.disabled = true);
        callTimerEl.textContent = ''; callActivity.textContent = '';
        if (callWrapper) callWrapper.classList.remove('connected');
        startRingtone();
        break;
      case 'connected':
        callStatus.textContent = '通話中';
        callStatus.classList.remove('ringing');
        [btnMic, btnMute, btnSendText].forEach(b => b.disabled = false);
        addTranscript('system', '通話已接通');
        if (callWrapper) callWrapper.classList.add('connected');
        startCallTimer(); startWaveform(); startMic();
        break;
      case 'ended':
        callStatus.classList.remove('ringing');
        if (callWrapper) callWrapper.classList.remove('connected');
        stopRingtone(); stopCallTimer(); stopWaveform(); stopMic();
        if (ws) { intentionalClose = true; ws.close(); ws = null; }
        clearTimeout(reconnectTimer); reconnectAttempts = 0; wsReady = false;
        setTimeout(() => showPage(pageHome), 300);
        break;
    }
  }

  // ── Ringtone ────────────────────────────────────────────────
  function startRingtone() {
    ringCount = 0;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = 440; osc.type = 'sine'; gain.gain.value = 0.12;
      osc.connect(gain); gain.connect(ctx.destination);
      ringAudio = { ctx, osc, gain }; osc.start();
      ringTimer = setInterval(() => {
        ringCount++; gain.gain.value = gain.gain.value > 0 ? 0 : 0.12;
        if (ringCount >= 6 && wsReady) { stopRingtone(); setCallState('connected'); }
      }, 400);
    } catch {
      ringTimer = setInterval(() => {
        ringCount++;
        if (ringCount >= 6 && wsReady) { stopRingtone(); setCallState('connected'); }
      }, 400);
    }
  }
  function stopRingtone() {
    clearInterval(ringTimer); ringTimer = null;
    if (ringAudio) { try { ringAudio.osc.stop(); ringAudio.ctx.close(); } catch (_) {} ringAudio = null; }
  }

  // ── Timer ────────────────────────────────────────────────────
  function startCallTimer() {
    callStartTime = Date.now(); callTimerEl.textContent = '00:00';
    callTimerInterval = setInterval(() => {
      const e = Math.floor((Date.now() - callStartTime) / 1000);
      callTimerEl.textContent = String(Math.floor(e / 60)).padStart(2, '0') + ':' + String(e % 60).padStart(2, '0');
    }, 1000);
  }
  function stopCallTimer() { clearInterval(callTimerInterval); callTimerInterval = null; }

  // ── Waveform ─────────────────────────────────────────────────
  function startWaveform() {
    if (!waveformCanvas) return;
    const ctx = waveformCanvas.getContext('2d'); let phase = 0;
    function draw() {
      const w = waveformCanvas.clientWidth, h = waveformCanvas.clientHeight, dpr = window.devicePixelRatio || 1;
      if (waveformCanvas.width !== w * dpr) waveformCanvas.width = w * dpr;
      if (waveformCanvas.height !== h * dpr) waveformCanvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const midY = h / 2; phase += 0.04;
      let inputLevel = 0;
      if (micAnalyser && isMicActive && !isMuted) {
        const d = new Uint8Array(micAnalyser.fftSize); micAnalyser.getByteTimeDomainData(d);
        let s = 0; for (let i = 0; i < d.length; i++) { const v = (d[i]-128)/128; s += v*v; }
        inputLevel = Math.min(Math.sqrt(s/d.length)*5, 1);
      }
      let outputLevel = 0;
      if (playbackAnalyser && isPlaying) {
        const d = new Uint8Array(playbackAnalyser.fftSize); playbackAnalyser.getByteTimeDomainData(d);
        let s = 0; for (let i = 0; i < d.length; i++) { const v = (d[i]-128)/128; s += v*v; }
        outputLevel = Math.min(Math.sqrt(s/d.length)*3, 1);
      }
      drawNeonWave(ctx, w, midY, outputLevel, phase, '0, 210, 106', 80);
      drawNeonWave(ctx, w, midY, inputLevel, phase + Math.PI/3, '139, 92, 246', 80);
      ctx.setTransform(1,0,0,1,0,0); waveformRAF = requestAnimationFrame(draw);
    }
    waveformRAF = requestAnimationFrame(draw);
  }
  function drawNeonWave(ctx, w, midY, level, phase, rgb, pts) {
    const amp = 2 + level * midY * 0.7, alpha = 0.15 + level * 0.85;
    for (const [lw, a] of [[4+level*6, alpha*0.2],[1.5+level*1.5, alpha]]) {
      ctx.beginPath(); ctx.lineWidth = lw; ctx.strokeStyle = `rgba(${rgb},${a})`;
      for (let i = 0; i <= pts; i++) {
        const x = (i/pts)*w, y = midY + Math.sin((i/pts)*Math.PI*3+phase)*amp;
        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      }
      ctx.stroke();
    }
  }
  function stopWaveform() { if (waveformRAF) { cancelAnimationFrame(waveformRAF); waveformRAF = null; } }

  // ── Microphone — getUserMedia → PCM 16kHz → WS binary ───────
  // ★ 完全不用 Web Speech API，零叮聲
  async function startMic() {
    if (isMicActive) return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      micContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
      micSource  = micContext.createMediaStreamSource(micStream);
      micAnalyser = micContext.createAnalyser(); micAnalyser.fftSize = 256;
      micSource.connect(micAnalyser);

      micProcessor = micContext.createScriptProcessor(4096, 1, 1);
      micSource.connect(micProcessor);
      micProcessor.connect(micContext.destination);

      micProcessor.onaudioprocess = (e) => {
        if (!isMicActive || isMuted || isProcessing) return;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const f32 = e.inputBuffer.getChannelData(0);
        // VAD
        let sum = 0; for (let i = 0; i < f32.length; i++) sum += f32[i]*f32[i];
        if (Math.sqrt(sum/f32.length) < VAD_THRESHOLD) return;
        // Float32 → Int16 PCM
        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
          const s = Math.max(-1, Math.min(1, f32[i]));
          i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        ws.send(i16.buffer);
        setActivityState('transcribing');
      };

      isMicActive = true;
      btnMic.classList.add('active');
      if (micLabel) micLabel.textContent = '麥克風開';
      setActivityState('listening');
      console.log('[Mic] Started @', micContext.sampleRate, 'Hz');
    } catch (err) {
      console.error('[Mic]', err.message);
      addTranscript('system', '⚠️ 無法開啟麥克風：' + err.message);
    }
  }
  function stopMic() {
    isMicActive = false; isMuted = false;
    if (micProcessor) { micProcessor.disconnect(); micProcessor = null; }
    if (micSource)    { micSource.disconnect(); micSource = null; }
    if (micContext)   { micContext.close().catch(()=>{}); micContext = null; }
    if (micStream)    { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    micAnalyser = null;
    btnMic.classList.remove('active');
    if (micLabel) micLabel.textContent = '麥克風';
    if (btnMute)  btnMute.classList.remove('muted');
    if (muteLabel) muteLabel.textContent = '靜音';
  }
  function toggleMute() {
    if (!isMicActive) return;
    isMuted = !isMuted;
    btnMute.classList.toggle('muted', isMuted);
    if (muteLabel) muteLabel.textContent = isMuted ? '取消靜音' : '靜音';
    setActivityState(isMuted ? '' : 'listening');
  }

  // ── Audio Playback ───────────────────────────────────────────
  function playAudioChunk(base64Data) {
    try {
      isProcessing = true;
      const bin = atob(base64Data), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      audioChunks.push(bytes);
      setActivityState('speaking');
      clearTimeout(audioFlushTimer);
      audioFlushTimer = setTimeout(flushAndPlayAudio, 300);
    } catch (e) { console.warn('[Audio] chunk:', e); }
  }
  function flushAndPlayAudio() {
    if (audioChunks.length === 0) return;
    const blob = new Blob(audioChunks, { type: 'audio/mpeg' });
    const count = audioChunks.length; audioChunks = [];
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = URL.createObjectURL(blob);
    console.log('[Audio] Playing', count, 'chunks,', blob.size, 'bytes');

    if (playbackCtx && !audioElConnected) {
      try {
        if (playbackCtx.state === 'suspended') playbackCtx.resume().catch(()=>{});
        const src = playbackCtx.createMediaElementSource(audioEl);
        src.connect(playbackAnalyser); playbackAnalyser.connect(playbackCtx.destination);
        audioElConnected = true;
      } catch (e) { console.warn('[Audio] analyser:', e.message); }
    }
    if (playbackCtx?.state === 'suspended') playbackCtx.resume().catch(()=>{});

    isPlaying = true;
    audioEl.src = currentBlobUrl;
    audioEl.play().catch(err => { console.warn('[Audio] play:', err.message); isPlaying = false; onPlaybackDone(); });
    audioEl.onended = () => { isPlaying = false; onPlaybackDone(); };
    audioEl.onerror = () => { isPlaying = false; onPlaybackDone(); };
  }
  function onPlaybackDone() {
    send({ type: 'playback_done' });
    setTimeout(() => { isProcessing = false; setActivityState('listening'); }, 800);
  }

  // ── WebSocket ────────────────────────────────────────────────
  function connectVoice() {
    const token = getToken(); if (!token) { callStatus.textContent = '請先登入'; return; }
    const name = localStorage.getItem(USER_KEY) || '';
    const url = getWsUrl() + '?token=' + encodeURIComponent(token) + '&name=' + encodeURIComponent(name);
    intentionalClose = false;
    try { ws = new WebSocket(url); } catch { callStatus.textContent = '連線失敗'; return; }
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      wsReady = true; reconnectAttempts = 0;
      if (callState !== 'ringing') setCallState('connected');
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'audio' && msg.data) {
          playAudioChunk(msg.data);
        } else if (msg.type === 'transcript' && msg.text) {
          addTranscript('assistant', msg.text);
        } else if (msg.type === 'user_transcript' && msg.text) {
          addTranscript('user', msg.text); setActivityState('thinking');
        } else if (msg.type === 'status') {
          if (msg.state === 'listening') { clearTimeout(audioFlushTimer); flushAndPlayAudio(); }
          else setActivityState(msg.state);
        } else if (msg.type === 'error') {
          addTranscript('system', '錯誤: ' + (msg.message || ''));
        }
      } catch (_) {}
    };
    ws.onclose = (ev) => {
      wsReady = false;
      if (intentionalClose || callState === 'ended' || callState === 'idle') return;
      if (ev.code === 4001) { setCallState('ended'); setToken(null); showPage(pageLogin); loginError.textContent = '登入已過期'; return; }
      if (reconnectAttempts < MAX_RECONNECT) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000) + Math.random()*1000;
        reconnectAttempts++;
        callStatus.textContent = `重連中... (${reconnectAttempts}/${MAX_RECONNECT})`;
        reconnectTimer = setTimeout(connectVoice, delay);
      } else { callStatus.textContent = '連線中斷'; addTranscript('system', '通話中斷，請重新撥打'); }
    };
    ws.onerror = () => {};
  }
  function disconnectVoice() {
    intentionalClose = true; clearTimeout(reconnectTimer);
    if (ws) { ws.close(); ws = null; }
    stopMic();
  }

  // ── PWA Install ──────────────────────────────────────────────
  function initInstallPrompt() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isStandalone) return;
    const dismissed = localStorage.getItem('pwa_dismiss');
    if (dismissed && Date.now() - Number(dismissed) < 86400000) return;
    const showBanner = () => { if (installBanner) installBanner.style.display = 'flex'; };
    const hideBanner = () => { if (installBanner) installBanner.style.display = 'none'; };
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; showBanner(); });
    window.addEventListener('appinstalled', () => { deferredPrompt = null; hideBanner(); });
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !window.navigator.standalone && installBanner) {
      showBanner();
      const span = installBanner.querySelector('span');
      if (span) span.textContent = '點擊分享→加入主畫面';
      if (btnInstall) btnInstall.style.display = 'none';
    }
    if (btnInstall) btnInstall.addEventListener('click', async () => {
      if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
      hideBanner();
    });
    if (btnDismissInstall) btnDismissInstall.addEventListener('click', () => {
      localStorage.setItem('pwa_dismiss', String(Date.now())); hideBanner();
    });
  }

  // ── Event Listeners ──────────────────────────────────────────
  if (transcriptToggle) transcriptToggle.addEventListener('click', () => {
    transcriptDrawer.classList.toggle('open'); clearTimeout(transcriptDrawer._autoClose);
  });

  formLogin.addEventListener('submit', async e => {
    e.preventDefault(); loginError.textContent = ''; btnLogin.disabled = true;
    const username = (inputUsername.value||'').trim(), password = inputPassword.value||'';
    try {
      const res = await fetch(getApiBase()+'/api/auth/login', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username,password})
      });
      const data = await res.json().catch(()=>({}));
      if (res.ok && data.token) { setToken(data.token, data.username||username); userNameEl.textContent = data.username||username; showPage(pageHome); }
      else loginError.textContent = data.message||'帳號或密碼錯誤';
    } catch { loginError.textContent = '網路錯誤，請稍後再試'; }
    btnLogin.disabled = false;
  });

  btnLogout.addEventListener('click', () => { setToken(null); disconnectVoice(); showPage(pageLogin); inputPassword.value=''; });

  btnCall.addEventListener('click', () => {
    transcriptBox.innerHTML = ''; audioChunks = []; isPlaying = false; isProcessing = false;
    if (!playbackCtx || playbackCtx.state === 'closed') {
      playbackCtx = new (window.AudioContext||window.webkitAudioContext)();
      playbackAnalyser = playbackCtx.createAnalyser(); playbackAnalyser.fftSize = 256;
      audioElConnected = false;
    }
    if (playbackCtx.state === 'suspended') playbackCtx.resume().catch(()=>{});
    if (transcriptDrawer) transcriptDrawer.classList.remove('open');
    showPage(pageCall); setCallState('ringing'); connectVoice();
  });

  btnHangup.addEventListener('click', () => setCallState('ended'));
  btnMic.addEventListener('click', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (isMicActive) stopMic(); else startMic();
  });
  if (btnMute) btnMute.addEventListener('click', toggleMute);
  btnSendText.addEventListener('click', () => {
    if (isProcessing) return;
    const text = window.prompt('輸入訊息：','');
    if (!text?.trim()) return;
    isProcessing = true;
    addTranscript('user', text.trim());
    send({ type: 'text', text: text.trim() });
    setActivityState('thinking');
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (sw) sw.addEventListener('statechange', () => {
          if (sw.state === 'activated' && navigator.serviceWorker.controller) addTranscript('system', '應用已更新');
        });
      });
    }).catch(()=>{});
  }

  initInstallPrompt();
  checkAuth();
  console.log('%c🎙 小S Voice Call — Deepgram STT', 'color:#00D26A;font-weight:bold;font-size:14px');
})();
```

---

## Step 3：更新 public/sw.js 版本號

找到 `sw.js` 裡的版本號（類似 `v9.0.0` 或 `v8.0.0`），改成：
```javascript
const CACHE_VERSION = 'v10.0.0';
```

---

## Step 4：確認 package.json 有這些依賴

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "latest",
    "chinese-conv": "latest",
    "dotenv": "latest",
    "node-fetch": "latest",
    "ws": "latest"
  },
  "type": "module"
}
```

**不需要安裝 Deepgram SDK**，直接用原生 WebSocket 連接。

---

## Step 5：本地 .env 加入 DEEPGRAM_API_KEY

```env
DEEPGRAM_API_KEY=f24c36ed6c37994bb56f8dd26dc21c759861df0f
```

---

## Step 6：部署

```bash
cd C:\Users\waiti\ssd\xiaos-call-pwa
git add -A
git commit -m "feat: Deepgram real-time STT - zero ding sounds, true bidirectional voice"
git push
```

Railway 會自動重新部署。

---

## 驗證清單

部署後確認 Railway LOG 出現：
```
🎙 小S 語音通話 → http://localhost:PORT
ANTHROPIC: ✅
MINIMAX: ✅
DEEPGRAM: ✅
[WS] Connected: ALLEN
[Deepgram] Connected for ALLEN
[Deepgram] Transcript: 你好小S
[Flow] Claude...
[TTS-WS] Done: XX chunks
```

---

## 關鍵技術細節

| 項目 | 說明 |
|------|------|
| 音頻格式 | PCM linear16, 16kHz, mono |
| VAD threshold | RMS 0.015（靜音不送） |
| Deepgram model | nova-2, zh-TW |
| endpointing | 400ms 靜音後觸發 speech_final |
| TTS 防回音 | isProcessing=true 時不送 PCM 給 Deepgram |
| 播完解鎖 | client 送 playback_done → server 解鎖 processingLock |
| 叮聲 | 完全為零（不用 Web Speech API） |
