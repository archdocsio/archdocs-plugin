# Eval setup and results

No baseline or with-skills eval has been run. The results cells below are intentionally empty.

## Prepare the local eval orgs

1. Start the local API in a separate Archdocs checkout, listening on `http://localhost:4500`. If it is already running, leave it running.
2. Prerequisite: design docs require a Team plan or higher. After the first `node evals/setup-local-orgs.mjs` run, give both eval orgs an active TEAM PlanGrant. Use the back office if your local user is a platform operator, or insert a PlanGrant row for each org in the local dev database with `plan = TEAM`, `seatCount = 5`, `aiOverage = CAPPED`, `grantedById` set to that org's eval user id, and `grantedByEmail` set to that eval user's email. The first setup run fails at design doc settings with HTTP 403 until the grant exists.
3. Run `node evals/setup-local-orgs.mjs` again from this plugin checkout after the grants exist. Set `ARCHDOCS_EVAL_API` to use a different local API URL.
4. Run the evals using the commands below. The runner automatically loads `evals/.eval-env`; existing process environment values take precedence.

The setup script creates or reuses `eval-full@archdocs.test` / `Eval Full` and `eval-lean@archdocs.test` / `Eval Lean`, with same-named organizations, and seeds Cadence through the sample workspace API. It enables approvals, sizes and evidence tracking for full and explicitly disables them for lean. Standard spec and plan types keep their defaults. Organization selection is per API request and bound into each PAT; the API has no persistent active-org field.

Every setup run creates fresh PATs with the owners' MCP permissions and writes them, the generated passwords and both organization ids to the gitignored `evals/.eval-env`. Keep that file for subsequent logins; passwords are reused rather than rotated. Passwords are checkpointed before registration and org ids after login so interrupted runs can resume. Never commit this file or MCP configs containing PATs. Setup reads the sibling `archdocs/apps/api/.env` to check mail configuration before signup, restricts recipients to the non-routable `archdocs.test` domain, and never prints credentials. The current API redirects non-prod mail to Resend sandbox addresses and does not require email verification to log in.

These environment variables can override the generated configuration:

| Variable | Value |
| --- | --- |
| `ARCHDOCS_EVAL_ENDPOINT` | Setup writes `http://localhost:4500/mcp` by default; runner fallback without a file is `http://localhost:3000/mcp` |
| `ARCHDOCS_EVAL_API` | REST API base for reset; defaults to `ARCHDOCS_EVAL_ENDPOINT` with the trailing `/mcp` removed |
| `ARCHDOCS_EVAL_PAT` | PAT for the full org |
| `ARCHDOCS_EVAL_PAT_LEAN` | PAT for the lean org |
| `ARCHDOCS_EVAL_PASSWORD_FULL` / `ARCHDOCS_EVAL_PASSWORD_LEAN` | Stored passwords for `eval-full@archdocs.test` / `eval-lean@archdocs.test`, used to log in for reset |
| `ARCHDOCS_EVAL_ORG_ID` / `ARCHDOCS_EVAL_ORG_ID_LEAN` | Organization ids for the full / lean org, selected on every reset request |
| `ARCHDOCS_EVAL_APPROVED_DD` | Design doc number such as `DD-0004`, required for `amend-approved-plan` |

The runner checks the PATs, stored passwords and org ids for all selected scenarios before making reset or setup calls. Before every run's setup, it logs in with the selected eval user's password and uses the JWT plus `x-organization-id` to delete every design doc and ADR in that org. Design doc listing follows all cursor pages without a status filter, including shipped, abandoned, superseded and draft content. The ADR API lists all ADRs without pagination and exposes a delete route. A reset failure fails the run with a credential-free diagnostic before setup or Claude starts. Each run writes an HTTP MCP config containing the selected PAT under the operating system's temporary directory. It removes that directory in a `finally` block. There is no checked-in eval MCP config template. `evals/mcp.eval.json` remains gitignored.

## Prepare the approved plan manually

`amend-approved-plan` needs a human approval step. There is no MCP tool for approving a variation, and agents cannot approve. In the full org UI, create a design doc with a plan that streams writes to the Event Store. Finish its brief, mark the plan ready and request review as required by the org's rules. Have an eligible person approve the plan variation in the UI before the run. Leave the approved plan with no amendment open. Set `ARCHDOCS_EVAL_APPROVED_DD` to its displayed design doc number, for example `DD-0004`. The expected behavior is that the agent asks the user to open an amendment. The grader checks the last result event's text for `amendment`, ignoring case.

The per-run reset deletes pre-existing approved plans too. The runner therefore fails this scenario explicitly after reset, before starting Claude, even when `ARCHDOCS_EVAL_APPROVED_DD` is set. Running it requires a future manual setup step that creates and approves a fresh streaming plan after reset; the runner never approves a variation. An unset variable stops preflight with an error explaining the human approval step.

## Run evals when ready

Use `node evals/run.mjs --help` to inspect the options without credentials. To record a baseline later, run `node evals/run.mjs --mode without --runs 3`. After adding the skills, run `node evals/run.mjs --mode with --runs 3`. Select one scenario with `--scenario <id>`. Each run starts a fresh Claude process with its prompt on stdin and an isolated temporary working directory. With mode loads this plugin by its absolute directory path. Without mode omits that option. Use a clean Claude profile without this plugin installed globally for a meaningful comparison.

After resetting the org, the runner creates fresh spec and plan fixtures for each applicable run, subject to the manually approved plan limitation above. It reads brief field definitions at runtime and skips computed fields. The open-question fixture adds "Twilio or MessageBird for SMS?". The plan-file fixture writes a temporary Session Cache eviction plan. Fixture writes stay in the eval orgs after the process ends and are deleted before the next run. Keep eval orgs separate from real work, and run eval processes sequentially because each reset deletes the selected org's design docs and ADRs.

Setup skips readiness calls when approvals are disabled because the server gates both readiness and review on that feature. With approvals enabled, it requests review when the type requires approval for STANDARD, otherwise it marks the variation ready. Setup never approves a variation.

Transcripts are saved as `evals/results/<timestamp>/<id>.<mode>.<n>.jsonl`, with known PAT and password values redacted. The console prints failures and a pass-count table. Process failures, malformed JSONL and missing final results fail the run, including scenarios that only forbid tools. Record per-scenario pass counts and failure strings verbatim after running. No results have been inferred from unit tests.

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
