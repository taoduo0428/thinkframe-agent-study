import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../public/ocean.css", import.meta.url), "utf8");

test("quick Agent drawer receives pointer events above the closing scrim", () => {
  const rootRule = css.match(/#quick-agent-root\s*\{([^}]*)\}/)?.[1] || "";
  const scrimRule = css.match(/\.quick-agent-scrim\s*\{([^}]*)\}/)?.[1] || "";
  const drawerRules = [...css.matchAll(/\.quick-agent-drawer\s*\{([^}]*)\}/g)].map((match) => match[1]);

  assert.match(rootRule, /pointer-events\s*:\s*none/);
  assert.match(scrimRule, /pointer-events\s*:\s*auto/);
  assert.ok(
    drawerRules.some((rule) => /pointer-events\s*:\s*auto/.test(rule)),
    "the drawer must override the root's pointer-events:none so send and close controls remain clickable"
  );
});
