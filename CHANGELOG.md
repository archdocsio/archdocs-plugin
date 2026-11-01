# Changelog

## 0.4.2

- `writing-a-design-doc` records a follow-up with `relate_design_doc` when a new design doc changes an earlier one: `UPDATES` when it changes a defined part, `REPLACES` when the earlier design no longer applies, with a summary of what changes and, for updates, what stays the same. The relationship is part of the spec, takes effect only when a person approves it, and is never inferred from dates or doc numbers.
- `using-design-docs` explains label `lineage` and the `updated-by`, `pending-update` and `pending-replacement` reasons, and that lineage lists only docs the reader can open.

## 0.4.1

- `working-under-a-design-doc` and `writing-a-design-doc` link the item a tool returned (its `url`: a journal entry, question, comment thread, criterion or variation tab) instead of the whole design doc. `designDocUrl` is the doc link.

## 0.4.0

- `working-under-a-design-doc` owns the work to its completion boundary: it reads the plan, handoff, context, criteria and verification status before acting, follows a push through CI and review, reruns and rechecks evidence a later commit made stale (`recheck_verification`), acts on acceptance criteria outcomes while working, submits agent-permitted evidence only for checks it ran, waits on asynchronous work through the host instead of polling, stops only for a verified outcome, a pending human decision, a concrete blocker or a user pause, and starts close-out itself when the boundary is reached.
- Readiness guidance matches the server: with approvals off there is no ready state; `requiredApprovals` 0 means `mark_variation_ready`; above 0 means `request_design_doc_review` directly, never ready first. Fixed in `writing-a-design-doc`, `closing-out-a-design-doc`, the example and the eval expectations.
- `closing-out-a-design-doc` separates preparing the record from shipping, keeps implemented, merged and live apart, and names the one remaining decision before asking.
- Evals grade calls by their results (`mustSucceed`, `mustNotFail`, `expectFailure`, `resultMatches`), check server state after a run, can grant a scenario `Bash`/`Edit`/`Write`, and gain scenarios for CI repair, review feedback, stale evidence, automatic close-out, approval-required review, resumption, approvals-off readiness and agent evidence with a human-only criterion pending.
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
