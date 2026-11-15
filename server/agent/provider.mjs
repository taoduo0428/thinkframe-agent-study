function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "").replace(/\/(chat\/completions|responses|models)$/i, "");
}

function authHeaders(settings, json = true) {
  const headers = json ? { "Content-Type": "application/json" } : {};
  const key = String(settings.apiKey || "");
  if (key) {
    const mode = settings.authMode || "bearer";
    if (mode === "x-api-key") headers["x-api-key"] = key;
    else if (mode === "api-key") headers["api-key"] = key;
    else headers.Authorization = "Bearer " + key;
  }
  return headers;
}

function parseModelList(payload) {
  const candidates = Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload?.models) ? payload.models
      : Array.isArray(payload?.result?.data) ? payload.result.data
        : Array.isArray(payload?.result?.models) ? payload.result.models : [];
  const seen = new Set();
  return candidates.map((item) => {
    if (typeof item === "string") return { id: item, ownedBy: "" };
    return {
      id: String(item?.id || item?.name || item?.model || "").trim(),
      ownedBy: String(item?.owned_by || item?.ownedBy || item?.provider || "").trim()
    };
  }).filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function extractChatContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text || part?.content || "").join("");
  return "";
}

function extractResponsesContent(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

export class OpenAICompatibleProvider {
  constructor(settings = {}) {
    this.baseUrl = normalizeBaseUrl(settings.baseUrl);
    this.apiKey = String(settings.apiKey || "");
    this.model = String(settings.model || "");
    this.temperature = Number(settings.temperature ?? 0.3);
    this.protocol = settings.protocol === "responses" ? "responses" : "chat-completions";
    this.authMode = ["x-api-key", "api-key"].includes(settings.authMode) ? settings.authMode : "bearer";
  }

  get configured() {
    return Boolean(this.baseUrl && this.model && this.apiKey);
  }

  get canDiscoverModels() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  async request(path, options = {}) {
    if (!this.baseUrl) throw new Error("请先填写 API Base URL。");
    const url = new URL(this.baseUrl + path);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("API 地址必须使用 HTTP 或 HTTPS。");
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: { ...authHeaders(this, options.method !== "GET"), ...(options.headers || {}) },
        signal: options.signal || AbortSignal.timeout(30000)
      });
    } catch (error) {
      const code = error?.cause?.code || error?.cause?.cause?.code || "";
      const detail = code ? code + " · " + String(error?.cause?.message || error.message || "") : String(error.message || error);
      throw new Error("无法连接 API：" + detail + "。请检查 ThinkFrame 启动时是否正确使用系统代理，以及 API 服务是否可达。");
    }
    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; }
    catch { payload = { message: raw.slice(0, 1000) }; }
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || response.statusText || "未知错误";
      throw new Error("API 返回 " + response.status + "：" + String(message).slice(0, 500));
    }
    return payload;
  }

  async listModels() {
    if (!this.canDiscoverModels) throw new Error("请先填写 API Base URL 和 API Key。");
    const payload = await this.request("/models", { method: "GET", headers: {} });
    const models = parseModelList(payload);
    if (!models.length) throw new Error("接口已响应，但没有识别到模型列表。你仍可手动输入模型 ID。");
    return models;
  }

  async complete({ system, user, messages, json = true, timeoutMs = 90000 }) {
    if (!this.configured) throw new Error("请先在设置中填写 API Base URL、模型名称和 API Key。");
    const conversation = Array.isArray(messages)
      ? messages
          .filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
          .slice(-12)
          .map((item) => ({ role: item.role, content: item.content.slice(0, 12000) }))
      : [{ role: "user", content: String(user || "") }];
    const endpoint = this.protocol === "responses" ? "/responses" : "/chat/completions";
    const body = this.protocol === "responses"
      ? {
          model: this.model,
          instructions: String(system || ""),
          input: conversation,
          temperature: this.temperature,
          ...(json ? { text: { format: { type: "json_object" } } } : {})
        }
      : {
          model: this.model,
          temperature: this.temperature,
          ...(json ? { response_format: { type: "json_object" } } : {}),
          messages: [{ role: "system", content: String(system || "") }, ...conversation]
        };
    const payload = await this.request(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const content = this.protocol === "responses"
      ? extractResponsesContent(payload)
      : extractChatContent(payload);
    if (!content) throw new Error("模型没有返回有效内容。");
    return String(content);
  }

  async test() {
    const content = await this.complete({
      system: "You are a connection test. Reply with JSON only.",
      user: "Return {\"ok\":true,\"message\":\"connected\"}.",
      json: false,
      timeoutMs: 30000
    });
    return { ok: true, model: this.model, protocol: this.protocol, response: content };
  }
}

function activeSettings(settings = {}) {
  if (Array.isArray(settings.providers)) {
    const active = settings.providers.find((item) => item.id === settings.activeProviderId)
      || settings.providers[0];
    return active || {};
  }
  return settings;
}

export function createProvider(settings = {}) {
  return new OpenAICompatibleProvider(activeSettings(settings));
}

export { parseModelList, normalizeBaseUrl };

export function parseJsonResponse(content) {
  const cleaned = String(content).trim()
    .replace(/^\uFEFF/, "")
    .replace(/^\x60{3}(?:json)?\s*/i, "")
    .replace(/\s*\x60{3}$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("模型输出不是有效 JSON。");
  return JSON.parse(cleaned.slice(start, end + 1));
}
