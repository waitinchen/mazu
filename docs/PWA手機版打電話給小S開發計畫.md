# PWA 手機版「打電話給小 S」開發計畫

**產品目標**：使用者用 **帳號密碼登入** 後，在手機上以 **PWA** 開啟 App，點選即可 **打電話給小 S**（即時語音對話）。

---

## 一、是否需要 MiniMax SDK？

**不需要** 額外安裝「MiniMax SDK」套件。

- **語音（打電話）**：用 MiniMax 的 **HTTP / WebSocket API** 即可（你現有的 realtime-voice-app 就是這樣做）。  
  - 後端 Gateway 呼叫 MiniMax Chat + `speech_output`（或 Realtime WebSocket），前端只連你們的 **一條 WebSocket**，收發語音。
- **若後端改用 Letta 當大腦**：用 **Letta SDK**（`letta-client`）呼叫 Letta API；語音仍由 MiniMax API 產生。

**結論**：前端 PWA 不直接碰 MiniMax，只連你們的後端；後端用 **MiniMax API**（及可選 Letta API），無需安裝 MiniMax 官方「SDK」套件。

---

## 二、產品流程（使用者視角）

1. 打開 PWA（瀏覽器或「加到主畫面」）。
2. 未登入 → 顯示 **登入頁**（帳號、密碼）→ 登入成功進入首頁。
3. 首頁有 **「打電話給小 S」** 按鈕（或類似入口）。
4. 點擊後進入 **通話頁**：麥克風權限 → 建立語音連線 → 用戶說話、小 S 語音回覆（即時雙向）。
5. 掛斷後可回首頁或查看通話紀錄（可選）。

---

## 三、系統架構概覽

```
┌─────────────────────────────────────────────────────────────────┐
│  PWA（手機瀏覽器 / 主畫面圖示）                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ 登入頁      │  │ 首頁        │  │ 通話頁（打電話給小 S）   │  │
│  │ 帳號/密碼   │→ │ 按鈕入口    │→ │ WebSocket + 麥克風/喇叭  │  │
│  └─────────────┘  └─────────────┘  └────────────┬──────────────┘  │
└──────────────────────────────────────────────────┼────────────────┘
                                                   │ HTTPS + WSS
┌──────────────────────────────────────────────────▼────────────────┐
│  後端 API（需新建或擴展現有）                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐│
│  │ 登入/註冊    │  │ 通話 Gateway │  │ 小 S 邏輯                 ││
│  │ JWT/Session  │  │ WebSocket    │  │ Letta API + MiniMax TTS   ││
│  └──────────────┘  └──────────────┘  └──────────────────────────┘│
└───────────────────────────────────────────────────────────────────┘
```

- **PWA**：靜態資源 + manifest + Service Worker（可離線殼、快取）。
- **登入**：帳號密碼 → 後端驗證 → 發 JWT（或 session），前端存起來，之後請求帶上。
- **打電話**：通話頁建立 **WebSocket**（帶 JWT）連到後端 Gateway；Gateway 驗證使用者後，接上 Letta（小 S persona + 記憶）+ MiniMax 語音，與現有 realtime-voice-app 邏輯一致。

---

## 四、技術棧建議

| 層級 | 選型 | 說明 |
|------|------|------|
| **PWA 前端** | HTML5 + JS（或 React/Vue） | 單頁應用，響應式、觸控友善；可沿用 realtime-voice-app 的語音邏輯。 |
| **PWA 必備** | manifest.json + Service Worker | 可安裝到主畫面、圖示、主題色；SW 做快取與離線殼。 |
| **登入** | 帳號密碼 + JWT | 後端提供 `/auth/login`（或註冊），回傳 JWT；前端存 localStorage 或 memory，請求頭帶 `Authorization: Bearer <token>`。 |
| **通話** | WebSocket (WSS) | 通話頁連 `wss://your-api/voice`（或 `/call`），握手時帶 JWT；後端驗證後建立與 Letta + MiniMax 的管道。 |
| **語音** | Web Audio API + 現有協議 | 麥克風採集、播放與 realtime-voice-app 相同；後端維持「單一 WebSocket、語音進/出」設計。 |
| **後端** | 現有 Gateway 擴充 或 新服務 | 新增登入/註冊 API、使用者表；WebSocket 路由驗證 JWT，再轉發語音到 Letta + MiniMax。 |

---

## 五、開發階段與任務

### Phase 1：帳號系統 + PWA 殼（約 2–3 週）

| 序 | 任務 | 產出 |
|----|------|------|
| 1.1 | 後端：使用者表（帳號、密碼雜湊、建立時間等） | DB schema + migration |
| 1.2 | 後端：註冊 API `POST /auth/register`、登入 API `POST /auth/login`（回傳 JWT） | 可測試的 API |
| 1.3 | 後端：JWT 驗證 middleware；受保護路由範例 | 認證層 |
| 1.4 | 前端：登入頁（帳號、密碼、送出）、註冊頁（可選） | 靜態頁 + 呼叫 API |
| 1.5 | 前端：登入成功後存 JWT、跳轉首頁；登出清除 | 簡單 SPA 流程 |
| 1.6 | 前端：PWA manifest（name、short_name、icons、theme_color、start_url） | manifest.json |
| 1.7 | 前端：Service Worker（快取靜態資源、離線回傳殼頁） | sw.js、可安裝到主畫面 |
| 1.8 | 前端：首頁（僅登入後可見）、「打電話給小 S」按鈕（先不接真實通話） | 首頁 UI |

**里程碑**：可安裝 PWA、帳密登入、看到首頁與入口按鈕。

---

### Phase 2：打電話給小 S（約 2–3 週）

| 序 | 任務 | 產出 |
|----|------|------|
| 2.1 | 後端：WebSocket 端點 `wss://.../voice`（或 `/call`）；握手時讀取 query/header 的 JWT，驗證後才建立連線 | 受保護的 WS 路由 |
| 2.2 | 後端：整合現有語音 Gateway（Letta + MiniMax），依 user_id 建立/取得 Letta agent（小 S persona + human 記憶） | 通話邏輯與現有架構一致 |
| 2.3 | 前端：通話頁（全螢幕或大按鈕），建立 WebSocket 時帶 JWT（query 或 subprotocol） | 連線 + 錯誤處理（未登入、網路錯誤） |
| 2.4 | 前端：麥克風權限請求、採集、送語音（與 realtime-voice-app 相同協議） | 語音上傳 |
| 2.5 | 前端：接收並播放小 S 語音（與 realtime-voice-app 相同） | 語音播放 |
| 2.6 | 前端：通話中 UI（掛斷按鈕、狀態提示）、掛斷後關閉 WS 並返回首頁 | 完整通話流程 |
| 2.7 | 後端：通話紀錄（可選）— 記錄 user_id、開始/結束時間、時長 | 可查詢的紀錄 |

**里程碑**：登入後可點「打電話給小 S」、實際語音對話、掛斷返回。

---

### Phase 3：手機體驗與上線準備（約 1–2 週）

| 序 | 任務 | 產出 |
|----|------|------|
| 3.1 | 前端：響應式 + 觸控優化（按鈕大小、防止雙擊縮放、安全區域） | 手機版 UI |
| 3.2 | 前端：通話中保持螢幕常亮（Wake Lock API）、避免休眠斷線 | 通話穩定性 |
| 3.3 | 前端：網路斷線 / WebSocket 斷開提示與重連（可選） | 體驗優化 |
| 3.4 | 後端：HTTPS + WSS、CORS、rate limit（登入與 WS） | 安全與部署 |
| 3.5 | 上線：主機/域名、PWA 以 HTTPS 提供、必要時 App Store 說明（PWA 無需上架） | 可對外使用 |

**里程碑**：手機上安裝 PWA、登入、打電話給小 S 流程穩定可用。

---

## 六、目錄結構建議（PWA 專案）

```
xiaos-call-pwa/
├── public/
│   ├── manifest.json          # PWA manifest
│   ├── icons/                 # 192x192, 512x512 等
│   ├── sw.js                  # Service Worker
│   └── index.html             # 入口（可 SPA 或多頁）
├── src/
│   ├── auth/                  # 登入、註冊、JWT 儲存
│   ├── home/                  # 首頁
│   ├── call/                  # 通話頁（WebSocket + 語音）
│   └── app.js / main.ts       # 路由、權限檢查
├── backend/                   # 或沿用/擴充現有 repo
│   ├── auth/                  # 註冊、登入、JWT
│   ├── voice/                 # WebSocket Gateway + Letta + MiniMax
│   └── users/                 # 使用者表與查詢
└── README.md
```

---

## 七、風險與注意事項

| 項目 | 說明 |
|------|------|
| **麥克風權限** | iOS Safari 對 getUserMedia 有限制，需 HTTPS 與使用者手動授權；PWA 安裝後行為與 Safari 一致，需實機測試。 |
| **背景/休眠** | 通話中若 App 進背景，部分裝置可能斷 WebSocket；Wake Lock 可減輕，必要時提示「請保持畫面開啟」。 |
| **MiniMax / Letta 配額** | 語音與 LLM 呼叫有成本與限流，需監控與設定用量或額度。 |
| **個資與合規** | 帳號密碼、通話紀錄若涉及個資，需隱私政策與合規（如 GDPR、個資法）。 |

---

## 八、時程與人力（粗估）

| 階段 | 時間 | 說明 |
|------|------|------|
| Phase 1 | 2–3 週 | 1 人全端可完成；若前後端分工可並行縮短。 |
| Phase 2 | 2–3 週 | 依現有 Gateway 與 Letta 整合程度，可增減約 1 週。 |
| Phase 3 | 1–2 週 | 以優化與上線為主。 |
| **合計** | **約 5–8 週** | 視是否含註冊、通話紀錄、重連等細節。 |

---

## 九、一句話總結

- **MiniMax**：不需額外「MiniMax SDK」，後端用 **MiniMax API**（語音）即可；前端 PWA 只連你們的 WebSocket。
- **流程**：PWA → 帳密登入（JWT）→ 首頁「打電話給小 S」→ 通話頁 WebSocket + 語音（後端接 Letta + MiniMax）→ 掛斷。
- **開發計畫**：Phase 1 帳號 + PWA 殼 → Phase 2 打電話流程與語音 → Phase 3 手機體驗與上線；依此可拆成具體 ticket 或 sprint。

若你提供現有後端語言（Node / Python 等）與是否已有多人/註冊，可再細化成「API 清單」或「前後端對接規格」一頁。
