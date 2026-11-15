import { timingSafeEqual } from "node:crypto";

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left), "utf8");
  const b = Buffer.from(String(right), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyBasicAuth(header, expectedUsername, expectedPassword) {
  if (!expectedPassword) return false;
  const match = String(header || "").match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return false;

  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  return constantTimeEqual(username, expectedUsername) && constantTimeEqual(password, expectedPassword);
}
