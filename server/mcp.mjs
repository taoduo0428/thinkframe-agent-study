import readline from "node:readline";
import {
  addQuestions, getQuestion, getStats, listQuestions, updateQuestion
} from "./storage/question-store.mjs";
import { answerQuestion } from "./agent/answerer.mjs";
import { retrieveKnowledge } from "./agent/knowledge-retriever.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const tools = [
  {
    name: "thinkframe_list_questions",
    description: "列出本地 ThinkFrame 面试题，可按分类、学习状态和关键词筛选。",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "关键词，可选" },
        category: { type: "string", description: "分类名称，可选" },
        status: { type: "string", enum: ["new", "learning", "mastered"], description: "学习状态，可选" },
        limit: { type: "number", description: "最多返回多少条，默认 30" }
      }
    }
  },
  {
    name: "thinkframe_get_question",
    description: "读取一道面试题的完整内容，包括答题思路、答案、来源和学习状态。",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "题目 ID" } },
      required: ["id"]
    }
  },
  {
    name: "thinkframe_add_question",
    description: "向本地 ThinkFrame 题库添加一道结构化面试题。答题思路应先于完整答案。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        question: { type: "string" },
        category: { type: "string" },
        questionType: { type: "string" },
        thinkingPath: { type: "array", items: { type: "object" } },
        answer: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        followUps: { type: "array", items: { type: "string" } }
      },
      required: ["title", "category", "thinkingPath", "answer"]
    }
  },
  {
    name: "thinkframe_update_learning_status",
    description: "更新一道面试题的掌握状态：new、learning 或 mastered。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["new", "learning", "mastered"] }
      },
      required: ["id", "status"]
    }
  },
  {
    name: "thinkframe_get_study_stats",
    description: "获取本地题库总数、已掌握数量、学习中数量和分类统计。",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "thinkframe_search_knowledge",
    description: "在本地 AI Agent 知识库和面试题库中检索相关段落，返回原始摘录及 PDF 页码。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "要检索的问题或关键词" },
        limit: { type: "number", description: "返回来源数量，1 到 8，默认 6" }
      },
      required: ["query"]
    }
  },
  {
    name: "thinkframe_answer_question",
    description: "调用 ThinkFrame 面试教练回答技术问题。配置模型 API 时生成思路、完整答案、工程取舍和追问，并引用本地知识库；未配置时返回题库原始答案或检索摘录。",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "当前要回答的问题" },
        questionId: { type: "string", description: "可选的 ThinkFrame 题目 ID" },
        history: {
          type: "array",
          description: "可选的最近对话上下文",
          items: {
            type: "object",
            properties: {
              role: { type: "string", enum: ["user", "assistant"] },
              content: { type: "string" }
            },
            required: ["role", "content"]
          }
        }
      },
      required: ["question"]
    }
  }
];

function rpcResult(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function rpcError(id, code, message, data) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } }) + "\n");
}
function toolResult(value, isError = false) {
  const serialized = JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text", text: serialized }],
    structuredContent: value,
    ...(isError ? { isError: true } : {})
  };
}

async function callTool(name, args = {}) {
  if (name === "thinkframe_list_questions") {
    const items = await listQuestions({ ...args, limit: args.limit || 30 });
    return toolResult({ count: items.length, questions: items.map((item) => ({
      id: item.id, title: item.title, category: item.category,
      questionType: item.questionType, status: item.status,
      thinkingPath: item.thinkingPath, answer: item.answer
    })) });
  }
  if (name === "thinkframe_get_question") {
    const item = await getQuestion(args.id);
    if (!item) return toolResult({ error: "题目不存在。" }, true);
    return toolResult(item);
  }
  if (name === "thinkframe_add_question") {
    const result = await addQuestions([{
      ...args,
      question: args.question || args.title,
      answerOrigin: "agent",
      sourceSection: "Agent 导入",
      status: "new"
    }]);
    return toolResult({ added: result.added, skipped: result.skipped, total: result.total });
  }
  if (name === "thinkframe_update_learning_status") {
    if (!["new", "learning", "mastered"].includes(args.status)) throw new Error("无效的学习状态。");
    const updated = await updateQuestion(args.id, { status: args.status });
    if (!updated) return toolResult({ error: "题目不存在。" }, true);
    return toolResult({ id: updated.id, title: updated.title, status: updated.status });
  }
  if (name === "thinkframe_get_study_stats") return toolResult(await getStats());
  if (name === "thinkframe_search_knowledge") {
    if (!String(args.query || "").trim()) throw new Error("请输入检索问题。");
    const result = await retrieveKnowledge(args.query, { limit: args.limit || 6 });
    return toolResult({ indexReady: result.indexReady, count: result.sources.length, sources: result.sources });
  }
  if (name === "thinkframe_answer_question") {
    if (!String(args.question || "").trim()) throw new Error("请输入要回答的问题。");
    const result = await answerQuestion({
      message: args.question,
      questionId: args.questionId,
      history: args.history
    });
    return toolResult(result);
  }
  throw Object.assign(new Error("Unknown tool: " + name), { code: -32601 });
}

async function handle(message) {
  const id = message.id;
  const method = message.method;
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "thinkframe-local-mcp", version: "0.2.0" },
      instructions: "本 MCP 服务仅访问 ThinkFrame 本地题库与知识库。可检索资料、回答面试问题、添加题目和更新学习状态。"
    });
  }
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools });
  if (method === "tools/call") {
    try {
      const result = await callTool(message.params?.name, message.params?.arguments || {});
      return rpcResult(id, result);
    } catch (error) {
      if (error.code) return rpcError(id, error.code, error.message);
      return rpcResult(id, toolResult({ error: error.message || "工具执行失败。" }, true));
    }
  }
  if (id !== undefined) rpcError(id, -32601, "Method not found: " + method);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", async (line) => {
  if (!line.trim()) return;
  try {
    const message = JSON.parse(line);
    await handle(message);
  } catch (error) {
    process.stderr.write("[ThinkFrame MCP] " + error.message + "\n");
  }
});
