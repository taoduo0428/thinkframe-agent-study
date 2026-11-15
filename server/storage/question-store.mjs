import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = process.env.THINKFRAME_DATA_DIR ? path.resolve(process.env.THINKFRAME_DATA_DIR) : path.join(ROOT, "data");
const PRIVATE_DIR = process.env.THINKFRAME_PRIVATE_DIR ? path.resolve(process.env.THINKFRAME_PRIVATE_DIR) : path.join(ROOT, ".data");
const QUESTIONS_FILE = path.join(DATA_DIR, "questions.json");
const SETTINGS_FILE = path.join(PRIVATE_DIR, "settings.json");
let writeQueue = Promise.resolve();
let questionCache = null;
let questionCacheStamp = "";

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}
async function atomicJsonWrite(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await rename(temp, file);
  if (file === QUESTIONS_FILE) {
    questionCache = value;
    const info = await stat(file);
    questionCacheStamp = info.mtimeMs + ":" + info.size;
  }
}
async function readQuestions() {
  let info;
  try { info = await stat(QUESTIONS_FILE); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    questionCache = [];
    questionCacheStamp = "missing";
    return questionCache;
  }
  const stamp = info.mtimeMs + ":" + info.size;
  if (questionCache && questionCacheStamp === stamp) return questionCache;
  const parsed = JSON.parse(await readFile(QUESTIONS_FILE, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("题库文件格式不正确：根节点必须是数组。");
  questionCache = parsed;
  questionCacheStamp = stamp;
  return questionCache;
}
function serializeWrite(task) {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => {});
  return next;
}
function normalizeTitle(value) {
  return String(value || "").toLocaleLowerCase().replace(/[\s，。！？?！、：:；;（）()\[\]{}"'“”‘’]/g, "");
}

export async function listQuestions(filters = {}) {
  const all = await readQuestions();
  const search = String(filters.search || "").trim().toLocaleLowerCase();
  const category = String(filters.category || "");
  const status = String(filters.status || "");
  const type = String(filters.type || "");
  const limit = Math.min(500, Math.max(1, Number(filters.limit) || 500));
  return all.filter((item) => {
    if (category && category !== "全部" && item.category !== category) return false;
    if (status && status !== "all" && item.status !== status) return false;
    if (type && type !== "all" && item.questionType !== type) return false;
    if (search) {
      const haystack = [item.title, item.question, item.category, ...(item.tags || [])].join(" ").toLocaleLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  }).slice(0, limit);
}
export async function getQuestion(id) {
  const all = await readQuestions();
  return all.find((item) => item.id === id) || null;
}
export async function addQuestions(items) {
  return serializeWrite(async () => {
    const all = await readQuestions();
    const existing = new Set(all.map((item) => normalizeTitle(item.title)));
    const added = [];
    for (const raw of items) {
      const title = String(raw.title || raw.question || "").trim();
      if (!title) continue;
      const key = normalizeTitle(title);
      if (existing.has(key)) continue;
      const now = new Date().toISOString();
      const item = {
        id: raw.id || randomUUID(), title, question: String(raw.question || title),
        category: raw.category || "Agent 基础与推理机制",
        sourceSection: raw.sourceSection || "自定义", sourcePage: raw.sourcePage || null,
        questionType: raw.questionType || "concept", difficulty: raw.difficulty || "中等",
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        keyPoints: Array.isArray(raw.keyPoints) ? raw.keyPoints : [],
        thinkingPath: Array.isArray(raw.thinkingPath) ? raw.thinkingPath : [],
        answer: String(raw.answer || "尚未补充完整答案。"),
        answerOrigin: raw.answerOrigin || "draft", sourceAnswer: String(raw.sourceAnswer || ""),
        followUps: Array.isArray(raw.followUps) ? raw.followUps : [],
        prerequisites: Array.isArray(raw.prerequisites) ? raw.prerequisites : [],
        relatedQuestions: Array.isArray(raw.relatedQuestions) ? raw.relatedQuestions : [],
        starred: Boolean(raw.starred), notes: String(raw.notes || "").slice(0, 5000),
        reviewHistory: Array.isArray(raw.reviewHistory) ? raw.reviewHistory : [],
        status: raw.status || "new", reviewCount: Number(raw.reviewCount) || 0,
        lastReviewedAt: raw.lastReviewedAt || null, createdAt: raw.createdAt || now, updatedAt: now
      };
      all.push(item); added.push(item); existing.add(key);
    }
    await atomicJsonWrite(QUESTIONS_FILE, all);
    return { added, skipped: items.length - added.length, total: all.length };
  });
}
export async function updateQuestion(id, patch) {
  return serializeWrite(async () => {
    const all = await readQuestions();
    const index = all.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const safe = { ...patch };
    delete safe.id; delete safe.createdAt; delete safe.sourceAnswer;
    all[index] = { ...all[index], ...safe, updatedAt: new Date().toISOString() };
    await atomicJsonWrite(QUESTIONS_FILE, all);
    return all[index];
  });
}
export async function recordQuestionReview(id, options = {}) {
  return serializeWrite(async () => {
    const all = await readQuestions();
    const index = all.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const now = new Date();
    const date = localDateKey(now);
    const history = Array.isArray(all[index].reviewHistory) ? [...all[index].reviewHistory] : [];
    history.push({ at: now.toISOString(), date, action: options.mastered === true ? "mastered" : "review" });
    if (history.length > 1000) history.splice(0, history.length - 1000);
    const previous = all[index];
    all[index] = {
      ...previous,
      reviewHistory: history,
      reviewCount: (Number(previous.reviewCount) || 0) + 1,
      lastReviewedAt: now.toISOString(),
      status: options.mastered === true ? "mastered" : (previous.status === "new" ? "learning" : previous.status),
      updatedAt: now.toISOString()
    };
    await atomicJsonWrite(QUESTIONS_FILE, all);
    return all[index];
  });
}

export async function deleteQuestion(id) {
  return serializeWrite(async () => {
    const all = await readQuestions();
    const next = all.filter((item) => item.id !== id);
    if (next.length === all.length) return false;
    await atomicJsonWrite(QUESTIONS_FILE, next);
    return true;
  });
}
function localDateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function calculateStats(all) {
  const categories = {};
  const activity = new Map();
  let mastered = 0;
  let learning = 0;
  let needsReview = 0;
  for (const item of all) {
    categories[item.category] = (categories[item.category] || 0) + 1;
    if (item.status === "mastered") mastered += 1;
    if (item.status === "learning") learning += 1;
    if (item.status !== "mastered") needsReview += 1;
    for (const event of Array.isArray(item.reviewHistory) ? item.reviewHistory : []) {
      if (event && /^\d{4}-\d{2}-\d{2}$/.test(String(event.date || ""))) {
        activity.set(event.date, (activity.get(event.date) || 0) + 1);
      }
    }
  }
  const today = new Date();
  const todayKey = localDateKey(today);
  const dailyActivity = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (13 - index));
    const key = localDateKey(date);
    return { date: key, count: activity.get(key) || 0 };
  });
  const totalReviews = [...activity.values()].reduce((sum, count) => sum + count, 0);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  let cursor = activity.has(todayKey) ? today : yesterday;
  let streakDays = 0;
  while (activity.has(localDateKey(cursor))) {
    streakDays += 1;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  }
  return {
    total: all.length, mastered, learning, new: all.length - mastered - learning,
    needsReview, completion: all.length ? Math.round((mastered / all.length) * 100) : 0,
    categories, totalReviews, todayReviewed: activity.get(todayKey) || 0, streakDays, dailyActivity
  };
}
export async function getStats() {
  return calculateStats(await readQuestions());
}
export async function getWorkspaceSnapshot({ limit = 500 } = {}) {
  const all = await readQuestions();
  return {
    questions: all.slice(0, Math.min(500, Math.max(1, Number(limit) || 500))),
    stats: calculateStats(all)
  };
}
function clampTemperature(value, fallback = 0.3) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1.5, number)) : fallback;
}

function normalizeProvider(raw = {}, previous = {}) {
  let baseUrl = String(raw.baseUrl || previous.baseUrl || "").trim();
  while (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
  return {
    id: String(raw.id || previous.id || randomUUID()),
    name: String(raw.name || previous.name || "API 连接").trim().slice(0, 80),
    enabled: raw.enabled === undefined ? (previous.enabled !== false) : raw.enabled !== false,
    baseUrl,
    protocol: raw.protocol === "responses" || (previous.protocol === "responses" && raw.protocol === undefined)
      ? "responses" : "chat-completions",
    authMode: ["bearer", "x-api-key", "api-key"].includes(raw.authMode)
      ? raw.authMode : (previous.authMode || "bearer"),
    model: String(raw.model ?? previous.model ?? "").trim().slice(0, 200),
    apiKey: String(raw.apiKey ?? previous.apiKey ?? "").trim(),
    temperature: clampTemperature(raw.temperature ?? previous.temperature, previous.temperature ?? 0.3),
    createdAt: raw.createdAt || previous.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function loadPrivateSettings() {
  const raw = await readJson(SETTINGS_FILE, {});
  if (Array.isArray(raw.providers)) {
    const providers = raw.providers.map((item) => normalizeProvider(item, item));
    const requestedActive = providers.find((item) => item.id === raw.activeProviderId && item.enabled !== false);
    const activeProviderId = requestedActive?.id || providers.find((item) => item.enabled !== false)?.id || null;
    return { ...raw, providers, activeProviderId };
  }

  // One-time migration from the previous single-API settings format.
  const hasLegacyConnection = Boolean(raw.baseUrl || raw.model || raw.apiKey);
  const providers = hasLegacyConnection
    ? [normalizeProvider({
        id: "legacy-default",
        name: raw.name || "原有 API 连接",
        baseUrl: raw.baseUrl || "https://api.openai.com/v1",
        model: raw.model || "",
        apiKey: raw.apiKey || "",
        protocol: raw.protocol || "chat-completions",
        authMode: raw.authMode || "bearer",
        temperature: raw.temperature
      })]
    : [];
  const migrated = {
    providers,
    activeProviderId: providers[0]?.id || null
  };
  if (hasLegacyConnection) await atomicJsonWrite(SETTINGS_FILE, migrated);
  return migrated;
}

function safeProvider(provider, activeProviderId) {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    protocol: provider.protocol,
    authMode: provider.authMode,
    model: provider.model,
    temperature: provider.temperature,
    hasApiKey: Boolean(provider.apiKey),
    enabled: provider.enabled !== false,
    active: provider.id === activeProviderId
  };
}

export async function getPrivateSettings() {
  const settings = await loadPrivateSettings();
  const active = settings.providers.find((item) => item.id === settings.activeProviderId && item.enabled !== false) || null;
  return {
    ...settings,
    ...(active || {
      baseUrl: "https://api.openai.com/v1",
      model: "",
      apiKey: "",
      protocol: "chat-completions",
      authMode: "bearer",
      temperature: 0.3
    })
  };
}

export async function getProviderSettings(id) {
  const settings = await loadPrivateSettings();
  return settings.providers.find((item) => item.id === id) || null;
}

export async function getSettings() {
  const settings = await loadPrivateSettings();
  const active = settings.providers.find((item) => item.id === settings.activeProviderId && item.enabled !== false) || null;
  const providers = settings.providers.map((item) => safeProvider(item, settings.activeProviderId));
  return {
    providers,
    activeProviderId: settings.activeProviderId,
    activeProvider: active ? safeProvider(active, settings.activeProviderId) : null,
    baseUrl: active?.baseUrl || "https://api.openai.com/v1",
    model: active?.model || "",
    protocol: active?.protocol || "chat-completions",
    temperature: active?.temperature ?? 0.3,
    hasApiKey: Boolean(active?.apiKey),
    providerCount: providers.length
  };
}

export async function saveProvider(input = {}, id = null) {
  return serializeWrite(async () => {
    const current = await loadPrivateSettings();
    const existing = id ? current.providers.find((item) => item.id === id) : null;
    if (id && !existing) throw new Error("找不到要编辑的 API 连接。");
    const nextProvider = normalizeProvider({
      ...input,
      id: existing?.id || input.id || randomUUID(),
      apiKey: input.clearApiKey ? "" : (String(input.apiKey || "").trim() || existing?.apiKey || ""),
      createdAt: existing?.createdAt
    }, existing || {});
    if (!nextProvider.name || !nextProvider.baseUrl) throw new Error("请填写连接名称和 API Base URL。");
    const providers = existing
      ? current.providers.map((item) => item.id === existing.id ? nextProvider : item)
      : [...current.providers, nextProvider];
    const preferredActiveId = input.activate === true ? nextProvider.id : current.activeProviderId;
    const activeProviderId = providers.find((item) => item.id === preferredActiveId && item.enabled !== false)?.id
      || providers.find((item) => item.enabled !== false)?.id || null;
    await atomicJsonWrite(SETTINGS_FILE, { providers, activeProviderId });
    return { ...(await getSettings()), savedProviderId: nextProvider.id };
  });
}

export async function setActiveProvider(id) {
  return serializeWrite(async () => {
    const current = await loadPrivateSettings();
    const target = current.providers.find((item) => item.id === id);
    if (!target) throw new Error("指定的 API 连接不存在。");
    if (target.enabled === false) throw new Error("这个 API 连接已停用，请先启用。");
    await atomicJsonWrite(SETTINGS_FILE, { providers: current.providers, activeProviderId: id });
    return getSettings();
  });
}

export async function setProviderEnabled(id, enabled) {
  return serializeWrite(async () => {
    const current = await loadPrivateSettings();
    const target = current.providers.find((item) => item.id === id);
    if (!target) throw new Error("指定的 API 连接不存在。");
    const providers = current.providers.map((item) => item.id === id
      ? { ...item, enabled: Boolean(enabled), updatedAt: new Date().toISOString() }
      : item);
    let activeProviderId = current.activeProviderId;
    if (!enabled && activeProviderId === id) {
      activeProviderId = providers.find((item) => item.enabled !== false)?.id || null;
    } else if (enabled && !activeProviderId) {
      activeProviderId = id;
    }
    await atomicJsonWrite(SETTINGS_FILE, { providers, activeProviderId });
    return getSettings();
  });
}

export async function deleteProvider(id) {
  return serializeWrite(async () => {
    const current = await loadPrivateSettings();
    const providers = current.providers.filter((item) => item.id !== id);
    if (providers.length === current.providers.length) throw new Error("指定的 API 连接不存在。");
    const activeProviderId = current.activeProviderId === id
      ? (providers.find((item) => item.enabled !== false)?.id || null)
      : current.activeProviderId;
    await atomicJsonWrite(SETTINGS_FILE, { providers, activeProviderId });
    return getSettings();
  });
}

export async function saveSettings(input = {}) {
  const settings = await loadPrivateSettings();
  const active = settings.providers.find((item) => item.id === settings.activeProviderId);
  return saveProvider(input, active?.id || null);
}
export const storagePaths = { ROOT, DATA_DIR, PRIVATE_DIR, QUESTIONS_FILE };
