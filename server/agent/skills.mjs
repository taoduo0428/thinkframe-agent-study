import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SKILLS = path.join(ROOT, "skills");
const allowed = new Set(["question-curator", "answer-coach", "question-reviewer", "knowledge-answerer"]);

export async function loadSkill(name) {
  if (!allowed.has(name)) throw new Error("Unknown skill: " + name);
  return readFile(path.join(SKILLS, name, "SKILL.md"), "utf8");
}

export async function loadSkillBundle(names) {
  const selected = names?.length ? names : ["question-curator", "answer-coach"];
  const sections = await Promise.all(selected.map(async (name) => {
    try { return await loadSkill(name); } catch { return ""; }
  }));
  return sections.filter(Boolean).join("\n\n---\n\n");
}
