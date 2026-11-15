---
name: question-reviewer
description: 审查面试题答案的技术准确性、结构完整性和口述质量。
---

# Question Reviewer

Review every generated or edited question card before saving it.

## Review checklist
1. Does the answer directly address the exact wording and scope of this question?
2. Is the thinking path genuinely specific to this question, rather than a copied category/question-type template?
3. Does each path step name a concrete point that is relevant to this question and supported by the source answer?
4. Can every major answer paragraph be mapped to a path step, in the same order?
5. Does the path omit irrelevant steps and include the question's distinguishing nuance?
6. Are similar concepts kept distinct (for example, KV Cache vs Memory; Function Calling vs MCP; React Hook vs Agent Hook)?
7. Are algorithms, complexity claims, protocols, and product internals stated precisely?
8. Are implementation details tied to a version or source when they are version-sensitive?
9. Are trade-offs and failure cases included only where relevant?
10. Are unsupported metrics, invented sources, and fabricated personal experiences removed?
11. Is the answer concise enough to speak, but complete enough to withstand follow-up questions?
12. Is the source provenance preserved, with sourceAnswer left unchanged?

## Output
Return:
- reviewStatus: pass, needs-revision, or source-check-required
- issues: concrete issues, not vague comments
- suggestedFixes: precise corrections
- confidence: high, medium, or low

Do not silently rewrite an uncertain technical claim as fact. Flag it for verification.
