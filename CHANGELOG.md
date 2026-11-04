# Changelog

## 0.16.0

- Supporting docs. `working-under-a-design-doc` says when to create a supporting doc (a runbook, test plan or investigation that would otherwise be pasted into the plan or repeated in the Work Log), how to find the one a task needs from `get_design_doc` `supportingDocs` or `get_task_context` without loading every body, how to record each attempt as a Work Log entry with a `SUPPORTING_DOC` reference pinned to the revision used, and how to revise a procedure with `expectedRevision`. Failed attempts keep their own entries, staging results stay staging results, and a supporting doc is never approval or evidence.
- `writing-a-design-doc` links a procedure from the plan as a supporting doc instead of embedding it.
- Adds `list_supporting_docs`, `get_supporting_doc`, `list_supporting_doc_revisions`, `create_supporting_doc`, `update_supporting_doc`, `archive_supporting_doc` and `restore_supporting_doc` to the tool list.
- Needs the ArchDocs server with supporting docs. Release this version only after that server is live.

## 0.15.0

- `closing-out-a-design-doc` calls `close_out_design_doc` once work with an authorized criteria baseline is merged and deployed, after writing the evidence, updating the living docs and recording architecture changes. Close-out needs no person's decision and moves the doc from Approved to Verifying. The agent finishes outstanding items that are its own, names what needs a person, and reports the status, automatic shipping and verification holds. When `changeType.shipsAutomatically` is true, close-out is the last step: Archdocs verifies and ships the doc, and the agent stops without asking the ship question or calling `mark_design_doc_shipped` to hurry it. Manual ships keep the question, relay and criteria exception rules. Docs without criteria keep the existing flow without close-out.
- `working-under-a-design-doc` hands merged and deployed work with criteria to close-out. For a type that ships automatically, deployed and verified ends there, with the holds readable in the handoff. On resume it reads `verifying.hold`: waiting needs nothing, attention needs action or a named open item, and ready means a person can ship by hand.
- `using-design-docs` distinguishes close-out from a person's ship decision and routes merged and deployed work with criteria to the close-out skill. `writing-a-design-doc` says a type's `shipsAutomatically` makes acceptance criteria the real definition of done. The close-out command and README follow the same flow.
- Adds `close_out_design_doc` to the tool list and Work Log hook matchers. Evals keep manual shipping for docs without criteria and include Verifying in status checks.
- Needs the ArchDocs server with DD-0037 (close_out_design_doc, changeType.shipsAutomatically, verifying on get_design_doc). Release this version only after that server is live.

## 0.14.0

- Design docs follow their change type. `writing-a-design-doc` reads `changeTypes`, `defaultChangeType` and `changeTypesEntitled` from `list_design_doc_types`, picks a type by comparing the work to each type's `whenToUse`, tells the user which type and why, and passes `changeType` to `create_design_doc`. When the fit is unclear the agent asks; without entitlement it uses the default. After creating the doc, the agent writes the variations from the doc's pinned `changeType.entries` and `types`: the before-work document entries required for its size, the `intentSource` entry first. A Bug fix gets no spec.
- `using-design-docs` names a better-fitting change type when it proposes a design doc. `closing-out-a-design-doc` writes the evidence entry (`role: "evidence"`) with the doc's pinned instructions. `importing-design-docs` passes `changeType` only when a document clearly is another type.
- Needs the ArchDocs server with DD-0026 change types (`changeTypes` in `list_design_doc_types`, `changeType` on `create_design_doc`).

## 0.13.0

- `working-under-a-design-doc` proposes checks that run after deploy. For outcomes a pull request check can't show, the agent calls `list_verification_connections`, picks a connection by the environment it watches, and proposes a connector criterion with a start and a timing, using revision variables where they help and a dry run when unsure. A check that can't fail is never presented as proof, and agents never create connections.
- Needs the ArchDocs server with DD-0034 connected verification sources (`list_verification_connections`).

## 0.12.0

- The repository in every Archdocs call comes from the git remote. `using-design-docs` tells the agent to read `owner/repo` from `git remote get-url origin` (or the tracked upstream) for task context, `COMMIT` and pull request references and code locations, never from the folder, product or package name, and to leave it out when there is no remote. `working-under-a-design-doc` and the commit hook's Work Log reminder say the same. Agents were recording commits against a repository that doesn't exist, so the references never resolved.
- Authorizing acceptance criteria follows the design doc's change type. When `get_design_doc` shows `changeType.agentsMayAuthorizeCriteria: true`, `using-design-docs` and `working-under-a-design-doc` let the agent call `authorize_acceptance_criteria` without a person's decision, following `changeType.agentInstructions`. Criteria a person authorized still need a person to replace them, and Archdocs labels agent-authorized criteria. When the flag is false or missing, a person authorizes, as before.
- Needs the Archdocs server with DD-0036. Release this version only after that server is live.

## 0.11.0

- `working-under-a-design-doc` records the guidance that shaped a change. When the design doc's `features.contextReferences` is true, the agent records material `get_task_context` results with `record_context_use`. Each record carries a one-sentence reason and the result's `pin` as `expectedPin`, so a source that changed after it was read is refused with its current text instead of being saved silently. Treatments go through `set_context_treatment`, and constraints that deserve a check are linked or proposed with `link_context_check`. On resume the agent reads `contextUsed` from the design doc or handoff. A recorded reference is described as reported use, never as approval of the source or proof of compliance. When the capability is missing, a journal note is not presented as a structured reference.
- `closing-out-a-design-doc` reads `list_context_used`. A changed source or a check pinned to an earlier criterion version goes into the evidence as an open item. "No check linked" is not a failure.
- Needs the Archdocs server with context references (DD-0033 Delivery A). Release this version only after that server is live.

## 0.10.0

- `writing-a-design-doc` draws the proposed design. The system as it is still comes from embedding the living canvas. The proposed design goes in a diagram owned by the design doc (`create_doc` with `designDocId`), embedded next to it. The agent draws one when the change touches two or more catalog objects or changes an interface or data flow between them, or when a picture helps. Existing parts use their exact catalog names and new parts use their `[[new: ...]]` names. The agent finds the doc's diagrams in `get_design_doc`'s `diagrams`, changes one with `update_doc` or `patch_doc`, and removes one by dropping its embed and then calling `delete_doc`. When `create_doc` refuses, the agent says so and describes the design in text, and never draws it in a library canvas. The skill's description now triggers on adding, changing or removing a design doc's diagrams. The old "a person can add one in the app" fallback is gone.
- `closing-out-a-design-doc` brings the living docs up to date with what shipped before writing the evidence. The design doc's own diagrams stay as the plan. Library canvases are changed with `patch_doc` or `update_doc`, and object descriptions with `update_object`. A part that is still a proposed object is drawn as a plain node until a person accepts it. Each update is recorded with `record_architecture_change`.
- `working-under-a-design-doc` and `using-design-docs` name the tools for updating a living doc (`get_doc`, `patch_doc`, `update_doc`, `update_object`) and keep proposed-design diagrams out of it.
- Evals: new `spec-draws-proposed-diagram`, `remove-proposed-diagram` and `close-out-updates-living-canvas` scenarios, with the `with-proposed-diagrams` and `with-living-canvas` fixtures. The grader adds `everyCallArgMatches` and the state checks `diagrams` and `docMatches`. Expectations can name fixture values. Scenarios that may edit library canvases set `restoreLibrary`, which snapshots the library before the run and restores it afterwards.
- Needs the Archdocs server with design-doc diagrams over MCP (archdocsio/monorepo#16). Release this version only after that server is live.

## 0.9.0

- `using-design-docs` relays more of a person's decisions: abandoning (`abandon_design_doc`) or deleting (`delete_design_doc`) a design doc, deciding a review request (`decide_review`), discarding draft acceptance criteria (`discard_acceptance_criteria`), accepting or dropping a proposed object (`decide_proposed_object`), and retiring, restoring, reanchoring, marking reviewed or adopting a knowledge item (`change_knowledge_item`, `resolve_knowledge_relation`). When work stopped, the agent abandons rather than deletes; it deletes only a doc the person names.
- `closing-out-a-design-doc` abandons a design doc through `abandon_design_doc` with the person's reason and words, and records proposed object decisions with `decide_proposed_object`, instead of sending the user to the app.
- `writing-a-design-doc` changes a design doc's title, size, space, folder or owner with `update_design_doc`, fixes an open question with `update_design_doc_question`, and reopens an answered or dropped question with `reopen_design_doc_question`.
- `working-under-a-design-doc` gains "Correcting what you recorded": unlink a mislinked pull request or Linear item, remove a wrong architecture change, edit or delete the agent's own comment, remove a criterion from an unauthorized draft, edit or cancel a drafted Linear proposal, and correct journal entries with a `correction` entry.
- `using-design-docs` adds code locations to the design doc being worked on with `add_code_location`, and sends bug reports, feature requests and feedback about Archdocs with `submit_feedback` when the user asks.
- Needs the Archdocs server from 2026-11-02 or later.

## 0.8.4

- `writing-a-design-doc` explains that a refused variation write saves nothing, so questions and comments aimed at that variation fail until it is written. When the server names a line it can't save, the agent fixes that line and resends the whole write.
- `writing-a-design-doc` passes `autoLink` only when the user asks for it, then checks the `autoLinked` list in the result and removes links that aren't meant. One-word catalog names now link only with exact case.
- `writing-a-design-doc` and `working-under-a-design-doc` record a decision a person changed on an answered question with `answer_design_doc_question` and `amend: true`. The earlier answer stays in the history. Needs the Archdocs server from 2026-11-02 or later.

## 0.8.3

- `using-design-docs` and the README describe the Free plan correctly: every plan includes design docs, and a Free organization gets one. When it's in use, `list_design_doc_types` returns `featureAdvice.designDocLimit` and `create_design_doc` refuses; the agent tells the user once that the existing design doc stays editable and that a person can upgrade to Team for more. The previous text said design docs need Team, which stopped being true when Free gained one design doc.

## 0.8.2

- `using-design-docs` reads the results of an in-client confirmation: when the person's client shows the server's prompt, a relayed decision comes back as `status: confirmed` (report it as done) or `status: not_recorded` (they chose not to; don't ask again). Clients without prompts still get `pending_confirmation` and the confirm link.

## 0.8.1

- `using-design-docs` handles a decision the organization wants confirmed: when a tool returns `status: pending_confirmation`, the agent gives the person the `confirmUrl`, says nothing is recorded until they confirm it in Archdocs, and doesn't retry or report the decision as made.

## 0.8.0

- Hooks keep the Work Log current. After a `git commit` or a returned subagent, and once when a turn ends with commits, test runs or subagent results not yet recorded, the agent is reminded to record them on the design doc. They are silent unless the session has used the Archdocs design-doc tools, defer to the journal's own instructions, never write to Archdocs themselves, and keep only a per-session state file. One bash script serves Claude Code and Codex (`hooks/hooks.json`) and Cursor (`hooks/hooks-cursor.json`); a launcher adapted from obra/superpowers finds bash on Windows. `ARCHDOCS_WORKLOG_HOOKS=off` turns them off.
- `working-under-a-design-doc` adds "Keep the record current": the record is never behind the work, so before starting the next step the agent records each commit, exact test results, what each subagent or delegated run produced and what its review found, and each approach that failed. A run, its review and its tests can share one entry. A journal type's explicit instructions on how often or what to record take priority. The skill now says it governs the whole span of the work, including while another skill, checklist or delegation tool drives the loop, and its description triggers after commits, test runs and returned runs. "Entries are checkpoints, not a log of every step" is gone.
- Evals: new `checkpoints-recorded` and `delegated-run-recorded` scenarios on a failing-test repo with a GitHub origin; argument checks accept a path of `*` to match the whole input. Without the plugin 1/3 and 0/3, with it 3/3 each.

## 0.7.2

- `using-design-docs` calls `get_task_context` before recommending how any catalogued system should work, including in a discussion or a "should we build X" answer, not only before planning or implementing code. Its description now triggers on those questions too. When `list_design_docs`, `search` or the context returns a design doc whose title covers the subsystem under discussion, the agent opens it with `get_design_doc` before proposing anything.
- `using-design-docs` reads the new coverage notes `no-text-matches` and `no-record-links-these-paths` as a thin result and searches design docs by the subsystem's name before relying on it.
- Evals: `with-subsystem-design` fixture (a Delivery Worker retry design that mentions the Cadence objects) and two scenarios: `discussion-reads-standing-design` (a recommendation question with nothing to build) and `should-we-build-reads-standing-design` (a "should we build X" proposal that contradicts the standing design without using its words).

## 0.7.1

- `closing-out-a-design-doc` relays a ship with an exception: when a person with `verification:manage` tells the agent to ship anyway, it passes `exception: { reason }` and their words in `decision.statement`, after telling them which criteria the exception covers. Archdocs fills in the criteria results current at the call. Needs the Archdocs server from 2026-11-01 or later.

## 0.7.0

- Agents record decisions a person tells them, instead of sending them to the app. `using-design-docs` adds "Decisions a person makes through you": approving a variation (`approve_variation`), reviewing evidence (`review_evidence`), authorizing acceptance criteria (`authorize_acceptance_criteria`), attesting to a criterion (`submit_evidence`), accepting or dropping a knowledge item (`decide_knowledge_item`), confirming Linear issues (`confirm_linear_issues`) and marking shipped (`mark_design_doc_shipped`), each with the person's own words from the session in `decision.statement`. Only an explicit decision about that item counts; "looks good" is not one. Archdocs records it in the person's name, labeled relayed, and still applies their permissions, the approver rules and the organization's minimum for that decision. Needs an Archdocs server with these tools (live on archdocs.io since 2026-11-01).
- `closing-out-a-design-doc` passes the person's words when it ships on their say-so, and records an attestation they relay as theirs instead of keeping it out of the evidence. Shipping with an exception still happens in the app.
- `working-under-a-design-doc` submits a person's relayed attestation with `decision.statement` instead of only noting it in the journal, and relays a person's decision on a knowledge item.
- `writing-a-design-doc` lets an approver approve through the agent after `request_design_doc_review`.
- Evals: new `relayed-attestation` scenario; `live-close-out-ships` expects the person's words on the ship call; the review and agent-evidence scenarios must not call `approve_variation`.

## 0.6.0

- New skill `importing-design-docs` and command `/archdocs:import-docs`: bring a team's existing design docs, RFCs and decision records into Archdocs as history. The agent classifies each file (spec, plan, RFC, decision record, not a document), pairs specs with plans, reads status, date, author and identifier out of frontmatter, export metadata or git, shows the person one mapping table with every guess marked, and only after approval imports each document with `import_design_doc` (or `create_adr` with `historical: true`). Imported documents land in their final status (SHIPPED by default) with their original date, author, identifier and a link back, skip review and notifications, and re-import by the same identifier updates instead of duplicating. Team plan and above; the server refuses on Free.
- `using-design-docs` points at the new skill when the user wants to import, migrate or port existing documents.

## 0.5.0

- `working-under-a-design-doc` captures a finding that matters beyond the doc (an edge case, a wrong assumption, a failure mode) with `propose_knowledge_item` and the journal entry's `entryNumber`, plus a `statement`, `kind`, `codeLocations` and, when it contradicts an existing item, `challengesItemId`. Later changes on the same paths get it from `get_task_context`. The capture stays proposed until a person accepts it and is never an approved rule. On an older server that rejects `entryNumber`, the finding stays in the journal.
- `using-design-docs` explains two labels: "From a Work Log finding" (not an approved rule; account for it in the plan and test the failure it describes) and "Challenged by a later finding" (read the challenge; only a person resolves it).

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
