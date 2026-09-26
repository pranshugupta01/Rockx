---
name: playwright-test-executor
description: Given a confirmed BDD scenario list (from linear-ticket-reader's parsed comment) and a resolved repo/branch (from github-pr-reader), checks out the branch, starts the app, executes every scenario live via Playwright MCP, diffs results against the prior run for this ticket, and reports pass/fail directly in this session. Called by the ai-test-orchestrator agent as Step 3 of the execution path. Never posts to Linear or GitHub.
effort: low
---

## What this explicitly does NOT do

- Does not call Linear or GitHub MCPs beyond what the caller already resolved — it consumes `repo`/`branch` as given, it doesn't re-resolve them.
- Does not post anything back to the PR or the ticket. The report stays in this session only — the caller relays it to the user verbatim.
- No CI trigger — this only runs when explicitly dispatched by the orchestrator within a human-invoked run.

---

### Step 1 — Check out and run the app

- Assume the working directory is already a clone of the target repo (this flow runs inside whatever sandbox/checkout the caller provides) — `git fetch` + `git checkout` the given branch there. If no local clone is available, say so and ask for the local path rather than assuming one.
- Start the app the way *this specific repo* starts it — check its `package.json` scripts / README / Dockerfile for the actual serve command, don't hardcode one. Wait until it responds on its port before continuing.

### Step 2 — Execute every scenario live via Playwright MCP

For each scenario, in a **fresh isolated browser context** (don't let one scenario's state — cart contents, login session — bleed into the next):

1. `browser_navigate` to the app's local URL.
2. Step through the `Given`/`When` lines as real actions: `browser_snapshot` to read the accessibility tree and find the target element by role/name (never a guessed CSS selector), then `browser_click` / `browser_type` / `browser_fill_form` as the step requires.
3. Take a fresh `browser_snapshot` and check it against the scenario's `Then` — the exact concrete value it specifies. Match → pass. Mismatch → fail; also `browser_take_screenshot` as evidence.
4. Record `{scenario_name, result: pass|fail, evidence}`.

### Step 3 — Diff against the previous run

Read the prior result set for this ticket if one exists (a small JSON file keyed by ticket id — session-scoped, no persistence guarantee needed beyond that). Bucket every scenario by comparing this run to that one:

- **Newly fixed** — failed last time, passes now.
- **Still failing** — failed both times (note if the failure reason changed).
- **Newly broken** — passed last time, fails now. Surface this bucket first and loudest — it's a regression from whatever just got fixed.
- **Unchanged passing** — collapse into a single count, don't list individually.

If there's no prior result for this ticket, this is just a flat pass/fail report — say so rather than presenting an empty diff. Overwrite the stored result with this run's outcome before finishing, so the *next* run has something to diff against.

### Step 4 — Return to caller

Return the (flat or diffed) report as plain text for the caller to relay to the user verbatim in this session — nothing gets posted to the PR or the ticket. The caller closes with something like: *"Fix and re-run against `<ticket-id>` to check again — this diffs against this run."*
