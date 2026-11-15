# ThinkFrame — Agent Interview Studio

A local-first Chinese technical interview learning app for AI Agent engineering.

## Features

- 188 imported interview questions with source answers and page provenance.
- Ten topic categories, question search, status tracking, and focused review.
- Question-curation Agent for bulk question intake and structured previews.
- Interview-coach Agent for direct Q&A and multi-turn follow-ups.
- RAG retrieval over the full local AI Agent knowledge-base PDF and question bank.
- Thinking path first, then a complete answer, implementation detail, trade-offs, follow-ups, and citations.
- OpenAI-compatible model provider, project Skills, and a narrow stdio MCP server.
- Responsive local UI; the server binds to 127.0.0.1.

## Quick start

Requirements:
- Node.js 20+
- Python 3.10+ with PyMuPDF for building the PDF index

Build the local PDF index once:

    python scripts/index_knowledge_base.py

Start the app:

    npm run dev

Open http://127.0.0.1:4173.

No npm install is required for the current vanilla-JS UI and Node server. If the source PDF is not in the parent directory, pass its path to the index script with --source.

## Configure AI

In the app, open 设置与连接 and enter:
- API Base URL
- Model name
- API Key
- Temperature

Without a configured model, the app still supports local question browsing and retrieval. It can show original question-bank answers and retrieved source excerpts, but cannot generate new AI answers.

## Agent answer workflow

1. Open Agent 解答.
2. Ask a technical question or open a question from the bank and choose 向 Agent 深入提问.
3. The retriever searches page-aware PDF chunks and question-bank entries.
4. The model produces a structured explanation and cites only retrieved source IDs.
5. Follow-up questions reuse recent conversation context.

Source-based claims and model-only additions are separated. PDF page numbers are shown alongside citations.

## Public access protection

The server binds to 127.0.0.1 and is intended to sit behind a Cloudflare Tunnel. Before exposing it publicly, configure these process environment variables:

- THINKFRAME_REQUIRE_AUTH=1
- THINKFRAME_ACCESS_USERNAME=thinkframe
- THINKFRAME_ACCESS_PASSWORD=<a long random password>

The app uses HTTP Basic Authentication for every page and API route. If a request arrives through Cloudflare without a configured password, the server fails closed with HTTP 503 rather than exposing the app or its data.

## MCP

Run:

    node server/mcp.mjs

See docs/AGENT-AND-MCP.md for the MCP client configuration and tool list.

## Verification

    npm run check
    npm test

## Local data and secrets

- data/questions.json — local question bank.
- data/knowledge_chunks.jsonl — generated local PDF index (ignored by Git).
- .data/settings.json — API settings and secret key (ignored by Git).

The original source PDF is never modified by the indexing script.

## Multiple API connections and model selection

Open **设置与连接** to add and manage multiple OpenAI-compatible API profiles. Each profile can store its own connection name, Base URL, API Key, authentication header, protocol, model, and temperature.

- Click **获取模型** to call the provider's GET /models endpoint and populate the model selector.
- Choose a model from the returned list, or enter a model ID manually if the provider does not expose a model-list endpoint.
- Switch the active profile at any time. Agent Q&A, question curation, and answer rewriting all use the currently active enabled profile.
- Profiles support enable, disable, edit, test, and delete actions.
- Supported request protocols: Chat Completions (/chat/completions) and Responses API (/responses).
- Supported API-key headers: Authorization: Bearer, x-api-key, and api-key.

API keys are stored locally in .data/settings.json and are never included in the settings response sent to the browser. The file is local plaintext storage, so keep the machine account protected and do not share or commit this file. The existing single-API settings format is migrated to one profile on first read.
