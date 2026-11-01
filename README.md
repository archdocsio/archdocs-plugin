# Archdocs plugin for Claude Code, Codex and Cursor

Ask a coding agent to plan a change and it will write a design doc for a typo fix if you let it, then fill every gap it finds with a confident guess. This plugin connects Claude Code, Codex and Cursor to [Archdocs](https://archdocs.io) and adds skills for what a tool list can't teach: when a change deserves a design doc, how to write one to your team's standard, and how to record what actually shipped.

## Install

### Claude Code

```text
/plugin marketplace add archdocsio/archdocs-plugin
/plugin install archdocs@archdocs
```

Then run `/mcp` and sign in to the `archdocs` server. The plugin connects to the hosted MCP server at `https://mcp.archdocs.io/mcp` over OAuth, so there is no token to copy.

### Codex

In a terminal:

```text
codex plugin marketplace add archdocsio/archdocs-plugin
codex plugin list
codex plugin add archdocs@archdocs
codex mcp login archdocs
```

Start a new Codex session to load the skills. The plugin connects to the same hosted MCP server over OAuth.

To remove it:

```text
codex plugin remove archdocs@archdocs
codex plugin marketplace remove archdocs
```

Design docs need an Archdocs Team plan or higher. On a Free plan the agent says so once and carries on without one.

### Cursor

The repository is a Cursor plugin (`.cursor-plugin/plugin.json`) with the same skills, commands and MCP server. Until it's listed in the Cursor Marketplace, add the pieces by hand:

1. Add the MCP server in Cursor Settings > MCP, or in `~/.cursor/mcp.json`:

   ```json
   { "mcpServers": { "archdocs": { "url": "https://mcp.archdocs.io/mcp" } } }
   ```

   Cursor opens the Archdocs sign-in the first time it connects.
2. Copy the folders inside `skills/` into `.cursor/skills/` in your project, or `~/.cursor/skills/` for every project.

## Commands

In Claude Code:

- `/archdocs:design-doc [topic]` decides whether the topic needs a design doc, then starts or continues one.
- `/archdocs:close-out [DD-number]` records pull requests, changes and evidence for a finished design doc.

You don't need the commands. The skills load on their own when you talk about planning a change or finishing one.

## Skills

`using-design-docs` decides between a design doc, an architecture decision record, an update to an existing diagram, or nothing. It checks before an agent starts planning or building a change, reads the rule from the Archdocs server, and proposes a design doc instead of creating one unasked. A design doc is the frozen record of one change. Diagrams and catalog objects describe the system as it is now.

`writing-a-design-doc` covers the work before it starts. It gathers the engineering context for the objects the change touches (standing ADRs, earlier design docs, open questions), raises a conflict with a standing decision as a tracked question instead of resolving it, reads your organization's variation types and follows their instructions, links real catalog objects, imports plan files from Claude Code, Spec Kit or Kiro, and turns every undecided point into a tracked question instead of a guess.

`working-under-a-design-doc` covers the middle, including spikes, verification and live testing. The agent owns the work to its completion boundary (implementation verified, merge-ready, merged, or deployed and verified, read from the request and standing authorization): after a push it follows CI for that revision and fixes what the change broke, addresses review feedback in scope and says where it disagrees, reruns and rechecks evidence that a later commit made stale, and acts on acceptance criteria as it goes. It records findings, decisions, pull requests and changed objects as they happen, in the design doc's Work Log journal when your organization has one, or in a "Deviations from the plan" thread when it doesn't. It resumes from the journal's last handoff, leaves one before stopping, and stops only for a verified outcome, a pending human decision, a concrete blocker or a pause from the user. A push, a PR, a journal entry, a queued check or a handoff is an intermediate step, not the end.

`closing-out-a-design-doc` covers the work after, and starts on its own when the boundary is reached. It builds the evidence from the journal, linked pull requests, recorded changes and the computed verification status, writes each deviation from the plan, keeps implemented, merged and live apart, treats journal claims as reported rather than verified, picks ready or review from the variation's `requiredApprovals`, and leaves approval and the ship decision to a person, naming the one decision that remains.

The skills hold judgment only. Your organization's outlines, brief fields and writing rules come from the server at run time, so editing a variation type in Archdocs changes what the agent writes without updating this plugin.

## Other agents

The skills are plain [Agent Skills](https://agentskills.io) folders. Copy the folders inside `skills/` into `.agents/skills/`, the vendor-neutral skills path, and point your agent's MCP client at `https://mcp.archdocs.io/mcp`. The server also sends a short version of these rules to every MCP client as server instructions.

## Evals

`evals/` runs each scenario through `claude -p` with and without the plugin, against a local Archdocs org, and grades the tool calls. The checks run offline:

```bash
npm test
npm run validate
```

Live runs need a local Archdocs API and two eval orgs. See [evals/BASELINE.md](evals/BASELINE.md) for setup and recorded results.

## Privacy

The plugin sends what you ask the agent to write to your Archdocs organization. See the [Archdocs privacy policy](https://archdocs.io/privacy).

## License

MIT
