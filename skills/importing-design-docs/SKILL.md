---
name: importing-design-docs
description: Use when a team wants to bring existing design docs, RFCs, specs, decision records or ADRs into Archdocs from a repository folder, a GitHub repo, a Notion or Confluence export, or loose markdown files, when the user says import, migrate, port, backfill or "move our docs into Archdocs", or when a repository holds a docs folder of finished design documents that Archdocs doesn't know about yet.
---

# Importing existing design docs

A team that adopts Archdocs already has history: RFCs in a repository folder, design pages in Notion, decision records in `docs/adr`. Imported documents are history, not new work. They land in their final status with the original date, author, identifier and a link back to where they came from, and they skip review, approvals and notifications. The point of importing is that search, `get_task_context`, an object's "Used in" and supersession chains work on day one, before the team writes anything new.

The tool is `import_design_doc`, one call per document. Decision records go through `create_adr` with `historical: true`. Both need a Team plan or higher. When the server refuses with a plan error, tell the user and stop; there is no workaround.

You do the judgment the server cannot: deciding what each file is, pairing specs with plans, reading status and dates out of git or export metadata, and showing the person a table before anything lands. Nothing is imported until they approve that table.

## 1. Find what there is

Ask for the source if the user hasn't named one: a folder in the current repository, another repository, a Notion or Confluence export (a zip of markdown plus CSV), or a set of files. Read the whole set before classifying anything, because conventions only show across files.

Classify each file as one of:

- **spec**: why and what. Headings like Problem, Goals, Decision, Alternatives, Risks, Design.
- **plan**: how. Ordered tasks, phases, checklists, rollout steps.
- **RFC or design page**: design and rollout in one document.
- **decision record**: MADR shape (Context, Decision, Consequences, Options) or an `adr/NNNN-*.md` path.
- **not a document**: README, index, template, meeting notes, changelog. List these for the user; don't import them.

Use the signals the files give you: frontmatter, the first heading, filename patterns (`2026-03-04-billing-design.md` and `2026-03-04-billing.md`, `RFC-042-*.md`, `0007-use-postgres.md`), Notion CSV properties. When you cannot classify a file, put it in the table as unclassified with your best guess marked, and let the person decide.

## 2. Pair, date and identify

Pair a spec with its plan when they share a topic slug and were written close together. A pair becomes one design doc with two variations. An RFC that mixes design and rollout stays one document and lands whole in the spec variation unless the person asks to split it; when they do, say in the table which headings go to the plan.

For each document, find:

- **Status.** Frontmatter `status`, a Notion Status column, or a "superseded by" or "replaced by" line. Otherwise read git: a plan whose tasks landed on the default branch is shipped; a document nobody touched since, with its code in the tree, is shipped. When nothing says otherwise, propose SHIPPED and mark it as a guess. Use ABANDONED only when the text or history says the work stopped. Use DRAFT only for documents people are still writing; a draft lands editable and open, not as history.
- **Original date.** Frontmatter date, Notion Created, else the date of the commit that added the file (`git log --diff-filter=A --format=%aI -- <file>`).
- **Original author.** Frontmatter author, Notion Owner, else the author of that first commit. Pass the name as `originalAuthor` and, when you have it, the email as `originalAuthorEmail`; the server matches it to a member of the organization.
- **External id.** The team's own identifier: `RFC-042`, `ADR-0007`, a Notion page id. When the documents have no numbering, use the file path relative to the repository root. It must be stable, because a second run with the same id updates the document instead of duplicating it.
- **Source url.** The GitHub blob URL on the default branch, the Notion page url, or nothing when the files came from a local folder with no remote.
- **Supersedes.** When a document says it was replaced, record which document replaces it, by external id.

Never invent a date, author or status. A column you cannot fill stays empty, and the server records the import date instead.

## 3. Show the mapping table, then stop

Present one table, one row per document to import:

| file(s) | title | variations | status | date | author | external id | superseded by | notes |

Mark every guess in the notes column. Below the table list the files you skipped and why. Ask the person to approve, edit or drop rows. Do not call `import_design_doc` before they answer. For more than about fifty documents, offer a first batch of ten so they can check the result in the app before the rest goes in.

## 4. Import

Call `import_design_doc` once per approved row:

- `sourceSystem`: `github` for a repository, `notion`, `confluence`, `markdown` for loose files, `other`.
- `externalId`, `sourceUrl`, `originalAuthor`, `originalAuthorEmail`, `originalDate` from the table.
- `status` and, for ABANDONED, `abandonedReason` from the text; for SUPERSEDED, `supersededBy` with the replacing document's `externalId`.
- `variations`: the markdown of each variation by type key (`spec`, `plan`, or the organization's own keys from `list_design_doc_types`). Send the file body as it is; the server drops a leading frontmatter block and stores canonical markdown. Do not rewrite, trim or "improve" the text.
- A `brief` per variation when you can write one honestly from the text (what was decided, the risks it names, the alternatives it rejected). The brief must say what the document says. When you can't, leave it out and the server stores a placeholder naming the source.
- `autoLink: true`, so plain-text names of catalog objects become mentions.

Order matters only for supersession: `supersededBy` needs the replacing document to exist already. Import the documents that replace others first, or import everything and re-import the superseded rows afterwards; re-import is idempotent.

Decision records go through `create_adr` with `historical: true`: `status` (`ACCEPTED`, `REJECTED` or `DEPRECATED`; leave it out for a proposal), `decisionDate`, `context`, `decisionOutcome` and `consequences` from the MADR sections, `consideredOptions` when the record lists them, and the same provenance fields. A superseded decision is imported first, then its replacement, then `supersede_adr` links them.

Each result carries the document's `url`. Keep them for the report.

## 5. After the import

- Each result lists `unresolved` names that didn't match a catalog object. Fix them with `link_design_doc_mentions` when the right object exists, or report them.
- When a document has a decisions section that reads like a standing rule, offer to record it as an ADR with `create_adr`. Don't create ADRs unasked.
- When a document has a lessons or postmortem section, offer to capture it with `propose_knowledge_item` so later changes on the same code see it. A person accepts the capture; it is never an approved rule.
- When a status or title turned out wrong, re-run `import_design_doc` with the same `externalId` or `sourceUrl`; the document is updated in place and gets a new version.

## 6. Report

Tell the person what landed: how many documents, with each one's `url`; the rows they dropped; the unresolved names; and anything the server refused, with the reason. Imported documents already carry their status, so there is nothing to ship or mark ready. Stop there unless they ask for the next batch.

## What not to do

- Don't import before the table is approved, and don't import rows the person dropped.
- Don't change the documents' words. Encoding and line endings only.
- Don't guess silently. A guess goes in the notes column; an empty field stays empty.
- Don't use `create_design_doc` plus `write_design_doc_variation` for history. That path creates a draft dated today, authored by the token holder, and an agent cannot ship it.
- Don't import a document people are still editing elsewhere as SHIPPED. Ask where it lives now.
