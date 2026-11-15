import test from "node:test";
import assert from "node:assert/strict";
import { splitAnswerIntoPoints } from "../public/answer-format.js";

test("removes a redundant full-answer heading and preserves paragraph order", () => {
  const points = splitAnswerIntoPoints("## 完整答案\n\n第一段原文。\n\n第二段原文。");
  assert.deepEqual(points, [
    { heading: "", content: "第一段原文。" },
    { heading: "", content: "第二段原文。" }
  ]);
});

test("keeps source headings and groups their following explanation and list", () => {
  const points = splitAnswerIntoPoints([
    "**核心结论**",
    "",
    "先给出结论。",
    "",
    "**1. 普通 LLM 应用：以文本生成为主**",
    "",
    "- **基本流程**：输入 prompt 后生成文本。",
    "- **能力边界**：没有工具时不能执行外部操作。",
    "",
    "**2. Agent：以完成目标为中心**",
    "",
    "Agent 会根据结果继续调整。"
  ].join("\n"));
  assert.deepEqual(points, [
    { heading: "核心结论", content: "先给出结论。" },
    { heading: "1. 普通 LLM 应用：以文本生成为主", content: "- **基本流程**：输入 prompt 后生成文本。\n- **能力边界**：没有工具时不能执行外部操作。" },
    { heading: "2. Agent：以完成目标为中心", content: "Agent 会根据结果继续调整。" }
  ]);
});

test("supports empty and unheaded content", () => {
  assert.deepEqual(splitAnswerIntoPoints(""), []);
  assert.deepEqual(splitAnswerIntoPoints("原文第一段。\n\n原文第二段。"), [
    { heading: "", content: "原文第一段。" },
    { heading: "", content: "原文第二段。" }
  ]);
});
