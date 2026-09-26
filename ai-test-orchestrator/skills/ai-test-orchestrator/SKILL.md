---
name: ai-test-orchestrator
description: Generic, app-agnostic QA workflow driven from a single Linear ticket. Given only a ticket id, deep-dives the ticket's own description/comments/attachments (no external doc store), generates concrete BDD scenarios, and creates a linked Linear sub-issue holding them. Re-run on the same ticket once a PR is linked — it checks out that PR's branch, executes every scenario live via Playwright MCP against the running app, and reports a pass/fail diff against the previous run directly in this session. Uses only GitHub MCP, Linear MCP, and Playwright MCP. Use whenever asked to generate test cases for a Linear ticket, or to verify a PR's branch against previously generated scenarios — even if the user never names this skill. Auto-invokes /ai-test-orchestrator-setup if any required MCP is missing.
effort: low
---

## What this explicitly does NOT do

- No BrowserStack, no Maestro, no TMS of any kind, no automation-tier tagging.
- No Google Drive, Glean, Figma, Confluence, or Jira reads — the ticket's own description, comments, and attachments text are the *only* spec source. If the real PRD only lives in a linked Google Doc and isn't restated in the ticket, tell the user the spec is thin rather than trying to fetch it.
- No PRD-quality gate, no scope-mode slicing across sibling tickets — this is a single-ticket, single-pass flow.
- No comment-posting to GitHub or Linear as the result surface. The pass/fail report is rendered directly back to the user in this session — never written back to the PR or the ticket. The one thing that *is* written back to Linear is the test-case sub-issue itself (Step 7), because that's meant to be a durable, referenceable artifact, not a transient report.
- No CI trigger. This only runs when a human explicitly invokes it (via the ticket id) — the GitHub-Actions/predictive-testing track is a separate, deferred effort and this skill does not wire into it.

---

### Step 1 — Preflight

Check that `mcp__github__*`, the Linear MCP's tools, and `mcp__playwright__*` are all present. If any is missing, auto-invoke `/ai-test-orchestrator-setup` and continue automatically once it completes.

### Step 2 — Ask for the ticket

Plain-text ask (not `AskUserQuestion` — this is free text): *"What Linear ticket id should I process? e.g. `APP-104`."* One ticket per run — this flow is intentionally not batched.

### Step 3 — Deep-dive the ticket (Linear only)

- `get_issue` on the ticket: `title`, `description`, `labels`, `state`, `parent`, `attachments`.
- `list_comments` for the ticket, chronological — a scope correction or an AC clarification posted as a comment is just as load-bearing as text in the description.
- If `parent` exists, do the same `get_issue`/`list_comments` on the parent for surrounding context.
- Build `ticket_context` = title + description + any explicit AC-style bullets ("should", "must", numbered requirements, Given/When/Then already present) + the comment thread. This is the entire spec — there is no fallback doc to fetch if it's thin. If it genuinely looks too sparse to generate anything meaningful from (a one-line description, no comments, no AC), say so and ask the user to paste the missing detail in plain text rather than guessing.

### Step 4 — Determine ticket state

**4a. Does a test-case sub-issue already exist?**
`list_issues` filtered by `parentId = ticket.id`. A match is any child issue whose title starts with `[Test Cases] `. If found, read its body back — it's plain markdown with one section per scenario (`### Scenario: ...` / `Given` / `When` / `Then` lines) — and parse it back into a scenario list. Set `testCasesExist = true`, `testCaseIssue = <that issue>`.

**4b. Is a PR linked to this ticket?**
Union of: (1) any `attachments[]` URL matching `^https://github\.com/.*/pull/[0-9]+$`; (2) any such URL in the comment thread; (3) `mcp__github__search_code` / `list_pull_requests` on the likely repo (inferred from the org's Linear↔GitHub convention, e.g. branch or PR title containing the ticket key) if nothing was attached directly. Verify any candidate the same way a fix-PR is verified elsewhere in this org's tooling: it must actually reference the ticket key (title/branch/body) — don't guess from a bare number. Set `prAttached = true`, `prUrl`/`branch` recorded, or `false` if nothing verifiable turns up.

### Step 5 — Branch on state

| `testCasesExist` | `prAttached` | Action |
|---|---|---|
| false | — | **Generation path** (Step 6) |
| true | false | Tell the user test cases already exist at `<link>`, no PR is linked yet, nothing to execute. Stop. |
| true | true | **Execution path** (Step 8) |

If the user explicitly asks to regenerate scenarios even though a sub-issue exists, confirm before overwriting it (plain-text ask), then go to Step 6 and update the existing sub-issue in place rather than creating a second one.

---

## Generation path (no test cases yet)

### Step 6 — Generate scenarios

One reasoning pass over `ticket_context` — no nested pipeline, no multi-worker fan-out; this is a single ticket with no PRD/TDD/Figma to enrich against, so that machinery has nothing to add. Produce 4–10 BDD scenarios (`Given` / `When` / `Then`), covering the stated happy path plus the failure modes and boundaries the ticket implies.

Tag each scenario `explicit` (directly stated in the description/comments/AC) or `derived` (you inferred it) — flag `derived` ones so the user can veto anything invented.

**Every `Then` must assert a concrete, checkable value — never vague language.** This is load-bearing, not stylistic: Step 9 has to verify each `Then` by looking at the live app, and it can only do that if the expected value is exact (an exact count, an exact price, an exact message string, an exact URL/route) rather than "works correctly" or "displays appropriately." If the ticket itself doesn't state the exact value, don't invent one — write the scenario with an explicit open question (`Then <the concrete outcome, TBD — needs a number from the ticket author>`) instead of guessing.

Present the list to the user in plain text and let them edit/add/remove/confirm before creating the sub-issue — they own the final list.

### Step 7 — Create the sub-issue

Format the confirmed scenarios as one clean markdown body:

```
## Test Scenarios for <ticket-key>: <ticket title>

### Scenario 1: <name> (explicit)
Given <...>
When <...>
Then <...>

### Scenario 2: <name> (derived — please review)
...
```

Create it via the Linear MCP: `parentId = ticket.id`, `title = "[Test Cases] <ticket title>"`, `body = <the markdown above>`. Report the new sub-issue's link back to the user. **Stop here** — a generation run does not execute anything.

---

## Execution path (test cases exist + a PR is linked)

### Step 8 — Check out and run the app

- Resolve the PR's repo + branch via GitHub MCP.
- Assume the working directory is already a clone of that repo (this flow runs inside whatever sandbox/checkout the caller provides) — `git fetch` + `git checkout` the PR's branch there. If no local clone is available in the working directory, say so and ask for the local path rather than assuming one.
- Start the app the way *this specific repo* starts it — check its `package.json` scripts / README / Dockerfile for the actual serve command, don't hardcode one. Wait until it responds on its port before continuing.

### Step 9 — Execute every scenario live via Playwright MCP

For each scenario from the sub-issue, in a **fresh isolated browser context** (don't let one scenario's state — cart contents, login session — bleed into the next):

1. `browser_navigate` to the app's local URL.
2. Step through the `Given`/`When` lines as real actions: `browser_snapshot` to read the accessibility tree and find the target element by role/name (never a guessed CSS selector), then `browser_click` / `browser_type` / `browser_fill_form` as the step requires.
3. Take a fresh `browser_snapshot` and check it against the scenario's `Then` — the exact concrete value required in Step 6. Match → pass. Mismatch → fail; also `browser_take_screenshot` as evidence.
4. Record `{scenario_name, result: pass|fail, evidence}`.

### Step 10 — Diff against the previous run

Read the prior result set for this ticket if one exists (a small JSON file keyed by ticket id — session-scoped, no persistence guarantee needed beyond that). Bucket every scenario by comparing this run to that one:

- **Newly fixed** — failed last time, passes now.
- **Still failing** — failed both times (note if the failure reason changed).
- **Newly broken** — passed last time, fails now. Surface this bucket first and loudest — it's a regression from whatever just got fixed.
- **Unchanged passing** — collapse into a single count, don't list individually.

If there's no prior result for this ticket, this is just a flat pass/fail report — say so rather than presenting an empty diff. Overwrite the stored result with this run's outcome before finishing, so the *next* run has something to diff against.

### Step 11 — Report

Render the (flat or diffed) report directly back to the user in this session now — nothing gets posted to the PR or the ticket. Close with: *"Fix and re-run `/ai-test-orchestrator <ticket-id>` to check again — I'll diff against this run."*
