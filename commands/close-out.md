---
description: Record evidence and close out an Archdocs design doc
argument-hint: [DD-number]
---

Close out the Archdocs design doc $ARGUMENTS by following the `closing-out-a-design-doc` skill.

If no number was given, find the design doc that matches the work in this session with `list_design_docs` and confirm it with the user before writing anything.

Prepare the whole record (evidence, deviations, outstanding scope, verification status), update the living docs and recorded architecture changes, and pick ready or review from the variation's `requiredApprovals`. For a doc with an authorized criteria baseline, once the work is merged and deployed call `close_out_design_doc` and handle its outstanding items as the skill says. When `changeType.shipsAutomatically` is true, close-out is the last step: report the status and holds, then stop without asking "Is this live?" or calling `mark_design_doc_shipped` to hurry it. Otherwise mark shipped only if the user has said the change is live; ask the ship question when they haven't. Docs without criteria keep that manual flow without close-out.
