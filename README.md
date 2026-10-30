# Archdocs plugin for Claude Code

Ask a coding agent to plan a change and it will write a design doc for a typo fix if you let it, then fill every gap it finds with a confident guess. This plugin connects Claude Code to [Archdocs](https://archdocs.io) and adds skills for what a tool list can't teach: when a change deserves a design doc, how to write one to your team's standard, and how to record what actually shipped.

## Install

In Claude Code:

```text
/plugin marketplace add archdocsio/archdocs-plugin
/plugin install archdocs@archdocs
```

Then run `/mcp` and sign in to the `archdocs` server. The plugin connects to the hosted MCP server at `https://mcp.archdocs.io/mcp` over OAuth, so there is no token to copy.

## Commands

- `/archdocs:design-doc [topic]` decides whether the topic needs a design doc, then starts or continues one.
- `/archdocs:close-out [DD-number]` records pull requests, changes and evidence for a finished design doc.

You don't need the commands. The skills load on their own when you talk about planning a change or finishing one.

## Skills

`using-design-docs` decides between a design doc, an architecture decision record, an update to an existing diagram, or nothing. A design doc is the frozen record of one change. Diagrams and catalog objects describe the system as it is now.

`writing-a-design-doc` covers the work before shipping. It reads your organization's variation types and follows their instructions, links real catalog objects, imports plan files from Claude Code, Spec Kit or Kiro, and turns every undecided point into a tracked question instead of a guess.

`closing-out-a-design-doc` covers the work after. It links pull requests, records changed objects, writes the evidence with each deviation from the plan, and leaves approval and shipping to a person.

The skills hold judgment only. Your organization's outlines, brief fields and writing rules come from the server at run time, so editing a variation type in Archdocs changes what the agent writes without updating this plugin.

## Other agents

The skills are plain [Agent Skills](https://agentskills.io) folders. Copy `skills/` into another agent's skills directory and point that agent's MCP client at `https://mcp.archdocs.io/mcp`. The server also sends a short version of these rules to every MCP client as server instructions.

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
