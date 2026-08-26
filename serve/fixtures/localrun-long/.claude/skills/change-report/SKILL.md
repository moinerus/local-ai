---
name: change-report
description: Format for a change report written into notes/ after fixing anything in this repository. Use whenever writing a report about a change.
---

# Change report format

A change report has exactly these four sections, in this order, as `##`
headings:

1. `## What was broken` - the defect in plain terms, naming the file and the
   function.
2. `## What changed` - the edit, in one or two sentences.
3. `## How it was verified` - the command that was run and what it printed.
4. `## Files touched` - a bullet list of paths, nothing else.

Rules:

- Keep each of the first three sections under 60 words.
- Name files by their path from the repository root, like `src/transform.py`.
- Do not include code blocks. Describe the change in prose.
- The report says what happened, not what could be improved next.
