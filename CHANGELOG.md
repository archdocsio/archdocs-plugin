# Changelog

## Unreleased

- `writing-a-design-doc` gathers context before writing: `get_task_context` for the touched objects, with `list_adrs_for_object`, `list_design_docs` and `get_impact` as the fallback, and raises a conflict with a standing ADR as a tracked question instead of resolving it.
- `working-under-a-design-doc` triggers on spikes, verification, live testing and "what's next", records findings, decisions and deviations in the Work Log journal when the organization has one (`add_journal_entry`), falls back to the Deviations thread when it doesn't, resumes from `get_journal_handoff`, and leaves a handoff before stopping.
- `closing-out-a-design-doc` builds the evidence from the journal, reads acceptance criteria and Linear work when the server offers them, and treats journal claims as reported, not verified.
- `using-design-docs` maps the three later skills to before, during and after the work, and skips `get_task_context` on servers that don't offer it.
- Evals: `with-journal-entries` and `with-standing-adr` fixtures, five new scenarios, and the full eval org opts into the Work Log so journal and thread paths are both covered.

## 0.3.0

Cursor plugin manifest (`.cursor-plugin/plugin.json`) with the same skills, commands and hosted MCP server.

## 0.2.0

- Add Codex plugin and marketplace manifests for the skills and hosted Archdocs MCP server.
- Document Codex installation and `.agents/skills/` as the vendor-neutral skills path.
- Add the `argMustNotMatch` and `finalTextNotMatches` grader checks and tests.
- Add eval scenarios for proposing a design doc, staying quiet on small changes, and recording decisions and pull requests during work.
- Bump the Claude Code plugin and marketplace versions to 0.2.0.

## 0.1.0

First release: the `using-design-docs`, `writing-a-design-doc` and `closing-out-a-design-doc` skills, the `/archdocs:design-doc` and `/archdocs:close-out` commands, and the hosted Archdocs MCP server connection.
