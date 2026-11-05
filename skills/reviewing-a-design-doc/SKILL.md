---
name: reviewing-a-design-doc
description: Use when the user asks you to review, critique or poke holes in an Archdocs design doc yourself, or to upload your own review of one, rather than starting the ArchDocs reviewer.
---

# Reviewing a design doc

This is a quick review you do with what you have in front of you, uploaded so it shows in the doc's AI review panel labelled as your review. It is not the ArchDocs reviewer. That one reads the whole repository, checks evidence against its own reads, and can be discussed and re-run. When the user wants depth, say so and offer `start_ai_review` instead.

## 1. Read the doc

- `get_design_doc` with `full: true`. Note each variation's `typeKey` and `version`. Your quotes must come from that exact text and version.
- `get_task_context` with the design doc id and the paths the plan names, for standing decisions and earlier designs that touch the same code.
- If the code the doc names is checked out, read the parts it makes claims about. Don't go looking further than that.

## 2. Write a few findings

Aim for three to eight findings that would change what gets built. Skip style, wording and formatting. Each finding has:

- `kind`: `PREMISE` (an assumption the doc relies on that may be false), `ALTERNATIVE` (a simpler or safer option it didn't consider), `RISK` (something likely to go wrong), `GAP` (something the plan needs but doesn't cover), `INCONSISTENCY` (two parts of the doc, or the doc and the code, disagree).
- `severity`: `HIGH` only when the plan would ship broken or unsafe as written; `MEDIUM` for real problems with a workaround; `LOW` otherwise.
- `title`: one line.
- `body`: what's wrong, why it matters, and what you'd change.
- `anchor`: `typeKey`, `version` and a `quote` copied exactly from that variation, short enough to be unique. Add `prefix` or `suffix` only when the quote appears more than once.
- `evidence` (optional, up to ten): `code` (`repoFullName` as `owner/repo`, `path`, `startLine`, `endLine`, and the commit `sha` you read at), `web` (`url` and `title` of a page you read), or `record` (`type` of `design-doc`, `adr`, `object` or `doc`, its `id` and a `label`, from the results above). Never cite something you didn't read. Code and web evidence show as reported by you, since ArchDocs didn't read them.

Don't invent findings to reach a number. Two good findings beat eight weak ones, and none is a valid result: tell the user and don't upload.

## 3. Upload once

Call `submit_ai_review` once with the design doc id, your model name, a two or three sentence `summary`, and the findings. If it rejects some findings (usually a quote that doesn't match the current version), fix those and submit again. Show the user the returned `url`.

The upload spends no AI credits, and the review can't be discussed or re-run in the app. Findings are advice: never change a finding's status, approve, or move the design doc because of your own review.
