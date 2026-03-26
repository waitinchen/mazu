---

# **Persona Factory**

## **後端專案目錄結構與微服務拆分建議**

### **Backend Project Structure & Microservices Recommendation v1.0**

---

# **一、文件目標**

本文件要解決四件事：

1. **後端專案如何組織**  
2. **哪些功能該獨立成微服務**  
3. **MVP 階段哪些可以先合併**  
4. **未來如何從模組化單體平滑演進到微服務**

---

# **二、總體建議**

對 Persona Factory 這種系統，我不建議一開始就拆得太碎。  
因為一開始最容易死在：

* 服務過多  
* 維運複雜  
* 開發速度太慢  
* 邊界還沒穩就先拆爛

所以建議走 **兩階段策略**：

## **第一階段：模組化單體（Modular Monolith）**

先用一個主 repo、單一後端專案，把邏輯切模組。

優點：

* 開發快  
* 好 debug  
* schema 變動容易  
* PM/工程師溝通成本低

## **第二階段：按負載與責任拆成微服務**

等這幾件事穩了再拆：

* Runtime 壓力變大  
* Corpus 任務明顯偏非同步  
* Evaluation 任務量大  
* Governance 需要獨立管控

---

# **三、推薦技術基底**

以 Python 為主的話，我建議：

* **FastAPI**：API 層  
* **SQLAlchemy / SQLModel**：ORM  
* **PostgreSQL \+ pgvector**：主資料與向量  
* **Redis**：快取 / session / queue meta  
* **Celery / Dramatiq / Temporal**：背景任務  
* **Pydantic**：Schema 驗證  
* **Alembic**：DB migration  
* **Docker**：容器化  
* **Kubernetes**：未來擴展  
* **OpenTelemetry**：觀測  
* **pytest**：測試

---

# **四、第一階段建議架構**

## **Modular Monolith 版本**

整體可以這樣分：

persona-factory-backend/  
├── app/  
│   ├── api/  
│   ├── core/  
│   ├── db/  
│   ├── modules/  
│   ├── services/  
│   ├── workers/  
│   ├── integrations/  
│   ├── schemas/  
│   ├── utils/  
│   └── main.py  
├── migrations/  
├── tests/  
├── scripts/  
├── docs/  
├── deployment/  
└── pyproject.toml

這是最穩的起手式。

---

# **五、專案目錄詳細拆法**

---

## **5.1 根目錄結構**

persona-factory-backend/  
├── app/  
├── migrations/  
├── tests/  
├── scripts/  
├── docs/  
├── deployment/  
├── .env.example  
├── Dockerfile  
├── docker-compose.yml  
├── Makefile  
├── pyproject.toml  
└── README.md

### **各資料夾用途**

#### **`app/`**

主應用程式。

#### **`migrations/`**

Alembic migration 檔。

#### **`tests/`**

單元測試、整合測試、API 測試。

#### **`scripts/`**

初始化腳本、資料匯入、維運工具。

#### **`docs/`**

Swagger 補充文件、架構文件、ERD、流程圖。

#### **`deployment/`**

K8s / Helm / Docker / CI 設定。

---

## **5.2 app 目錄建議**

app/  
├── api/  
├── core/  
├── db/  
├── modules/  
├── services/  
├── workers/  
├── integrations/  
├── schemas/  
├── utils/  
└── main.py

---

## **5.3 api**

API 路由層

app/api/  
├── deps.py  
├── router.py  
└── v1/  
    ├── personas.py  
    ├── corpus.py  
    ├── agents.py  
    ├── runtime.py  
    ├── memory.py  
    ├── evaluations.py  
    ├── incidents.py  
    └── health.py

### **責任**

* HTTP route  
* request/response mapping  
* auth dependency  
* input validation  
* call application service

### **不該做的事**

* 不直接寫 SQL  
* 不直接拼 prompt  
* 不直接寫商業邏輯

---

## **5.4 core**

系統核心設定

app/core/  
├── config.py  
├── logging.py  
├── security.py  
├── constants.py  
├── enums.py  
├── exceptions.py  
└── telemetry.py

### **責任**

* 環境設定  
* logging  
* exception class  
* 共用 enum  
* tracing / metrics

---

## **5.5 db**

資料庫層

app/db/  
├── base.py  
├── session.py  
├── models/  
│   ├── persona.py  
│   ├── corpus.py  
│   ├── agent.py  
│   ├── runtime.py  
│   ├── memory.py  
│   ├── evaluation.py  
│   └── incident.py  
├── repositories/  
│   ├── persona\_repository.py  
│   ├── corpus\_repository.py  
│   ├── agent\_repository.py  
│   ├── session\_repository.py  
│   ├── memory\_repository.py  
│   ├── evaluation\_repository.py  
│   └── incident\_repository.py  
└── unit\_of\_work.py

### **建議原則**

* `models/` 放 ORM model  
* `repositories/` 放資料存取  
* 商業邏輯不要塞進 repository

---

## **5.6 modules**

領域模組層  
這層最重要。

app/modules/  
├── personas/  
│   ├── domain.py  
│   ├── service.py  
│   ├── prompts.py  
│   └── validators.py  
├── corpus/  
│   ├── domain.py  
│   ├── service.py  
│   ├── generator.py  
│   ├── reviewer.py  
│   └── pack\_builder.py  
├── agents/  
│   ├── domain.py  
│   ├── service.py  
│   ├── builder.py  
│   ├── deployer.py  
│   └── config\_manager.py  
├── runtime/  
│   ├── domain.py  
│   ├── service.py  
│   ├── strategy\_engine.py  
│   ├── prompt\_assembler.py  
│   ├── response\_postprocessor.py  
│   └── session\_manager.py  
├── memory/  
│   ├── domain.py  
│   ├── service.py  
│   ├── retriever.py  
│   ├── summarizer.py  
│   └── writer.py  
├── evaluation/  
│   ├── domain.py  
│   ├── service.py  
│   ├── scorers.py  
│   ├── suites.py  
│   └── report\_builder.py  
└── governance/  
    ├── domain.py  
    ├── service.py  
    ├── policy\_engine.py  
    ├── safety\_checker.py  
    ├── boundary\_checker.py  
    └── fallback\_handler.py

### **這層的價值**

這裡才是 Persona Factory 真正的靈魂。

不是 API，不是 DB。  
而是：

* 人格生成邏輯  
* 語料工廠邏輯  
* Agent 組裝邏輯  
* 對話策略邏輯  
* 安全治理邏輯

---

## **5.7 services**

跨模組應用服務層

app/services/  
├── llm\_gateway.py  
├── embedding\_service.py  
├── vector\_search\_service.py  
├── prompt\_render\_service.py  
├── moderation\_service.py  
├── cache\_service.py  
├── event\_bus.py  
└── audit\_service.py

### **用途**

處理跨模組共用能力。

例如：

#### **`llm_gateway.py`**

統一接 OpenAI / Anthropic / Gemini / 本地模型。

#### **`embedding_service.py`**

生成 embedding。

#### **`vector_search_service.py`**

統一做 pgvector / external vector db 檢索。

#### **`moderation_service.py`**

統一內容安全判定。

---

## **5.8 workers**

背景任務

app/workers/  
├── celery\_app.py  
├── corpus\_tasks.py  
├── evaluation\_tasks.py  
├── deployment\_tasks.py  
├── memory\_tasks.py  
└── maintenance\_tasks.py

### **適合放背景任務的事**

* 批量語料生成  
* embedding 建立  
* 評測跑批  
* 報表彙整  
* 清理舊 session  
* 部署流程

---

## **5.9 integrations**

外部系統整合

app/integrations/  
├── openai\_client.py  
├── anthropic\_client.py  
├── gemini\_client.py  
├── redis\_client.py  
├── s3\_client.py  
├── telemetry\_client.py  
└── webhook\_client.py

### **原則**

外部依賴要集中，不要散在各模組。

---

## **5.10 schemas**

Pydantic schema

app/schemas/  
├── common.py  
├── persona.py  
├── corpus.py  
├── agent.py  
├── runtime.py  
├── memory.py  
├── evaluation.py  
└── incident.py

### **分工**

* Request schema  
* Response schema  
* Internal DTO 也可在這或 modules 下獨立管理

---

## **5.11 utils**

工具層

app/utils/  
├── time.py  
├── id\_generator.py  
├── json\_helper.py  
├── retry.py  
└── text.py

只放真正通用的小工具。  
不要把核心邏輯偷塞進 utils。

---

# **六、main.py 與 router 結構**

## **`app/main.py`**

負責：

* create app  
* middleware  
* exception handler  
* router mount  
* startup/shutdown hooks

例如啟動流程：

1. load config  
2. init logging  
3. init db  
4. init cache  
5. register routes  
6. register telemetry

---

# **七、模組內部分層建議**

以 `personas` 模組為例：

app/modules/personas/  
├── domain.py  
├── service.py  
├── prompts.py  
└── validators.py

## **`domain.py`**

放領域模型與規則，例如：

* Persona aggregate  
* trait normalization  
* spec validation rule

## **`service.py`**

放應用邏輯，例如：

* create persona  
* update traits  
* generate spec

## **`prompts.py`**

放人格 spec 生成要用的 prompt 模板。

## **`validators.py`**

放人格資料合法性檢查。

---

# **八、推薦的責任分層**

我建議採這個分法：

API Layer  
→ Application Service Layer  
→ Domain Logic Layer  
→ Repository Layer  
→ Database

### **API Layer**

處理 HTTP。

### **Application Service Layer**

組合 use case。

### **Domain Logic Layer**

處理人格規則與核心商業邏輯。

### **Repository Layer**

處理資料存取。

### **Database**

純存資料。

這樣人格工廠的邏輯才不會被控制器污染。

---

# **九、微服務拆分建議**

## **第二階段拆分路徑**

等 MVP 跑起來後，建議拆成 **6 個核心服務 \+ 1 個 gateway**。

---

## **9.1 gateway-service**

### **職責**

* API Gateway  
* auth / rate limit  
* request routing  
* 統一 response format

### **為什麼獨立**

因為之後前台、後台、外部 SaaS 都會從這裡進。

---

## **9.2 persona-service**

### **職責**

* 人格原型管理  
* persona traits  
* persona spec generation  
* prompt profile 管理

### **管的資料**

* personas  
* persona\_traits  
* persona\_specs  
* prompt\_templates

### **邊界很清楚**

它只負責回答：  
**這個人格是誰。**

---

## **9.3 corpus-service**

### **職責**

* 語料生成  
* 語料審核  
* tag 管理  
* pack 組裝  
* embedding 建立  
* 語料檢索

### **管的資料**

* corpus\_items  
* corpus\_tags  
* corpus\_packs  
* corpus\_pack\_items  
* corpus\_embeddings

### **為什麼容易獨立**

因為它高度非同步、批量、運算重。

---

## **9.4 agent-service**

### **職責**

* Agent 建立  
* Agent config  
* pack 掛載  
* deployment config  
* 版本管理

### **管的資料**

* agents  
* agent\_configs  
* agent\_corpus\_packs  
* deployments

### **它回答的問題是**

**這個人格怎麼變成一個可運行的 Agent。**

---

## **9.5 runtime-service**

### **職責**

* session 管理  
* prompt assembly  
* strategy selection  
* LLM call  
* response post-process  
* message log

### **管的資料**

* sessions  
* messages

### **為什麼應該獨立**

它通常流量最高、延遲最敏感。  
未來最有機會單獨擴容。

---

## **9.6 memory-service**

### **職責**

* 記憶寫入  
* 摘要化  
* 偏好提取  
* 記憶檢索  
* embedding / recall

### **管的資料**

* memory\_items  
* memory\_embeddings

### **為什麼獨立**

記憶邏輯和對話執行強關聯，但生命週期不同。  
拆開後更容易優化。

---

## **9.7 governance-service**

### **職責**

* moderation  
* policy engine  
* boundary check  
* fallback mode  
* incident tracking

### **管的資料**

* incidents  
* policy configs  
* safety logs

### **為什麼重要**

這層不能只是 library。  
當規則複雜後，最好獨立。

---

## **9.8 evaluation-service**

### **職責**

* 批量測試  
* Persona stability suite  
* A/B 測試  
* 報表生成  
* 評測指標寫回

### **管的資料**

* evaluations  
* evaluation\_metrics

### **為什麼獨立**

這是典型離線運算服務。

---

# **十、建議拆分時機**

不要太早拆。  
建議等滿足以下條件再拆：

## **從 modular monolith 拆成微服務的信號**

### **1\. Runtime QPS 明顯拉高**

例如線上互動量大，單體 API 已成瓶頸。

### **2\. Corpus 背景任務拖慢主服務**

大批量語料生成影響在線 API。

### **3\. Evaluation 跑批時間太長**

測試任務與主流程互搶資源。

### **4\. 治理策略變複雜**

不同產品線需要不同安全策略。

### **5\. 團隊人數擴大**

超過 6–8 位後端 / AI 工程師時，模組所有權要更清楚。

---

# **十一、建議的 repo 策略**

這裡有兩種。

---

## **11.1 單 repo（Monorepo）**

我比較推薦初期用這個。

persona-factory/  
├── backend/  
├── worker/  
├── shared/  
├── docs/  
├── deployment/  
└── tools/

### **優點**

* 共享 schema 容易  
* CI/CD 好管理  
* refactor 成本低  
* 對新團隊友善

### **適合**

MVP 到早期成長期。

---

## **11.2 多 repo（Polyrepo）**

等你真的拆成獨立微服務再考慮。

例如：

* persona-service  
* corpus-service  
* runtime-service  
* governance-service

### **缺點**

* 版本協調痛苦  
* shared lib 管理麻煩  
* CI/CD 複雜度升高

所以我的建議很明確：

**前期 monorepo，後期再視流量與組織結構拆。**

---

# **十二、Monorepo 進一步建議結構**

如果你已經預期會拆，可以在 monorepo 內先長這樣：

persona-factory/  
├── services/  
│   ├── api-server/  
│   ├── worker/  
│   ├── runtime-engine/  
│   └── evaluation-runner/  
├── packages/  
│   ├── domain/  
│   ├── schemas/  
│   ├── db/  
│   ├── llm/  
│   ├── governance/  
│   └── observability/  
├── deployment/  
├── docs/  
└── scripts/

這是一種 **可拆式 monorepo**。  
現在一起開發，以後好分家。

---

# **十三、packages 層該放什麼**

---

## **`packages/domain/`**

放共用領域定義：

* persona enums  
* scenario enums  
* metric names  
* policy types

## **`packages/schemas/`**

放跨服務共用 schema：

* DTO  
* event payload  
* API contract base schema

## **`packages/db/`**

放共用：

* base model  
* migration helper  
* db session helper

## **`packages/llm/`**

放：

* LLM gateway  
* prompt renderer  
* model response parser

## **`packages/governance/`**

放：

* safety rule matcher  
* policy helpers  
* fallback templates

## **`packages/observability/`**

放：

* logger  
* metrics helper  
* tracing wrapper

---

# **十四、微服務之間的通訊建議**

初期不要太花。  
建議：

## **同步通訊**

* REST 為主

## **非同步通訊**

* 事件佇列  
* Redis Stream / RabbitMQ / Kafka 擇一

---

## **適合事件化的任務**

* `persona.spec.generated`  
* `corpus.pack.built`  
* `agent.deployed`  
* `evaluation.completed`  
* `incident.created`

這樣之後要拆服務時，不會全靠同步 call 卡死。

---

# **十五、Runtime 服務內部再細拆建議**

Runtime 是最容易變胖的。

建議它內部先切成這些組件：

runtime/  
├── session\_manager.py  
├── strategy\_engine.py  
├── prompt\_assembler.py  
├── corpus\_retriever.py  
├── memory\_retriever.py  
├── llm\_executor.py  
├── safety\_filter.py  
└── response\_postprocessor.py

### **流程**

1. 讀 session  
2. 選 strategy  
3. 抓 corpus  
4. 抓 memory  
5. assemble prompt  
6. call LLM  
7. safety check  
8. post-process  
9. write log

這條線清楚，你的 runtime 才穩。

---

# **十六、治理服務內部建議**

governance/  
├── policy\_engine.py  
├── input\_moderator.py  
├── output\_moderator.py  
├── persona\_boundary\_checker.py  
├── fallback\_handler.py  
└── incident\_logger.py

### **核心原則**

治理不要只在 API 前面擋一下就算了。  
要前後都做：

* **輸入前檢查**  
* **生成後檢查**  
* **人格邊界檢查**  
* **事件落庫**

---

# **十七、測試目錄建議**

tests/  
├── unit/  
│   ├── test\_persona\_service.py  
│   ├── test\_corpus\_generator.py  
│   ├── test\_agent\_builder.py  
│   ├── test\_runtime\_strategy.py  
│   └── test\_governance.py  
├── integration/  
│   ├── test\_persona\_api.py  
│   ├── test\_runtime\_api.py  
│   ├── test\_memory\_flow.py  
│   └── test\_evaluation\_flow.py  
├── e2e/  
│   ├── test\_create\_persona\_to\_agent.py  
│   └── test\_runtime\_chat\_flow.py  
└── fixtures/

### **至少要保證三種測試**

* 單元測試：人格規則、策略選擇  
* 整合測試：API \+ DB \+ queue  
* E2E：從建 persona 到上線聊天跑一遍

---

# **十八、環境切分建議**

至少切三套：

* `local`  
* `staging`  
* `production`

如需企業版，可再加：

* `sandbox`

### **原則**

* Runtime 與管理後台分環境  
* staging 要能跑真實測試資料  
* production 要有灰度與回滾能力

---

# **十九、CI/CD 建議**

Pipeline 建議至少包含：

1. lint  
2. type check  
3. unit test  
4. integration test  
5. build image  
6. deploy to staging  
7. smoke test  
8. manual approval  
9. deploy to production

---

# **二十、MVP 真的要怎麼切**

如果你現在只有小團隊，我會建議：

## **MVP 只做三個可執行單元**

### **1\. api-server**

包含：

* personas  
* corpus  
* agents  
* runtime  
* governance 基本版

### **2\. worker**

包含：

* corpus generate  
* evaluation batch  
* embedding jobs

### **3\. shared package**

包含：

* schemas  
* db  
* llm gateway  
* common utils

這其實就夠你跑出第一版。

不要一開始就 8 個服務。  
那會先把自己拆死。

---

# **二十一、推薦的人力對應**

如果是 MVP 階段，理想配置：

### **後端 / 架構 1 人**

主導服務切分、DB、API。

### **AI Engineer 1 人**

負責 LLM gateway、prompt pipeline、evaluation。

### **後端工程師 1–2 人**

負責 API、runtime、memory、worker。

### **QA / PM 兼職 1 人**

負責流程驗證與規格對齊。

四人左右就能開始。

---

# **二十二、一句話結論**

這套後端建議的核心精神是：

前期用模組化單體穩定打底，讓 Persona、Corpus、Agent、Runtime、Governance、Evaluation 六大能力先成形；等流量、任務型態與團隊規模成熟後，再沿著責任邊界平滑拆成微服務。

---

