---
name: pr-test-agent
description: Generate QA-grade E2E test flows AND executable test code for a Pull Request, enriched with Linear business context, PR reviewer insights, and repo test patterns/CI pipeline analysis. Generates NestJS E2E tests (Supertest + buildApp), DTO validation tests, Next.js API route tests, Kafka handler tests, guard/interceptor tests, and GraphQL schema backward-compatibility tests. Performs predictive test selection to identify indirectly affected tests. Chains pr-reader, linear-deep-dive, repo-context-analyzer, generate-pr-test-cases, and generate-executable-tests into a single pipeline with 3 parallel data tracks. Use when asked to test a PR, generate test cases for a PR, or review PR quality.
---

# PR Test Case Agent

Give this agent a PR number and it produces **QA-grade E2E test flows** AND **executable test code** that cover **code paths** (from the diff), **business intent** (from Linear), and **repo conventions** (from test patterns and CI). It orchestrates three data tracks into a single automated pipeline:

1. **Track A: pr-reader** — fetches PR metadata, description, changed files, diffs, file classifications, review comments, and commit messages
2. **Track B: linear-deep-dive** — reads the Linear ticket thoroughly (description, comments, parent, children, siblings, historical bugs) for any ticket type
3. **Track C: repo-context-analyzer** — fetches test framework, existing tests for changed files, full file content, test helper content, sample test files, E2E infrastructure, predictive test map, GraphQL schema changes, DTO/Kafka/guard classifications, code structure, CI pipeline, SonarQube config, callers, and cross-repo consumers

All three tracks feed into **generate-pr-test-cases** (BDD flows) and then **generate-executable-tests** (runnable test code). The executable test generator checks if existing tests already cover the PR changes — if they do, it suggests running those; if not, it generates new test code matching the repo's existing patterns.

The key insight: `generate-pr-test-cases` alone only sees code diffs. It misses acceptance criteria, expected behavior, reproduction steps, reviewer concerns, commit-level intent, existing test patterns, and CI pipeline context. This agent injects all of that so test flows cover what the code *should* do (from Linear), what reviewers *worry about* (from PR reviews), and what conventions the repo follows (from test patterns). The `generate-executable-tests` step then converts those flows into actual runnable code — or identifies that existing tests already cover the changes.

## When to Use

- User says "test PR #1234", "generate test cases for PR #1234", "QA this PR"
- User provides a PR URL and wants test coverage
- User wants test cases that account for the Linear ticket context (acceptance criteria, bug reproduction, expected behavior)

## Prerequisites

**Required:**
- **GitHub MCP** (`mcp__github__*` tools) — used for every GitHub read (PR metadata, files, diffs, comments, commits)
- **Linear MCP** — used for ticket context

If either is missing from the current tool list, tell the user which one and stop until it's registered. There is no CLI or API-token fallback for either — both are assumed to be available as MCP tools, the same way `ai-test-orchestrator` assumes them.

## Dependent Skills

This agent requires these five skills, all living as sibling folders inside `.github/predictive-testing/` alongside this one:

- `pr-reader/SKILL.md`
- `linear-deep-dive/SKILL.md`
- `repo-context-analyzer/SKILL.md`
- `generate-pr-test-cases/SKILL.md`
- `generate-executable-tests/SKILL.md`

## Workflow

```
PR Test Case Agent Progress:
- [ ] Step 0: Verify prerequisites (GitHub MCP + Linear MCP)
- [ ] Step 1: Accept PR input and quick-fetch title + branch + file list
- [ ] Step 2: Run 3 parallel tracks (pr-reader, linear-deep-dive, repo-context-analyzer)
- [ ] Step 3: Merge all 3 tracks — build enriched input
- [ ] Step 4: Run generate-pr-test-cases skill with full context (BDD flows)
- [ ] Step 5: Run generate-executable-tests skill (coverage + unit + E2E + DTO + API route + Kafka + guard + schema tests)
- [ ] Step 6: Present combined output (schema alert + coverage + predicted tests + executable tests + BDD flows)
```

---

## Step 0: Verify Prerequisites

### 0a. Check GitHub MCP

Confirm `mcp__github__*` tools are present in the current tool list. If not, tell the user GitHub MCP needs to be registered and stop until resolved.

### 0b. Check Linear MCP

Confirm the Linear MCP's tools are present in the current tool list. If not, tell the user Linear MCP needs to be registered and stop until resolved.

Both are required — there is no graceful-degradation path for either. (Unlike the removed Datadog/Sentry track, PR context and ticket context are core to what this pipeline produces, not optional enrichment.)

---

## Step 1: Accept PR Input and Quick-Fetch

### 1a. Parse the user's input

Accept any of these formats:
- PR number: `1234` or `#1234` or `PR #1234`
- PR URL: `https://github.com/hinge-health/phoenix/pull/1234`
- PR number + repo: `PR #1234 in phoenix`

GitHub MCP has no notion of "the current repo" the way a local `gh` CLI does — if only a bare PR number is given with no repo, ask the user which repo it's in rather than trying to infer one.

### 1b. Quick-fetch PR title, branch name, and file list

This is a lightweight call to extract the Linear key and file list before launching the parallel tracks:

```
mcp__github__get_pull_request(owner, repo, pull_number)
mcp__github__get_pull_request_files(owner, repo, pull_number)
```

Extract the file paths from the files response — this is needed for Track C (repo-context-analyzer) which uses `changed_files` as input. Also record the `repo` in `owner/repo` format for Track C.

### 1c. Extract Linear ticket key

Search for pattern `[A-Z]+-[0-9]+` in this order:
1. PR title (e.g., `[CV-6355] Fix audio playback` → `CV-6355`)
2. Branch name (e.g., `fix/CV-6355-audio-playback` → `CV-6355`)
3. PR body/description (scan for ticket references)

Take the **first match**. If multiple different keys are found, prefer the one in the title.

If **no Linear key is found**: inform the user — "No Linear ticket found in PR title, branch, or description. Proceeding with code-only test generation." Skip Track B in Step 2.

---

## Step 2: Run 3 Parallel Data Tracks

Launch all three tracks simultaneously. None depends on the others — they only need the PR number (Track A), Linear key (Track B), and repo + file list (Track C) from Step 1.

### Track A — Execute the pr-reader skill

Read and follow the **pr-reader** skill (`SKILL.md`). Execute its full workflow (Steps 1-5, including Step 2b for inline review comments and Step 3b for file classification) on the target PR:
- Input: PR number and repo from Step 1
- Output: The pr-reader JSON contract (`pr`, `changed_files`, `code_diffs`, `review_comments`, `commits`, `review_decision`, `dependencies`, `file_classifications`, `change_surface`, `has_breaking_changes`, `summary`)

Hold the JSON output in memory. Do NOT present the raw pr-reader output to the user.

### Track B — Execute the linear-deep-dive skill (data gathering only)

If a Linear key was found in Step 1, read and follow the **linear-deep-dive** skill (`SKILL.md`). Execute its data-gathering workflow only (verify access, get ticket, gather parent/siblings/linked tickets/historical bugs):
- Input: Linear ticket key from Step 1c
- Output: The full knowledge base linear-deep-dive assembles (ticket with description/comments, parent if applicable, relevant siblings, linked tickets, historical bugs)

**Important:** Do NOT execute linear-deep-dive's own analysis/briefing-report step if it has one. We only need the raw data — this agent uses it to enrich test cases, not to produce a standalone report.

Extract and hold in memory:

**Universal (all ticket types):**
- `ticket_key`, `summary`, `status`, `type`/`labels`, `priority`
- `description` — the ticket's own description field, verbatim
- `acceptance_criteria` — extracted from the description or comments (Linear has no dedicated AC field; this is parsed from free text, not a structured field — treat it as best-effort, not guaranteed-complete)
- `key_comments` — substantive findings from the comment thread (investigation results, decisions, scope corrections, workarounds)
- `parent_context` — one-line summary of the parent ticket if applicable
- `sibling_patterns` — patterns detected across sibling tickets under the same parent
- `linked_tickets_context` — one-line summaries of directly linked tickets
- `historical_bugs` — past resolved bugs in the same area, found via a Linear search scoped to the ticket's labels/team, with whatever root-cause/resolution detail is available in their own description/comments

**Bug-specific (parsed from free text, not a dedicated field — populate only what's actually stated):**
- `repro_and_expected` — steps to reproduce, expected behavior, and actual behavior, however much of this the ticket's own description/comments actually states. If the ticket doesn't state one of these explicitly, leave it null rather than inferring it.

**Sub-issue handling:** If the ticket is a sub-issue, extract fields matching the parent's apparent type/context. Set `type` to whatever the ticket's own labels indicate.

### Track C — Execute the repo-context-analyzer skill

Read and follow the **repo-context-analyzer** skill (`SKILL.md`). Execute its full workflow:
- Input: `repo` (owner/repo from Step 1), `changed_files` (file paths from Step 1b), `pr_branch` (branch name from Step 1b)
- Output: The repo-context-analyzer JSON contract (`test_framework`, `existing_tests`, `full_file_contents`, `code_structure`, `test_helpers`, `callers`, `cross_repo_consumers`, `ci_pipeline`, `sonar_config`)

Hold the JSON output in memory. Do NOT present the raw output to the user.

**Wait for all three tracks to complete before proceeding.**

---

## Step 3: Merge All 3 Tracks — Build Enriched Input

Map the outputs from all three tracks into the input contract that generate-pr-test-cases expects.

### 3a. From PR Reader (Track A)

- `pr_title` = `pr.title`
- `pr_description` = `pr.description` (the PR body, unchanged)
- `changed_files` = `changed_files[]`
- `code_diffs` = `code_diffs[]`
- `review_comments` = `review_comments[]` (the combined array of review bodies, inline comments, and PR comments)
- `pr_commits` = `commits[]` (ordered commit SHAs and messages)
- `pr_dependencies` = `dependencies[]` (related/dependent PRs with state and relationship)
- `file_classifications` = `file_classifications` (changed files grouped by type)
- `change_surface` = `change_surface` (single-service, cross-service, infra-only, test-only)
- `has_breaking_changes` = `has_breaking_changes`

### 3b. Build the `linear_context` object (Track B)

If Linear data was fetched (Track B completed), build a `linear_context` object from the linear-deep-dive knowledge base. Fields are populated with whatever the ticket actually has — leave the rest null:

| `linear_context` field | Source from linear-deep-dive |
|---|---|
| `ticket_key` | Ticket key |
| `summary` | Ticket title |
| `type` | Labels/effective type |
| `status` | Ticket state |
| `priority` | Ticket priority |
| `description` | Ticket description, verbatim |
| `acceptance_criteria` | Parsed from description/comments (best-effort, not a structured field) |
| `key_comments` | Substantive findings from comment thread |
| `parent_context` | One-line summary of parent ticket |
| `sibling_patterns` | Patterns detected across siblings |
| `linked_tickets_context` | Summaries of linked tickets |
| `historical_bugs` | Past resolved bugs in the same area |
| `repro_and_expected` | Bug-ticket repro/expected/actual, only if the ticket itself states it |

If no Linear key was found (Track B was skipped), set `linear_context = null`.

### 3c. Build the `repo_context` object (Track C)

Map the repo-context-analyzer output directly:

| `repo_context` field | Source from repo-context-analyzer |
|---|---|
| `test_framework` | Test framework name, config file, test command, patterns, **setup_file_contents** (global mocks/polyfills) |
| `existing_tests` | Existing test files for each changed source file (null test_file = coverage gap) |
| `full_file_contents` | Full source content of changed files (not just diffs) |
| `code_structure` | Architectural file paths (routes, models, middleware, DTOs, GraphQL, Kafka, guards) |
| `test_helpers` | Available test utilities with **content** for top 5 files (custom_renderers, factories, mocks, fixtures) |
| `sample_tests` | 2-3 nearby test files as pattern references for executable test generation |
| `e2e_infrastructure` | E2E test helpers (buildApp, auth fixtures, or Playwright page-object patterns), sample E2E specs, E2E command, E2E pattern type |
| `predicted_tests` | Test files predicted to be affected by this PR (direct + indirect + transitive), with confidence |
| `schema_changes` | GraphQL schema breaking/non-breaking changes detected in the diff |
| `dto_files` | Changed DTO files with class-validator decorator details |
| `api_route_files` | Changed Next.js API route files with HTTP methods |
| `has_node_mocks_http` | Whether the repo has node-mocks-http in test helpers |
| `kafka_infrastructure` | Kafka handler files, mock patterns, event patterns found in changed files |
| `callers` | Best-effort callers of changed exported functions (~70% accurate) |
| `cross_repo_consumers` | Repos that import this package (if shared package) |
| `ci_pipeline` | CI test jobs, commands, services, coverage config from GitHub Actions |
| `sonar_config` | SonarQube coverage exclusions, source/test dirs |

If Track C failed entirely, set `repo_context = null`.

### 3d. Final input to generate-pr-test-cases

- `pr_title`, `pr_description`, `changed_files`, `code_diffs` — from Track A (pr-reader)
- `review_comments` — from Track A (reviewer insights, inline code comments, PR discussion)
- `pr_commits` — from Track A (per-change intent from commit messages)
- `pr_dependencies` — from Track A (related/dependent PRs)
- `file_classifications`, `change_surface`, `has_breaking_changes` — from Track A (file type routing)
- `linear_context` — from Track B (or null)
- `repo_context` — from Track C (or null)

---

## Step 4: Run generate-pr-test-cases Skill (BDD Flows)

Read and follow the **generate-pr-test-cases** skill (`SKILL.md`). Execute its full workflow with the inputs from Step 3d: `pr_title`, `pr_description`, `changed_files`, `code_diffs`, `review_comments`, `pr_commits`, `pr_dependencies`, `file_classifications`, `change_surface`, `has_breaking_changes`, `linear_context`, and `repo_context`.

The skill natively handles all context — Linear enrichment (AC extraction, bug reproduction, historical bugs, behavioral contracts, intent detection, AC traceability), reviewer concerns (risk flagging, reviewer-concern flows), commit signals (per-file intent refinement), dependency awareness, and repo test patterns (existing test alignment, coverage gap detection, CI pipeline awareness). No additional orchestration needed from this agent.

Hold the BDD flows JSON output in memory (`bdd_test_flows`). Do NOT present it to the user yet — it feeds into Step 5.

---

## Step 5: Run generate-executable-tests Skill (Coverage Analysis + Runnable Code)

Read and follow the **generate-executable-tests** skill (`SKILL.md`). Execute its full workflow with these inputs:

| Input | Source |
|---|---|
| `bdd_test_flows` | The JSON output from Step 4 (`generate-pr-test-cases`) |
| `repo_context` | From Step 3c (the full `repo_context` object including `test_helpers` with content, `sample_tests`, `setup_file_contents`) |
| `pr_diff` | From Step 3a — the `code_diffs[]` array containing unified diffs per file |
| `changed_files` | From Step 3a — the `changed_files[]` array with paths and change stats |

The skill will:
1. Build a test style profile from the repo's existing test patterns
2. Parse the change surface to identify specific modified functions/components/hooks
3. Check existing tests for coverage of those specific changes
4. Suggest running existing tests where coverage already exists
5. Generate new executable test code for uncovered changes, matching the repo's exact style
6. Compile execution instructions

Hold the executable tests output in memory (`executable_test_output`).

**CRITICAL: You MUST execute all steps of the generate-executable-tests workflow to completion. The output of Step 5 must contain the full `executable_tests[]` array with generated code — not a summary, not a question, not a suggestion. If repo_context is available and any file is uncovered, code MUST be generated.**

**If `repo_context` is null** (Track C failed): Skip this step entirely. Set `executable_test_output = null`. The pipeline still outputs BDD flows from Step 4.

---

## Step 6: Present Combined Output

### 6a. Summary header

```
PR #{number} ({repo}) — Test Generation Complete
Context: Linear {ticket_key} ({ticket_type}) | Framework: {test_framework}
Coverage: {N_covered}/{N_total} changed files already have tests | {N_new} new test files generated | {N_predicted} predicted tests | {N_e2e} E2E tests
```

If no Linear ticket was found, omit the Linear portion. If executable_test_output is null, omit the Coverage line. Omit E2E count if no E2E tests were generated. Omit predicted count if no predicted tests.

### 6b. Schema Change Alert (from generate-executable-tests)

**Only show this section if `executable_test_output.schema_alert` is non-null.**

```
## Schema Change Alert

{N} GraphQL schema changes detected in this PR:

**Breaking Changes:**
- {type}: {detail} in `{location}`

**Non-Breaking Changes:**
- {type}: {detail} in `{location}`
```

If breaking changes exist, add a warning: "Breaking schema changes may affect downstream consumers. Backward-compatibility tests have been generated below."

If no schema changes, skip this section entirely.

### 6c. Coverage Analysis (from generate-executable-tests)

If `executable_test_output` is not null, present the coverage analysis:

```
## Coverage Analysis

{executable_test_output.coverage_analysis.summary}

### Already Covered (run existing tests)
- `{test_file}` — covers: {covered_units}
  Run: `{run_command}`

### Needs New Tests
- `{source_file}` — {reason}: {changed_units}
```

### 6d. Predicted Tests to Run (from generate-executable-tests)

**Only show this section if `executable_test_output.predicted_tests` is non-empty.**

These are existing tests that are indirectly affected by the PR changes (they test files that import the changed files). They are distinct from "Already Covered" tests — those directly test the changed file, while predicted tests are transitively affected.

```
## Predicted Tests to Run

These {N} existing test files are affected by your PR changes (they test code that imports your changed files). Run them to validate nothing broke:

| Test File | Reason | Confidence | Command |
|-----------|--------|------------|---------|
| `{test_file}` | {reason} | {confidence} | `{run_command}` |

Run all predicted: `{execution.run_predicted}`
```

### 6e. Executable Tests (from generate-executable-tests)

For each entry in `executable_test_output.executable_tests[]`:

- If `type: "new"`: The file has already been created on disk by generate-executable-tests. Show the file path, test count, what it covers, and the run command. Do NOT repeat the full file content in the output — the file is already in the repo.
- If `type: "addition"`: Present the code in a fenced block with the target file path and insertion point. Do NOT modify the existing file — the user will copy-paste manually.

Group by test type for clarity:

```
## Executable Tests

### Unit Tests

#### New: {file_path} ({test_count} tests)
Created at: `{file_path}`
Covers: {covers}
Run: `{run_command}`

#### Addition to: {file_path} ({test_count} tests)
Insert into: `{insertion_point}`

\`\`\`typescript
{content}
\`\`\`

Run after inserting: `{run_command}`

### E2E Tests

#### New: {file_path} ({test_count} tests)
Created at: `{file_path}`
Covers: {covers}
Run: `{e2e_run_command}`

### DTO Validation Tests

#### New: {file_path} ({test_count} tests)
Created at: `{file_path}`
Covers: {covers}
Run: `{run_command}`

### Schema Backward-Compatibility Tests

#### New: {file_path} ({test_count} tests)
Created at: `{file_path}`
Covers: {covers}
Run: `{e2e_run_command}`
```

Only show subsection headers that have generated tests. If all tests are unit tests, don't use type grouping — just list them flat.

### 6f. Execution Instructions

```
## How to Run

Run all unit tests (new + existing):
`{execution.run_all_unit}`

Run only new unit tests:
`{execution.run_new_only}`

Run only existing unit tests (verify coverage):
`{execution.run_existing_only}`

Run predicted tests (indirectly affected):
`{execution.run_predicted}`

Run E2E tests:
`{execution.run_e2e}`

Watch mode:
`{execution.watch}`

{execution.setup_notes}
```

Omit E2E and predicted lines if those sections are empty.

### 6g. BDD Test Flows (from generate-pr-test-cases)

Present the BDD flows JSON for QA/manual reference:

```
## BDD Test Flows (for QA/manual reference)

{bdd_test_flows JSON}
```

---

## Rules

1. **Use the existing skills — don't reinvent them.** This agent is a pure orchestrator. For PR reading, follow the pr-reader skill. For Linear data, follow the linear-deep-dive skill. For repo context, follow the repo-context-analyzer skill. For BDD test flows, follow the generate-pr-test-cases skill. For executable test code, follow the generate-executable-tests skill. If those skills are updated, this agent automatically benefits.

2. **Parallel execution is mandatory.** All three tracks must run at the same time, not sequentially. The only sequential dependency is Step 1 (quick-fetch to get the Linear key, repo, and file list) before Step 2. Steps 4 and 5 are sequential — Step 5 depends on Step 4's BDD output.

3. **Graceful degradation where it makes sense.** If no Linear key is found, pass `linear_context = null`. If repo-context-analyzer fails, pass `repo_context = null` (and skip Step 5 — executable tests require repo context). generate-pr-test-cases skips dependent logic automatically for null inputs. GitHub MCP and Linear MCP themselves are not optional (Step 0) — only the per-PR Linear-key lookup and the repo-context pass can come back empty.

4. **No redundant output.** Do NOT show raw output from any track (linear-deep-dive report, repo-context JSON). All data is consumed internally. The user sees the structured output from Step 6: schema change alert (if applicable), coverage analysis, predicted tests, executable tests (grouped by type: unit, E2E, DTO, schema), execution instructions, and BDD flows.

5. **External service failure is never fatal for the per-PR lookups.** If the Linear ticket lookup fails for a given PR (e.g. no ticket linked, or the specific ticket 404s), log a warning and set `linear_context` to null rather than aborting the whole run.

6. **Large PR handling.** For PRs with >5000 lines of diff, follow the pr-reader large PR protocol: warn the user and offer to filter to source files only, or let the user select specific files.

7. **Existing tests first, then gaps.** Lead the output with coverage analysis showing which files are already covered. Then ALWAYS present the generated executable test code for every uncovered or partially-covered file. Both sections are mandatory in the output. The only case where `executable_tests` is empty is when ALL changed units are `fully_covered` — and even then, explicitly state "All PR changes are covered by existing tests. No new test code needed."

8. **NEVER ask for permission or stop mid-pipeline.** Once the user triggers "test PR ...", the full pipeline (Steps 1-6) runs to completion autonomously. The final output (Step 6) must include ALL sections: coverage analysis, generated executable test code (if any uncovered files exist), execution instructions, and BDD flows. Do NOT pause between steps to ask the user anything. Do NOT present partial results. The user expects one complete response with everything.

9. **Create new test files, never modify existing repo files, never run tests.** When the generate-executable-tests skill produces new test files (`type: "new"`), write them to disk at the specified path. When it produces additions (`type: "addition"`), present the code in a fenced block — do NOT edit existing files. NEVER execute any test commands. Only present run commands as text for the user to copy-paste. The user controls when and how tests are executed.
