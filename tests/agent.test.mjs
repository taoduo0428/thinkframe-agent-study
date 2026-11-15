import test from "node:test";
import assert from "node:assert/strict";
import { retrieveKnowledge, getKnowledgeIndexStatus } from "../server/agent/knowledge-retriever.mjs";
import { OpenAICompatibleProvider, parseJsonResponse } from "../server/agent/provider.mjs";

test("knowledge index is built and reports a non-zero chunk count", async () => {
  const status = await getKnowledgeIndexStatus();
  assert.equal(status.ready, true);
  assert.ok(status.chunks > 0);
});

test("hybrid retrieval returns source passages with PDF page metadata", async () => {
  const result = await retrieveKnowledge("MCP Function Calling", { limit: 5 });
  assert.ok(result.retrievedCount > 0);
  assert.ok(result.sources.length > 0);
  assert.ok(result.sources.every((source) => /^S\d+$/.test(source.sourceId)));
  assert.ok(result.sources.some((source) => Number.isInteger(source.pdfPage)));
});

test("provider stays unconfigured without a key and fails closed", async () => {
  const provider = new OpenAICompatibleProvider({
    baseUrl: "https://api.openai.com/v1",
    model: "example-model"
  });
  assert.equal(provider.configured, false);
  await assert.rejects(
    provider.complete({ system: "test", user: "test" }),
    /请先在设置中填写/
  );
});

test("JSON parser extracts a valid object from fenced model output", () => {
  const fence = String.fromCharCode(96).repeat(3);
  const parsed = parseJsonResponse(fence + "json\n{\"answer\":\"ok\",\"citations\":[\"S1\"]}\n" + fence);
  assert.equal(parsed.answer, "ok");
  assert.deepEqual(parsed.citations, ["S1"]);
});
