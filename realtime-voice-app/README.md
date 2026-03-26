# 即時語音對話 App（單一 WebSocket）

**單一 WebSocket** 實現 **語音進 + 語音出** 的對話 Web 應用。前端只連一條 WS，後端可直連 MiniMax Realtime API（方案 A）或經自建 Gateway（方案 B）。

---

## 目錄

- `frontend/` — Web 前端（HTML + JS + CSS）
- `backend/` — Gateway 範例（Node.js），用 MiniMax Chat + speech_output 回傳語音
- [ARCHITECTURE.md](./ARCHITECTURE.md) — 架構與方案 A/B 說明

---

## 快速開始（方案 B：自建 Gateway）

### 1. 後端

```bash
cd backend
cp .env.example .env
# 編輯 .env，填入 MINIMAX_API_KEY（必填）
npm install
npm start
```

服務會跑在 `ws://localhost:8765`。

### 2. 前端

用本機靜態伺服器打開前端（或直接開 `frontend/index.html`，部分瀏覽器需 HTTPS 才能用麥克風）：

```bash
cd frontend
npx serve .
# 或: python -m http.server 8080
```

瀏覽器打開 `http://localhost:8080`（依你用的 port）：

1. WebSocket 位址保持 `ws://localhost:8765`，點 **連線**。
2. 點 **用文字發送**，輸入「你好」等文字，即可收到 **語音 + 文字** 回覆（同一條 WebSocket）。

麥克風按鈕會上傳語音片段；目前 Gateway **尚未接 ASR**，需自行接 MiniMax/第三方 ASR 後把文字送 `streamMiniMaxReply`。

### 3. 環境變數（backend/.env）

| 變數 | 說明 |
|------|------|
| `PORT` | Gateway 埠號，預設 8765 |
| `MINIMAX_API_KEY` | MiniMax API Key（必填） |
| `MINIMAX_GROUP_ID` | 若官方要求則填 |
| `MINIMAX_CHAT_URL` | 可選，覆寫 Chat 端點 |

---

## 方案 A：直連 MiniMax Realtime WebSocket

若你取得 MiniMax **Realtime API** 的 WebSocket 端點與協議：

1. 在 MiniMax 文檔確認 URL（例如 `wss://api.minimax.io/ws/v1/realtime`）與鑑權方式。
2. 前端將 **WebSocket 位址** 改為該 URL，並依文檔在連線時帶上 API Key（例如 query 或 subprotocol）。
3. 依文檔格式收發語音/文字訊息，可 **不必運行** 本 repo 的 `backend/`。

---

## 前端訊息協議（與 Gateway 約定）

- **上行**
  - `{ "type": "text", "text": "用戶輸入文字" }` — 觸發 AI 語音回覆（不需 ASR）
  - `{ "type": "audio", "data": "<base64>" }` — 用戶語音片段（Gateway 可接 ASR 後轉成 text 再呼叫 MiniMax）
- **下行**
  - `{ "type": "audio", "data": "<base64>" }` — AI 語音片段（MP3 等，前端解碼播放）
  - `{ "type": "transcript", "text": "..." }` — 即時轉寫/旁白
  - `{ "type": "error", "message": "..." }` — 錯誤

---

## 授權與依賴

- 前端：無額外依賴，原生 Web API。
- 後端：`ws`、`node-fetch`，見 `backend/package.json`。
- MiniMax API 使用須遵守 MiniMax 開放平台條款與計費。
