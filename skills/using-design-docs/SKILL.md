---
name: using-design-docs
description: Use when planning or discussing a code or architecture change and deciding whether it needs an Archdocs design doc, an architecture decision record, an update to an existing diagram, or nothing, or when the user mentions design docs, specs, RFCs or ADRs in a project connected to Archdocs.
---

# Using design docs

Archdocs keeps two kinds of architecture writing. The first thing to get right is which one a change needs.

Canvas docs and catalog objects describe the system as it is. They change whenever the system changes, and nobody needs to know what they said last month.

Design docs describe one change. The spec says why and what, the plan says how, and the evidence says what actually shipped. Once approved or shipped, a design doc is not rewritten, because its value is the record of what was decided at the time.

ADRs record one decision that will outlive any single change ("new services use Postgres", "we don't call Salesforce synchronously").

## Pick one

Ask which question the user needs answered later:

| Later question | Write |
| --- | --- |
| What does the system look like now? | Update the canvas doc or object |
| Why did we build this change this way, and did it ship as planned? | Design doc |
| What's our standing rule for this, and why? | ADR |
| None of the above | Nothing |

## When a change needs a design doc

Write one when any of these is true:

- The change touches two or more catalog objects, or changes an interface, contract, schema or data flow between them.
- Someone other than the author has to review or approve the approach before work starts.
- An agent will carry out the work across several steps or pull requests, so the plan is worth keeping.
- It adds an external dependency or a data store, or starts handling personal data the system didn't handle before.

Skip it for a fix or refactor inside one component that changes no interface, for dependency bumps, and for copy or config changes. A design doc for a typo fix is noise that buries the docs people need.

When the system has already changed and a diagram is now wrong, that's an update to the living doc, not a design doc. Find the doc with `search` or `list_object_usages` and update it.

When the user is recording a decision and nothing is being built, write an ADR with `create_adr`. When a design doc's spec settles something that will outlive the change, write the ADR as well and mention it from the spec.

If the call is unclear, ask one short question before creating anything. An unwanted document is harder to undo than a question.

## Size

`list_design_doc_types` returns the organization's `features`. Only when `features.sizes` is on, propose a size along with your reason:

- Small: one object, no interface change.
- Standard: several objects, or any interface change.
- Large: a new service or data store, a migration, or work across teams.

The size decides which variations are required and which need approval, so the user picks it. You propose. With sizes off, don't mention size at all.

## Examples

| Request | Choice |
| --- | --- |
| "Rename the retry counter in the Delivery Worker." | Nothing |
| "We're moving session storage from Redis to Postgres." | Design doc (data store change touching several services) |
| "From now on every public endpoint goes through the API gateway." | ADR |
| "We added a dead-letter queue last week; the delivery diagram doesn't show it." | Update the canvas doc |
| "Plan how we'll split the monolith's billing module out." | Design doc, plus an ADR if the split sets a rule for future modules |

## Next step

To write a design doc, use the `writing-a-design-doc` skill. When the work is finished or merged, use `closing-out-a-design-doc`.

## If the Archdocs tools are missing

If no Archdocs tools are available, the MCP server isn't connected or signed in. Ask the user to run `/mcp` and sign in to the `archdocs` server. Don't write the design doc as a markdown file in the repository instead; it won't be linked to the catalog, and nobody will find it later.
