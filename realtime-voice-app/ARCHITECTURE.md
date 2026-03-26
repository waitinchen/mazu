# 單一 WebSocket 雙向即時語音對話 — 架構說明

本專案目標：**對話 App / Web 應用**，使用 **一條 WebSocket** 實現 **語音進 + 語音出**（Realtime API 風格）。

---

## 一、整體架構

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 (Web / App)                          │
│  ┌─────────────┐    ┌──────────────────┐    ┌───────────────┐ │
│  │ 麥克風採集   │───▶│  單一 WebSocket   │◀───│ 揚聲器播放     │ │
│  │ (AudioWorklet)│   │  (語音上傳/下載)   │    │ (Web Audio API)│ │
│  └─────────────┘    └──────────────────┘    └───────────────┘ │
└───────────────────────────────┬─────────────────────────────────┘
                                 │
                    wss://... (一條連線)
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│                    後端 (二選一)                                  │
│                                                                   │
│  方案 A：MiniMax Realtime API（若開放）                           │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 前端 WS ──────▶ MiniMax Realtime WebSocket ──────▶ 前端 WS   │ │
│  │              (語音進 → 語音出，同一條連線)                    │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  方案 B：自建 Gateway（當前可實作）                                │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────────────┐ │
│  │ 前端 WS     │   │ Gateway      │   │ MiniMax                 │ │
│  │ 語音 in     │──▶│ ASR → 文本   │──▶│ Chat + speech_output    │ │
│  │ 語音 out ◀──│   │ 文本 → 語音 ◀│   │ (SSE 流式)              │ │
│  └─────────────┘   └──────────────┘   └─────────────────────────┘ │
│                     一條 WS 對前端                                 │
└───────────────────────────────────────────────────────────────────┘
```

- **前端**：只維護 **一條 WebSocket**，發送麥克風語音、接收並播放 AI 語音。
- **後端**：  
  - **方案 A**：直連 MiniMax Realtime WebSocket（需官方提供端點與協議）。  
  - **方案 B**：自建 Gateway，對外提供一條 WebSocket，內部用 MiniMax Chat + speech_output + 第三方 ASR 組裝。

---

## 二、方案 A：MiniMax Realtime WebSocket（首選）

- **端點**：向 MiniMax 確認 Realtime 專用 WebSocket URL（例如 `wss://api.minimax.io/ws/v1/realtime` 或依文檔）。
- **鑑權**：`Authorization: Bearer <API_KEY>`（或文檔指定方式）。
- **協議**：依官方 Realtime 文檔（中文站 [實時交互](https://platform.minimaxi.com/document/Realtime)），通常包含：
  - 客戶端發送：語音二進制或 base64、會話設定。
  - 服務端回傳：語音片段、轉寫、會話事件。
- **前端**：連到該 URL，按文檔收發訊息即可，無需自建 Gateway。

**若你已拿到 Realtime 文檔**：只需在 `frontend/.env` 或設定裡填 WebSocket URL 與 API Key，前端改為直連該 URL。

---

## 三、方案 B：自建 Gateway（當前可落地的作法）

在 Realtime WebSocket 未對外公開前，可用 **Gateway** 對前端仍暴露 **單一 WebSocket**：

1. **前端** → 透過唯一 WebSocket 發送：**語音二進制**（或 base64）。
2. **Gateway**：  
   - 收語音 → 呼叫 **ASR**（如 MiniMax 若提供、或阿里/訊飛/Whisper 等）→ 得到文本。  
   - 文本 → 呼叫 **MiniMax Chat Completions**（`stream: true`, `speech_output: true`）→ 收到 SSE 流（文本 + `audio_content`）。  
   - 將 **音頻片段** 透過同一 WebSocket 回傳給前端。
3. **前端**：收到音頻片段即播放，體感仍是「一條連線、語音進、語音出」。

本 repo 的 `backend/` 為 **方案 B** 的範例（Node 或 Python），可依需要替換 ASR 與 MiniMax 端點。

---

## 四、前端要點（Web / App 通用）

- **麥克風**：使用 **Web Audio API**（`getUserMedia` + `AudioWorklet` 或 `ScriptProcessorNode`）採集 PCM，依後端要求送 **原始 PCM** 或 **編碼後**（如 WebSocket 發 binary 或 base64）。
- **播放**：收到服務端語音片段（binary/base64）→ 解碼 → 送入 **Web Audio API** 或 **AudioBufferSourceNode** 播放；可做簡單佇列以應對流式。
- **連線狀態**：Connecting → Ready → Speaking/Listening → Error / Reconnecting，便於 UI 顯示與重連。
- **協議**：若為自建 Gateway，可約定 JSON 訊息類型，例如：
  - `{ "type": "audio", "data": "<base64>" }` 上行（用戶語音）；
  - `{ "type": "audio", "data": "<base64>" }` 下行（AI 語音）；
  - `{ "type": "transcript", "text": "..." }` 下行（轉寫/旁白）；
  - `{ "type": "error", "message": "..." }` 下行。

---

## 五、目錄結構

```
realtime-voice-app/
├── README.md                 # 本說明
├── ARCHITECTURE.md            # 本架構說明
├── frontend/                  # Web 前端（單一 WebSocket）
│   ├── index.html
│   ├── app.js                 # WebSocket + 採集 + 播放
│   └── style.css
└── backend/                   # 方案 B：Gateway 範例（可選）
    ├── package.json
    ├── server.js              # WS 服務 + MiniMax Chat + speech_output
    └── .env.example
```

---

## 六、小結

- **體驗最好**：使用 **MiniMax 單一 WebSocket Realtime API**（方案 A），前端只連一條 WS，語音進/出同一連線。  
- **立即可做**：用 **自建 Gateway**（方案 B），對前端仍呈現 **單一 WebSocket**，內部用 MiniMax Chat + speech_output + ASR 組裝。  
- 前端實作保持 **「只連一個 WebSocket、發語音、收語音」**，之後從方案 B 切到方案 A 只需更換 WebSocket URL 與訊息格式。
