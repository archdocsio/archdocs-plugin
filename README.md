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

`writing-a-design-doc` covers the work before shipping. It reads your organization's variation types and follows their instructions, links real catalog objects, imports plan files from Claude Code, Spec Kit or Kiro, and turns every undecided point into a tracked question instead of a guess.

`working-under-a-design-doc` covers the middle. It records decisions, pull requests and changed objects as they happen. When the code drifts from the plan, it adds an entry to a "Deviations from the plan" thread instead of rewriting the plan.

`closing-out-a-design-doc` covers the work after. It links pull requests, records changed objects, writes the evidence with each deviation from the plan, and leaves approval and shipping to a person.

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
