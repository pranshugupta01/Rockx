---
name: generate-bdd-tests
description: Given ticket context (from linear-ticket-reader) and optional PRD content (from github-pr-reader), generates 4-10 concrete BDD scenarios (Given/When/Then), lets the user confirm/edit them, then posts them as a comment on the Linear ticket. The only skill in this pipeline that writes to Linear. Called by the ai-test-orchestrator agent as Step 3 of the generation path.
effort: low
---

## What this explicitly does NOT do

- Does not call GitHub or Playwright MCPs.
- Does not decide whether to run — the caller (orchestrator) only dispatches this when `testCasesExist = false`.
- Does not execute anything — a generation run never touches Playwright or a running app.

---

### Step 1 — Generate scenarios

One reasoning pass over the combined ticket context + PRD content (if any) — no nested pipeline, no multi-worker fan-out. Produce 4–10 BDD scenarios (`Given` / `When` / `Then`) covering the stated happy path plus the failure modes and boundaries the ticket/PRD implies.

Tag each scenario `explicit` (directly stated in the description/comments/AC/PRD) or `derived` (inferred) — flag `derived` ones so the user can veto anything invented.

**Every `Then` must assert a concrete, checkable value — never vague language.** This is load-bearing: `playwright-test-executor` has to verify each `Then` against the live app, and it can only do that if the expected value is exact (an exact count, an exact price, an exact message string, an exact URL/route) rather than "works correctly" or "displays appropriately." If the source material doesn't state the exact value, don't invent one — write the scenario with an explicit open question (`Then <the concrete outcome, TBD — needs a number from the ticket author>`) instead of guessing.

### Step 2 — Confirm with the user

Present the list to the user in plain text and let them edit/add/remove/confirm before posting — they own the final list.

### Step 3 — Post the scenarios as a comment on the ticket

Format the confirmed scenarios as one clean markdown body, each scenario carrying a `[source]` tag so reviewers can see whether it came from the PRD, the ticket, or derivation:

```
## Test Scenarios for <ticket-key>: <ticket title>

**PRD source:** <linked doc URL or "ticket-only" if none>  |  **Ticket:** <linear-link>
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

Post it via Linear MCP as a comment on the ticket (`createComment`, `issueId = ticket.id`, `body = <markdown above>`). The sentinel heading `## Test Scenarios for <ticket-key>:` is what lets `linear-ticket-reader` find this comment on the next run — never change its wording.

**If a previous test-scenarios comment already exists** (caller passed `testCasesCommentId` because the user explicitly asked to regenerate):
1. Post the new comment first (Linear's API doesn't reliably support in-place comment edits).
2. Then delete the old comment by id.
3. If delete fails, leave both and tell the user — never silently swap one for the other.

### Step 4 — Return to caller

Return the new comment's link and the final confirmed scenario list. This skill's run ends here — it does not execute anything.
