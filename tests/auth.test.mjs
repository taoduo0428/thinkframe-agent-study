import test from "node:test";
import assert from "node:assert/strict";
import { verifyBasicAuth } from "../server/auth.mjs";

const basic = (username, password) => "Basic " + Buffer.from(username + ":" + password).toString("base64");

test("Basic Auth accepts the configured username and password", () => {
  assert.equal(verifyBasicAuth(basic("thinkframe", "long-test-password"), "thinkframe", "long-test-password"), true);
});

test("Basic Auth rejects missing, malformed, and incorrect credentials", () => {
  assert.equal(verifyBasicAuth("", "thinkframe", "long-test-password"), false);
  assert.equal(verifyBasicAuth("Bearer token", "thinkframe", "long-test-password"), false);
  assert.equal(verifyBasicAuth(basic("other", "long-test-password"), "thinkframe", "long-test-password"), false);
  assert.equal(verifyBasicAuth(basic("thinkframe", "wrong-password"), "thinkframe", "long-test-password"), false);
  assert.equal(verifyBasicAuth(basic("thinkframe", "anything"), "thinkframe", ""), false);
});
