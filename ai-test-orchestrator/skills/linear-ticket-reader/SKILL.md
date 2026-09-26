---
name: linear-ticket-reader
description: Linear-only skill. Given a PRA-<number> ticket id, deep-dives the ticket's own description/comments/attachments/parent, detects whether test scenarios already exist on it and whether a PR is linked, and extracts any GitHub PRD/doc link found in attachments or comments. Returns ticket context + state to the caller — never fetches GitHub file contents itself. Called by the ai-test-orchestrator agent as Step 1 of every run.
effort: low
---

## What this explicitly does NOT do

- Does not call any GitHub MCP tool. If a PRD/doc link is found, it is returned as a plain URL for `github-pr-reader` to fetch — this skill only extracts the link.
- Does not call Playwright MCP, and does not post anything to Linear (no comments written here — that's `generate-bdd-tests`'s job).
- No Google Drive, Glean, Figma, or Confluence reads.

---

### Step 1 — Fetch the ticket

Given the ticket id (e.g. `PRA-104`):
- `get_issue`: `title`, `description`, `labels`, `state`, `parent`, `attachments`.
- `list_comments`, chronological — a scope correction or AC clarification posted as a comment is just as load-bearing as text in the description.
- If `parent` exists, do the same `get_issue`/`list_comments` on the parent for surrounding context.

If the ticket id doesn't resolve, report that clearly to the caller rather than guessing at a similar id.

### Step 2 — Extract a PRD/doc link (do not fetch it)

Scan `attachments[]` and the comment thread for any URL matching `^https://github\.com/[^/]+/[^/]+/(wiki|blob)/.*$` (wiki pages, repo markdown files like `prd.md`, etc.).

- If exactly one match: return it as `prdLink`.
- If more than one match: return all candidates to the caller and let the caller (or the user, via the caller) pick — never guess which one is THE PRD.
- If none: `prdLink = null`. This is not an error — plenty of tickets have no linked doc.

### Step 3 — Detect existing test scenarios

Scan the comment thread for any comment whose body begins with the exact sentinel heading `## Test Scenarios for <ticket-key>:`. If found:
- `testCasesExist = true`
- `testCasesCommentId` = that comment's id
- `testCasesCommentBody` = that comment's body, parsed back into a scenario list (one section per `### Scenario N: ...` / `Given` / `When` / `Then` block)

If multiple matching comments exist (e.g. a previous run that wasn't cleaned up), use the **latest** one — earlier runs are stale. If none found, `testCasesExist = false`.

### Step 4 — Detect a linked PR

Union of:
1. Any `attachments[]` URL matching `^https://github\.com/.*/pull/[0-9]+$`.
2. Any such URL in the comment thread.
3. `mcp__github__search_code` / `list_pull_requests` on the likely repo (inferred from the org's Linear↔GitHub convention — branch or PR title containing the ticket key) if nothing was attached directly.

Verify any candidate actually references the ticket key (title/branch/body) — don't guess from a bare number.

- Found and verified → `prAttached = true`, return `prUrl` and `branch`.
- Nothing verifiable → `prAttached = false`.

### Step 5 — Return to caller

Return, as plain text/structured summary:

```
ticketContext: <title + description + AC-style bullets + comment thread, concatenated>
prdLink: <url or null>
testCasesExist: <bool>
testCasesCommentId: <id or null>
scenarios: <parsed scenario list, if testCasesExist>
prAttached: <bool>
prUrl / branch: <if prAttached>
```

If, after this, `ticketContext` still looks too sparse to be useful (a one-line description, no comments, no AC, no PRD link) — say so explicitly in the return so the orchestrator can ask the user to paste the missing detail, rather than the pipeline silently generating weak scenarios downstream.
