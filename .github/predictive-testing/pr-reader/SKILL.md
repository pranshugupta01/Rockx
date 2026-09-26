---
name: pr-reader
description: Fetch and analyze open Pull Requests from the your GitHub organization. Extracts PR metadata, description, changed files, code diffs, dependencies, review comments (formal reviews + inline code comments + PR conversation), and commit messages. Use when the user asks to read a PR, analyze PR changes, list open PRs, or before generating test cases for a PR.
---

# PR Reader

Fetch PR data from your GitHub org using GitHub MCP (`mcp__github__*` tools) and produce a structured JSON output. This skill is the **data provider** for downstream skills like `generate-pr-test-cases`.

## When to Use

- User asks to read, analyze, or summarize a PR
- User asks to list open PRs for a repo or the org
- User wants to generate test cases for a PR (this skill fetches the data first)
- User says "read PR #1234", "what changed in this PR", "analyze this pull request"

## Prerequisites

- **GitHub MCP** tools (`mcp__github__*`) available in the session
- Read access to the target repository

## Workflow

```
Progress:
- [ ] Step 1: Identify target (PR number, repo, or org-wide scan)
- [ ] Step 2: Fetch PR metadata, description, and review data
- [ ] Step 2b: Fetch inline code review comments
- [ ] Step 3: Fetch changed files and diffs
- [ ] Step 3b: Classify changed files (source, test, config, migration, schema, etc.)
- [ ] Step 4: Detect dependencies
- [ ] Step 5: Output structured JSON
```

### Step 1: Identify Target

Determine what the user wants to analyze:

| Input | Action |
|-------|--------|
| PR number (e.g., "PR #1234") | Analyze that specific PR |
| PR URL (e.g., `github.com/your-org/phoenix/pull/1234`) | Extract owner/repo/number, analyze that PR |
| Repository name (e.g., "phoenix") | List open PRs for `your-org/{repo}` |
| "all" or org-wide | List open PRs across the org |

If the user provides a PR URL or number without a repo, check if the current directory is a git repo and infer from the remote (local git, not a GitHub API call — no MCP tool needed):

```bash
git remote get-url origin
```
Parse `owner/repo` out of the resulting URL (works for both `https://github.com/owner/repo.git` and `git@github.com:owner/repo.git` forms).

### Step 2: Fetch PR Metadata, Description, and Review Data

**For a specific PR, issue these GitHub MCP calls:**

- `mcp__github__get_pull_request(owner, repo, pull_number)` — core metadata: `number`, `title`, `body` (the PR description — contains acceptance criteria, context, linked tickets), `user.login` (author), `state`, `labels`, `base.ref` (base branch), `head.ref`, `html_url`, `created_at`.
- `mcp__github__get_pull_request_comments(owner, repo, pull_number)` — **known gap:** GitHub actually has two distinct comment endpoints — general PR-conversation comments (issue-style, on the PR as a whole) and inline review comments (line-level, on the diff). This tool's name suggests it maps to the inline/review-comment endpoint. There is no separate MCP tool in this session's GitHub toolset for the general issue-style PR conversation. Use this call for Step 2b's inline comments (below); if it turns out to also return general conversation comments, use it for both and drop the duplicate call — otherwise, general PR-conversation comments are simply unavailable through GitHub MCP right now and this skill should degrade by omitting `type: "pr_comment"` entries rather than guessing.
- `mcp__github__get_pull_request_reviews(owner, repo, pull_number)` — formal review submissions (approve/request-changes/comment) with body text and `state` per review. Derive `review_decision` (`APPROVED` / `CHANGES_REQUESTED` / `REVIEW_REQUIRED`) yourself from the most recent review state per reviewer — there is no separate "overall decision" field on this tool, unlike `gh pr view`'s `reviewDecision`.
- `mcp__github__list_commits(owner, repo, sha: head.ref)` — commits on the PR's head branch, showing per-change intent. This is a best-effort substitute: `list_commits` is a general repo-commits tool scoped by branch/SHA, not a PR-specific "commits on this PR" endpoint the way `gh pr view --json commits` was — for a head branch that's still ahead of base with no rebase noise this is equivalent, but on a branch with a messy history it may include commits that predate the PR. If that's a problem in practice, filter by comparing against the PR's `base.sha`.

Extract:
- `number`, `title`, `url`, `author.login`, `state`
- `body` -- this is the PR description (contains acceptance criteria, context, linked tickets)
- `labels` -- array of label names
- `base_branch` -- base branch (main/master)
- `created_at`
- `comments` -- PR-level conversation comments (general discussion, not inline on code)
- `reviews` -- formal review submissions (approve/request-changes/comment) with body text
- `commits` -- individual commit SHAs and messages showing per-change intent
- `review_decision` -- overall review status (APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED) — derived as above

**Build the `review_comments` array:** Combine three sources into a single unified array:

1. **Review bodies** (`reviews`): For each review with a non-empty `body`, add an entry with `type: "review_body"`. These contain the reviewer's overall assessment (e.g., "Looks good but I'm worried about the cache invalidation path").
2. **PR conversation comments** (`comments`): For each comment, add an entry with `type: "pr_comment"`. These are general discussion threads on the PR.
3. **Inline code comments** from Step 2b (added next).

Each entry in the array:
```json
{
  "author": "reviewer.login",
  "body": "comment text",
  "type": "review_body | inline | pr_comment",
  "file_path": null,
  "line": null,
  "created_at": "2026-02-19T..."
}
```

`file_path` and `line` are only populated for `type: "inline"` comments (from Step 2b).

**Build the `commits` array:** For each commit from the `commits` field:
```json
{
  "sha": "abc1234",
  "message": "fix race condition in session cleanup",
  "author": "dev.login"
}
```

**For listing open PRs in a repo:**

```
mcp__github__list_pull_requests(owner, repo, state: "open")
```

Present the list to the user and ask which PR(s) to analyze in detail.

### Step 2b: Fetch Inline Code Review Comments

Inline comments are line-level comments on specific files in the diff — the most valuable source for test generation because they point directly at code concerns.

```
mcp__github__get_pull_request_comments(owner, repo, pull_number)
```

For each inline comment, add an entry to the `review_comments` array with:
- `type`: `"inline"`
- `file_path`: the file the comment is on (from `path` field)
- `line`: the line number (from `line` or `original_line` field)
- `author`: from `user.login`
- `body`: the comment text
- `created_at`: from `created_at`

If the call fails (rate limit, permissions), log a warning and proceed with review bodies and PR comments only — inline comments are additive.

### Step 3: Fetch Changed Files and Diffs

**Get the file list, status, and per-file diff in one call:**

```
mcp__github__get_pull_request_files(owner, repo, pull_number)
```

This returns, per file: `filename` (path), `status` (added/modified/removed), `additions`, `deletions`, and `patch` — the unified diff hunk for that file. This single call covers what previously took two `gh` calls (name-only listing + full diff) plus the per-file additions/deletions lookup, since the GitHub API's PR-files endpoint already includes all of it. Note: GitHub's API omits `patch` for files above its internal diff-size threshold — if `patch` is missing on a file you need full content for, fall back to `mcp__github__get_file_contents(owner, repo, path, ref: head.ref)` for that file only.

For large PRs (>5000 lines of diff), warn the user and ask whether to:
- Fetch diffs for all files (may be slow / large)
- Fetch diffs only for source files (skip lockfiles, auto-generated, assets)
- Fetch diffs for specific files the user selects

**Filter out noise by default:** Skip diffs for files matching these patterns (still list them in `changed_files` but with `"diff": null`):
- `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- `*.generated.*`, `*.snap`
- Binary files, images, fonts

### Step 3b: Classify Changed Files

Classify each file in `changed_files` into a category based on its path. This enables downstream skills to auto-detect migration changes, contract changes, feature flag toggles, etc.

**Classification rules (apply first match):**

| Category | Path Patterns |
|----------|--------------|
| `test` | `*.test.*`, `*.spec.*`, `*__tests__*`, `*_test.*`, `*_spec.*`, `test/**`, `tests/**` |
| `migration` | `**/migrations/**`, `**/migrate/**`, `*.sql` (under db/), `**/db/**/*.ts` |
| `schema_contract` | `*.proto`, `*.graphql`, `*.gql`, `*openapi*`, `*swagger*`, `*.avsc`, `*.avdl` |
| `feature_flag` | `*feature*flag*`, `*launch*darkly*`, `*split*`, `*unleash*`, `*feature*toggle*` |
| `ci_config` | `.github/**`, `Jenkinsfile`, `.circleci/**`, `.gitlab-ci.yml` |
| `helm_k8s` | `**/helm/**`, `**/k8s/**`, `**/deploy/**`, `Chart.yaml`, `**/charts/**` |
| `config` | `*.yml`, `*.yaml` (not CI), `*.toml`, `*.env*`, `Dockerfile*`, `docker-compose*`, `*.json` (not source) |
| `source` | everything else |

For `config` vs `source` disambiguation on `.json` files: treat `package.json`, `tsconfig*.json`, `.eslintrc.json`, `*.config.json` as `config`. Treat `.json` files under `src/` as `source`.

**Build two outputs:**

1. `file_classifications` — an object mapping each category to an array of file paths:
```json
{
  "config": ["docker-compose.yml"],
  "migration": ["src/migrations/202601-add-mfa.ts"],
  "schema_contract": [],
  "feature_flag": [],
  "test": ["src/users/users.service.test.ts"],
  "ci_config": [],
  "helm_k8s": ["deploy/helm/values-common.yaml"],
  "source": ["src/users/users.service.ts"]
}
```

2. `change_surface` — a single string summarizing what kind of change this PR is:
   - `"test-only"` — all changed files are tests
   - `"infra-only"` — all changed files are config, ci_config, or helm_k8s (no source or test)
   - `"cross-service"` — PR modifies schema_contract, helm_k8s, or config files that contain service URLs
   - `"single-service"` — default — PR modifies source files in one service

3. `has_breaking_changes` — boolean. Set to `true` if any of these are detected:
   - `schema_contract` files are modified (proto, graphql, openapi changes)
   - `migration` files are present (database schema changes)
   - Deleted files that are imported by other files (detected from diff context)

### Step 4: Detect Dependencies

Parse the PR body (`body` field from Step 2) for dependency signals:

| Pattern | Relationship |
|---------|-------------|
| `depends on #123`, `requires #123` | `depends_on` |
| `blocked by #123` | `blocked_by` |
| `related to #123`, `see also #123` | `related` |
| `closes #123`, `fixes #123` | `closes` |
| Cross-repo: `your-org/phoenix-bff#456` | Parse as `owner/repo#number` |

For each linked PR, fetch its basic metadata:

```
mcp__github__get_pull_request(owner, repo, pull_number: {NUMBER})
```

### Step 5: Output Structured JSON

Produce the following JSON. This is the **contract** that downstream skills consume.

```json
{
  "pr": {
    "number": 1234,
    "title": "Add user authentication flow",
    "url": "https://github.com/your-org/phoenix/pull/1234",
    "description": "## Summary\nImplements OAuth2 authentication...\n\n## Acceptance Criteria\n- [ ] User can log in with email/password\n- [ ] Biometric auth works on supported devices",
    "author": "vishwas.krishna",
    "state": "open",
    "labels": ["feature", "needs-review"],
    "base_branch": "main",
    "created_at": "2026-02-19T10:00:00Z"
  },
  "changed_files": [
    {
      "path": "src/auth/LoginScreen.tsx",
      "status": "added",
      "additions": 120,
      "deletions": 0
    },
    {
      "path": "src/auth/BiometricAuth.ts",
      "status": "modified",
      "additions": 45,
      "deletions": 12
    },
    {
      "path": "src/auth/OldAuth.ts",
      "status": "deleted",
      "additions": 0,
      "deletions": 85
    }
  ],
  "code_diffs": [
    {
      "path": "src/auth/LoginScreen.tsx",
      "diff": "--- /dev/null\n+++ b/src/auth/LoginScreen.tsx\n@@ -0,0 +1,120 @@\n+import React from 'react';\n+..."
    },
    {
      "path": "src/auth/BiometricAuth.ts",
      "diff": "--- a/src/auth/BiometricAuth.ts\n+++ b/src/auth/BiometricAuth.ts\n@@ -10,6 +10,18 @@..."
    },
    {
      "path": "package-lock.json",
      "diff": null
    }
  ],
  "review_comments": [
    {
      "author": "tech.lead",
      "body": "This could break cache invalidation if TTL is negative — add a guard.",
      "type": "inline",
      "file_path": "src/cache/CacheService.ts",
      "line": 42,
      "created_at": "2026-02-19T14:30:00Z"
    },
    {
      "author": "senior.dev",
      "body": "Overall LGTM. One concern: the biometric fallback path doesn't handle expired tokens.",
      "type": "review_body",
      "file_path": null,
      "line": null,
      "created_at": "2026-02-19T15:00:00Z"
    },
    {
      "author": "qa.engineer",
      "body": "Have we tested this with accounts that have MFA disabled?",
      "type": "pr_comment",
      "file_path": null,
      "line": null,
      "created_at": "2026-02-19T16:00:00Z"
    }
  ],
  "commits": [
    {
      "sha": "a1b2c3d",
      "message": "feat: add OAuth2 login screen with biometric support",
      "author": "vishwas.krishna"
    },
    {
      "sha": "e4f5g6h",
      "message": "fix: handle null token in biometric fallback path",
      "author": "vishwas.krishna"
    }
  ],
  "review_decision": "APPROVED",
  "dependencies": [
    {
      "number": 1230,
      "repo": "your-org/phoenix",
      "title": "Add biometric API utilities",
      "state": "merged",
      "url": "https://github.com/your-org/phoenix/pull/1230",
      "relationship": "depends_on"
    }
  ],
  "file_classifications": {
    "config": [],
    "migration": [],
    "schema_contract": [],
    "feature_flag": [],
    "test": [],
    "ci_config": [],
    "helm_k8s": [],
    "source": ["src/auth/LoginScreen.tsx", "src/auth/BiometricAuth.ts"]
  },
  "change_surface": "single-service",
  "has_breaking_changes": false,
  "summary": {
    "total_files": 15,
    "files_added": 5,
    "files_modified": 8,
    "files_deleted": 2,
    "total_additions": 450,
    "total_deletions": 120
  }
}
```

### Downstream Handoff

After outputting the JSON, inform the user that test case generation is available:

> "PR data fetched. To generate QA-grade test cases for this PR, use the **generate-pr-test-cases** skill."

The `generate-pr-test-cases` skill consumes:
- `pr.title` as `pr_title`
- `pr.description` as `pr_description`
- `changed_files` as `changed_files`
- `code_diffs` as `code_diffs`
- `review_comments` as `review_comments` (reviewer insights on risks and edge cases)
- `commits` as `pr_commits` (per-change intent from commit messages)
- `dependencies` as `pr_dependencies` (related/dependent PRs with state)
- `file_classifications` as `file_classifications` (changed files grouped by type for smart test routing)
- `change_surface` as `change_surface` (single-service, cross-service, infra-only, test-only)
- `has_breaking_changes` as `has_breaking_changes` (schema/migration/deleted import detection)
- `tech_stack` is auto-detected from the diffs by that skill

## Output Contract

The JSON above is the **output contract** of this skill. The key fields and their purpose:

| Field | Type | Purpose |
|-------|------|---------|
| `pr.title` | string | PR title for intent detection |
| `pr.description` | string | Full PR body including AC, context, linked tickets |
| `changed_files` | array | Every changed file with path, status, line counts |
| `code_diffs` | array | Unified diff per file (null for skipped files) |
| `review_comments` | array | Reviewer comments from reviews, inline code comments, and PR conversation — tagged by type with optional file/line for inline comments |
| `commits` | array | Ordered commit SHAs and messages showing per-change intent |
| `review_decision` | string | Overall review status (APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED) |
| `dependencies` | array | Linked PRs with state and relationship type |
| `file_classifications` | object | Changed files grouped by category (source, test, config, migration, schema_contract, feature_flag, ci_config, helm_k8s) |
| `change_surface` | string | PR scope: `single-service`, `cross-service`, `infra-only`, or `test-only` |
| `has_breaking_changes` | boolean | True if schema/contract, migration, or deleted imports detected |
| `summary` | object | Aggregate file/line counts |

## Listing Mode

When the user asks to list PRs (not analyze a specific one), output a summary table instead of the full JSON:

```
mcp__github__list_pull_requests(owner, repo: {REPO}, state: "open")
```

Format as:

```
| # | Title | Author | Labels | Age |
|---|-------|--------|--------|-----|
| 1234 | Add user authentication flow | vishwas.krishna | feature, needs-review | 2d |
| 1235 | Fix memory leak in image cache | john.doe | bug, high-priority | 5h |
```

Then ask: "Which PR would you like to analyze in detail?"

## Error Handling

| Error | Action |
|-------|--------|
| GitHub MCP tools not available | Tell user to register the GitHub MCP server before continuing |
| PR not found | Verify PR number and repo; ask user to confirm |
| No read access | Tell user to request access to the repository |
| Rate limited | Tell user to wait and retry; note the rate-limit reset time from the tool's error response if provided |
| Diff too large (>5000 lines) | Warn user; offer filtered/selective diff fetch |
