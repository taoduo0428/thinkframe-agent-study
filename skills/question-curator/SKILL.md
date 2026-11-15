---
name: question-curator
description: 将用户提供的面试题整理成 ThinkFrame 统一题目卡片。
---

# Question Curator

## Goal
Turn raw interview questions into clean, traceable, structured question records.

## Rules
- Preserve the original question wording. Only correct obvious spacing or punctuation; do not silently change what is being asked.
- Classify each question into one of the ThinkFrame categories:
  1. Agent 基础与推理机制
  2. 工具调用与能力接入
  3. Memory 与 Context Engineering
  4. RAG 与向量检索
  5. 框架与运行时架构
  6. 系统基础与后端工程
  7. 可靠性、评估与安全
  8. Coding Agent 与 IDE
  9. 综合系统设计与场景题
  10. 开放题与个人观点
- Determine the question type: concept, mechanism, comparison, troubleshooting, system-design, or opinion.
- Add a concise list of what the interviewer is testing.
- Write a separate thinking path for each question. Use the category's shared conceptual framework as a guide, not as a template to copy.
- Tailor each step to the exact wording, scope, and source answer. Similar questions may share a conceptual spine but must not receive identical outlines.
- Keep source text separate from AI-rewritten content.
- If the source does not provide an answer and the model cannot verify it, mark the answer as a draft. Never invent citations, benchmarks, product internals, or personal experience.
- Preserve duplicate questions when their wording or expected depth is meaningfully different. Flag near-duplicates rather than deleting them automatically.

## Required output
Return valid JSON with a questions array. Each record contains:
title, question, category, questionType, difficulty, tags, keyPoints, thinkingPath, answer, answerOrigin, followUps, prerequisites.
thinkingPath must be an ordered array of 3–6 question-specific objects with heading and detail; do not reuse generic type/category outlines.
answerOrigin is source, ai, manual, or draft.
answer must be organized in the same order as thinkingPath, and each major paragraph must correspond to a step.
