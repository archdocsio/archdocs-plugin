---
name: closing-out-a-design-doc
description: Use when work tracked by an Archdocs design doc is finished, merged or abandoned, when the user says a design doc's change is done or live, or when asked to record what actually shipped against a design doc.
---

# Closing out a design doc

The evidence variation is the part of a design doc people read a year later, when they want to know what was actually built and where it differed from the plan. Write it from what happened, not from what the plan said would happen.

## 1. Read what was planned

Find the design doc with `list_design_docs` (by number or text) and read it with `get_design_doc`, including the plan's full text. Call `list_design_doc_types` for the evidence type's instructions, outline and brief fields, and for `features`.

## 2. Start from what was recorded during the work

If the work followed `working-under-a-design-doc`, much of the evidence already exists:

- linked pull requests and recorded changes, in `get_design_doc`
- the journal, when the doc has a variation with `contentMode: "JOURNAL"` (the Work Log): `get_journal_handoff` for the last handoff and what came after it, then `list_journal_entries` for the whole timeline. Decision entries are the deviations; blocker and test entries say what was tried; commit and PR references say where.
- answered questions, from `list_design_doc_questions`
- without a journal, the "Deviations from the plan" thread on the plan variation, from `list_comment_threads` on the design doc (with evidence tracking off, PR links are there too)

Read all of it before looking anywhere else. Journal entries are reported activity: a "tests pass" entry says someone reported it, not that it was verified. The evidence reports what pull requests, CI, acceptance criteria or the user confirm.

## 3. Fill the gaps

Then use the pull requests, commits and code in front of you, and ask the user about anything you can't see. Note for each planned item whether it was done, done differently, or not done.

When `features.evidenceTracking` is on, fill in what's missing:

- Call `link_pull_request` for each pull request not linked yet. Archdocs reads the PR state and CI results from GitHub. Never type a CI status into the text yourself.
- Call `record_architecture_change` for each changed catalog object or doc not recorded yet. Compare against the planned changes; anything changed that wasn't planned is worth a sentence in the evidence.

When it's off, skip both tools and put the PR links in the evidence text.

When the server offers acceptance criteria, call `list_acceptance_criteria`. For an attestation criterion the user confirms, call `submit_evidence` with a note. Then read `get_verification_status` and report it as Archdocs computed it. Never write that a criterion is verified or satisfied yourself; the evidence brief's `verification` field is computed. When Linear is connected, `list_linear_work` gives issue and project status and the pull requests correlated with them; a done issue is a lead for the evidence, not verification, and it never ships the doc. Skip both when the server doesn't offer the tools, and when a call refuses because the plan doesn't include the feature, carry on without mentioning it.

## 4. Write the evidence

Write the `evidence` variation with `write_design_doc_variation`, following the type's outline. Cover:

- what shipped
- each deviation from the plan, with its reason
- what was planned but not done, and whether it's dropped or deferred

The brief's outcome, deviations and not-done fields must say the same things as the text, in fewer words. If you don't know why something deviated, say so and ask; don't supply a reason.

Screenshots help here (a dashboard after the change, a test run). Attach them as described in `writing-a-design-doc`.

Then call `mark_variation_ready` on the evidence variation. With approvals on, shipping fails until every required variation is ready, the evidence included.

## 5. Open questions

Call `list_design_doc_questions`. Some questions will have been settled during the work. Answer those with `answer_design_doc_question`, saying who decided, but only for decisions a person made or facts you verified (the same rule as in `writing-a-design-doc`). List the rest for the user.

## 6. Things only people do

Proposed objects (`[[new: ...]]` mentions) are accepted into the catalog or dropped by a person at ship time in the app. List them for the user.

Approvals, opening amendments, superseding and abandoning are done by people in the app. When work was abandoned, tell the user to mark the design doc abandoned with a reason there, and don't write evidence for work that didn't happen.

## 7. Shipping

Shipping means the change is live for its users, not merged. Call `mark_design_doc_shipped` only when the evidence variation is written and marked ready and the user has said the change is live, in production, released or deployed.

"Merged", "done", "finished" and "it shipped as planned" (a description of how the work went) don't say that. In those cases don't ship and don't stay quiet either. End by asking: "Is this live? Want me to mark DD-0023 shipped?" Ship on a yes. Without that question nobody marks the doc shipped, and it sits at approved forever.

If the ship call fails, read the reason and act on it:

- A variation isn't ready or approved: mark it ready if it's yours to mark, or tell the user who has to approve it.
- Open questions, with a request to acknowledge them: list the questions for the user, and pass `acknowledgeOpenQuestions: true` only after they agree to ship with them open.
- Open questions that must be answered first (the organization blocks shipping on them): list them, and answer only the ones a person has decided.
- An open amendment: tell the user it has to be finished in the app first.
