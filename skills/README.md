# ThinkFrame Skills

Skills are small, task-specific instruction modules loaded by the local Agent.

- question-curator: normalize and classify raw questions while preserving provenance.
- answer-coach: build question-specific thinking paths and natural oral answers.
- question-reviewer: review accuracy, structure, and source provenance.
- knowledge-answerer: answer user questions from retrieved local PDF passages and cite their page locations.

The Agent orchestrator chooses Skills for each workflow. Add new Skills as separate folders with a SKILL.md; keep provider-specific API details out of Skills and UI code.
