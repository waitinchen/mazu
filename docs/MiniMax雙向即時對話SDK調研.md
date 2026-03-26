# MiniMax 雙向即時對話 SDK 調研

**調研日期**：2025-03  
**目標**：釐清 MiniMax 官方對「雙向、即時對話」的支援方式與可用 SDK / API。

---

## ★ 雙向即時對話「體驗最好」的作法（結論先行）

| 優先級 | 作法 | 體驗好的原因 | 備註 |
|--------|------|--------------|------|
| **1（最佳）** | **MiniMax Realtime API — 單一 WebSocket** | 一條連線同時收發語音，端到端延遲優化、首包 <200ms 級，業界即時語音多用此模式 | 官方 2024.10 已發布；需在中文站/商務處確認 Realtime WebSocket 端點與協議 |
| **2（文檔齊、可落地）** | **Chat Completions + `speech_output`（SSE 流式）** | 一次請求同時拿到「文本 + 語音」流，邊生成邊播，無需再建 T2A 連線，首字就能開始出聲 | 語音輸入需另接 ASR；SSE 為單向（伺服器→客戶端），用戶語音走另一通道 |
| **3** | Chat 流式 + T2A WebSocket 串接 | 可細調 TTS 參數，但多一跳、多一次連線，延遲與實現複雜度較高 | 適合對音色/格式有極高客製需求時 |

**一句話**：  
- 若能拿到 **Realtime API 的單一 WebSocket（語音進+語音出）** → 用這個，體驗最好。  
- 若目前只能依公開文檔實作 → **Chat Completions（stream + speech_output）** 是延遲與複雜度平衡最好的作法。

---

## 一、名詞說明：MINIMX → MiniMax

- 你問的 **MINIMX** 即 **MiniMax**（上海 MiniMax 開放平台）。
- 官方未提供名為「MINIMX SDK」的獨立套件，雙向即時對話是透過 **一組 API（HTTP + WebSocket）** 以及 **相容的 SDK（如 Anthropic / OpenAI SDK）** 組合實現。

---

## 二、MiniMax「實時交互 API」概覽（2024.10 發布）

2024 年 10 月 24 日 MiniMax 正式發布 **實時交互 API（Realtime API）**：

- **介面形態**：HTTP + WebSocket 兩種。
- **能力**：
  - **多模態輸入**：支援 **文字** 或 **語音** 輸入。
  - **多模態輸出**：支援 **文字** 或 **語音** 輸出。
  - **音色**：300+ 系統音色與復刻音色，支援 40 種語言。
  - **延遲**：端到端延遲優化，主打實時語音對話。

**文檔入口**（實時相關）：

- 國際站：<https://platform.minimax.io/docs>（未單獨列出「Realtime」一頁，實時能力分散在 T2A、Text Chat 等）
- 中文站可搜「實時交互」：<https://platform.minimaxi.com>

目前公開文檔中，**雙向即時對話** 的具體實現主要來自以下兩類方式（見下一節）。

---

## 三、雙向即時對話的兩種實現方式

### 方式一：Chat Completions + 流式語音輸出（推薦做「說→聽」一側）

**思路**：用 **文本對話 API** 做理解與生成，並在 **同一次請求** 中開啟 **語音輸出**，以 SSE 流式同時返回文字與音頻，實現「邊生成邊播放」。

- **端點**（示例）：  
  `POST https://api.minimax.io/v1/chat/completions`  
  （或平台文檔中的 `chatcompletion_v2` 等等價路徑，以文檔為準）
- **關鍵參數**：
  - `stream: true`：啟用 SSE 流式。
  - `stream_options: { "speech_output": true }`：啟用語音輸出。
  - `voice_setting`：指定 TTS 模型與音色，例如：
    - `model`: `"speech-01-turbo-240228"` 或新版 `speech-2.6-turbo` / `speech-2.8-*`
    - `voice_id`: 如 `"female-tianmei"` 等。
- **回傳格式**：SSE 中每個 chunk 可能包含：
  - `delta.content`：文本內容。
  - `delta.audio_content`：音頻數據（多為 **十六進制字串**，需解碼後送播放器）。

**特點**：

- 一條 HTTP 請求即可完成「用戶輸入 → 模型回覆 → 文本 + 語音」。
- 語音是 **邊生成邊下發**，延遲較低，適合做 **AI 說、用戶聽** 的即時對話。
- **用戶語音輸入** 需自行用 ASR（或 MiniMax 其他語音輸入能力）轉成文字後，再調此接口。

**官方示例**（智能外呼場景）：  
<https://platform.minimax.io/docs/solutions/outboundbot>  
其中示範：`chatcompletion_v2` + `speech_output: true` + `voice_setting`，並用 SSE 解析 `audio_content` 做實時播放。

---

### 方式二：T2A WebSocket（專做「文本 → 語音」流式合成）

若你已有「要說的文本」（例如來自上面的 Chat Completions 或自家邏輯），只需 **低延遲、流式語音合成**，可用 **T2A WebSocket**：

- **端點**：`wss://api.minimax.io/ws/v1/t2a_v2`
- **鑑權**：`Authorization: Bearer <API_KEY>`
- **流程概覽**：
  1. 建立 WebSocket 連線，收到 `event: "connected_success"`。
  2. 發送 `event: "task_start"`：帶上 `model`、`voice_setting`、`audio_setting`（如 sample_rate、format、bitrate）。
  3. 發送 `event: "task_continue"`：`text` 為要合成的文字，可多次發送。
  4. 持續接收回傳：`data.audio` 為 hex 編碼音頻，可即時解碼播放。
  5. 收到 `is_final: true` 表示該段合成結束；可再發 `task_continue` 或發 `event: "task_finish"` 結束任務。

**支援模型**（節錄）：  
`speech-2.8-hd` / `speech-2.8-turbo`、`speech-2.6-hd` / `speech-2.6-turbo`、`speech-02-hd` / `speech-02-turbo` 等。  
**語音格式**：如 mp3、pcm、flac 等（依 `audio_setting`）；單次請求文本長度上限一般為 10,000 字以內（以官方為準）。

**文檔**：  
- Guide：<https://platform.minimax.io/docs/guides/speech-t2a-websocket>  
- API Reference：<https://platform.minimax.io/docs/api-reference/speech-t2a-websocket>

**與「雙向即時」的關係**：  
T2A WebSocket 只負責「文本 → 語音」；若要完整 **雙向**，需搭配：  
- 語音輸入：ASR（或 MiniMax 若提供語音輸入 API）→ 文本；  
- 文本理解與回覆：Chat Completions（或 Realtime API 若開放）；  
- 語音輸出：本 T2A WebSocket 或上面的 Chat + `speech_output`。

---

## 四、SDK 與依賴

### 1. 文本模型（對話、Chat Completions）

- **推薦**：使用 **Anthropic SDK** 對接 MiniMax 文本模型（與 Realtime 公告中的「多模態」同一生態）。
  - Python：`pip install anthropic`
  - Node：`npm install @anthropic-ai/sdk`
- 文檔：<https://platform.minimax.io/docs/guides/quickstart-sdk>

### 2. 語音（T2A）與「實時對話」

- **無單獨的「MiniMax Realtime SDK」安裝包**。
- 實時語音部分需自行：
  - **HTTP**：用 `requests`（或 fetch）調 Chat Completions + `speech_output`，並解析 SSE。
  - **WebSocket**：用 `websockets`（Python）或瀏覽器 `WebSocket` / Node `ws` 接 `wss://api.minimax.io/ws/v1/t2a_v2`，按上述事件協議收發。

### 3. 官方 MCP（可選）

- MiniMax 提供 **MCP** 實現（Python / JavaScript），涵蓋語音合成、語音克隆等，可作為整合參考，但不是專用「雙向即時對話 SDK」：  
  <https://platform.minimax.io/docs/guides/mcp-guide>

---

## 五、雙向即時對話的推薦架構（結合你方 Persona / 主持場景）

- **用戶語音 → 文本**：ASR（MiniMax 若提供則用，否則第三方）→ 文本。
- **文本 → 主持回覆（文本+語音）**：  
  - **方案 A**：直接調 **Chat Completions**（或 chatcompletion_v2） + `stream: true` + `stream_options.speech_output: true` + `voice_setting`，一次拿到流式文本與流式語音，前端邊收邊播。  
  - **方案 B**：先用 Chat Completions 流式拿文本，再將文本送 **T2A WebSocket** 做語音合成並播放（延遲略高，但語音參數可單獨細調）。
- **人格/主持風格**：透過 Chat 的 `system` / `messages` 與 Persona Factory 的 persona_spec / corpus 注入即可。

---

## 六、關鍵連結整理

| 項目 | 連結 |
|------|------|
| 開發者平台 | https://platform.minimax.io |
| API 總覽 | https://platform.minimax.io/docs/api-reference/api-overview |
| 快速開始（SDK） | https://platform.minimax.io/docs/guides/quickstart-sdk |
| T2A WebSocket 指南 | https://platform.minimax.io/docs/guides/speech-t2a-websocket |
| T2A WebSocket API 參考 | https://platform.minimax.io/docs/api-reference/speech-t2a-websocket |
| 實時對話示例（智能外呼） | https://platform.minimax.io/docs/solutions/outboundbot |
| Realtime API 發布說明 | https://www.minimax.io/news/realtime-api |
| 取得 API Key | 登入後：API Keys / Create new secret key |

---

## 七、小結

- **「MINIMX SDK」** 即 **MiniMax**；雙向即時對話 **沒有** 單一專用 SDK 名稱，而是 **HTTP Chat Completions + 流式語音** 與 **T2A WebSocket** 的組合。
- **雙向即時** 的建議做法：  
  - 使用 **Chat Completions（stream + speech_output）** 實現「一次請求、邊生成邊播語音」；  
  - 語音輸入端用 ASR 轉文字再進 Chat；  
  - 若要更細控制 TTS，可再加 **T2A WebSocket** 專做語音合成。
- **SDK**：文本側用 **Anthropic SDK**；語音側用官方文檔中的 **HTTP + WebSocket 範例** 即可對接，無需額外「MiniMax Realtime SDK」安裝。

若你接下來要接的環境是 **Web 前端** 或 **Python 後端**，可說明一下，我可以按其中一種寫成最小可運行範例（含 Chat + speech_output 或 T2A WebSocket）。
