import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "data", "questions.json");
const rawQuestions = await readFile(file);
const dataFileSha256 = createHash("sha256").update(rawQuestions).digest("hex");
const questions = JSON.parse(rawQuestions.toString("utf8"));
const args = new Set(process.argv.slice(2));
const categoryArg = process.argv.find(arg => arg.startsWith("--category="))?.slice("--category=".length) || "";
const inspectTitleArg = process.argv.find(arg => arg.startsWith("--inspect-title="))?.slice("--inspect-title=".length) || "";
const queueMode = args.has("--queue");
const limitArg = Number(process.argv.find(arg => arg.startsWith("--limit="))?.slice("--limit=".length) || 0);

if (!Array.isArray(questions)) throw new Error("data/questions.json must contain an array.");

const errors = [];
const warnings = [];
const reviewQueue = [];
const categories = new Map();
const types = new Map();
const reviews = new Map();
const pathSignatures = new Map();
const ids = new Set();
const titles = new Set();
const metrics = {
  total: questions.length,
  withSourceAnswer: 0,
  withSourceMetadata: 0,
  withAnswer: 0,
  withThinkingPath: 0,
  pathSteps: 0,
  shortestPath: Infinity,
  longestPath: 0,
  withKeyPoints: 0
};

const stopWords = new Set([
  "什么", "如何", "怎么", "一个", "哪些", "介绍", "一下", "核心", "区别",
  "实现", "设计", "问题", "场景", "方式", "特点", "分析", "需要", "应该",
  "是否", "进行", "中的", "可以", "怎样", "为什么", "时候", "以及", "这个",
  "那个", "自己", "一般", "通常", "具体", "简要", "说一说", "了解", "agent",
  "agents", "llm", "llms", "system", "systems"
]);

function clean(value) {
  return String(value ?? "").trim();
}

function tokens(value) {
  const text = clean(value).toLowerCase().replace(/具体怎么实现|具体如何实现|怎么实现|如何实现|怎么做|有什么特点|有什么区别|是什么|为什么|怎么理解|介绍一下|说一说/g, " ");
  const result = new Set(text.match(/[a-z][a-z0-9_+#.-]{1,}/g) || []);
  const runs = text.match(/[\u3400-\u9fff]{2,}/g) || [];
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i += 1) result.add(run.slice(i, i + 2));
    for (let i = 0; i < run.length - 2; i += 1) result.add(run.slice(i, i + 3));
  }
  return new Set([...result].filter(token => !stopWords.has(token)));
}

function addCount(map, value) {
  const key = clean(value) || "(missing)";
  map.set(key, (map.get(key) || 0) + 1);
}

for (const [index, question] of questions.entries()) {
  const label = clean(question.title) || `record #${index + 1}`;
  const prefix = `[${label}]`;
  const reviewStatus = clean(question.reviewStatus) || "missing";

  if (!clean(question.id)) errors.push(`${prefix} missing id`);
  else if (ids.has(question.id)) errors.push(`${prefix} duplicate id: ${question.id}`);
  else ids.add(question.id);

  const normalizedTitle = label.toLowerCase().replace(/[\s，。！？?！、：:；;（）()\[\]{}"'“”‘’]/g, "");
  if (titles.has(normalizedTitle)) warnings.push(`${prefix} duplicate/near-duplicate title`);
  else titles.add(normalizedTitle);

  if (!clean(question.title) || !clean(question.question)) errors.push(`${prefix} missing title or question text`);
  if (!clean(question.category)) errors.push(`${prefix} missing category`);
  if (!clean(question.questionType)) errors.push(`${prefix} missing questionType`);
  if (!clean(question.answer)) errors.push(`${prefix} missing answer`);
  else metrics.withAnswer += 1;

  if (clean(question.sourceAnswer)) metrics.withSourceAnswer += 1;
  if (clean(question.sourceSection) || question.sourcePage) metrics.withSourceMetadata += 1;
  if (Array.isArray(question.keyPoints) && question.keyPoints.length) metrics.withKeyPoints += 1;

  const path = Array.isArray(question.thinkingPath) ? question.thinkingPath : [];
  if (path.length) metrics.withThinkingPath += 1;
  metrics.pathSteps += path.length;
  metrics.shortestPath = Math.min(metrics.shortestPath, path.length);
  metrics.longestPath = Math.max(metrics.longestPath, path.length);

  if (path.length < 2) warnings.push(`${prefix} thinkingPath has only ${path.length} step(s)`);
  if (path.length > 6) warnings.push(`${prefix} thinkingPath exceeds 6 steps (${path.length})`);

  const incompleteSteps = path.filter(step => !clean(step?.heading) || !clean(step?.detail));
  if (incompleteSteps.length) warnings.push(`${prefix} ${incompleteSteps.length} thinking-path step(s) lack a heading or explanation`);

  const answerOrigin = clean(question.answerOrigin);
  if (clean(question.sourceAnswer) && !answerOrigin) warnings.push(`${prefix} sourceAnswer exists but answerOrigin is missing`);
  if (clean(question.sourceAnswer) && !clean(question.sourceSection) && !question.sourcePage) {
    warnings.push(`${prefix} sourceAnswer exists without source section/page metadata`);
  }
  if (/尚未补充完整答案|当前尚未连接模型 API|待补充草稿/.test(clean(question.answer))) {
    warnings.push(`${prefix} answer is still a draft placeholder`);
  }

  if (question.reviewStatus) addCount(reviews, question.reviewStatus);
  else warnings.push(`${prefix} missing reviewStatus`);
  addCount(categories, question.category);
  addCount(types, question.questionType);

  const signature = path.map(step => `${clean(step?.heading)}::${clean(step?.detail)}`).join("|");
  if (signature) {
    const existing = pathSignatures.get(signature) || [];
    existing.push(label);
    pathSignatures.set(signature, existing);
  }

  const titleTokens = tokens(question.title + " " + question.question);
  const pathTokens = tokens(path.map(step => `${step?.heading || ""} ${step?.detail || ""}`).join(" "));
  const overlaps = [...titleTokens].filter(token => pathTokens.has(token));
  if (path.length && titleTokens.size && !overlaps.length) {
    warnings.push(`${prefix} thinkingPath has no obvious title-term overlap; inspect manually`);
  }

  if (clean(question.sourceAnswer) && path.length) {
    const sourceTokens = tokens(question.sourceAnswer);
    const supportedSteps = path.filter(step => {
      const stepTokens = tokens(step?.heading || "");
      return [...stepTokens].some(token => sourceTokens.has(token));
    }).length;
    if (supportedSteps === 0) warnings.push(`${prefix} path headings have no obvious overlap with sourceAnswer; inspect manually`);
  }

  if (reviewStatus !== "pass") {
    reviewQueue.push({
      id: question.id,
      title: label,
      category: question.category,
      questionType: question.questionType,
      reviewStatus,
      answerOrigin: question.answerOrigin || "",
      reviewIssues: question.reviewIssues || [],
      sourceSection: question.sourceSection || "",
      sourcePage: question.sourcePage || null,
      question: clean(question.question).slice(0, 500),
      sourceAnswer: clean(question.sourceAnswer).slice(0, 850),
      answer: clean(question.answer).slice(0, 850),
      thinkingPath: path.map(step => ({
        heading: clean(step?.heading),
        detail: clean(step?.detail).slice(0, 180)
      }))
    });
  }
}

for (const [signature, names] of pathSignatures) {
  if (names.length > 1) warnings.push(`identical full thinkingPath reused by ${names.length} questions: ${names.slice(0, 5).join(" / ")}`);
}

metrics.shortestPath = Number.isFinite(metrics.shortestPath) ? metrics.shortestPath : 0;
const offsetArg = Math.max(0, Number(process.argv.find(arg => arg.startsWith("--offset="))?.slice("--offset=".length) || 0));
const duplicatePathGroups = [...pathSignatures.values()]
  .filter(names => names.length > 1)
  .map(names => ({ count: names.length, titles: names }));
const duplicateGroupArg = Number(process.argv.find(arg => arg.startsWith("--group="))?.slice("--group=".length) || 0);
const duplicatePathRecords = duplicatePathGroups
  .map((group, index) => ({
    group: index + 1,
    count: group.count,
    records: group.titles.map(title => {
      const question = questions.find(item => item.title === title);
      return {
        id: question.id,
        title: question.title,
        category: question.category,
        questionType: question.questionType,
        reviewStatus: question.reviewStatus || "missing",
        sourceSection: question.sourceSection || "",
        sourcePage: question.sourcePage || null,
        sourceAnswer: clean(question.sourceAnswer).slice(0, 1100),
        answer: clean(question.answer).slice(0, 1500),
        thinkingPath: (Array.isArray(question.thinkingPath) ? question.thinkingPath : []).map(step => ({
          heading: clean(step?.heading),
          detail: clean(step?.detail).slice(0, 180)
        }))
      };
    })
  }))
  .filter(group => !duplicateGroupArg || group.group === duplicateGroupArg);
const inspectQuestion = inspectTitleArg ? questions.find(item => item.title === inspectTitleArg) : null;
const inspectRecord = inspectQuestion ? {
  id: inspectQuestion.id,
  title: inspectQuestion.title,
  category: inspectQuestion.category,
  questionType: inspectQuestion.questionType,
  reviewStatus: inspectQuestion.reviewStatus || "missing",
  sourceSection: inspectQuestion.sourceSection || "",
  sourcePage: inspectQuestion.sourcePage || null,
  sourceAnswer: clean(inspectQuestion.sourceAnswer),
  answer: clean(inspectQuestion.answer),
  keyPoints: inspectQuestion.keyPoints || [],
  thinkingPath: inspectQuestion.thinkingPath || []
} : null;
const categoryQueue = reviewQueue.filter(item => !categoryArg || item.category === categoryArg);
const filteredQueue = categoryQueue.slice(offsetArg, limitArg > 0 ? offsetArg + limitArg : undefined);

const report = {
  file: "data/questions.json",
  dataFileSha256,
  total: metrics.total,
  coverage: {
    answer: `${metrics.withAnswer}/${metrics.total}`,
    sourceAnswer: `${metrics.withSourceAnswer}/${metrics.total}`,
    sourceMetadata: `${metrics.withSourceMetadata}/${metrics.total}`,
    thinkingPath: `${metrics.withThinkingPath}/${metrics.total}`,
    keyPoints: `${metrics.withKeyPoints}/${metrics.total}`
  },
  thinkingPath: {
    totalSteps: metrics.pathSteps,
    averageSteps: metrics.total ? Number((metrics.pathSteps / metrics.total).toFixed(2)) : 0,
    minSteps: metrics.shortestPath,
    maxSteps: metrics.longestPath
  },
  categories: Object.fromEntries([...categories].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"))),
  questionTypes: Object.fromEntries([...types].sort((a, b) => a[0].localeCompare(b[0]))),
  reviewStatuses: Object.fromEntries([...reviews].sort((a, b) => a[0].localeCompare(b[0]))),
  errors: errors.length,
  warnings: warnings.length,
  warningExamples: warnings.slice(0, 40),
  reviewQueueCount: reviewQueue.length,
  duplicatePathGroups,
  ...(args.has("--duplicates") ? { duplicatePathRecords } : {}),
  ...(inspectTitleArg ? { inspectRecord } : {}),
  ...(queueMode ? { reviewQueue: filteredQueue } : {})
};

console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
