import test from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleProvider, parseModelList } from "../server/agent/provider.mjs";

test("model discovery normalizes OpenAI-compatible model responses and removes duplicates", () => {
  const models = parseModelList({
    data: [
      { id: "gpt-alpha", owned_by: "openai" },
      { id: "gpt-alpha", owned_by: "duplicate" },
      { id: "deepseek-chat", owned_by: "deepseek" }
    ]
  });
  assert.deepEqual(models, [
    { id: "deepseek-chat", ownedBy: "deepseek" },
    { id: "gpt-alpha", ownedBy: "openai" }
  ]);
});

test("model discovery calls GET /models with the selected API key", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestInit = {};
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestInit = init;
    return new Response(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://gateway.example.test/v1/",
      apiKey: "test-secret",
      model: "model-a"
    });
    const models = await provider.listModels();
    assert.equal(requestUrl, "https://gateway.example.test/v1/models");
    assert.equal(requestInit.method, "GET");
    assert.equal(requestInit.headers.Authorization, "Bearer test-secret");
    assert.deepEqual(models.map((item) => item.id), ["model-a", "model-b"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Responses API provider sends instructions and parses output_text", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody = {};
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ output_text: "OK" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://gateway.example.test/v1",
      apiKey: "test-secret",
      model: "responses-model",
      protocol: "responses"
    });
    const answer = await provider.complete({ system: "system prompt", user: "hello", json: false });
    assert.equal(answer, "OK");
    assert.equal(requestUrl, "https://gateway.example.test/v1/responses");
    assert.equal(requestBody.instructions, "system prompt");
    assert.equal(requestBody.input[0].content, "hello");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Chat Completions provider uses the active model and parses assistant content", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody = {};
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://gateway.example.test/v1",
      apiKey: "test-secret",
      model: "chat-model"
    });
    const answer = await provider.complete({ system: "system prompt", user: "hello", json: false });
    assert.equal(answer, "answer");
    assert.equal(requestUrl, "https://gateway.example.test/v1/chat/completions");
    assert.equal(requestBody.model, "chat-model");
    assert.equal(requestBody.messages[0].role, "system");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
