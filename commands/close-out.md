---
description: Record evidence and close out an Archdocs design doc
argument-hint: [DD-number]
---

Close out the Archdocs design doc $ARGUMENTS by following the `closing-out-a-design-doc` skill.

If no number was given, find the design doc that matches the work in this session with `list_design_docs` and confirm it with the user before writing anything.

Prepare the whole record (evidence, deviations, outstanding scope, verification status) and pick ready or review from the variation's `requiredApprovals`. Mark the design doc shipped only if the user has said the change is live; otherwise end by asking whether it is.
