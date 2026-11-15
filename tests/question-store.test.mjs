import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const originalDataDir = process.env.THINKFRAME_DATA_DIR;
const originalPrivateDir = process.env.THINKFRAME_PRIVATE_DIR;
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "thinkframe-question-store-"));
const dataDir = path.join(tempRoot, "data");
const privateDir = path.join(tempRoot, ".data");
const questionsFile = path.join(dataDir, "questions.json");

await mkdir(dataDir, { recursive: true });
await mkdir(privateDir, { recursive: true });
await writeFile(questionsFile, JSON.stringify([{
  id: "question-1",
  title: "Agent 状态机如何工作",
  question: "Agent 状态机如何工作",
  category: "Agent 基础与推理机制",
  questionType: "concept",
  status: "new",
  reviewCount: 0,
  reviewHistory: [],
  starred: false,
  notes: "",
  sourceAnswer: "保留的原始答案",
  answer: "整理后的答案",
  answerOrigin: "curated",
  thinkingPath: []
}], null, 2), "utf8");

process.env.THINKFRAME_DATA_DIR = dataDir;
process.env.THINKFRAME_PRIVATE_DIR = privateDir;
const store = await import("../server/storage/question-store.mjs?question-store-test");

after(async () => {
  await rm(tempRoot, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.THINKFRAME_DATA_DIR;
  else process.env.THINKFRAME_DATA_DIR = originalDataDir;
  if (originalPrivateDir === undefined) delete process.env.THINKFRAME_PRIVATE_DIR;
  else process.env.THINKFRAME_PRIVATE_DIR = originalPrivateDir;
});

test("favorites, notes, and daily study activity persist as real events", async () => {
  const updated = await store.updateQuestion("question-1", {
    starred: true,
    notes: "区分 Controller 与 Executor 的职责。",
    sourceAnswer: "这段内容不应覆盖原始资料"
  });

  assert.equal(updated.starred, true);
  assert.equal(updated.notes, "区分 Controller 与 Executor 的职责。");
  assert.equal(updated.sourceAnswer, "保留的原始答案");

  const now = new Date();
  const expectedToday = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  const firstReview = await store.recordQuestionReview("question-1", { date: "2000-01-01" });
  assert.equal(firstReview.reviewCount, 1);
  assert.equal(firstReview.status, "learning");
  assert.equal(firstReview.reviewHistory.length, 1);
  assert.equal(firstReview.reviewHistory[0].date, expectedToday);

  const secondReview = await store.recordQuestionReview("question-1", { mastered: true, date: "2099-12-31" });
  assert.equal(secondReview.reviewHistory[1].date, expectedToday);
  assert.equal(secondReview.reviewCount, 2);
  assert.equal(secondReview.status, "mastered");
  assert.equal(secondReview.reviewHistory.length, 2);

  const stats = await store.getStats();
  assert.equal(stats.totalReviews, 2);
  assert.equal(stats.todayReviewed, 2);
  assert.equal(stats.mastered, 1);
  assert.equal(stats.streakDays, 1);
  assert.equal(stats.dailyActivity.at(-1).count, 2);

  const persisted = JSON.parse(await readFile(questionsFile, "utf8"));
  assert.equal(persisted[0].starred, true);
  assert.equal(persisted[0].notes, "区分 Controller 与 Executor 的职责。");
  assert.equal(persisted[0].sourceAnswer, "保留的原始答案");
  assert.equal(persisted[0].reviewHistory.length, 2);
  assert.equal(persisted[0].reviewCount, 2);
});
