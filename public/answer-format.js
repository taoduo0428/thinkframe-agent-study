function isCompleteAnswerHeading(value) {
  return /^(?:#{1,6}\s*)?(?:\*\*)?\s*完整答案\s*(?:\*\*)?\s*$/i.test(String(value || "").trim());
}

function extractHeading(block) {
  const firstLine = String(block || "").split(/\r?\n/, 1)[0].trim();
  const markdown = firstLine.match(/^#{1,6}\s+(.+?)\s*$/);
  const bold = firstLine.match(/^\*\*([^*]+?)\*\*\s*$/);
  const heading = markdown?.[1] || bold?.[1] || "";
  if (!heading || isCompleteAnswerHeading(heading)) return null;
  return heading.trim();
}

/**
 * Split an answer into ordered learning points without rewriting its wording.
 * Explicit source headings collect their following paragraphs and lists;
 * unheaded source paragraphs remain separate points in their original order.
 */
export function splitAnswerIntoPoints(source) {
  const normalized = String(source || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !isCompleteAnswerHeading(line))
    .join("\n")
    .trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n[ \t]*\n+/).map((block) => block.trim()).filter(Boolean);
  const points = [];
  let pendingHeading = "";

  for (const block of blocks) {
    const heading = extractHeading(block);
    if (heading) {
      if (pendingHeading) points.push({ heading: pendingHeading, content: "" });
      pendingHeading = heading;
      const content = block.split(/\r?\n/).slice(1).join("\n").trim();
      if (content) {
        points.push({ heading: pendingHeading, content });
        pendingHeading = "";
      }
      continue;
    }

    points.push({ heading: pendingHeading, content: block });
    pendingHeading = "";
  }

  if (pendingHeading) points.push({ heading: pendingHeading, content: "" });
  return points.filter((point) => point.heading || point.content);
}
