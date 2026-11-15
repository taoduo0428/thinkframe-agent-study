import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addQuestions, deleteQuestion, getQuestion, getSettings, getStats, getWorkspaceSnapshot,
  listQuestions, saveSettings, updateQuestion, storagePaths, getPrivateSettings,
  getProviderSettings, saveProvider, setActiveProvider, setProviderEnabled, deleteProvider, recordQuestionReview
} from "./storage/question-store.mjs";
import { organizeQuestions, rewriteQuestion } from "./agent/orchestrator.mjs";
import { answerQuestion } from "./agent/answerer.mjs";
import { getKnowledgeIndexStatus } from "./agent/knowledge-retriever.mjs";
import { createProvider } from "./agent/provider.mjs";
import {
  listConversations, getConversation, createConversation, updateConversation, appendConversationMessage, deleteConversation,
  listMemories, createMemory, updateMemory, deleteMemory,
  listTasks, createTask, updateTask, deleteTask
} from "./storage/agent-store.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(ROOT, "../public");
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(value));
}

async function readBody(req, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("请求内容过大。"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("请求 JSON 格式不正确。"), { status: 400 }); }
}

function safeQuestionPatch(body) {
  const allowed = ["title", "question", "category", "questionType", "difficulty", "tags", "keyPoints", "thinkingPath", "answer", "answerOrigin", "reviewStatus", "followUps", "prerequisites", "relatedQuestions", "status", "starred", "notes"];
  return Object.fromEntries(Object.entries(body || {}).filter(([key]) => allowed.includes(key)));
}

function validateProviderInput(body = {}) {
  const name = String(body.name || "").trim();
  const baseUrl = String(body.baseUrl || "").trim();
  if (!name || !baseUrl) throw Object.assign(new Error("请填写连接名称和 API Base URL。"), { status: 400 });
  let parsed;
  try { parsed = new URL(baseUrl); }
  catch { throw Object.assign(new Error("API Base URL 格式不正确。"), { status: 400 }); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw Object.assign(new Error("API Base URL 仅支持不带账号、密码、查询参数的 HTTP 或 HTTPS 地址。"), { status: 400 });
  }
  if (body.protocol && !["chat-completions", "responses"].includes(body.protocol)) {
    throw Object.assign(new Error("暂不支持该 API 协议。"), { status: 400 });
  }
  if (body.authMode && !["bearer", "x-api-key", "api-key"].includes(body.authMode)) {
    throw Object.assign(new Error("不支持该 API Key 认证方式。"), { status: 400 });
  }
  if (String(body.apiKey || "").length > 4096) {
    throw Object.assign(new Error("API Key 长度超出限制。"), { status: 400 });
  }
}

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const file = path.resolve(PUBLIC_DIR, "." + requested);
  const relative = path.relative(PUBLIC_DIR, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (req.method === "GET" && pathname === "/api/bootstrap") {
    const [workspace, settings, index] = await Promise.all([
      getWorkspaceSnapshot({ limit: 500 }), getSettings(), getKnowledgeIndexStatus()
    ]);
    return sendJson(res, 200, {
      health: {
        ok: true, app: "ThinkFrame", version: "0.2.0",
        totalQuestions: workspace.stats.total,
        agentMode: settings.hasApiKey && settings.model ? "api-ready" : "local",
        knowledgeIndexReady: index.ready,
        knowledgeChunks: index.chunks
      },
      stats: workspace.stats,
      questions: workspace.questions,
      settings
    });
  }
  if (req.method === "GET" && pathname === "/api/health") {
    const [stats, settings, index] = await Promise.all([getStats(), getSettings(), getKnowledgeIndexStatus()]);
    return sendJson(res, 200, {
      ok: true, app: "ThinkFrame", version: "0.2.0",
      totalQuestions: stats.total,
      agentMode: settings.hasApiKey && settings.model ? "api-ready" : "local",
      knowledgeIndexReady: index.ready,
      knowledgeChunks: index.chunks
    });
  }
  if (req.method === "GET" && pathname === "/api/stats") {
    return sendJson(res, 200, await getStats());
  }
  if (req.method === "GET" && pathname === "/api/questions") {
    const questions = await listQuestions({
      search: url.searchParams.get("search") || "",
      category: url.searchParams.get("category") || "",
      status: url.searchParams.get("status") || "",
      type: url.searchParams.get("type") || "",
      limit: url.searchParams.get("limit") || 500
    });
    return sendJson(res, 200, { questions, total: questions.length });
  }
  if (req.method === "POST" && pathname === "/api/questions") {
    const body = await readBody(req);
    const items = Array.isArray(body.questions) ? body.questions : [body];
    const result = await addQuestions(items);
    return sendJson(res, 201, result);
  }
  if (req.method === "GET" && pathname === "/api/settings") {
    return sendJson(res, 200, await getSettings());
  }

  const providerAction = pathname.match(/^\/api\/providers\/([^/]+)\/(models|test|activate|enable|disable)$/);
  const providerMatch = pathname.match(/^\/api\/providers\/([^/]+)$/);
  if (req.method === "POST" && pathname === "/api/providers") {
    const body = await readBody(req, 64 * 1024);
    validateProviderInput(body);
    return sendJson(res, 201, await saveProvider(body));
  }
  if (req.method === "PUT" && providerMatch) {
    const body = await readBody(req, 64 * 1024);
    validateProviderInput(body);
    return sendJson(res, 200, await saveProvider(body, decodeURIComponent(providerMatch[1])));
  }
  if (req.method === "DELETE" && providerMatch) {
    return sendJson(res, 200, await deleteProvider(decodeURIComponent(providerMatch[1])));
  }
  if (req.method === "POST" && providerAction) {
    const id = decodeURIComponent(providerAction[1]);
    const action = providerAction[2];
    if (action === "activate") return sendJson(res, 200, await setActiveProvider(id));
    if (action === "enable" || action === "disable") return sendJson(res, 200, await setProviderEnabled(id, action === "enable"));
    const settings = await getProviderSettings(id);
    if (!settings) return sendJson(res, 404, { error: "API 连接不存在。" });
    const provider = createProvider({ providers: [settings], activeProviderId: settings.id });
    if (action === "models") {
      const models = await provider.listModels();
      return sendJson(res, 200, { models, count: models.length });
    }
    const result = await provider.test();
    return sendJson(res, 200, { ok: true, message: "模型调用成功。", result });
  }

  if (req.method === "PUT" && pathname === "/api/settings") {
    const body = await readBody(req, 64 * 1024);
    if (body.baseUrl) {
      const parsed = new URL(body.baseUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) return sendJson(res, 400, { error: "API Base URL 必须使用 HTTP 或 HTTPS。" });
      if (parsed.username || parsed.password) return sendJson(res, 400, { error: "API 地址中不能包含用户名或密码。" });
    }
    const settings = await saveSettings(body);
    return sendJson(res, 200, settings);
  }
  if (req.method === "POST" && pathname === "/api/settings/test") {
    const settings = await getPrivateSettings();
    const provider = createProvider(settings);
    if (!provider.configured) return sendJson(res, 400, { error: "请先填写 Base URL、模型名称和 API Key。" });
    const result = await provider.test();
    return sendJson(res, 200, { ok: true, message: "模型连接成功。", response: result });
  }
  if (req.method === "GET" && pathname === "/api/agent/conversations") {
    const conversations = await listConversations({
      search: url.searchParams.get("search") || "",
      archived: url.searchParams.get("archived") === "true",
      limit: url.searchParams.get("limit") || 100
    });
    return sendJson(res, 200, { conversations });
  }
  if (req.method === "POST" && pathname === "/api/agent/conversations") {
    const body = await readBody(req, 16 * 1024);
    return sendJson(res, 201, await createConversation({ title: body.title, contextId: body.contextId }));
  }
  const conversationMatch = pathname.match(/^\/api\/agent\/conversations\/([^/]+)$/);
  if (conversationMatch) {
    const id = decodeURIComponent(conversationMatch[1]);
    if (req.method === "GET") {
      const conversation = await getConversation(id);
      return conversation ? sendJson(res, 200, conversation) : sendJson(res, 404, { error: "对话不存在。" });
    }
    if (req.method === "PATCH" || req.method === "PUT") {
      const body = await readBody(req, 16 * 1024);
      const updated = await updateConversation(id, {
        title: body.title, summary: body.summary, contextId: body.contextId,
        pinned: body.pinned, archived: body.archived
      });
      return updated ? sendJson(res, 200, updated) : sendJson(res, 404, { error: "对话不存在。" });
    }
    if (req.method === "DELETE") {
      const removed = await deleteConversation(id);
      return removed ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "对话不存在。" });
    }
  }
  if (req.method === "POST" && pathname === "/api/agent/chat") {
    const body = await readBody(req, 64 * 1024);
    const message = String(body.message || "").trim();
    if (!message) return sendJson(res, 400, { error: "请输入消息。" });
    if (message.length > 5000) return sendJson(res, 400, { error: "单条消息不能超过 5000 个字符。" });
    let conversation = body.conversationId ? await getConversation(String(body.conversationId)) : null;
    if (body.conversationId && !conversation) return sendJson(res, 404, { error: "当前对话不存在，可能已被删除。" });
    if (!conversation) conversation = await createConversation({ contextId: body.questionId || null });
    const questionId = body.questionId === undefined ? conversation.contextId : (body.questionId || null);
    if (questionId !== conversation.contextId) await updateConversation(conversation.id, { contextId: questionId });
    const history = (conversation.messages || [])
      .filter((item) => ["user", "assistant"].includes(item.role) && item.status !== "error")
      .slice(-12)
      .map((item) => ({ role: item.role, content: item.content || item.result?.answer || "" }))
      .filter((item) => item.content);
    await appendConversationMessage(conversation.id, { role: "user", content: message });
    try {
      const result = await answerQuestion({
        message, history, questionId,
        memories: (await listMemories()).filter((item) => item.enabled !== false),
        conversationId: conversation.id
      });
      const assistantContent = [result.answer, result.implementation, result.tradeoffs, result.supplementalNotes].filter(Boolean).join("\n\n");
      await appendConversationMessage(conversation.id, { role: "assistant", content: assistantContent, result });
      return sendJson(res, 200, { conversation: await getConversation(conversation.id), result });
    } catch (error) {
      await appendConversationMessage(conversation.id, { role: "assistant", content: "", error: error.message || "Agent 执行失败。" });
      return sendJson(res, 502, { error: error.message || "Agent 执行失败。", conversationId: conversation.id, failed: true });
    }
  }
  if (req.method === "GET" && pathname === "/api/agent/memories") {
    return sendJson(res, 200, { memories: await listMemories() });
  }
  if (req.method === "POST" && pathname === "/api/agent/memories") {
    const body = await readBody(req, 16 * 1024);
    return sendJson(res, 201, await createMemory(body));
  }
  const memoryMatch = pathname.match(/^\/api\/agent\/memories\/([^/]+)$/);
  if (memoryMatch) {
    const id = decodeURIComponent(memoryMatch[1]);
    if (req.method === "PUT" || req.method === "PATCH") {
      const body = await readBody(req, 16 * 1024);
      const updated = await updateMemory(id, body);
      return updated ? sendJson(res, 200, updated) : sendJson(res, 404, { error: "记忆不存在。" });
    }
    if (req.method === "DELETE") {
      const removed = await deleteMemory(id);
      return removed ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "记忆不存在。" });
    }
  }
  if (req.method === "GET" && pathname === "/api/agent/tasks") {
    return sendJson(res, 200, { tasks: await listTasks({ status: url.searchParams.get("status") || "" }) });
  }
  if (req.method === "POST" && pathname === "/api/agent/tasks") {
    const body = await readBody(req, 32 * 1024);
    return sendJson(res, 201, await createTask(body));
  }
  const taskMatch = pathname.match(/^\/api\/agent\/tasks\/([^/]+)$/);
  if (taskMatch) {
    const id = decodeURIComponent(taskMatch[1]);
    if (req.method === "PUT" || req.method === "PATCH") {
      const body = await readBody(req, 32 * 1024);
      const updated = await updateTask(id, body);
      return updated ? sendJson(res, 200, updated) : sendJson(res, 404, { error: "任务不存在。" });
    }
    if (req.method === "DELETE") {
      const removed = await deleteTask(id);
      return removed ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "任务不存在。" });
    }
  }

  if (req.method === "GET" && pathname === "/api/agent/knowledge-status") {
    return sendJson(res, 200, await getKnowledgeIndexStatus());
  }
  if (req.method === "POST" && pathname === "/api/agent/organize") {
    const body = await readBody(req);
    const result = await organizeQuestions(body.text || "");
    return sendJson(res, 200, result);
  }
  if (req.method === "POST" && pathname === "/api/agent/answer") {
    const body = await readBody(req);
    const result = await answerQuestion({
      message: body.message,
      history: body.history,
      questionId: body.questionId
    });
    return sendJson(res, 200, result);
  }

  const rewriteMatch = pathname.match(/^\/api\/agent\/rewrite\/([^/]+)$/);
  if (req.method === "POST" && rewriteMatch) {
    const question = await getQuestion(decodeURIComponent(rewriteMatch[1]));
    if (!question) return sendJson(res, 404, { error: "题目不存在。" });
    const body = await readBody(req, 8192);
    const relatedQuestions = Array.isArray(body.relatedQuestions) ? body.relatedQuestions.filter(item => item && typeof item === "object" && !Array.isArray(item)).slice(0, 4).map(item => ({
      id: String(item.id || "").slice(0, 80),
      title: String(item.title || "").slice(0, 200),
      category: String(item.category || "").slice(0, 100),
      questionType: String(item.questionType || "").slice(0, 60),
      question: String(item.question || "").slice(0, 500)
    })) : [];
    const result = await rewriteQuestion({ ...question, relatedQuestions });
    const updated = await updateQuestion(question.id, result);
    return sendJson(res, 200, updated);
  }

  const reviewMatch = pathname.match(/^\/api\/questions\/([^/]+)\/review$/);
  if (req.method === "POST" && reviewMatch) {
    const id = decodeURIComponent(reviewMatch[1]);
    const body = await readBody(req, 4096);
    const updated = await recordQuestionReview(id, body);
    return updated ? sendJson(res, 200, updated) : sendJson(res, 404, { error: "题目不存在。" });
  }

  const questionMatch = pathname.match(/^\/api\/questions\/([^/]+)$/);
  if (questionMatch) {
    const id = decodeURIComponent(questionMatch[1]);
    if (req.method === "GET") {
      const question = await getQuestion(id);
      return question ? sendJson(res, 200, question) : sendJson(res, 404, { error: "题目不存在。" });
    }
    if (req.method === "PUT") {
      const body = await readBody(req);
      const updated = await updateQuestion(id, safeQuestionPatch(body));
      return updated ? sendJson(res, 200, updated) : sendJson(res, 404, { error: "题目不存在。" });
    }
    if (req.method === "DELETE") {
      const removed = await deleteQuestion(id);
      return removed ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "题目不存在。" });
    }
  }

  return sendJson(res, 404, { error: "API 路由不存在。" });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://" + HOST + ":" + PORT);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(url.pathname, res);
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) process.stderr.write("[ThinkFrame] " + error.message + "\n");
    return sendJson(res, status, { error: error.message || "服务器内部错误。" });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write("ThinkFrame is ready at http://" + HOST + ":" + PORT + "\n");
  process.stdout.write("Local data: " + storagePaths.QUESTIONS_FILE + "\n");
});
