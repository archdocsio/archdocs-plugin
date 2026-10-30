---
name: closing-out-a-design-doc
description: Use when work tracked by an Archdocs design doc is finished, merged or abandoned, when the user says a design doc's change is done or live, or when asked to record what actually shipped against a design doc.
---

# Closing out a design doc

The evidence variation is the part of a design doc people read a year later, when they want to know what was actually built and where it differed from the plan. Write it from what happened, not from what the plan said would happen.

## 1. Read what was planned

Find the design doc with `list_design_docs` (by number or text) and read it with `get_design_doc`, including the plan's full text. Call `list_design_doc_types` for the evidence type's instructions, outline and brief fields, and for `features`.

## 2. Gather what happened

Use the pull requests, commits and code in front of you, and ask the user about anything you can't see. Note for each planned item whether it was done, done differently, or not done.

When `features.evidenceTracking` is on:

- Call `link_pull_request` for each pull request. Archdocs reads the PR state and CI results from GitHub. Never type a CI status into the text yourself.
- Call `record_architecture_change` for each catalog object or doc the work changed. Compare against the planned changes; anything changed that wasn't planned is worth a sentence in the evidence.

When it's off, skip both tools and put the PR links in the evidence text.

## 3. Write the evidence

Write the `evidence` variation with `write_design_doc_variation`, following the type's outline. Cover:

- what shipped
- each deviation from the plan, with its reason
- what was planned but not done, and whether it's dropped or deferred

The brief's outcome, deviations and not-done fields must say the same things as the text, in fewer words. If you don't know why something deviated, say so and ask; don't supply a reason.

## 4. Open questions

Call `list_design_doc_questions`. Some questions will have been settled during the work. Answer those with `answer_design_doc_question`, saying who decided, but only for decisions a person made or facts you verified (the same rule as in `writing-a-design-doc`). List the rest for the user.

## 5. Things only people do

Proposed objects (`[[new: ...]]` mentions) are accepted into the catalog or dropped by a person at ship time in the app. List them for the user.

Approvals, opening amendments, superseding and abandoning are done by people in the app. When work was abandoned, tell the user to mark the design doc abandoned with a reason there, and don't write evidence for work that didn't happen.

## 6. Shipping

Call `mark_design_doc_shipped` only when both are true:

- the evidence variation exists, and
- the user has said the work is shipped or live. A merged pull request alone doesn't mean shipped, and neither does "done" when it could mean "the code is written".

If questions are still open, the tool needs `acknowledgeOpenQuestions: true`. Pass it only after showing the user the open questions and hearing that they want to ship anyway.

If you didn't mark it shipped, say what's left: the user's confirmation, an approval, or a proposed object to accept.
