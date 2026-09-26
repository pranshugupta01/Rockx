---
name: github-pr-reader
description: GitHub-only skill. Given a PRD/doc link and/or a PR url/branch (from linear-ticket-reader), fetches the PRD markdown content and/or resolves the PR's repo, branch, and diff/changed files via GitHub MCP. Returns plain content to the caller — never reads or writes Linear, never drives a browser. Called by the ai-test-orchestrator agent as Step 2 of every run.
effort: low
---

## What this explicitly does NOT do

- No Linear MCP calls of any kind (no reading, no posting).
- No Playwright MCP calls, no checking out branches locally, no starting the app — that's `playwright-test-executor`'s job. This skill only resolves *which* repo/branch, it doesn't check it out.
- No test-scenario generation — this skill returns raw content, not scenarios.

---

## Input modes

This skill is called with one or both of:
- **A PRD/doc link** (a wiki page or repo markdown file URL) → fetch its content.
- **A PR url/branch** → resolve repo + branch + diff.

Handle whichever is present; skip the other.

### Mode A — Fetch PRD/doc content

Given a URL matching `^https://github\.com/[^/]+/[^/]+/(wiki|blob)/.*$`:

1. Extract `owner`, `repo`, and the path after `/wiki/` (or after `/blob/`).
2. For a wiki URL like `https://github.com/org/repo/wiki/Page-Name`, the underlying file path is `wiki/Page-Name.md` on the default branch. For a `/blob/` URL, use the path as given (e.g. `prd.md`).
3. Use `mcp__github__get_file_contents` to fetch the raw markdown.
4. If the fetch succeeds, return it verbatim as `prdContent`, tagged `## PRD (from <url>)`.
5. If the fetch fails (404, permissions, not a valid page), do **not** silently return empty content — return an explicit failure signal: *"The PRD link isn't readable via GitHub MCP — check the repo, or ask the user to paste the PRD content."* The caller relays this to the user rather than treating it as "no PRD."

### Mode B — Resolve PR + diff

Given a PR url (`https://github.com/owner/repo/pull/123`) or a bare branch name:

1. `mcp__github__get_pull_request` to resolve `owner`, `repo`, `branch` (head ref), and base branch.
2. `mcp__github__get_pull_request_files` for the changed-files list and diff.
3. Return `{ owner, repo, branch, baseBranch, changedFiles, diffSummary }`.

If the PR can't be resolved (bad url, deleted, no access), return that failure explicitly rather than guessing a branch name.

## Return to caller

```
prdContent: <markdown or null>
prdFetchError: <error message or null>
repo/branch/baseBranch: <if PR mode>
changedFiles/diffSummary: <if PR mode>
```
