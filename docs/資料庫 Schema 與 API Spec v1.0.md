面我直接把 **Persona Factory** 落成偏工程可實作的版本。

這份文件分兩部分：

**第一部分：資料庫 Schema v1.0**  
**第二部分：API Spec v1.0**

目標不是理論漂亮，而是讓後端、AI Engineer、PM 可以拿去拆工。

---

# **Persona Factory**

## **資料庫 Schema 與 API Spec v1.0**

---

# **一、設計原則**

Persona Factory 的資料層要同時滿足五件事：

1. **人格可結構化**  
2. **語料可檢索、可標註、可打包**  
3. **Agent 可配置、可部署**  
4. **對話可追蹤、可評測**  
5. **治理可審計、可熔斷**

因此建議採用：

* **PostgreSQL**：主資料庫  
* **pgvector**：語意檢索  
* **Redis**：session / cache  
* **Object Storage**：匯出檔、長文本報表、語音資產

---

# **二、資料庫 Schema v1.0**

---

## **2.1 personas**

人格主表

### **用途**

儲存人格原型的基礎資料。

### **欄位**

CREATE TABLE personas (  
    id UUID PRIMARY KEY,  
    persona\_code VARCHAR(64) UNIQUE NOT NULL,  
    persona\_name VARCHAR(128) NOT NULL,  
    archetype VARCHAR(64) NOT NULL,  
    description TEXT,  
    status VARCHAR(32) NOT NULL DEFAULT 'draft',  
    owner\_team VARCHAR(128),  
    target\_audience VARCHAR(256),  
    primary\_use\_case VARCHAR(128),  
    created\_by VARCHAR(128) NOT NULL,  
    updated\_by VARCHAR(128),  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    updated\_at TIMESTAMP NOT NULL DEFAULT NOW()  
);

### **說明**

* `persona_code`：像 `host_xiaos_v1`  
* `archetype`：如 `host` / `coach` / `advisor` / `companion`  
* `status`：`draft` / `review` / `approved` / `archived`

---

## **2.2 persona\_traits**

人格特徵表

### **用途**

把人格量化，方便後續建模與評測。

CREATE TABLE persona\_traits (  
    id UUID PRIMARY KEY,  
    persona\_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,  
    humor\_level SMALLINT NOT NULL CHECK (humor\_level BETWEEN 1 AND 10),  
    warmth\_level SMALLINT NOT NULL CHECK (warmth\_level BETWEEN 1 AND 10),  
    directness\_level SMALLINT NOT NULL CHECK (directness\_level BETWEEN 1 AND 10),  
    emotional\_intensity SMALLINT NOT NULL CHECK (emotional\_intensity BETWEEN 1 AND 10),  
    proactiveness\_level SMALLINT NOT NULL CHECK (proactiveness\_level BETWEEN 1 AND 10),  
    intimacy\_level SMALLINT NOT NULL CHECK (intimacy\_level BETWEEN 1 AND 10),  
    stability\_target SMALLINT NOT NULL DEFAULT 8 CHECK (stability\_target BETWEEN 1 AND 10),  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    updated\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    UNIQUE(persona\_id)  
);

---

## **2.3 persona\_specs**

人格規格表

### **用途**

儲存 AI 真正使用的人格規格。

CREATE TABLE persona\_specs (  
    id UUID PRIMARY KEY,  
    persona\_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,  
    version INTEGER NOT NULL DEFAULT 1,  
    language\_style JSONB NOT NULL,  
    interaction\_pattern JSONB NOT NULL,  
    emotional\_profile JSONB NOT NULL,  
    guardrails JSONB NOT NULL,  
    prompt\_profile JSONB NOT NULL,  
    status VARCHAR(32) NOT NULL DEFAULT 'draft',  
    created\_by VARCHAR(128) NOT NULL,  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    updated\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    UNIQUE(persona\_id, version)  
);

### **JSONB 範例**

#### **language\_style**

{  
  "sentence\_length": "short",  
  "register": "spoken",  
  "rhythm": "fast",  
  "verbosity": "medium"  
}

#### **interaction\_pattern**

{  
  "steps": \["break\_ice", "tease", "probe", "amplify", "close"\],  
  "default\_strategy": "host\_playful"  
}

#### **guardrails**

{  
  "forbidden": \["humiliation", "manipulation", "harmful\_advice"\],  
  "fallback\_mode": "neutral\_safe\_mode"  
}

---

## **2.4 prompt\_templates**

Prompt 模板表

### **用途**

管理各種 prompt 組件。

CREATE TABLE prompt\_templates (  
    id UUID PRIMARY KEY,  
    template\_code VARCHAR(64) UNIQUE NOT NULL,  
    template\_type VARCHAR(64) NOT NULL,  
    name VARCHAR(128) NOT NULL,  
    content TEXT NOT NULL,  
    variables JSONB,  
    version INTEGER NOT NULL DEFAULT 1,  
    status VARCHAR(32) NOT NULL DEFAULT 'active',  
    created\_by VARCHAR(128) NOT NULL,  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    updated\_at TIMESTAMP NOT NULL DEFAULT NOW()  
);

### **`template_type` 範例**

* `base_instruction`  
* `persona_style`  
* `scenario_strategy`  
* `safety_override`

---

## **2.5 corpus\_items**

語料主表

### **用途**

儲存單筆語料。

CREATE TABLE corpus\_items (  
    id UUID PRIMARY KEY,  
    corpus\_code VARCHAR(64) UNIQUE NOT NULL,  
    text TEXT NOT NULL,  
    source\_type VARCHAR(64) NOT NULL DEFAULT 'generated',  
    scenario VARCHAR(128) NOT NULL,  
    tone VARCHAR(64) NOT NULL,  
    emotion VARCHAR(64),  
    intent VARCHAR(64),  
    persona\_type VARCHAR(64),  
    safety\_level VARCHAR(32) NOT NULL DEFAULT 'low',  
    quality\_score NUMERIC(4,2),  
    status VARCHAR(32) NOT NULL DEFAULT 'draft',  
    reviewer VARCHAR(128),  
    reviewed\_at TIMESTAMP,  
    created\_by VARCHAR(128) NOT NULL,  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    updated\_at TIMESTAMP NOT NULL DEFAULT NOW()  
);

---

## **2.6 corpus\_embeddings**

語料向量表

### **用途**

做語意檢索。

CREATE TABLE corpus\_embeddings (  
    corpus\_id UUID PRIMARY KEY REFERENCES corpus\_items(id) ON DELETE CASCADE,  
    embedding VECTOR(1536)  
);

維度依實際 embedding model 調整。

---

## **2.7 corpus\_tags**

語料標籤表

CREATE TABLE corpus\_tags (  
    id UUID PRIMARY KEY,  
    corpus\_id UUID NOT NULL REFERENCES corpus\_items(id) ON DELETE CASCADE,  
    tag\_key VARCHAR(64) NOT NULL,  
    tag\_value VARCHAR(128) NOT NULL,  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW()  
);

### **範例**

* `tag_key=tone`, `tag_value=playful`  
* `tag_key=scene`, `tag_value=interview_opening`

---

## **2.8 corpus\_packs**

語料包主表

### **用途**

把一批語料打成某人格可用的 pack。

CREATE TABLE corpus\_packs (  
    id UUID PRIMARY KEY,  
    pack\_code VARCHAR(64) UNIQUE NOT NULL,  
    pack\_name VARCHAR(128) NOT NULL,  
    persona\_id UUID REFERENCES personas(id) ON DELETE SET NULL,  
    version INTEGER NOT NULL DEFAULT 1,  
    description TEXT,  
    status VARCHAR(32) NOT NULL DEFAULT 'draft',  
    created\_by VARCHAR(128) NOT NULL,  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    updated\_at TIMESTAMP NOT NULL DEFAULT NOW()  
);

---

## **2.9 corpus\_pack\_items**

語料包明細表

CREATE TABLE corpus\_pack\_items (  
    id UUID PRIMARY KEY,  
    pack\_id UUID NOT NULL REFERENCES corpus\_packs(id) ON DELETE CASCADE,  
    corpus\_id UUID NOT NULL REFERENCES corpus\_items(id) ON DELETE CASCADE,  
    weight NUMERIC(5,2) DEFAULT 1.00,  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    UNIQUE(pack\_id, corpus\_id)  
);

---

## **2.10 agents**

Agent 主表

### **用途**

描述一個可運行人格 Agent。

CREATE TABLE agents (  
    id UUID PRIMARY KEY,  
    agent\_code VARCHAR(64) UNIQUE NOT NULL,  
    agent\_name VARCHAR(128) NOT NULL,  
    persona\_id UUID NOT NULL REFERENCES personas(id),  
    persona\_spec\_id UUID NOT NULL REFERENCES persona\_specs(id),  
    status VARCHAR(32) NOT NULL DEFAULT 'draft',  
    deployment\_status VARCHAR(32) NOT NULL DEFAULT 'not\_deployed',  
    primary\_model VARCHAR(128) NOT NULL,  
    fallback\_model VARCHAR(128),  
    memory\_policy VARCHAR(64) NOT NULL DEFAULT 'session\_only',  
    safety\_profile VARCHAR(64) NOT NULL,  
    owner\_team VARCHAR(128),  
    created\_by VARCHAR(128) NOT NULL,  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    updated\_at TIMESTAMP NOT NULL DEFAULT NOW()  
);

---

## **2.11 agent\_corpus\_packs**

Agent 掛載語料包

CREATE TABLE agent\_corpus\_packs (  
    id UUID PRIMARY KEY,  
    agent\_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,  
    pack\_id UUID NOT NULL REFERENCES corpus\_packs(id) ON DELETE CASCADE,  
    priority INTEGER NOT NULL DEFAULT 1,  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    UNIQUE(agent\_id, pack\_id)  
);

---

## **2.12 agent\_configs**

Agent 設定表

### **用途**

儲存可變動配置，避免 agents 主表過肥。

CREATE TABLE agent\_configs (  
    id UUID PRIMARY KEY,  
    agent\_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,  
    config JSONB NOT NULL,  
    version INTEGER NOT NULL DEFAULT 1,  
    is\_active BOOLEAN NOT NULL DEFAULT TRUE,  
    created\_by VARCHAR(128) NOT NULL,  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    UNIQUE(agent\_id, version)  
);

### **config 範例**

{  
  "max\_context\_turns": 12,  
  "temperature": 0.8,  
  "top\_p": 0.95,  
  "max\_output\_tokens": 500,  
  "response\_post\_process": \["style\_check", "safety\_filter"\]  
}

---

## **2.13 sessions**

對話 Session 表

CREATE TABLE sessions (  
    id UUID PRIMARY KEY,  
    session\_code VARCHAR(64) UNIQUE NOT NULL,  
    agent\_id UUID NOT NULL REFERENCES agents(id),  
    user\_ref VARCHAR(128),  
    channel VARCHAR(64) NOT NULL DEFAULT 'web',  
    state VARCHAR(32) NOT NULL DEFAULT 'active',  
    current\_strategy VARCHAR(64),  
    started\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    ended\_at TIMESTAMP,  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW()  
);

---

## **2.14 messages**

訊息表

CREATE TABLE messages (  
    id UUID PRIMARY KEY,  
    session\_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,  
    role VARCHAR(32) NOT NULL,  
    content TEXT NOT NULL,  
    input\_tokens INTEGER,  
    output\_tokens INTEGER,  
    model\_used VARCHAR(128),  
    safety\_action VARCHAR(64),  
    latency\_ms INTEGER,  
    metadata JSONB,  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW()  
);

### **`role`**

* `user`  
* `assistant`  
* `system`  
* `tool`

---

## **2.15 memory\_items**

記憶表

### **用途**

存中長期偏好與高價值記憶。

CREATE TABLE memory\_items (  
    id UUID PRIMARY KEY,  
    agent\_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,  
    user\_ref VARCHAR(128) NOT NULL,  
    memory\_type VARCHAR(64) NOT NULL,  
    content TEXT NOT NULL,  
    summary TEXT,  
    importance\_score NUMERIC(4,2) DEFAULT 5.00,  
    status VARCHAR(32) NOT NULL DEFAULT 'active',  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    updated\_at TIMESTAMP NOT NULL DEFAULT NOW()  
);

### **`memory_type`**

* `preference`  
* `relationship`  
* `constraint`  
* `event`

---

## **2.16 memory\_embeddings**

記憶向量表

CREATE TABLE memory\_embeddings (  
    memory\_id UUID PRIMARY KEY REFERENCES memory\_items(id) ON DELETE CASCADE,  
    embedding VECTOR(1536)  
);

---

## **2.17 evaluations**

評測主表

CREATE TABLE evaluations (  
    id UUID PRIMARY KEY,  
    evaluation\_code VARCHAR(64) UNIQUE NOT NULL,  
    target\_type VARCHAR(32) NOT NULL,  
    target\_id UUID NOT NULL,  
    evaluation\_type VARCHAR(64) NOT NULL,  
    status VARCHAR(32) NOT NULL DEFAULT 'pending',  
    overall\_score NUMERIC(5,2),  
    report JSONB,  
    created\_by VARCHAR(128) NOT NULL,  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    completed\_at TIMESTAMP  
);

### **`target_type`**

* `persona`  
* `agent`  
* `corpus_pack`

---

## **2.18 evaluation\_metrics**

評測明細表

CREATE TABLE evaluation\_metrics (  
    id UUID PRIMARY KEY,  
    evaluation\_id UUID NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,  
    metric\_name VARCHAR(64) NOT NULL,  
    metric\_score NUMERIC(5,2),  
    metric\_comment TEXT,  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW()  
);

### **`metric_name` 範例**

* `persona_stability`  
* `style_consistency`  
* `scenario_fit`  
* `safety_score`  
* `engagement_score`

---

## **2.19 incidents**

治理事件表

### **用途**

記錄熔斷、越界、輸出異常。

CREATE TABLE incidents (  
    id UUID PRIMARY KEY,  
    incident\_code VARCHAR(64) UNIQUE NOT NULL,  
    agent\_id UUID REFERENCES agents(id),  
    session\_id UUID REFERENCES sessions(id),  
    message\_id UUID REFERENCES messages(id),  
    incident\_type VARCHAR(64) NOT NULL,  
    severity VARCHAR(32) NOT NULL,  
    description TEXT NOT NULL,  
    action\_taken VARCHAR(128),  
    status VARCHAR(32) NOT NULL DEFAULT 'open',  
    created\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    resolved\_at TIMESTAMP  
);

---

## **2.20 deployments**

部署紀錄表

CREATE TABLE deployments (  
    id UUID PRIMARY KEY,  
    agent\_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,  
    environment VARCHAR(32) NOT NULL,  
    version VARCHAR(64) NOT NULL,  
    deployment\_status VARCHAR(32) NOT NULL,  
    deployed\_by VARCHAR(128) NOT NULL,  
    deployed\_at TIMESTAMP NOT NULL DEFAULT NOW(),  
    metadata JSONB  
);

---

# **三、索引建議**

CREATE INDEX idx\_personas\_archetype ON personas(archetype);  
CREATE INDEX idx\_personas\_status ON personas(status);

CREATE INDEX idx\_corpus\_items\_scenario ON corpus\_items(scenario);  
CREATE INDEX idx\_corpus\_items\_tone ON corpus\_items(tone);  
CREATE INDEX idx\_corpus\_items\_status ON corpus\_items(status);

CREATE INDEX idx\_agents\_persona\_id ON agents(persona\_id);  
CREATE INDEX idx\_agents\_status ON agents(status);

CREATE INDEX idx\_sessions\_agent\_id ON sessions(agent\_id);  
CREATE INDEX idx\_sessions\_user\_ref ON sessions(user\_ref);

CREATE INDEX idx\_messages\_session\_id ON messages(session\_id);  
CREATE INDEX idx\_messages\_created\_at ON messages(created\_at);

CREATE INDEX idx\_memory\_items\_agent\_user ON memory\_items(agent\_id, user\_ref);  
CREATE INDEX idx\_evaluations\_target ON evaluations(target\_type, target\_id);  
CREATE INDEX idx\_incidents\_agent\_id ON incidents(agent\_id);

若使用 `pgvector`，可再補 ANN index。

---

# **四、核心關聯圖**

可以簡化理解成：

personas  
 ├── persona\_traits  
 ├── persona\_specs  
 ├── corpus\_packs  
 └── agents  
       ├── agent\_configs  
       ├── agent\_corpus\_packs  
       ├── sessions  
       │    └── messages  
       ├── memory\_items  
       ├── evaluations  
       ├── incidents  
       └── deployments

---

# **五、API Spec v1.0**

以下以 **REST API** 為主。  
格式統一：

* Request / Response：`application/json`  
* 時間：ISO 8601  
* ID：UUID  
* 驗證：Bearer Token

---

## **5.1 通用回應格式**

### **成功**

{  
  "success": true,  
  "data": {},  
  "meta": {}  
}

### **失敗**

{  
  "success": false,  
  "error": {  
    "code": "PERSONA\_NOT\_FOUND",  
    "message": "指定的人格不存在"  
  }  
}

---

# **六、Persona API**

---

## **6.1 建立人格**

### **`POST /api/v1/personas`**

#### **Request**

{  
  "persona\_code": "host\_xiaos\_v1",  
  "persona\_name": "小S型主持人格",  
  "archetype": "host",  
  "description": "娛樂主持型人格，擅長破冰、調侃、情緒放大與真誠收尾",  
  "target\_audience": "綜藝節目、直播互動、訪談場景",  
  "primary\_use\_case": "interview\_host"  
}

#### **Response**

{  
  "success": true,  
  "data": {  
    "id": "uuid",  
    "persona\_code": "host\_xiaos\_v1",  
    "status": "draft"  
  }  
}

---

## **6.2 取得人格列表**

### **`GET /api/v1/personas`**

#### **Query Params**

* `archetype`  
* `status`  
* `keyword`  
* `page`  
* `page_size`

#### **Response**

{  
  "success": true,  
  "data": \[  
    {  
      "id": "uuid",  
      "persona\_code": "host\_xiaos\_v1",  
      "persona\_name": "小S型主持人格",  
      "archetype": "host",  
      "status": "approved"  
    }  
  \],  
  "meta": {  
    "page": 1,  
    "page\_size": 20,  
    "total": 1  
  }  
}

---

## **6.3 取得單一人格**

### **`GET /api/v1/personas/{persona_id}`**

---

## **6.4 更新人格**

### **`PUT /api/v1/personas/{persona_id}`**

---

## **6.5 更新人格特徵**

### **`PUT /api/v1/personas/{persona_id}/traits`**

#### **Request**

{  
  "humor\_level": 9,  
  "warmth\_level": 6,  
  "directness\_level": 8,  
  "emotional\_intensity": 8,  
  "proactiveness\_level": 9,  
  "intimacy\_level": 5,  
  "stability\_target": 8  
}

---

## **6.6 生成人格規格**

### **`POST /api/v1/personas/{persona_id}/generate-spec`**

#### **用途**

根據 persona \+ traits 自動生成 `persona_spec`。

#### **Request**

{  
  "version": 1,  
  "generation\_mode": "semi\_auto"  
}

#### **Response**

{  
  "success": true,  
  "data": {  
    "persona\_spec\_id": "uuid",  
    "version": 1,  
    "status": "draft"  
  }  
}

---

## **6.7 取得人格規格**

### **`GET /api/v1/personas/{persona_id}/specs`**

---

# **七、Corpus API**

---

## **7.1 單筆建立語料**

### **`POST /api/v1/corpus/items`**

#### **Request**

{  
  "text": "你今天是不是有點繃住？",  
  "source\_type": "generated",  
  "scenario": "interview\_opening",  
  "tone": "playful",  
  "emotion": "light\_tension",  
  "intent": "break\_ice",  
  "persona\_type": "host",  
  "safety\_level": "low"  
}

---

## **7.2 批量生成語料**

### **`POST /api/v1/corpus/generate`**

#### **Request**

{  
  "persona\_id": "uuid",  
  "scenario": "interview\_opening",  
  "tone": "playful",  
  "count": 50,  
  "mode": "template\_plus\_llm"  
}

#### **Response**

{  
  "success": true,  
  "data": {  
    "job\_id": "uuid",  
    "status": "queued"  
  }  
}

---

## **7.3 查詢語料**

### **`GET /api/v1/corpus/items`**

#### **Query Params**

* `scenario`  
* `tone`  
* `persona_type`  
* `status`  
* `keyword`  
* `page`  
* `page_size`

---

## **7.4 審核語料**

### **`POST /api/v1/corpus/items/{corpus_id}/review`**

#### **Request**

{  
  "status": "approved",  
  "quality\_score": 8.8,  
  "review\_comment": "風格自然，可進 production"  
}

---

## **7.5 建立語料包**

### **`POST /api/v1/corpus/packs`**

#### **Request**

{  
  "pack\_code": "pack\_host\_core\_v1",  
  "pack\_name": "主持人格核心語料包",  
  "persona\_id": "uuid",  
  "description": "主持人格的破冰、追問、收尾語料"  
}

---

## **7.6 將語料加入語料包**

### **`POST /api/v1/corpus/packs/{pack_id}/items`**

#### **Request**

{  
  "corpus\_ids": \["uuid1", "uuid2", "uuid3"\],  
  "default\_weight": 1.0  
}

---

## **7.7 語意搜尋語料**

### **`POST /api/v1/corpus/search`**

#### **Request**

{  
  "query": "輕鬆破冰但帶幽默的開場句",  
  "persona\_type": "host",  
  "top\_k": 10  
}

#### **Response**

{  
  "success": true,  
  "data": \[  
    {  
      "corpus\_id": "uuid",  
      "text": "你今天是不是有點繃住？",  
      "score": 0.91  
    }  
  \]  
}

---

# **八、Agent API**

---

## **8.1 建立 Agent**

### **`POST /api/v1/agents`**

#### **Request**

{  
  "agent\_code": "agent\_host\_xiaos\_v1",  
  "agent\_name": "小S型 AI 主持人",  
  "persona\_id": "uuid",  
  "persona\_spec\_id": "uuid",  
  "primary\_model": "gpt-5-class",  
  "fallback\_model": "gpt-4o-class",  
  "memory\_policy": "session\_plus\_preference",  
  "safety\_profile": "entertainment\_safe\_v1"  
}

---

## **8.2 掛載語料包**

### **`POST /api/v1/agents/{agent_id}/packs`**

#### **Request**

{  
  "pack\_ids": \["uuid1", "uuid2"\]  
}

---

## **8.3 更新 Agent 配置**

### **`POST /api/v1/agents/{agent_id}/configs`**

#### **Request**

{  
  "config": {  
    "max\_context\_turns": 12,  
    "temperature": 0.85,  
    "top\_p": 0.95,  
    "max\_output\_tokens": 600  
  }  
}

---

## **8.4 取得 Agent 詳情**

### **`GET /api/v1/agents/{agent_id}`**

---

## **8.5 部署 Agent**

### **`POST /api/v1/agents/{agent_id}/deploy`**

#### **Request**

{  
  "environment": "staging",  
  "version": "v1.0.0"  
}

#### **Response**

{  
  "success": true,  
  "data": {  
    "deployment\_id": "uuid",  
    "deployment\_status": "deploying"  
  }  
}

---

## **8.6 取得部署紀錄**

### **`GET /api/v1/agents/{agent_id}/deployments`**

---

# **九、Runtime API**

---

## **9.1 建立 Session**

### **`POST /api/v1/runtime/sessions`**

#### **Request**

{  
  "agent\_id": "uuid",  
  "user\_ref": "user\_123",  
  "channel": "web"  
}

#### **Response**

{  
  "success": true,  
  "data": {  
    "session\_id": "uuid",  
    "session\_code": "sess\_abc123",  
    "state": "active"  
  }  
}

---

## **9.2 對話回應**

### **`POST /api/v1/runtime/respond`**

#### **Request**

{  
  "session\_id": "uuid",  
  "user\_message": "我今天有點緊張，等等要錄節目。",  
  "metadata": {  
    "scenario": "pre\_show\_chat"  
  }  
}

#### **Response**

{  
  "success": true,  
  "data": {  
    "assistant\_message": "你今天是不是有點繃住？先不要急，我們先把氣氛暖起來。",  
    "strategy\_used": "break\_ice",  
    "model\_used": "gpt-5-class",  
    "safety\_action": "none",  
    "latency\_ms": 1240  
  }  
}

---

## **9.3 取得 Session 訊息**

### **`GET /api/v1/runtime/sessions/{session_id}/messages`**

---

## **9.4 結束 Session**

### **`POST /api/v1/runtime/sessions/{session_id}/close`**

---

# **十、Memory API**

---

## **10.1 寫入記憶**

### **`POST /api/v1/memory/items`**

#### **Request**

{  
  "agent\_id": "uuid",  
  "user\_ref": "user\_123",  
  "memory\_type": "preference",  
  "content": "使用者偏好直接、輕鬆的主持風格",  
  "importance\_score": 8.5  
}

---

## **10.2 查詢記憶**

### **`GET /api/v1/memory/items`**

#### **Query Params**

* `agent_id`  
* `user_ref`  
* `memory_type`

---

## **10.3 語意搜尋記憶**

### **`POST /api/v1/memory/search`**

#### **Request**

{  
  "agent\_id": "uuid",  
  "user\_ref": "user\_123",  
  "query": "和節目緊張感有關的使用者偏好",  
  "top\_k": 5  
}

---

# **十一、Evaluation API**

---

## **11.1 發起評測**

### **`POST /api/v1/evaluations`**

#### **Request**

{  
  "target\_type": "agent",  
  "target\_id": "uuid",  
  "evaluation\_type": "persona\_stability\_suite"  
}

---

## **11.2 取得評測結果**

### **`GET /api/v1/evaluations/{evaluation_id}`**

#### **Response**

{  
  "success": true,  
  "data": {  
    "evaluation\_id": "uuid",  
    "status": "completed",  
    "overall\_score": 86.5,  
    "metrics": \[  
      {  
        "metric\_name": "persona\_stability",  
        "metric\_score": 88  
      },  
      {  
        "metric\_name": "style\_consistency",  
        "metric\_score": 84  
      },  
      {  
        "metric\_name": "safety\_score",  
        "metric\_score": 95  
      }  
    \]  
  }  
}

---

# **十二、Governance API**

---

## **12.1 建立 incident**

### **`POST /api/v1/incidents`**

#### **Request**

{  
  "agent\_id": "uuid",  
  "session\_id": "uuid",  
  "message\_id": "uuid",  
  "incident\_type": "boundary\_violation",  
  "severity": "medium",  
  "description": "輸出過度嘲諷，偏離主持人格邊界",  
  "action\_taken": "fallback\_to\_neutral"  
}

---

## **12.2 取得 incident 列表**

### **`GET /api/v1/incidents`**

#### **Query Params**

* `agent_id`  
* `severity`  
* `status`

---

## **12.3 更新 incident 狀態**

### **`PUT /api/v1/incidents/{incident_id}`**

---

# **十三、狀態碼建議**

* `200 OK`  
* `201 Created`  
* `202 Accepted`  
* `400 Bad Request`  
* `401 Unauthorized`  
* `403 Forbidden`  
* `404 Not Found`  
* `409 Conflict`  
* `422 Unprocessable Entity`  
* `500 Internal Server Error`

---

# **十四、版本與命名規則**

## **API 版本**

* `/api/v1/...`

## **命名規則**

* resource 用複數：`/personas`、`/agents`  
* action 用動詞子路徑：`/generate-spec`、`/deploy`

---

# **十五、MVP 必做 API**

若第一版想快上，先做這 12 支就夠：

### **Persona**

* `POST /personas`  
* `GET /personas`  
* `PUT /personas/{id}/traits`  
* `POST /personas/{id}/generate-spec`

### **Corpus**

* `POST /corpus/items`  
* `POST /corpus/generate`  
* `POST /corpus/packs`  
* `POST /corpus/packs/{id}/items`

### **Agent**

* `POST /agents`  
* `POST /agents/{id}/packs`  
* `POST /agents/{id}/deploy`

### **Runtime**

* `POST /runtime/sessions`  
* `POST /runtime/respond`

嚴格說是 13 支，但這就是 MVP 核心骨架。

---

# **十六、實作順序建議**

## **Phase 1**

先完成：

* personas  
* persona\_traits  
* persona\_specs  
* prompt\_templates

## **Phase 2**

再完成：

* corpus\_items  
* corpus\_packs  
* corpus\_pack\_items  
* embeddings

## **Phase 3**

再做：

* agents  
* agent\_configs  
* sessions  
* messages

## **Phase 4**

最後補：

* memory  
* evaluations  
* incidents  
* deployments

---

# **十七、一句話收束**

這份 **《Persona Factory 資料庫 Schema 與 API Spec v1.0》** 的核心目的，是把你的人格工廠從概念推進到：

**可建模、可存取、可組裝、可部署、可評測、可治理的工程底座。**

接下來最自然的下一步，不是再講概念，而是直接進入兩個實戰文件其中之一：

**《Persona Factory 後端專案目錄結構與微服務拆分建議》**  
或  
**《Persona Factory API Swagger / OpenAPI 3.0 草案》**

