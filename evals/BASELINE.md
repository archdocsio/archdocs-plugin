# Eval setup and results

No baseline or with-skills eval has been run. The results cells below are intentionally empty.

## Prepare the eval orgs manually

1. In a separate Archdocs checkout, start the local app with `pnpm dev` when you are ready to run evals.
2. Create two test orgs in the UI and seed the Cadence sample workspace in each.
3. In the full org, open Settings > Design docs and enable approvals, sizes and evidence tracking. Keep the standard spec and plan types enabled.
4. In the lean org, leave the feature defaults. Keep the standard spec and plan types enabled.
5. Create a PAT in each org. Store them in the environment of the terminal that will run the evals. Never commit PATs or MCP configs containing them.

Set these environment variables in that terminal:

| Variable | Value |
| --- | --- |
| `ARCHDOCS_EVAL_ENDPOINT` | Optional MCP endpoint, default `http://localhost:3000/mcp` |
| `ARCHDOCS_EVAL_PAT` | PAT for the full org |
| `ARCHDOCS_EVAL_PAT_LEAN` | PAT for the lean org |
| `ARCHDOCS_EVAL_APPROVED_DD` | Design doc number such as `DD-0004`, required for `amend-approved-plan` |

The runner checks the PATs for all selected scenarios before making setup calls. Each run writes an HTTP MCP config containing the selected PAT under the operating system's temporary directory. It removes that directory in a `finally` block. There is no checked-in eval MCP config template. `evals/mcp.eval.json` remains gitignored.

## Prepare the approved plan manually

`amend-approved-plan` needs a human approval step. There is no MCP tool for approving a variation, and agents cannot approve. In the full org UI, create a design doc with a plan that streams writes to the Event Store. Finish its brief, mark the plan ready and request review as required by the org's rules. Have an eligible person approve the plan variation in the UI before the run. Leave the approved plan with no amendment open. Set `ARCHDOCS_EVAL_APPROVED_DD` to its displayed design doc number, for example `DD-0004`. The expected behavior is that the agent asks the user to open an amendment. The grader checks the last result event's text for `amendment`, ignoring case.

The runner uses that existing number instead of creating a fixture for this scenario. Restore or prepare an approved streaming plan with no amendment open before each independent trial. For this scenario, run one trial at a time with `--runs 1` and select one mode so a previous trial cannot affect the next trial. An unset variable stops setup with an error explaining the human approval step.

## Run evals when ready

Use `node evals/run.mjs --help` to inspect the options without credentials. To record a baseline later, run `node evals/run.mjs --mode without --runs 3`. After adding the skills, run `node evals/run.mjs --mode with --runs 3`. Select one scenario with `--scenario <id>`. Each run starts a fresh Claude process with its prompt on stdin and an isolated temporary working directory. With mode loads this plugin by its absolute directory path. Without mode omits that option. Use a clean Claude profile without this plugin installed globally for a meaningful comparison.

The runner creates fresh spec and plan fixtures for each applicable run, except for the manually approved plan above. It reads brief field definitions at runtime and skips computed fields. The open-question fixture adds "Twilio or MessageBird for SMS?". The plan-file fixture writes a temporary Session Cache eviction plan. Fixture writes stay in the eval orgs after the process ends. Reset the seeded workspaces between independent scenario comparisons, especially SMS design scenarios, so earlier docs do not affect duplicate detection. Keep eval orgs separate from real work.

Setup skips readiness calls when approvals are disabled because the server gates both readiness and review on that feature. With approvals enabled, it requests review when the type requires approval for STANDARD, otherwise it marks the variation ready. Setup never approves a variation.

Transcripts are saved as `evals/results/<timestamp>/<id>.<mode>.<n>.jsonl`, with known PAT values redacted. The console prints failures and a pass-count table. Process failures, malformed JSONL and missing final results fail the run, including scenarios that only forbid tools. Record per-scenario pass counts and failure strings verbatim after running. No results have been inferred from unit tests.

| scenario | baseline (without) | with skills |
| --- | --- | --- |
| typo-fix-no-doc | | |
| decision-only-adr | | |
| living-what-update | | |
| spec-for-multi-service-change | | |
| existing-design-doc | | |
| import-plan-file | | |
| amend-approved-plan | | |
| lean-org-close-out | | |
| full-org-close-out | | |
| answer-relayed-decision | | |
