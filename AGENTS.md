# ThinkFrame project guide

ThinkFrame is a local-first AI Agent interview study app.

## Product principles
- The primary learning unit is a question with a clear thinking path followed by a concrete answer.
- Keep the UI calm, premium, readable, and low-friction. Motion is subtle and must respect reduced-motion preferences.
- Preserve source wording and source answers. Distinguish imported source content from AI-rewritten content.
- Do not silently fabricate technical facts. When no model is configured, use deterministic templates and mark generated content as a draft.
- Keep provider, agent orchestration, skills, MCP tools, persistence, and UI separated behind small contracts.

## Data rules
- The canonical question format lives in `server/domain/question.ts`.
- The canonical local store is `data/questions.json`; update it atomically through the repository.
- Local API credentials/config belong in `.data/settings.json` and must never be committed.
- Every question must include a question type, category, thinking path, answer provenance, and source metadata when imported.

## Agent rules
- Agent workflows are orchestrated by the app, not hidden inside UI components.
- Skills are Markdown files in `skills/`; load only the relevant skill for the task.
- Model providers implement the shared `ModelProvider` interface. Default mode is local/offline.
- MCP exposes explicit, narrow question-bank tools. Do not expose arbitrary filesystem or shell access.

## Verification
- Run `npm run build` after code changes.
- Verify question persistence, question status updates, agent import preview, and MCP tool registration.
- Never log or return API keys.
