# Letta 與小 S 人格 + 記憶系統 — 適配評估

**參考**：[Letta (letta-ai/letta)](https://github.com/letta-ai/letta) — 具狀態的 Agent 平台，內建進階記憶與自我改進能力。

---

## 一、小 S 人格 + 記憶 需要什麼

| 維度 | 需求摘要 |
|------|----------|
| **人格** | 破防開場、玩笑式攻擊、情緒放大、自嘲、真誠收尾；語氣短、直接、口語、有節奏 |
| **記憶** | 記住用戶是誰、偏好、說過的事、關係脈絡；區分 session / 長期 / 重要性 |
| **穩定度** | 不崩人設、不越界（幽默≠羞辱）、可評測、可治理 |
| **整合** | 能接語音進/出（如 MiniMax）、主持策略、語料/範例 |

---

## 二、Letta 提供什麼

- **Stateful Agent**：有狀態的對話，跨輪次記得上下文與記憶。
- **Memory blocks**：用文字定義「誰是誰」與「人設」：
  - `human`：用戶資訊（姓名、身份、偏好等）。
  - `persona`：Agent 自己的人設（小 S 的風格、原則）。
- **Tools**：可掛 `web_search`、`fetch_webpage` 等，擴充能力。
- **API + SDK**：Python / TypeScript，方便把 Agent 接到你的 App 或語音 Gateway。
- **Model-agnostic**：可接 OpenAI / Anthropic 等，你仍可選適合中文、口語的模型。

---

## 三、適配性結論：**合適，但角色要劃分清楚**

### ✅ Letta 很適合做的事

1. **小 S 人格的「大腦」**
   - 把「小 S 語氣人格模型」寫進 **persona** memory block（破防、玩笑攻擊、情緒放大、自嘲、真誠收尾、禁止羞辱等）。
   - 把來賓/用戶資訊寫進 **human** memory block，Agent 會記住並在對話中引用。

2. **記憶系統**
   - Letta 主打「advanced memory that can learn and self-improve」；多輪對話、摘要、recall 都內建，可直接當成小 S 的「記得這個人、這段關係」的基底。

3. **與現有語音/前端對接**
   - 你的 realtime-voice-app 是「單一 WebSocket、語音進/出」；後端 Gateway 目前用 MiniMax Chat + speech_output。
   - **可改為**：Gateway 收到文字（或 ASR 結果）→ 呼叫 **Letta API** 取得小 S 風格回覆 → 再送 MiniMax TTS 或沿用 Chat+speech_output。  
   - 即：**Letta = 有記憶的小 S 文本 Agent**，**MiniMax = 語音層**。

4. **快速驗證**
   - 用 Letta 的 `agents.create` + `memory_blocks` 就能先跑通「小 S 人設 + 記住用戶」，不必先做完 Persona Factory 的語料工廠與評測，再迭代。

### ⚠️ Letta 不取代、需你補上的部分

| 項目 | 說明 |
|------|------|
| **語料庫 / 語感** | Persona Factory 的 Corpus Factory（母句、風格轉譯、語料包）Letta 沒有；可把精華寫進 persona 的長文本，或在你自己的 Runtime 做 RAG/範例注入。 |
| **主持策略引擎** | 破冰→追問→收尾等「策略選擇」Letta 不內建；可在 persona 裡寫清楚策略規則，或在前端/Gateway 依情境選不同 system 提示。 |
| **行為治理 / 安全** | 禁止羞辱、越界熔斷等，Letta 無現成模組；需在 persona 描述 + 必要時在 Gateway 做事後過濾或調用安全 API。 |
| **人格穩定度評測** | 評測、A/B、指標回寫是 Persona Factory 的 Evaluation；若要做嚴謹評測，需自建或沿用你們的評測架構。 |

---

## 四、建議用法（小 S + 記憶）

- **用 Letta 做**：  
  - 小 S **人設**（persona memory block）。  
  - **用戶/來賓記憶**（human memory block + 對話歷程）。  
  - 多輪對話、召回、摘要（交給 Letta 內建機制）。  
  - 對外提供 **文本回覆 API**，供 Gateway 呼叫。

- **保留 / 自建**：  
  - 語音層：MiniMax（或你們現有 Realtime / TTS）。  
  - 若要做「語料包 + 風格轉譯」：仍用 Persona Factory 的語料設計，產出文字後可注入 Letta 的 persona 或作為 few-shot。  
  - 治理與評測：在 Gateway 或 Persona Factory 層做。

### 簡化架構示意

```
用戶語音 → ASR → 文字
                    ↓
            [你的 Gateway]
                    ↓
            Letta API（小 S persona + human 記憶）
                    ↓
            文本回覆 → MiniMax TTS → 語音回傳用戶
```

---

## 五、一句話總結

**Letta 很適合當「小 S 人格 + 記憶」的 Agent 引擎**：用人設與用戶記憶把「誰在說話、記得誰」做穩，並用 API 接在你現有的語音與產品上。語料精細度、主持策略、治理與評測仍建議保留在 Persona Factory / 自建流程中，由 Letta 專心負責「有記憶的小 S 大腦」。

參考：[Letta GitHub](https://github.com/letta-ai/letta) · [Letta 文檔](https://docs.letta.com/)
