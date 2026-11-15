import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listQuestions } from "../storage/question-store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX_FILE = path.join(ROOT, "data", "knowledge_chunks.jsonl");
let indexPromise;
let preparedSearchIndex = null;
let preparedSearchSignature = "";

function tokenize(input) {
  const text = String(input || "").toLocaleLowerCase();
  const tokens = [];
  const latin = text.match(/[a-z0-9][a-z0-9_+.#-]*/g) || [];
  tokens.push(...latin.filter((token) => token.length > 1));
  const chineseRuns = text.match(/[\u3400-\u9fff]+/g) || [];
  for (const run of chineseRuns) {
    if (run.length === 1) tokens.push(run);
    for (let size = 2; size <= Math.min(3, run.length); size++) {
      for (let i = 0; i <= run.length - size; i++) tokens.push(run.slice(i, i + size));
    }
  }
  return tokens;
}

async function loadIndex() {
  if (!indexPromise) {
    indexPromise = readFile(INDEX_FILE, "utf8").then((raw) => raw.split(/\r?\n/).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter((item) => item && typeof item.text === "string")).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  }
  return indexPromise;
}

function buildSearchIndex(documents) {
  const docFrequency = new Map();
  let totalLength = 0;
  const prepared = documents.map((doc) => {
    const terms = tokenize(doc.text);
    const termFrequency = new Map();
    for (const term of terms) termFrequency.set(term, (termFrequency.get(term) || 0) + 1);
    for (const term of termFrequency.keys()) docFrequency.set(term, (docFrequency.get(term) || 0) + 1);
    totalLength += terms.length;
    return {
      ...doc,
      termFrequency,
      termCount: terms.length,
      compactText: String(doc.text || "").toLocaleLowerCase().replace(/\s+/g, ""),
      compactTitle: String(doc.title || "").toLocaleLowerCase().replace(/\s+/g, "")
    };
  });
  return {
    documents: prepared,
    docFrequency,
    averageLength: totalLength / prepared.length || 1
  };
}

function scoreDocuments(query, index) {
  const queryTerms = [...new Set(tokenize(query))];
  const documents = index.documents;
  if (!queryTerms.length || !documents.length) return [];
  const queryCompact = String(query).toLocaleLowerCase().replace(/\s+/g, "");
  const scored = [];
  for (const doc of documents) {
    let score = 0;
    for (const term of queryTerms) {
      const frequency = doc.termFrequency.get(term) || 0;
      if (!frequency) continue;
      const df = index.docFrequency.get(term) || 0;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      const denominator = frequency + 1.2 * (0.25 + 0.75 * doc.termCount / index.averageLength);
      score += idf * (frequency * 2.2) / denominator;
    }
    if (queryCompact.length >= 3 && doc.compactText.includes(queryCompact)) score += 3.5;
    if (doc.sourceKind === "question") {
      if (doc.compactTitle && queryCompact.includes(doc.compactTitle)) score += 5;
      if (doc.compactTitle && doc.compactTitle.includes(queryCompact)) score += 4;
    }
    if (score > 0) {
      const { termFrequency, termCount, compactText, compactTitle, ...source } = doc;
      scored.push({ ...source, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score);
}

function toSource(doc, index) {
  let location = "题库记录";
  if (doc.pdfPage) {
    location = "PDF 第 " + doc.pdfPage + " 页";
    if (doc.printedPage) location += "（资料页 " + doc.printedPage + "）";
  } else if (doc.sourcePage) {
    location = "PDF 第 " + doc.sourcePage + " 页";
  }
  return {
    sourceId: "S" + (index + 1),
    title: doc.title || doc.pageTitle || doc.section || "知识库片段",
    section: doc.section || "未分类",
    location,
    pdfPage: doc.pdfPage || doc.sourcePage || null,
    printedPage: doc.printedPage || null,
    excerpt: String(doc.text || "").slice(0, 1800),
    sourceKind: doc.sourceKind || "pdf"
  };
}

export async function retrieveKnowledge(query, options = {}) {
  const limit = Math.min(8, Math.max(1, Number(options.limit) || 6));
  const [chunks, questions] = await Promise.all([
    loadIndex(),
    listQuestions({ limit: 500 })
  ]);

  const pdfDocs = chunks.map((item) => ({
    ...item,
    sourceKind: "pdf",
    title: item.pageTitle || item.section || "知识库片段",
    text: [item.pageTitle, item.section, item.text].filter(Boolean).join("\n")
  }));
  const questionDocs = questions.filter((item) => item.sourceAnswer || item.answer).map((item) => ({
    id: item.id,
    sourceKind: "question",
    title: item.title,
    section: item.sourceSection || item.category,
    pdfPage: item.sourcePage || null,
    text: [item.title, item.question, item.sourceAnswer || item.answer, ...(item.tags || [])].filter(Boolean).join("\n"),
    question: item
  }));
  const signature = createHash("sha256").update(questions.map((item) => [
    item.id, item.title, item.question, item.category, item.sourceSection, item.sourcePage,
    item.sourceAnswer || item.answer, ...(item.tags || [])
  ].join("\u001f")).join("\u001e")).digest("hex");
  if (!preparedSearchIndex || signature !== preparedSearchSignature) {
    preparedSearchIndex = buildSearchIndex([...questionDocs, ...pdfDocs]);
    preparedSearchSignature = signature;
  } else {
    const latestQuestions = new Map(questions.map((item) => [item.id, item]));
    for (const doc of preparedSearchIndex.documents) {
      if (doc.sourceKind === "question") doc.question = latestQuestions.get(doc.id) || doc.question;
    }
  }

  const ranked = scoreDocuments(query, preparedSearchIndex).slice(0, limit);
  const sources = ranked.map(toSource);
  const matchedQuestions = ranked.filter((item) => item.question).map((item) => item.question);
  const context = ranked.map((item, index) => {
    const page = item.pdfPage ? "PDF 第 " + item.pdfPage + " 页" : "题库记录";
    return "[" + sources[index].sourceId + "] " + item.title + "｜" + (item.section || "未分类") + "｜" + page + "\n" + String(item.text || "").slice(0, 1800);
  }).join("\n\n---\n\n");

  return {
    sources,
    matchedQuestions,
    context,
    indexReady: chunks.length > 0,
    retrievedCount: ranked.length
  };
}

export async function getKnowledgeIndexStatus() {
  const chunks = await loadIndex();
  return { ready: chunks.length > 0, chunks: chunks.length };
}
