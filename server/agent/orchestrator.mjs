import { randomUUID } from "node:crypto";
import { getPrivateSettings } from "../storage/question-store.mjs";
import { createProvider, parseJsonResponse } from "./provider.mjs";
import { loadSkillBundle } from "./skills.mjs";

const CATEGORIES = [
  "Agent 基础与推理机制",
  "工具调用与能力接入",
  "Memory 与 Context Engineering",
  "RAG 与向量检索",
  "框架与运行时架构",
  "系统基础与后端工程",
  "可靠性、评估与安全",
  "Coding Agent 与 IDE",
  "综合系统设计与场景题",
  "开放题与个人观点"
];

function classify(title) {
  const t = title.toLowerCase();
  let category = "Agent 基础与推理机制";
  if (/(rag|embedding|rerank|向量|chunk|hnsw|ivf|faiss|ann|召回)/i.test(t)) category = "RAG 与向量检索";
  else if (/(claude.?code|codex|cursor|openclaw|queryengine|queryloop|microcompact|grep)/i.test(t)) category = "Coding Agent 与 IDE";
  else if (/(memory|记忆|上下文|context)/i.test(t)) category = "Memory 与 Context Engineering";
  else if (/(mcp|tool calling|function calling|function call|skill|cli|hook|plugin|a2a|工具调用)/i.test(t)) category = "工具调用与能力接入";
  else if (/(mysql|redis|多进程|多线程|异步|async|sse|websocket|缓存|布隆|数据库|索引|高并发)/i.test(t)) category = "系统基础与后端工程";
  else if (/(langchain|langgraph|harness|graph engineering|loop engineering|checkpoint|框架)/i.test(t)) category = "框架与运行时架构";
  else if (/(评估|judge|badcase|幻觉|路径震荡|超时|失败|冲突|成功率|优化|a\/b test)/i.test(t)) category = "可靠性、评估与安全";
  else if (/(设计一个|智能客服|新闻推荐|可中断|系统架构)/i.test(t)) category = "综合系统设计与场景题";
  else if (/(未来|使用心得|瓶颈|难点|发展|谈谈|怎么看待)/i.test(t)) category = "开放题与个人观点";

  let questionType = "concept";
  if (/(区别|对比|选型|\bvs\b)/i.test(t)) questionType = "comparison";
  else if (/(设计一个|如何设计|搭建|系统架构)/i.test(t)) questionType = "system-design";
  else if (/(怎么办|怎么解决|如何优化|失败|冲突|异常|成功率|延迟|如何保证)/i.test(t)) questionType = "troubleshooting";
  else if (/(流程|原理|机制|怎么实现|如何实现|怎么触发|如何工作)/i.test(t)) questionType = "mechanism";
  else if (/(未来|心得|瓶颈|难点|谈谈|怎么看|你认为|你的理解)/i.test(t)) questionType = "opinion";
  return { category, questionType };
}

function buildThinkingPath(type, category, title = "") {
  const subject = String(title || "这道题").replace(/[？?。！!]+$/, "").trim();
  const focus = {
    concept: "先界定题目中的核心概念",
    mechanism: "先明确题目涉及的运行机制",
    comparison: "先确定对比对象与比较边界",
    troubleshooting: "先界定问题现象与目标",
    "system-design": "先提炼业务目标和关键约束",
    opinion: "先给出针对题目的明确判断"
  }[type] || "先拆解题目真正要回答的内容";
  return [{
    heading: focus,
    detail: "围绕「" + subject + "」识别题目中的关键对象、动作和限定条件。当前是本地待补充草稿；不要用分类模板代替这道题自己的思路。补充来源答案或接入模型后，再建立完整的专属路径。"
  }];
}

function splitQuestions(input) {
  const lines = String(input || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) {
    return lines.map((line) => line.replace(/^[-*•\d.、)）\s]+/, "").replace(/^(题目|问题|Q)[:：]\s*/i, "")).filter(Boolean);
  }
  return lines[0] ? [lines[0]] : [];
}

function normalizeModelQuestions(payload) {
  const items = Array.isArray(payload) ? payload : payload.questions;
  if (!Array.isArray(items)) throw new Error("Agent 输出缺少 questions 数组。");
  return items.map((item) => {
    const title = String(item.title || item.question || "").trim();
    if (!title) return null;
    const fallback = classify(title);
    return {
      id: randomUUID(),
      title,
      question: String(item.question || title),
      category: CATEGORIES.includes(item.category) ? item.category : fallback.category,
      questionType: item.questionType || fallback.questionType,
      difficulty: item.difficulty || "中等",
      tags: Array.isArray(item.tags) ? item.tags : [],
      keyPoints: Array.isArray(item.keyPoints) ? item.keyPoints : [],
      thinkingPath: Array.isArray(item.thinkingPath) ? item.thinkingPath : buildThinkingPath(fallback.questionType, fallback.category, title),
      answer: String(item.answer || "尚未补充完整答案。"),
      answerOrigin: item.answer ? "ai" : "draft",
      sourceAnswer: "",
      followUps: Array.isArray(item.followUps) ? item.followUps : [],
      prerequisites: Array.isArray(item.prerequisites) ? item.prerequisites : [],
      relatedQuestions: [],
      status: "new"
    };
  }).filter(Boolean);
}

export async function organizeQuestions(rawText) {
  const titles = splitQuestions(rawText);
  if (!titles.length) throw new Error("请先输入至少一道面试题。");

  const settings = await getPrivateSettings();
  const provider = createProvider(settings);
  if (provider.configured) {
    const [curator, coach, reviewer] = await Promise.all([
      loadSkillBundle(["question-curator"]),
      loadSkillBundle(["answer-coach"]),
      loadSkillBundle(["question-reviewer"])
    ]);
    const system = [
      "你是 ThinkFrame 的面试题整理 Agent。请只输出符合 JSON 格式的内容，不要输出 Markdown。",
      "输出结构：{ \"questions\": [{ \"title\": string, \"question\": string, \"category\": string, \"questionType\": string, \"difficulty\": string, \"tags\": string[], \"keyPoints\": string[], \"thinkingPath\": [{ \"heading\": string, \"detail\": string }], \"answer\": string, \"followUps\": string[], \"prerequisites\": string[] }] }。",
      "答题思路必须先于完整答案；每一步包含简短标题和一两句解释。完整答案按思路顺序展开，适合中文技术面试口述。",
      "分类必须从以下集合选择：" + CATEGORIES.join("、"),
      curator, coach, reviewer
    ].join("\n\n");
    const content = await provider.complete({
      system,
      user: "请整理以下面试题，每道题单独生成结构化卡片：\n" + titles.map((t, i) => String(i + 1) + ". " + t).join("\n"),
      json: true
    });
    return { mode: "agent", warnings: [], questions: normalizeModelQuestions(parseJsonResponse(content)) };
  }

  const questions = titles.map((title) => {
    const { category, questionType } = classify(title);
    return {
      id: randomUUID(), title, question: title, category, questionType,
      difficulty: ["mechanism", "troubleshooting", "system-design"].includes(questionType) ? "进阶" : "基础",
      tags: [category], keyPoints: [], thinkingPath: buildThinkingPath(questionType, category, title),
      answer: "当前尚未连接模型 API。已根据题型生成答题思路；请在设置中接入模型后自动生成完整答案，或先手动补充。",
      answerOrigin: "draft", sourceAnswer: "", followUps: [], prerequisites: [], relatedQuestions: [], status: "new"
    };
  });
  return {
    mode: "local",
    warnings: ["当前使用本地规则模式：已完成题型与分类识别，并生成答题路径；完整答案需要接入模型 API 或手动补充。"],
    questions
  };
}

export async function rewriteQuestion(question) {
  const settings = await getPrivateSettings();
  const provider = createProvider(settings);
  if (!provider.configured) throw new Error("请先配置模型 API。");
  const [coach, reviewer] = await Promise.all([
    loadSkillBundle(["answer-coach"]),
    loadSkillBundle(["question-reviewer"])
  ]);
  const system = [
    "你是 ThinkFrame 的逐题技术面试教练。只输出 JSON，不要输出 Markdown。",
    "输出结构：{ \"answer\": string, \"thinkingPath\": [{ \"heading\": string, \"detail\": string }], \"keyPoints\": string[], \"followUps\": string[], \"reviewStatus\": \"pass\"|\"needs-revision\"|\"source-check-required\", \"reviewIssues\": string[] }。",
    "必须先独立分析这道题的具体问法、范围、考察对象和 sourceAnswer，再设计本题专属的 3–6 步思路。不得复制 questionType 或 category 的固定模板；同类题也必须根据各自题意微调步骤。",
    "每个 thinkingPath.heading 都要出现本题特有的概念、机制、比较维度、组件、故障点或设计约束；detail 要解释这一步为什么适用于本题。",
    "完整答案必须严格按照 thinkingPath 的顺序展开。每个主要答案段落都要能对应到一个思路步骤；不允许思路讲 A、答案却讲 B。",
    "sourceAnswer 是原始资料依据。保留其中有支持的事实与术语，不要覆盖、改写或声称修改 sourceAnswer；不要补造来源、数据、基准、版本细节或个人经历。",
    "如果原始资料没有覆盖题目中的某个要求，明确写出资料边界，并把 reviewStatus 设为 source-check-required 或 needs-revision，不要用常识假装是原文内容。",
    "reviewStatus 与 reviewIssues 必须只评价你即将返回的最终 answer、thinkingPath 和 keyPoints，而不是评价输入中的 currentThinkingPath/currentAnswer/currentKeyPoints；这些 current 字段只是待修订的旧版本。",
    "如果最终输出已经修复了旧版本的问题，不得把旧问题继续列入 reviewIssues。reviewIssues 只写最终版本仍然存在、且能指出具体字段或句子的缺陷；没有实质缺陷时 reviewStatus 必须为 pass 且 reviewIssues 为空。",
    "只有当最终答案确实缺少源材料支持、存在技术事实不确定性或无法安全补全时才使用 source-check-required；只有最终版本仍存在结构/覆盖/表达缺陷时才使用 needs-revision。",
    "keyPoints 只列本题答案真正需要记住的 3–6 个要点；避免泛化成类别目录。",
    coach,
    reviewer
  ].join("\n\n");
  const content = await provider.complete({
    system,
    user: JSON.stringify({
      title: question.title,
      question: question.question,
      category: question.category,
      questionType: question.questionType,
      currentThinkingPath: question.thinkingPath,
      currentKeyPoints: question.keyPoints || [],
      currentAnswer: question.answer,
      sourceAnswer: question.sourceAnswer || question.answer,
      relatedQuestions: question.relatedQuestions || []
    }),
    json: true
  });
  const parsed = parseJsonResponse(content);
  const thinkingPath = Array.isArray(parsed.thinkingPath) ? parsed.thinkingPath.slice(0, 6) : question.thinkingPath;
  const keyPoints = Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0, 8) : question.keyPoints || [];
  return {
    answer: String(parsed.answer || question.answer || ""),
    thinkingPath,
    keyPoints,
    followUps: Array.isArray(parsed.followUps) ? parsed.followUps : question.followUps,
    reviewStatus: ["pass", "needs-revision", "source-check-required"].includes(parsed.reviewStatus) ? parsed.reviewStatus : "needs-revision",
    reviewIssues: Array.isArray(parsed.reviewIssues) ? parsed.reviewIssues : [],
    answerOrigin: "ai"
  };
}
