import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PRIVATE_DIR = process.env.THINKFRAME_PRIVATE_DIR ? path.resolve(process.env.THINKFRAME_PRIVATE_DIR) : path.join(ROOT, ".data");
const FILE = path.join(PRIVATE_DIR, "agent-workspace.json");
let writeQueue = Promise.resolve();

async function readState() {
  try {
    const value = JSON.parse(await readFile(FILE, "utf8"));
    return {
      conversations: Array.isArray(value.conversations) ? value.conversations : [],
      memories: Array.isArray(value.memories) ? value.memories : [],
      tasks: Array.isArray(value.tasks) ? value.tasks : []
    };
  } catch (error) {
    if (error.code === "ENOENT") return { conversations: [], memories: [], tasks: [] };
    throw error;
  }
}
async function writeState(state) {
  await mkdir(path.dirname(FILE), { recursive: true });
  const temp = FILE + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await rename(temp, FILE);
}
function mutate(fn) {
  const next = writeQueue.then(async () => {
    const state = await readState();
    const result = await fn(state);
    await writeState(state);
    return result;
  });
  writeQueue = next.catch(() => {});
  return next;
}
function cleanText(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}
function previewMessage(message) {
  if (!message) return "";
  return cleanText(message.content || message.result?.answer || message.error || "", 180);
}
function publicConversation(item, includeMessages = false) {
  const messages = Array.isArray(item.messages) ? item.messages : [];
  return {
    id: item.id,
    title: item.title,
    contextId: item.contextId || null,
    summary: item.summary || "",
    pinned: Boolean(item.pinned),
    archived: Boolean(item.archived),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    messageCount: messages.length,
    preview: previewMessage(messages[messages.length - 1]),
    ...(includeMessages ? { messages } : {})
  };
}

export async function listConversations({ search = "", archived = false, limit = 100 } = {}) {
  const state = await readState();
  const needle = cleanText(search, 200).toLocaleLowerCase();
  return state.conversations
    .filter((item) => Boolean(item.archived) === Boolean(archived))
    .filter((item) => !needle || [item.title, item.summary, ...(item.messages || []).map(previewMessage)].join(" ").toLocaleLowerCase().includes(needle))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, Math.min(300, Math.max(1, Number(limit) || 100)))
    .map((item) => publicConversation(item));
}
export async function getConversation(id) {
  const state = await readState();
  const item = state.conversations.find((entry) => entry.id === id);
  return item ? publicConversation(item, true) : null;
}
export async function createConversation(input = {}) {
  return mutate((state) => {
    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      title: cleanText(input.title, 100) || "新对话",
      contextId: cleanText(input.contextId, 100) || null,
      summary: "",
      pinned: false,
      archived: false,
      messages: [],
      createdAt: now,
      updatedAt: now
    };
    state.conversations.push(item);
    return publicConversation(item, true);
  });
}
export async function updateConversation(id, patch = {}) {
  return mutate((state) => {
    const item = state.conversations.find((entry) => entry.id === id);
    if (!item) return null;
    if (patch.title !== undefined) item.title = cleanText(patch.title, 100) || item.title;
    if (patch.summary !== undefined) item.summary = cleanText(patch.summary, 3000);
    if (patch.contextId !== undefined) item.contextId = cleanText(patch.contextId, 100) || null;
    if (patch.pinned !== undefined) item.pinned = Boolean(patch.pinned);
    if (patch.archived !== undefined) item.archived = Boolean(patch.archived);
    item.updatedAt = new Date().toISOString();
    return publicConversation(item, true);
  });
}
export async function appendConversationMessage(id, input = {}) {
  return mutate((state) => {
    const item = state.conversations.find((entry) => entry.id === id);
    if (!item) return null;
    const role = ["user", "assistant", "tool"].includes(input.role) ? input.role : "assistant";
    const message = {
      id: randomUUID(),
      role,
      content: cleanText(input.content, 20000),
      ...(input.result && typeof input.result === "object" ? { result: input.result } : {}),
      ...(input.error ? { error: cleanText(input.error, 1000), status: "error" } : {}),
      ...(input.toolName ? { toolName: cleanText(input.toolName, 100) } : {}),
      createdAt: new Date().toISOString()
    };
    item.messages.push(message);
    if (item.messages.length > 1000) item.messages.splice(0, item.messages.length - 1000);
    const firstUser = item.messages.find((entry) => entry.role === "user");
    if (item.title === "新对话" && firstUser) item.title = cleanText(firstUser.content, 36) || "新对话";
    item.updatedAt = message.createdAt;
    return message;
  });
}
export async function deleteConversation(id) {
  return mutate((state) => {
    const length = state.conversations.length;
    state.conversations = state.conversations.filter((item) => item.id !== id);
    return state.conversations.length !== length;
  });
}

export async function listMemories() {
  const state = await readState();
  return state.memories.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
export async function createMemory(input = {}) {
  const content = cleanText(input.content, 1200);
  if (!content) throw new Error("记忆内容不能为空。");
  return mutate((state) => {
    const duplicate = state.memories.find((item) => item.content.toLocaleLowerCase() === content.toLocaleLowerCase());
    if (duplicate) {
      duplicate.updatedAt = new Date().toISOString();
      return duplicate;
    }
    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      content,
      category: cleanText(input.category, 40) || "用户偏好",
      source: cleanText(input.source, 100) || "用户主动保存",
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now
    };
    state.memories.push(item);
    return item;
  });
}
export async function updateMemory(id, patch = {}) {
  return mutate((state) => {
    const item = state.memories.find((entry) => entry.id === id);
    if (!item) return null;
    if (patch.content !== undefined) item.content = cleanText(patch.content, 1200);
    if (patch.category !== undefined) item.category = cleanText(patch.category, 40) || item.category;
    if (patch.enabled !== undefined) item.enabled = Boolean(patch.enabled);
    item.updatedAt = new Date().toISOString();
    return item;
  });
}
export async function deleteMemory(id) {
  return mutate((state) => {
    const length = state.memories.length;
    state.memories = state.memories.filter((item) => item.id !== id);
    return state.memories.length !== length;
  });
}

export async function listTasks({ status = "", limit = 100 } = {}) {
  const state = await readState();
  return state.tasks
    .filter((item) => !status || item.status === status)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, Math.min(300, Math.max(1, Number(limit) || 100)));
}
export async function createTask(input = {}) {
  const title = cleanText(input.title, 180);
  if (!title) throw new Error("任务标题不能为空。");
  return mutate((state) => {
    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      title,
      description: cleanText(input.description, 3000),
      status: "todo",
      priority: ["low", "normal", "high"].includes(input.priority) ? input.priority : "normal",
      steps: Array.isArray(input.steps) ? input.steps.slice(0, 30).map((step) => ({ title: cleanText(step.title || step, 180), done: false })) : [],
      sourceConversationId: cleanText(input.sourceConversationId, 100) || null,
      createdAt: now,
      updatedAt: now
    };
    state.tasks.push(item);
    return item;
  });
}
export async function updateTask(id, patch = {}) {
  return mutate((state) => {
    const item = state.tasks.find((entry) => entry.id === id);
    if (!item) return null;
    if (patch.title !== undefined) item.title = cleanText(patch.title, 180) || item.title;
    if (patch.description !== undefined) item.description = cleanText(patch.description, 3000);
    if (patch.status !== undefined && ["todo", "doing", "done", "blocked"].includes(patch.status)) item.status = patch.status;
    if (patch.priority !== undefined && ["low", "normal", "high"].includes(patch.priority)) item.priority = patch.priority;
    if (patch.steps !== undefined && Array.isArray(patch.steps)) item.steps = patch.steps.slice(0, 30).map((step) => ({ title: cleanText(step.title || step, 180), done: Boolean(step.done) }));
    item.updatedAt = new Date().toISOString();
    return item;
  });
}
export async function deleteTask(id) {
  return mutate((state) => {
    const length = state.tasks.length;
    state.tasks = state.tasks.filter((item) => item.id !== id);
    return state.tasks.length !== length;
  });
}
