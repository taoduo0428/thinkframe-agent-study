import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const originalPrivateDir = process.env.THINKFRAME_PRIVATE_DIR;
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "thinkframe-agent-store-"));
process.env.THINKFRAME_PRIVATE_DIR = tempRoot;
const store = await import("../server/storage/agent-store.mjs?agent-store-test");
const storeReloaded = await import("../server/storage/agent-store.mjs?agent-store-reload-test");
const workspaceFile = path.join(tempRoot, "agent-workspace.json");

after(async () => {
  await rm(tempRoot, { recursive: true, force: true });
  if (originalPrivateDir === undefined) delete process.env.THINKFRAME_PRIVATE_DIR;
  else process.env.THINKFRAME_PRIVATE_DIR = originalPrivateDir;
});

test("Agent conversations and message history survive reloads", async () => {
  const created = await store.createConversation({ contextId: "question-1" });
  assert.ok(created.id);
  assert.equal(created.contextId, "question-1");

  await store.appendConversationMessage(created.id, {
    role: "user",
    content: "Explain how vector retrieval works."
  });
  await store.appendConversationMessage(created.id, {
    role: "assistant",
    content: "Vector retrieval converts text into embeddings and searches nearby vectors.",
    result: {
      answer: "Vector retrieval converts text into embeddings and searches nearby vectors.",
      sources: [{ title: "Local RAG notes", page: 4 }]
    }
  });
  await store.updateConversation(created.id, { pinned: true });

  const reloaded = await storeReloaded.getConversation(created.id);
  assert.equal(reloaded.messages.length, 2);
  assert.equal(reloaded.messages[0].role, "user");
  assert.match(reloaded.messages[1].result.answer, /embeddings/);
  assert.equal(reloaded.pinned, true);

  const list = await storeReloaded.listConversations({ search: "vector retrieval" });
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "Explain how vector retrieval works.");
  assert.equal(list[0].preview.includes("embeddings"), true);

  const persisted = JSON.parse(await readFile(workspaceFile, "utf8"));
  assert.equal(persisted.conversations.length, 1);
  assert.equal(persisted.conversations[0].messages.length, 2);
});
