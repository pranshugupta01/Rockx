---
name: ai-test-orchestrator
description: Generic, app-agnostic QA workflow driven from a single Linear ticket. Given only a ticket id, deep-dives the ticket's own description/comments/attachments (no external doc store), generates concrete BDD scenarios, and posts them as a comment back on the same Linear ticket. Re-run on the same ticket once a PR is linked — it checks out that PR's branch, executes every scenario live via Playwright MCP against the running app, and reports a pass/fail diff against the previous run directly in this session. Uses only GitHub MCP, Linear MCP, and Playwright MCP — assumed already connected, no setup step. Use whenever asked to generate test cases for a Linear ticket, or to verify a PR's branch against previously generated scenarios — even if the user never names this skill.
effort: low
---

## What this explicitly does NOT do

- No BrowserStack, no Maestro, no TMS of any kind, no automation-tier tagging.
- No Google Drive, Glean, Figma, Confluence, or Jira reads — but **GitHub wiki links attached to the ticket ARE fetched** (they're an attachment, not a separate doc store). The flow allows exactly ONE external doc source: a GitHub wiki page attached to the ticket. Anything else (Google Doc, Confluence, Figma, etc.) is treated as a thin-spec signal and surfaced to the user.
- No PRD-quality gate, no scope-mode slicing across sibling tickets — this is a single-ticket, single-pass flow.
- The one thing written back to Linear is the test-scenarios comment on the same ticket (Step 6) — it's a durable referenceable artifact, not a transient report. No PR comments, no sub-issues, no other tickets. Pass/fail reports stay in this session only.
- No CI trigger. This only runs when a human explicitly invokes it (via the ticket id) — the GitHub-Actions/predictive-testing track is a separate, deferred effort and this skill does not wire into it.

---

### Step 1 — Ask for the ticket

Plain-text ask (not `AskUserQuestion` — this is free text): *"What Linear ticket id should I process? e.g. `APP-104`."* One ticket per run — this flow is intentionally not batched.

### Step 2 — Deep-dive the ticket (Linear only)

- `get_issue` on the ticket: `title`, `description`, `labels`, `state`, `parent`, `attachments`.
- `list_comments` for the ticket, chronological — a scope correction or an AC clarification posted as a comment is just as load-bearing as text in the description.
- If `parent` exists, do the same `get_issue`/`list_comments` on the parent for surrounding context.

**2a. GitHub wiki PRD fetch** (when a wiki link is attached). Scan `attachments[]` for any URL matching `^https://github\.com/[^/]+/[^/]+/(wiki|blob)/.*$` — wiki pages, repo markdown files, etc. The ticket author's intent is clearly that *this* attachment is the PRD, so treat it as the authoritative spec source:
   - Extract `owner`, `repo`, and the path after `/wiki/` (or after `/blob/`) from the URL. For a wiki URL like `https://github.com/org/repo/wiki/Page-Name`, the path is `Page-Name`.
   - Use GitHub MCP (`mcp__github__get_file_contents`) to fetch the raw markdown. For a wiki page, the underlying file path is `wiki/Page-Name.md` on the default branch.
   - If the fetch returns markdown, prepend it to `ticket_context` as `## PRD (from wiki)\n\n<markdown content>` — it is the spec, the ticket description is supplemental context.
   - If the fetch fails (404, permissions, not a wiki page), tell the user: *"The PRD wiki link in the attachments isn't readable via GitHub MCP — check the repo, or paste the PRD content here."* Do NOT silently fall back to ticket-description-only; that produced poor scenarios when this exact case failed in testing.
   - Multiple wiki/doc attachments: if more than one URL matches the wiki/blob pattern, present them to the user (plain text) and ask which one is THE PRD before fetching. Never guess.
- Build `ticket_context` = title + description + any explicit AC-style bullets ("should", "must", numbered requirements, Given/When/Then already present) + the comment thread + PRD markdown from the wiki (if attached and fetched). This is the entire spec. If after the wiki fetch the context still looks too sparse to generate anything meaningful from (a one-line description, no comments, no AC), say so and ask the user to paste the missing detail in plain text rather than guessing.

### Step 3 — Determine ticket state

**3a. Does a test-scenarios comment already exist on this ticket?**
Scan the ticket's comment thread (already fetched in Step 2) for any comment whose body begins with the exact sentinel heading `## Test Scenarios for <ticket-key>:`. If found, parse the body back — it's plain markdown with one section per scenario (`### Scenario N: ...` / `Given` / `When` / `Then` lines) — into a scenario list. Set `testCasesExist = true`, `testCasesCommentId = <that comment id>`, `testCasesCommentBody = <that body>`. If multiple matching comments exist (e.g. from a previous run that wasn't updated), use the **latest** one — earlier runs are stale.

**3b. Is a PR linked to this ticket?**
Union of: (1) any `attachments[]` URL matching `^https://github\.com/.*/pull/[0-9]+$`; (2) any such URL in the comment thread; (3) `mcp__github__search_code` / `list_pull_requests` on the likely repo (inferred from the org's Linear↔GitHub convention, e.g. branch or PR title containing the ticket key) if nothing was attached directly. Verify any candidate the same way a fix-PR is verified elsewhere in this org's tooling: it must actually reference the ticket key (title/branch/body) — don't guess from a bare number. Set `prAttached = true`, `prUrl`/`branch` recorded, or `false` if nothing verifiable turns up.

### Step 4 — Branch on state

| `testCasesExist` | `prAttached` | Action |
|---|---|---|
| false | — | **Generation path** (Step 5) |
| true | false | Tell the user test scenarios already exist as a comment on this ticket (point to the comment), no PR is linked yet, nothing to execute. Stop. |
| true | true | **Execution path** (Step 7) |

If the user explicitly asks to regenerate scenarios even though a comment with scenarios already exists, confirm before overwriting (plain-text ask), then go to Step 5 and UPDATE the existing comment in place (delete the old comment by id, post the new one) rather than leaving two stale comments side-by-side.

---

## Generation path (no test cases yet)

### Step 5 — Generate scenarios

One reasoning pass over `ticket_context` — no nested pipeline, no multi-worker fan-out; this is a single ticket with no PRD/TDD/Figma to enrich against, so that machinery has nothing to add. Produce 4–10 BDD scenarios (`Given` / `When` / `Then`), covering the stated happy path plus the failure modes and boundaries the ticket implies.

Tag each scenario `explicit` (directly stated in the description/comments/AC) or `derived` (you inferred it) — flag `derived` ones so the user can veto anything invented.

**Every `Then` must assert a concrete, checkable value — never vague language.** This is load-bearing, not stylistic: Step 8 has to verify each `Then` by looking at the live app, and it can only do that if the expected value is exact (an exact count, an exact price, an exact message string, an exact URL/route) rather than "works correctly" or "displays appropriately." If the ticket itself doesn't state the exact value, don't invent one — write the scenario with an explicit open question (`Then <the concrete outcome, TBD — needs a number from the ticket author>`) instead of guessing.

Present the list to the user in plain text and let them edit/add/remove/confirm before posting it as a comment — they own the final list.

### Step 6 — Post the scenarios as a comment on this ticket

Format the confirmed scenarios as one clean markdown body. Each scenario carries a `[source]` tag so reviewers can see whether it came from the wiki PRD, ticket description, or derivation:

```
## Test Scenarios for <ticket-key>: <ticket title>

**PRD source:** <linked wiki URL or "ticket-only" if none>  |  **Ticket:** <linear-link>
**Generated:** <ISO timestamp>

### Scenario 1: <name> [explicit · PRD]
Given <...>
When <...>
Then <...>

### Scenario 2: <name> [explicit · ticket]
Given <...>
When <...>
Then <...>

### Scenario 3: <name> [derived — please review]
...
```

Post it via the Linear MCP as a COMMENT on the same ticket (`createComment` with `issueId = ticket.id`, `body = <the markdown above>`). The sentinel heading `## Test Scenarios for <ticket-key>:` lets Step 3a find this comment on the next run.

**If a previous test-scenarios comment already exists** (from Step 4's `testCasesCommentId`):
1. Post the new comment FIRST (Linear's API doesn't let you edit a comment in place via `createComment`; edit-paths vary by Linear version).
2. Then delete the old comment by id (`deleteComment` or whatever the Linear MCP exposes for comment deletion).
3. If delete fails, leave both and tell the user — never silently swap one for the other.

Report the new comment's link back to the user. **Stop here** — a generation run does not execute anything.

---

## Execution path (test cases exist + a PR is linked)

### Step 7 — Check out and run the app

- Resolve the PR's repo + branch via GitHub MCP.
- Assume the working directory is already a clone of that repo (this flow runs inside whatever sandbox/checkout the caller provides) — `git fetch` + `git checkout` the PR's branch there. If no local clone is available in the working directory, say so and ask for the local path rather than assuming one.
- Start the app the way *this specific repo* starts it — check its `package.json` scripts / README / Dockerfile for the actual serve command, don't hardcode one. Wait until it responds on its port before continuing.

### Step 8 — Execute every scenario live via Playwright MCP

For each scenario from the sub-issue, in a **fresh isolated browser context** (don't let one scenario's state — cart contents, login session — bleed into the next):

1. `browser_navigate` to the app's local URL.
2. Step through the `Given`/`When` lines as real actions: `browser_snapshot` to read the accessibility tree and find the target element by role/name (never a guessed CSS selector), then `browser_click` / `browser_type` / `browser_fill_form` as the step requires.
3. Take a fresh `browser_snapshot` and check it against the scenario's `Then` — the exact concrete value required in Step 5. Match → pass. Mismatch → fail; also `browser_take_screenshot` as evidence.
4. Record `{scenario_name, result: pass|fail, evidence}`.

### Step 9 — Diff against the previous run

Read the prior result set for this ticket if one exists (a small JSON file keyed by ticket id — session-scoped, no persistence guarantee needed beyond that). Bucket every scenario by comparing this run to that one:

- **Newly fixed** — failed last time, passes now.
- **Still failing** — failed both times (note if the failure reason changed).
- **Newly broken** — passed last time, fails now. Surface this bucket first and loudest — it's a regression from whatever just got fixed.
- **Unchanged passing** — collapse into a single count, don't list individually.

If there's no prior result for this ticket, this is just a flat pass/fail report — say so rather than presenting an empty diff. Overwrite the stored result with this run's outcome before finishing, so the *next* run has something to diff against.

### Step 10 — Report

Render the (flat or diffed) report directly back to the user in this session now — nothing gets posted to the PR or the ticket. Close with: *"Fix and re-run `/ai-test-orchestrator <ticket-id>` to check again — I'll diff against this run."*
