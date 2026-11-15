import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || "index.mjs";
const entry = path.resolve(SERVER_DIR, target);

function parseProxyValue(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const mapped = {};
  for (const part of value.split(";")) {
    const match = part.trim().match(/^(http|https)=(.+)$/i);
    if (match) mapped[match[1].toLowerCase()] = match[2].trim();
  }
  const normalize = (item) => {
    if (!item) return null;
    return /^https?:\/\//i.test(item) ? item : "http://" + item;
  };
  const shared = value.includes("=") ? null : value;
  const http = normalize(mapped.http || mapped.https || shared);
  const https = normalize(mapped.https || mapped.http || shared);
  return http || https ? { http, https } : null;
}

function readWindowsSystemProxy() {
  if (process.platform !== "win32") return null;
  const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
  try {
    const enabledOutput = execFileSync("reg.exe", ["query", key, "/v", "ProxyEnable"], {
      encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"]
    });
    if (!/ProxyEnable\s+REG_DWORD\s+0x0*1\b/i.test(enabledOutput)) return null;
    const serverOutput = execFileSync("reg.exe", ["query", key, "/v", "ProxyServer"], {
      encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"]
    });
    const raw = serverOutput.match(/ProxyServer\s+REG_\w+\s+(.+)/i)?.[1]?.trim();
    return parseProxyValue(raw);
  } catch {
    return null;
  }
}

const env = { ...process.env };
const hasProxyEnv = Boolean(
  env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy ||
  env.ALL_PROXY || env.all_proxy
);
const systemProxy = hasProxyEnv ? null : readWindowsSystemProxy();

if (systemProxy) {
  env.HTTP_PROXY ||= systemProxy.http || systemProxy.https;
  env.HTTPS_PROXY ||= systemProxy.https || systemProxy.http;
  env.ALL_PROXY ||= systemProxy.https || systemProxy.http;
  env.NODE_USE_ENV_PROXY = "1";
} else if (hasProxyEnv) {
  env.NODE_USE_ENV_PROXY ||= "1";
}

if (env.NODE_USE_ENV_PROXY === "1" && (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy)) {
  const proxyValue = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  let proxyLabel = "configured proxy";
  try {
    const proxyUrl = new URL(proxyValue);
    proxyLabel = proxyUrl.host;
  } catch {}
  process.stdout.write("[ThinkFrame] Node.js environment proxy enabled (" + proxyLabel + ").\n");

  const child = spawn(process.execPath, [entry], { env, stdio: "inherit", windowsHide: false });
  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));
  const exitCode = await new Promise((resolve) => {
    child.once("error", (error) => {
      process.stderr.write("[ThinkFrame] Unable to start server: " + error.message + "\n");
      resolve(1);
    });
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  process.exitCode = exitCode;
} else {
  await import(pathToFileURL(entry).href);
}
