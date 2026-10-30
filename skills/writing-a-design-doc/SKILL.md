---
name: writing-a-design-doc
description: Use when creating or editing an Archdocs design doc, writing its spec or implementation plan, raising or answering its open questions, or moving an existing plan file (Claude Code plan, Spec Kit plan.md, Kiro tasks.md, superpowers plan) into Archdocs.
---

# Writing a design doc

A design doc has variations: by default a spec, an implementation plan and evidence of work, plus any the organization added. Each variation has full text and a short brief. People read the brief first, and reviewers trust it, so it must say exactly what the full text says.

This skill covers everything before the work ships. For deciding whether a design doc is the right document at all, see `using-design-docs`. For evidence and shipping, see `closing-out-a-design-doc`.

## 1. Look before creating

Search for an existing design doc on the topic with `list_design_docs` or `search`. If one exists, show it to the user and offer to continue it. If they want a fresh one that replaces it, create the new doc and ask them to mark the old one as superseded in the app (there is no tool for that).

## 2. Read the organization's standard

Call `list_design_doc_types` before writing anything. It returns, per variation type:

- the writing instructions, which are the organization's rules for that variation. Follow them as written.
- the starting outline. Use its headings.
- the brief fields. Fill each one that isn't computed. Never write a computed field such as `openQuestions`; the server fills it.
- the timing (before or after the work) and, when sizes are on, which sizes require it and which need approval.

It also returns `features` and `featureAdvice`. Don't call a tool for a feature that is off; it fails. If an off feature would have helped the user, pass on the advice once.

## 3. Create

`create_design_doc` needs a title and a size. With `features.sizes` off, send `STANDARD`. With it on, use the size the user chose (see `using-design-docs` for proposing one). Pass `sessionUrl` on this and every later write when your session has a shareable link, so readers can see where the agent work happened.

## 4. Write the variations that come before the work

By default that's `spec`, then `plan`. With sizes on, write each type whose timing is before and which is required for the doc's size. Write each with `write_design_doc_variation`, sending the full markdown and the brief together. The server refuses an agent write without a brief.

If the user already has a plan file from another tool, don't rewrite it. Use `import_plan_file` with its content, its `source` (`claude-code`, `spec-kit`, `kiro` or `markdown`) and a brief written from it.

## 5. Never invent

Decisions, rejected alternatives and risks come from the user, the code, or existing docs. You may summarize, structure and point out gaps. You may not fill a gap with a plausible guess and present it as decided.

Each point that hasn't been decided becomes a tracked question:

```text
add_design_doc_question
  text: "Twilio or MessageBird for SMS delivery?"
  context: "Twilio has US short codes today; MessageBird is cheaper in the EU."
  options: [{ label: "Twilio" }, { label: "MessageBird" }]
  variation: "spec"
```

Give 2 to 6 options when the choices are known, and none when they aren't. Set a preferred option only when the user stated a preference. Write the question in the question tool, not as an "Open questions" section in the text, unless the type's instructions ask for that section.

## 6. Answering questions

Call `list_design_doc_questions` before you write, so you don't contradict a question that has already been answered or re-ask one.

Answer with `answer_design_doc_question` only when a person made the decision or you checked the fact yourself (in code, docs or data). Say who decided in the answer. When the decision was made outside the app, in a meeting or a chat, pass `outside: true` and a link if there is one. When you only have an opinion or a guess, don't answer. Add it to the question's discussion with `create_comment_thread` (with the question's id) or `reply_to_comment_thread`, and leave the question open.

`drop_design_doc_question` needs a reason and the user's agreement.

## 7. Mentions

Mentions make the design doc show up on the objects it touches, so link real catalog objects:

- Look names up with `list_objects` or `search` first.
- Write `[[Exact Name]]` for an existing catalog object, and `[[new: Name]]` for something the change introduces. A person accepts proposed objects at ship time.
- Each write returns names it couldn't resolve. Fix every one (use the exact catalog name, or `[[new: Name]]` if it really is new) or tell the user. Never leave them silently.
- To link plain-text names that are already in a variation, use `link_design_doc_mentions`, or pass `autoLink` on the write.

## 8. Planned changes

When `features.evidenceTracking` is on, call `set_planned_changes` with the objects, docs and proposed objects the plan will touch. Close-out compares this list with what actually changed.

## 9. Editing an existing variation

Read the current full text with `get_design_doc` first, then send the whole updated text. People co-edit design docs live in the app, and your write replaces the text, so work from what's there now, not from a copy you read earlier. Keep their changes.

A variation that is approved, or any variation on a shipped design doc, is frozen. Don't try to write it. Tell the user a person has to open an amendment on that variation in the app and give the reason. Write the change only after they confirm the amendment is open. If the change came up during implementation, it can go in the evidence variation's deviations instead.

## 10. Finish

Mark each finished variation with `mark_variation_ready`. When approvals are on and the type needs approval for this size, call `request_design_doc_review`. Agents cannot approve. Tell the user who needs to (the type's approvers) and what they're approving.

End by giving the user the design doc number, the list of open questions, and anything that needs a person: approvals, unresolved mentions, an amendment.

Once the work starts, use `working-under-a-design-doc` to record decisions, pull requests and deviations as they happen.

## Example

The user says: "Write up adding SMS as a delivery channel. It touches the Sequencer and the Delivery Worker. We haven't picked Twilio or MessageBird."

1. `list_design_docs` finds nothing on SMS.
2. `list_design_doc_types`: sizes off, so size is `STANDARD`; spec outline and brief fields noted.
3. `list_objects` confirms "Sequencer" and "Delivery Worker".
4. `create_design_doc` titled "SMS delivery channel".
5. `write_design_doc_variation` writes the spec with `[[Sequencer]]`, `[[Delivery Worker]]` and `[[new: SMS Provider Adapter]]`, plus a brief whose decision field says only what the spec decides.
6. `add_design_doc_question` raises "Twilio or MessageBird?" with both as options.
7. `mark_variation_ready` on the spec, then the agent tells the user that DD-0007 is ready for review and has one open question.
