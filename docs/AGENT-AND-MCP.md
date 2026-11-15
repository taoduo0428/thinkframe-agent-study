# ThinkFrame Agent, RAG, Skills and MCP

## What the Agent can do

ThinkFrame has two separate Agent workflows:

1. Question curator — paste a list of questions, classify them, build a question-specific thinking path, draft answers when a model is configured, review the preview, and save only after approval.
2. Interview coach — ask a technical question directly, or open a question card and ask follow-ups in its context. The Agent retrieves local source passages, explains the answer, and returns source citations with PDF page numbers.

The interview coach response contains:
- A short understanding of the question
- An ordered, teachable thinking path (not hidden chain-of-thought)
- A complete Chinese answer suitable for an interview
- Implementation detail or code when useful
- Engineering trade-offs and failure cases
- Follow-up questions
- Source citations and page locations
- A separate “模型补充（非原文）” section for general engineering knowledge not established by the PDF

If no model API is configured, ThinkFrame still searches the local index and question bank. It can display a saved original answer or source excerpts, but it does not pretend that a new AI-generated answer was produced.

## RAG pipeline

The local retrieval pipeline is deliberately inspectable:

1. Extract page text from the source PDF without modifying the PDF.
2. Split text into page-aware chunks with a small overlap.
3. Store chunk metadata (source filename, PDF page, printed page when detected, section, page title, chunk number).
4. Search both the PDF chunks and the 188 imported question records.
5. Rank candidates with BM25-style lexical scoring plus exact-phrase and question-title boosts.
6. Pass the selected excerpts to the model as untrusted reference data.
7. Ask the model to cite only source IDs supplied in the current request.
8. Map cited IDs back to source metadata and show the PDF page in the UI.

This first local retriever is lexical/hybrid, not a vector-embedding index. It requires no external vector database or extra runtime service. The retrieval interface is isolated so embeddings or a reranker can be added later without changing the UI or answer contract.

## Build the local knowledge index

The source PDF is expected one directory above the project:

    ..\AI Agent工程师知识库全文.pdf

Run once:

    python scripts/index_knowledge_base.py

The script writes:

    data/knowledge_chunks.jsonl

It indexes the PDF page by page and reports the number of indexed pages and chunks. The original PDF remains read-only. The generated index is local data and is excluded from Git.

If the PDF is stored elsewhere:

    python scripts/index_knowledge_base.py --source "D:\path\to\AI Agent工程师知识库全文.pdf"

If PyMuPDF is not installed in the Python environment:

    python -m pip install pymupdf

## Configure a model

Open 设置与连接 and enter:
- API Base URL, such as https://api.openai.com/v1
- Model name
- API Key
- Temperature

The adapter currently uses the OpenAI-compatible Chat Completions endpoint. API credentials are stored in .data/settings.json, are not returned by the settings API, and should never be committed or shared. The server binds to 127.0.0.1 by default.

## Start ThinkFrame

Node.js 20 or later is required. No npm package installation is needed for the local UI/server.

    npm run dev

Open:

    http://127.0.0.1:4173

## MCP server

Start the stdio server:

    node "C:\Users\lenovo\Desktop\agent资料\学习软件\server\mcp.mjs"

Example MCP client configuration:

    {
      "mcpServers": {
        "thinkframe": {
          "command": "node",
          "args": [
            "C:\\Users\\lenovo\\Desktop\\agent资料\\学习软件\\server\\mcp.mjs"
          ]
        }
      }
    }

Available tools:
- thinkframe_list_questions
- thinkframe_get_question
- thinkframe_add_question
- thinkframe_update_learning_status
- thinkframe_get_study_stats
- thinkframe_search_knowledge
- thinkframe_answer_question

The MCP server uses stdio JSON-RPC and exposes narrow question-bank and knowledge-answering operations. It does not expose arbitrary filesystem, shell, or network access.

## Main API routes

- GET /api/health
- GET /api/stats
- GET /api/questions
- POST /api/questions
- GET /api/settings
- PUT /api/settings
- POST /api/settings/test
- POST /api/agent/organize
- POST /api/agent/answer
- POST /api/agent/rewrite/:questionId
- GET /api/agent/knowledge-status

## Extend later

- Add a provider by implementing complete({ system, user, messages, json }).
- Add a Skill by creating skills/<skill-name>/SKILL.md and allow-listing it in server/agent/skills.mjs.
- Add semantic embeddings or a reranker behind knowledge-retriever.mjs.
- Add MCP tools only for concrete workflows; keep their schemas narrow and auditable.
- If the question bank outgrows a single-user local workload, replace the JSON repository with SQLite behind the existing store functions.

## Multiple API connections and model discovery

The settings screen is a local API connection manager rather than a single global form.

Each profile stores:
- Display name and API Base URL
- API Key and auth header mode (Bearer, x-api-key, or api-key)
- Request protocol (Chat Completions or Responses API)
- Selected model ID and temperature
- Enabled/disabled state

The UI calls POST /api/providers/:id/models; the server requests GET /models from that provider and returns normalized model IDs. A provider that does not expose a compatible model list can still be used with a manually entered model ID.

Connection management routes:
- POST /api/providers — create a profile
- PUT /api/providers/:id — edit a profile
- DELETE /api/providers/:id — delete a profile
- POST /api/providers/:id/activate — select the active profile
- POST /api/providers/:id/enable and /disable — enable or disable a profile
- POST /api/providers/:id/models — discover models
- POST /api/providers/:id/test — test an actual model call

Agent answer, question organization, and answer rewrite resolve the same active enabled profile through the local settings store. Existing single-profile settings are migrated automatically. API keys are kept in .data/settings.json, omitted from browser-facing settings responses, and are not encrypted at rest; protect this local file and never commit or share it.
