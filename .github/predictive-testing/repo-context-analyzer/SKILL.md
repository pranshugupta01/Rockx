---
name: repo-context-analyzer
description: Analyze a GitHub repository's test patterns, existing tests, full file content, code structure, E2E infrastructure, predictive test selection, GraphQL schema changes, DTO validation decorators, Next.js API routes, Kafka handler patterns, Playwright page-object frontend suites, CI pipeline (GitHub Actions), and SonarQube config — all via GitHub MCP (no local clone). Use when generating test cases to provide repo-level context that diffs alone cannot. Includes best-effort caller search, cross-repo import scanning, and specialized file classification for NestJS E2E, DTO validation, API route, Kafka, guard/interceptor, and Playwright page-object test generation.
---

# Repo Context Analyzer

Fetch test patterns, existing tests, full file content, test helper content, setup file content, sample test files, E2E test infrastructure, code structure, import dependency map, GraphQL schema changes, DTO/Kafka/guard/Playwright-page-object classifications, CI pipeline details, and SonarQube coverage config from a GitHub repository using **GitHub MCP** (`mcp__github__*`). Designed to run **without a local clone** so it works in CI environments. This skill is a **data provider** for `generate-pr-test-cases` and `generate-executable-tests` via the `pr-test-agent` orchestrator.

## When to Use

- As Track C in the `pr-test-agent` pipeline (automated — called by the orchestrator)
- Standalone: user asks "what test framework does this repo use", "are there existing tests for this file", "show me the CI pipeline"

## Prerequisites

- **GitHub MCP** (`mcp__github__*`) registered and authenticated
- Read access to the target repository

## Arguments

- `repo` — required. GitHub owner/repo (e.g., `your-org/user-workflow-service`)
- `changed_files` — required. Array of file paths from pr-reader (e.g., `["src/users/users.service.ts", "src/auth/auth.guard.ts"]`)
- `pr_branch` — optional. Branch name for fetching branch-specific content (defaults to default branch)

## Workflow

```
Repo Context Analyzer Progress:
- [ ] Step 1: Detect test framework and tooling
- [ ] Step 2: Find existing tests for changed files
- [ ] Step 3: Fetch full file content for changed source files
- [ ] Step 4: Discover code structure (routes, models, middleware, DTOs, GraphQL, Kafka, guards)
- [ ] Step 4b: Classify changed files for specialized test generation
- [ ] Step 5: Fetch test helpers (factories, fixtures, mocks) with content
- [ ] Step 5b: Fetch test setup file content
- [ ] Step 5c: Fetch sample test files (pattern references)
- [ ] Step 5d: Fetch E2E test infrastructure (app helpers, auth fixtures, sample E2E specs)
- [ ] Step 5e: Build import dependency map (predictive test selection)
- [ ] Step 5f: GraphQL schema change analysis
- [ ] Step 6: Best-effort caller search for changed exports
- [ ] Step 7: Cross-repo import scan (if shared package)
- [ ] Step 8: Parse CI pipeline (GitHub Actions)
- [ ] Step 9: Parse SonarQube config
- [ ] Step 10: Output structured JSON
```

Print this checklist at the start and tick each step as you complete it.

---

## Step 1: Detect Test Framework and Tooling

Fetch known config files to identify the test framework. Try each path via `mcp__github__get_file_contents(owner, repo, path, ref)` — a not-found result means the file doesn't exist, move on.

**Detection order:**

| File | Framework Signal |
|------|-----------------|
| `package.json` | Check `devDependencies` for: `jest` = Jest, `vitest` = Vitest, `mocha` = Mocha, `@playwright/test` **with no backend/API framework present (no `@nestjs/*`, `express`, `next` API routes)** = **Playwright frontend (page-object)**, `@playwright/test` alongside a backend framework = Playwright used for backend E2E instead, `cypress` = Cypress |
| `jest.config.ts` or `jest.config.js` | Jest (read for `testMatch`, `moduleNameMapper`, `setupFiles`) |
| `vitest.config.ts` or `vitest.config.js` | Vitest (read for `test.include`, `test.globals`) |
| `playwright.config.ts` or `playwright.config.js` | Playwright (read for `testDir`, `use.baseURL`, `projects[]`) — presence of this file plus a `testDir` pointing at a flat `tests/` directory (not colocated with backend source) is the strongest signal for the Playwright-frontend path below |
| `pytest.ini` or `pyproject.toml` | pytest (check `[tool.pytest]` section) |
| `go.mod` | Go test (native `go test`) |
| `.rspec` or `Gemfile` | RSpec |

**Extract from the detected config:**
- Framework name
- Config file path
- Test command (e.g., `npm test`, `npx jest`, `pytest`)
- Test file patterns (e.g., `**/*.test.ts`, `**/*.spec.ts`)
- Any custom test setup files (from `setupFiles`, `setupFilesAfterFramework`, conftest paths)

If `package.json` exists, also extract:
- `scripts.test`, `scripts.test:unit`, `scripts.test:integration`, `scripts.test:e2e` — to understand what test commands are available

### 1b. Playwright Page-Object Frontend Detection

If Step 1 detected `@playwright/test` with no backend framework present, this repo uses the **Playwright + page-object pattern** — a plain frontend E2E suite, not a backend test target. Confirm and extract the actual convention (don't assume — read it):

1. From `playwright.config.ts`/`.js` (already fetched above), record `testDir` (e.g. `./tests`) and `use.baseURL`.
2. List the page-object directory — conventionally `src/pages/` — via `mcp__github__get_file_contents` on that directory path. For each `.ts` file found, fetch its content and record: the exported class name, its constructor/inherited base class (e.g. `extends Page`), and its public methods (e.g. `loginWithUser(username, password)`) — these are the reusable actions `generate-executable-tests` should call rather than writing raw Playwright locators.
3. Also list any component-wrapper directory (conventionally `src/components/`) the page objects compose — same extraction (class name + public members).
4. Check for a shared fixtures file (conventionally `src/fixtures.ts`) that extends `test as base` from `@playwright/test` with one fixture per page object (e.g. `loginPage`, `cartPage`) — record the fixture names, since generated specs must destructure tests from `{ test, expect } from '<fixtures path>'`, not from `@playwright/test` directly, when this file exists.
5. Fetch 1-2 sample spec files from `testDir` (e.g. `tests/login.spec.ts`) and record: import style, `test.describe(...)` / `test(...)` structure, `test.beforeEach` navigation pattern, and how assertions reference page-object members (e.g. `await expect(loginPage.errorContainer.errorMessage).toHaveText(...)`).
6. Record the run command from `package.json` `scripts.test` (typically `npx playwright test ...`).

**Output — add to `test_framework`:**
```json
{
  "playwright_page_objects": {
    "page_object_dir": "src/pages",
    "component_dir": "src/components",
    "fixtures_file": "src/fixtures.ts",
    "fixture_names": ["loginPage", "cartPage", "checkoutPage", "inventoryPage"],
    "pages": [
      {
        "class_name": "LoginPage",
        "file": "src/pages/login.ts",
        "extends": "Page",
        "public_methods": ["loginWithUser(username: string, password: string): Promise<void>"]
      }
    ],
    "sample_spec": { "path": "tests/login.spec.ts", "content": "..." },
    "run_command": "npm test"
  }
}
```
Set `"playwright_page_objects": null` if `@playwright/test` isn't present or no `src/pages`-style directory is found — this is additive, not a replacement for the rest of `test_framework`.

---

## Step 2: Find Existing Tests for Changed Files

For each file in `changed_files` that is a source file (not a test, config, lock, or generated file), search for its corresponding test file.

**Naming convention search order** (using `src/users/users.service.ts` as example):

1. `src/users/users.service.test.ts` — co-located test
2. `src/users/users.service.spec.ts` — co-located spec
3. `src/users/__tests__/users.service.test.ts` — `__tests__` directory
4. `test/users/users.service.test.ts` — mirror `test/` directory
5. `tests/users/users.service.test.ts` — mirror `tests/` directory

For Python: replace `.ts` with `.py` and use `test_` prefix pattern:
1. `src/users/test_users_service.py`
2. `tests/users/test_users_service.py`

**For each candidate path:** Call `mcp__github__get_file_contents(owner, repo, path, ref)`. If it returns content (not a not-found error), that's the test file content — the tool returns text directly, no base64 decode step needed.

**From the test content, extract:**
- Test file path
- Test names (regex for `it('...', `, `test('...', `, `describe('...', `, `def test_`, `func Test`)
- Full content (up to 500 lines — if longer, truncate to the first 500; `get_file_contents` has no range-header option, so truncate client-side after fetching)

If no test file is found for a changed source file, record `{ "source_file": "...", "test_file": null }` — this signals a coverage gap to the test generator.

---

## Step 3: Fetch Full File Content for Changed Source Files

For each file in `changed_files` that is a source file (not test, lock, config, generated):

```
mcp__github__get_file_contents(owner, repo, path, ref=PR_BRANCH)
```

No decode step needed — the tool returns text content directly. **Limitation:** GitHub MCP's `get_file_contents` has no documented >1MB fallback equivalent to the raw Git blob API (`gh api repos/{REPO}/git/blobs/{SHA}`) — if a file is too large for the tool to return, skip it, log which file and why, and continue with the rest rather than blocking the whole step.

**Record for each file:**
- Path
- Full content (decoded)
- Language (inferred from extension)
- Line count

**Cap:** Fetch at most 15 source files. If more exist, prioritize files with the most additions/deletions (from `changed_files` metadata).

---

## Step 4: Discover Code Structure

Discover architectural files so the test generator understands what the changed code connects to.

**No clean MCP equivalent for a single recursive tree listing** (`gh api .../git/trees/{branch}?recursive=1` has no direct match among the available GitHub MCP tools) — use `mcp__github__search_code` per pattern below instead, one query per category (e.g. `filename:*.controller.ts repo:{REPO}`, `filename:*.dto.ts repo:{REPO}`). This is less complete than a full tree walk (search indexing lag, and it only returns filename/path matches, not a full directory listing) but is the closest available substitute. If a category returns nothing, that's a real "none found" signal, not necessarily a tool failure — note it either way in the output so downstream steps know whether absence means "doesn't exist" or "search missed it."

Identify files matching these patterns:

| Pattern | Category |
|---------|----------|
| `*.controller.ts`, `*.controller.js` | API routes (NestJS) |
| `*.resolver.ts`, `*.resolver.js` | GraphQL resolvers (NestJS) |
| `*routes*.ts`, `*routes*.js`, `*router*.ts` | Route definitions (Express/Fastify) |
| `*router*.py`, `*views*.py` | Route definitions (Python) |
| `*.entity.ts`, `*.model.ts`, `*.schema.ts` | Database models |
| `**/models/*.py`, `**/models/*.go` | Database models (Python/Go) |
| `*.middleware.ts`, `*.guard.ts`, `*.interceptor.ts` | Middleware (NestJS) |
| `*.pipe.ts` | Pipes (NestJS) |
| `*.module.ts` | Module definitions (NestJS) |
| `*.config.ts`, `*.config.js` | Configuration files |
| `*.dto.ts`, `*.input.ts` | DTOs / Validation input files |
| `app/api/**/route.ts`, `pages/api/**/*.ts` | Next.js API routes |
| `*.graphql`, `*.gql` | GraphQL schema definitions |
| `*.handler.ts`, `*.consumer.ts`, `*.publisher.ts`, `*.producer.ts` | Message/Kafka handlers |
| `**/kafka/**` | Kafka directory |

For each category, record up to 5 file paths. Do NOT fetch content for these — just record the paths so the test generator knows the structure.

**Exception:** If a file in `changed_files` IS one of these structural files (e.g., PR modifies a controller), its content is already fetched in Step 3.

### 4b. Classify Changed Files for Specialized Test Generation

For each file in `changed_files`, check if it matches a specialized category. This drives targeted test generation in `generate-executable-tests`:

**DTO files:** If a changed file matches `*.dto.ts` or `*.input.ts`, check its content (from Step 3) for `class-validator` imports (`@IsString`, `@IsNotEmpty`, `@IsEmail`, `@IsOptional`, `@IsNumber`, `@IsBoolean`, `@IsEnum`, `@IsArray`, `@ValidateNested`, `@Type`). Flag it:

```json
{
  "dto_files": [
    {
      "path": "src/modules/user/dto/create-user.dto.ts",
      "has_validation_decorators": true,
      "decorators_found": ["@IsString", "@IsNotEmpty", "@IsEmail", "@IsOptional"]
    }
  ]
}
```

**Next.js API routes:** If a changed file matches `app/api/**/route.ts` or `pages/api/**/*.ts`, search its content for exported HTTP methods (`export async function GET`, `POST`, `PUT`, `DELETE`, `PATCH`) or `export default function handler`. Flag it:

```json
{
  "api_route_files": [
    {
      "path": "src/app/api/users/route.ts",
      "router_type": "app",
      "http_methods": ["GET", "POST"]
    }
  ]
}
```

Also check if `node-mocks-http` exists in `test_helpers` — set `has_node_mocks_http: true` if so.

**Kafka/message handlers:** If a changed file matches `*.handler.ts`, `*.consumer.ts`, `*.publisher.ts`, `*.producer.ts` or is inside a `kafka/` directory, check its content for `@EventPattern`, `@MessagePattern` decorators. Search for existing Kafka mock patterns in `src/test/` or `src/e2e/` (look for `KafkaPublisher`, `KafkaSubscriber` mock definitions). Flag it:

```json
{
  "kafka_infrastructure": {
    "handler_files": ["src/modules/notifications/notifications.handler.ts"],
    "mock_patterns": [
      { "path": "src/e2e/app-helpers.ts", "mock_snippet": "KafkaPublisher: { sendMessage: jest.fn() }" }
    ],
    "event_patterns_found": ["@EventPattern('user.created')", "@EventPattern('appointment.cancelled')"]
  }
}
```

**GraphQL schema files:** If a changed file matches `*.graphql`, `*.gql`, or its content contains `@ObjectType`, `@Field`, `@InputType`, `@ArgsType`, `@Query`, `@Mutation` decorators, flag `has_graphql_schema_changes: true`. Detailed analysis happens in Step 5f.

---

## Step 5: Fetch Test Helpers (with Content)

Search for test utility files that the test generator and executable test generator need. Unlike previous versions, **fetch the full content** of the most important helpers so the executable test generator can replicate their patterns.

**Search directories** (each via `mcp__github__get_file_contents(owner, repo, path)` — a directory path returns its listing; a not-found result means the directory doesn't exist, move on):

```
test/helpers
test/factories
test/fixtures
test/utils
__mocks__
src/__mocks__
src/lib/test-utils
```

For each directory that exists, list all files and record their paths.

**Fetch content for the top 5 most important helper files.** Priority order:
1. Custom render utilities (`*render*`, `*test-utils*`, `*test-helper*`) — these show how components should be wrapped for testing
2. Mock factory files (`*factory*`, `*mock*`, `*builder*`) — these show how test data is constructed
3. Shared fixture files (`.ts`, `.tsx`, `.py` fixtures, not `.json`) — these show common test data patterns
4. Global mock overrides (`__mocks__/*.ts`) — these show what's auto-mocked

For each prioritized file, fetch its content via `mcp__github__get_file_contents(owner, repo, path)`.

Cap at 300 lines per file. If a file exceeds 300 lines, keep only the first 300.

If the repo uses a `conftest.py` pattern (Python), check and fetch content the same way at `tests/conftest.py`, falling back to `conftest.py`.

**Output schema for test_helpers:**
```json
{
  "factories": [{"path": "test/factories/user.factory.ts", "content": "import ..."}],
  "fixtures": [{"path": "test/fixtures/appointments.json"}],
  "mocks": [{"path": "__mocks__/zustand.ts", "content": "import ..."}],
  "custom_renderers": [{"path": "src/lib/test-utils/renderer.tsx", "content": "import ..."}],
  "conftest": null
}
```

Files without fetched content omit the `content` field (path-only). The top 5 prioritized files include `content`.

---

## Step 5b: Fetch Test Setup File Content

The test setup file (e.g., `vitest.setup.ts`, `jest.setup.ts`, `conftest.py`) configures global mocks, polyfills, and cleanup that applies to ALL tests. The executable test generator needs this to avoid re-mocking globally mocked modules.

From Step 1, the detected setup files are listed in `test_framework.setup_files`. For each setup file path, fetch via `mcp__github__get_file_contents(owner, repo, path)`.

Also check these common paths if not already detected:
- `vitest.setup.ts`, `vitest.setup.js`
- `jest.setup.ts`, `jest.setup.js`
- `setupTests.ts`, `setupTests.js`
- `tests/conftest.py`, `conftest.py`

Record the content of each found setup file. Cap at 200 lines per file.

**Output:** Add to the `test_framework` object:
```json
{
  "setup_file_contents": [
    {
      "path": "vitest.setup.ts",
      "content": "import '@testing-library/jest-dom/vitest';\nimport { cleanup } from ..."
    }
  ]
}
```

---

## Step 5c: Fetch Sample Test Files (Pattern References)

Fetch 2-3 test files from the repo that are **not** for the changed files — these serve as "example" tests for the executable test generator to learn the repo's style from multiple sources, not just the tests for changed files.

**Selection strategy:**
1. Via `mcp__github__search_code` (e.g. `extension:test.ts repo:{REPO}`, `extension:spec.ts repo:{REPO}`), find test files that are **near** the changed files — same feature directory or parent directory.
2. If no nearby tests exist, pick any 2-3 test files from the `src/` directory (list it via `get_file_contents`).
3. Prefer test files of the same type as the changed files (if PR changes `.tsx` components, pick component test files; if PR changes hooks, pick hook test files).

For each selected sample test file, fetch via `mcp__github__get_file_contents(owner, repo, path)`.

Cap at 300 lines per file. Fetch at most 3 sample files.

**Output:**
```json
{
  "sample_tests": [
    {
      "path": "src/features/nearby-feature/__tests__/component.test.tsx",
      "content": "import { render, screen } from ...",
      "line_count": 85
    }
  ]
}
```

---

## Step 5d: Fetch E2E Test Infrastructure

Detect and fetch E2E test infrastructure so that `generate-executable-tests` can generate E2E specs matching the repo's patterns.

**Search for E2E helper files** via `mcp__github__get_file_contents(owner, repo, path)` on each candidate path, skipping not-found results:

```
src/e2e/app-helpers.ts
test/app-helpers.ts
src/e2e/setup-env.ts
test/setup-env.ts
```

If an app helper file is found (`buildApp`, `createApp`, `setupApp` functions), fetch its content (up to 300 lines).

**Search for auth fixture files** the same way at `src/test/fixtures/auth` and `test/fixtures/auth`.

If found, list files in the directory and fetch content for up to 3 `.ts` files (up to 200 lines each). These contain JWT tokens and auth header builders per role.

**Find sample E2E specs:** via `mcp__github__search_code` (`extension:e2e-spec.ts repo:{REPO}` / `extension:e2e.test.ts repo:{REPO}`), find files near the changed files. Fetch content of 2-3 as style references (up to 300 lines each).

**Detect E2E test command:** From `package.json` (Step 1), look for scripts named `test:e2e`, `test:integration`, `e2e`. Record the command.

**Determine E2E pattern:**
- If Supertest is in `devDependencies` AND app helper uses `getHttpServer()` → `"supertest-graphql"` (if queries go to `/graphql`) or `"supertest-rest"`
- If `@playwright/test` is in `devDependencies` and `test_framework.playwright_page_objects` (Step 1b) is non-null → `"playwright-page-object"` — this is the frontend page-object pattern, distinct from using Playwright to hit a backend API
- If `@playwright/test` is in `devDependencies` with no page-object dir detected → `"playwright"`
- If `cypress` is in `devDependencies` → `"cypress"`
- Otherwise → `"none"`

**Output:**
```json
{
  "e2e_infrastructure": {
    "app_helper": { "path": "src/e2e/app-helpers.ts", "content": "..." },
    "setup_env": { "path": "src/e2e/setup-env.ts", "content": "..." },
    "auth_fixtures": [
      { "path": "src/test/fixtures/auth/auth.fixture.ts", "content": "..." }
    ],
    "sample_e2e_specs": [
      { "path": "src/e2e/auth.e2e-spec.ts", "content": "...", "line_count": 120 }
    ],
    "e2e_test_command": "npm run test:e2e",
    "e2e_pattern": "supertest-graphql | supertest-rest | playwright | cypress | none"
  }
}
```

If no E2E infrastructure is found at all, set `"e2e_infrastructure": null`.

---

## Step 5e: Build Import Dependency Map (Predictive Test Selection)

For each changed source file, find ALL existing test files that exercise it — directly or indirectly. This enables "predictive test selection": telling the user exactly which tests to run instead of running the full suite.

**Direct test lookup:** Already done in Step 2 (`existing_tests[]`). Reuse those results — if `test_file` is not null, it is a direct test with `"confidence": "high"`.

**Indirect test discovery:** For each changed file, search for other test files that reference it by name via `mcp__github__search_code`, one query per extension:

```
repo:{REPO} extension:test.ts {filename_without_ext}
repo:{REPO} extension:test.tsx {filename_without_ext}
repo:{REPO} extension:spec.ts {filename_without_ext}
repo:{REPO} extension:e2e-spec.ts {filename_without_ext}
```

Filter out test files already found in the direct lookup. These are indirect references with `"confidence": "medium"`.

**Transitive test discovery:** From Step 6 (callers), if a changed file is imported by source file X, and source file X has a test, that test is transitively affected with `"confidence": "medium"`.

**Rate limit:** Reuse the 10-search budget from Step 6. If rate-limited, return what was found so far.

**Output:**
```json
{
  "predicted_tests": [
    {
      "test_file": "src/features/configurator/__tests__/component.test.tsx",
      "reason": "directly tests changed file src/features/configurator/component.tsx",
      "confidence": "high"
    },
    {
      "test_file": "src/features/overview/__tests__/overview.test.tsx",
      "reason": "tests src/features/overview/overview.tsx which imports changed file src/shared/hooks/use-data.ts",
      "confidence": "medium"
    }
  ]
}
```

Cap at 20 predicted tests. Deduplicate by test file path.

---

## Step 5f: GraphQL Schema Change Analysis

**Only run if** any file in `changed_files` was flagged as having GraphQL changes in Step 4b (`has_graphql_schema_changes: true`).

For each changed file with GraphQL content (from `full_file_contents` in Step 3), parse the diff to identify schema changes:

**For `.graphql` / `.gql` files:**
- Lines starting with `-` containing `type `, `input `, `enum `, field definitions → removed types/fields
- Lines starting with `+` containing new types/fields → added types/fields
- Changed field types (same field name, different type on `+` vs `-` lines)

**For NestJS code-first schemas (`.ts` files with decorators):**
- Lines starting with `-` containing `@Field`, `@Query`, `@Mutation`, `@ObjectType`, `@InputType` → removed schema elements
- Lines starting with `+` containing those decorators → added schema elements
- Changed return types or argument types

**Classify each change:**

| Change | Severity |
|--------|----------|
| Field removed from type | `breaking` |
| Required argument added (no default) | `breaking` |
| Field type changed (narrowing) | `breaking` |
| Query/Mutation removed | `breaking` |
| New optional field added | `non_breaking` |
| New query/mutation added | `non_breaking` |
| Optional argument added | `non_breaking` |
| Description/comment changed | `non_breaking` |

**Output:**
```json
{
  "schema_changes": {
    "has_schema_changes": true,
    "breaking_changes": [
      {
        "type": "field_removed",
        "location": "src/modules/user/user.resolver.ts",
        "detail": "Field 'legacyId' removed from UserType",
        "severity": "breaking"
      }
    ],
    "non_breaking_changes": [
      {
        "type": "field_added",
        "location": "src/modules/user/user.resolver.ts",
        "detail": "New optional field 'mfaEnabled' added to UserType"
      }
    ]
  }
}
```

If no GraphQL changes were detected, set `"schema_changes": null`.

---

## Step 6: Best-Effort Caller Search

For each changed source file from Step 3, extract exported function/class names using regex:

**TypeScript/JavaScript:**
- `export (async )?function (\w+)` → function name
- `export class (\w+)` → class name
- `export const (\w+)` → constant name
- `export default (class|function) (\w+)` → default export

**Python:**
- `^def (\w+)` at module level (not indented) → function name
- `^class (\w+)` → class name

For each exported name, run `mcp__github__search_code(query: "{FUNCTION_NAME} repo:{REPO} language:{LANG}")`.

**Filter results:**
- Exclude the source file itself
- Exclude test files (`*.test.*`, `*.spec.*`, `__tests__`)
- Exclude `node_modules`, `dist`, `build` directories
- Exclude lines that are only `import` statements (they're callers in a dependency sense but not invocation callers)

**Output per function:**
```json
{
  "function": "processPayment",
  "source_file": "src/payments/payment.service.ts",
  "callers": [
    { "file": "src/checkout/checkout.service.ts", "line_snippet": "await processPayment(order)", "confidence": "text-match" }
  ]
}
```

**Caveats:**
- Text-based search, not AST-aware — ~70% accuracy. Label all results with `"confidence": "text-match"`.
- GitHub code search API: 30 requests/minute rate limit. Cap at 10 function searches per run.
- If rate-limited, stop caller search gracefully and return what was found so far.

---

## Step 7: Cross-Repo Import Scan

**Only run if the PR modifies a shared package.** Detect by checking:

1. Fetch `package.json` (already fetched in Step 1). Check if `name` starts with `@your-org/` — this is a shared package.
2. Check if the repo is a monorepo with workspace packages that other repos import.

If the repo IS a shared package, search for downstream consumers via `mcp__github__search_code(query: "{PACKAGE_NAME} org:your-org filename:package.json")`, paging through results if the tool supports pagination.

Record each consuming repo and file path.

**Rate limit handling:** GitHub's code search rate limits still apply through MCP. If paginating across many results, add delays between pages. Cap at 3 pages (90 results).

**If the repo is NOT a shared package:** Skip this step entirely. Record `"cross_repo_consumers": []`.

---

## Step 8: Parse CI Pipeline (GitHub Actions)

Fetch the workflows directory listing via `mcp__github__get_file_contents(owner, repo, ".github/workflows")`.

For each `.yml` or `.yaml` file in the listing, fetch its content the same way.

**Extract from each workflow file:**

| Data Point | How to Extract |
|------------|---------------|
| Test job names | YAML keys under `jobs:` that contain test commands |
| Test commands | Values in `run:` steps containing `test`, `jest`, `pytest`, `vitest`, `go test` |
| Test environment variables | `env:` blocks within test jobs |
| Coverage commands | Steps containing `--coverage`, `coverage`, `lcov` |
| SonarQube steps | Steps using `sonarsource/sonarqube-scan-action` or containing `sonar-scanner` |
| Test dependencies | `services:` blocks (Postgres, Redis, etc. used in test jobs) |

**Output:**
```json
{
  "test_jobs": [
    {
      "name": "unit-tests",
      "workflow_file": "ci.yml",
      "command": "npm run test:unit -- --coverage",
      "env_vars": ["NODE_ENV=test", "DATABASE_URL=postgresql://..."],
      "services": ["postgres:14"],
      "has_coverage": true
    }
  ],
  "has_sonar_gate": true,
  "sonar_step": "SonarQube Quality Gate"
}
```

If no `.github/workflows` directory exists (404), record `"ci_pipeline": null`.

---

## Step 9: Parse SonarQube Config

Fetch the SonarQube project properties via `mcp__github__get_file_contents(owner, repo, "sonar-project.properties")`.

If found, parse the key-value pairs. Extract:

| Property | What It Tells Us |
|----------|-----------------|
| `sonar.coverage.exclusions` | Files excluded from coverage — these need fewer tests (e.g., `src/migrations/**`, `src/main.ts`, `**/*.entity.ts`) |
| `sonar.sources` | Source root directories (e.g., `src`) |
| `sonar.tests` | Test root directories (e.g., `test`) |
| `sonar.javascript.lcov.reportPaths` | Coverage report location |
| `sonar.python.coverage.reportPaths` | Coverage report location (Python) |
| `sonar.exclusions` | Files excluded from all analysis |
| `sonar.projectKey` | Project identifier |

**Cross-reference with changed files:** If any file in `changed_files` matches a `sonar.coverage.exclusions` pattern, flag it — the file is intentionally excluded from coverage, so the test generator can deprioritize it.

If `sonar-project.properties` doesn't exist (404), record `"sonar_config": null`.

---

## Step 10: Output Structured JSON

Produce the following JSON. This is the **output contract** consumed by `generate-pr-test-cases` and `generate-executable-tests` via `pr-test-agent`.

```json
{
  "test_framework": {
    "name": "jest | vitest | pytest | go-test | rspec | mocha | playwright-page-object | unknown",
    "config_file": "jest.config.ts",
    "test_command": "npm run test:unit",
    "test_patterns": ["**/*.test.ts", "**/*.spec.ts"],
    "setup_files": ["test/setup.ts"],
    "setup_file_contents": [
      {
        "path": "vitest.setup.ts",
        "content": "import '@testing-library/jest-dom/vitest';\nimport { cleanup } from '@testing-library/react';\n..."
      }
    ],
    "playwright_page_objects": null
  },
  "existing_tests": [
    {
      "source_file": "src/users/users.service.ts",
      "test_file": "src/users/users.service.test.ts",
      "test_content": "import { UsersService } from './users.service';\n\ndescribe('UsersService', () => {\n  it('should create user', ...",
      "test_names": ["should create user", "should validate email", "should throw on duplicate email"]
    },
    {
      "source_file": "src/auth/auth.guard.ts",
      "test_file": null
    }
  ],
  "full_file_contents": [
    {
      "path": "src/users/users.service.ts",
      "content": "import { Injectable } from '@nestjs/common';\n...",
      "language": "typescript",
      "line_count": 150
    }
  ],
  "code_structure": {
    "api_routes": ["src/users/users.controller.ts", "src/auth/auth.controller.ts"],
    "db_models": ["src/users/user.entity.ts", "src/auth/session.entity.ts"],
    "middleware": ["src/auth/auth.guard.ts", "src/logging/logging.interceptor.ts"],
    "modules": ["src/users/users.module.ts"],
    "config": ["src/config/database.config.ts"]
  },
  "test_helpers": {
    "factories": [
      {"path": "test/factories/user.factory.ts", "content": "import { User } from '../../src/users/user.entity';\n..."},
      {"path": "test/factories/session.factory.ts"}
    ],
    "fixtures": [{"path": "test/fixtures/appointments.json"}],
    "mocks": [{"path": "__mocks__/auth-service.ts", "content": "export const authService = { authenticate: vi.fn() };\n..."}],
    "custom_renderers": [
      {"path": "src/lib/test-utils/renderer.tsx", "content": "import { render } from '@testing-library/react';\n..."}
    ],
    "conftest": null
  },
  "sample_tests": [
    {
      "path": "src/features/nearby-feature/__tests__/component.test.tsx",
      "content": "import { render, screen } from '@testing-library/react';\nimport { describe, expect, it, vi } from 'vitest';\n...",
      "line_count": 85
    }
  ],
  "e2e_infrastructure": {
    "app_helper": { "path": "src/e2e/app-helpers.ts", "content": "export async function buildApp() { ... }" },
    "setup_env": { "path": "src/e2e/setup-env.ts", "content": "process.env.NODE_ENV = 'TEST'; ..." },
    "auth_fixtures": [
      { "path": "src/test/fixtures/auth/auth.fixture.ts", "content": "export const adminToken = '...'" }
    ],
    "sample_e2e_specs": [
      { "path": "src/e2e/auth.e2e-spec.ts", "content": "import { buildApp } from './app-helpers'; ...", "line_count": 120 }
    ],
    "e2e_test_command": "npm run test:e2e",
    "e2e_pattern": "supertest-graphql"
  },
  "predicted_tests": [
    {
      "test_file": "src/features/configurator/__tests__/component.test.tsx",
      "reason": "directly tests changed file src/features/configurator/component.tsx",
      "confidence": "high"
    },
    {
      "test_file": "src/features/overview/__tests__/overview.test.tsx",
      "reason": "tests src/features/overview/overview.tsx which imports changed file src/shared/hooks/use-data.ts",
      "confidence": "medium"
    }
  ],
  "schema_changes": {
    "has_schema_changes": true,
    "breaking_changes": [
      {
        "type": "field_removed",
        "location": "src/modules/user/user.resolver.ts",
        "detail": "Field 'legacyId' removed from UserType",
        "severity": "breaking"
      }
    ],
    "non_breaking_changes": [
      {
        "type": "field_added",
        "location": "src/modules/user/user.resolver.ts",
        "detail": "New optional field 'mfaEnabled' added to UserType"
      }
    ]
  },
  "dto_files": [
    {
      "path": "src/modules/user/dto/create-user.dto.ts",
      "has_validation_decorators": true,
      "decorators_found": ["@IsString", "@IsNotEmpty", "@IsEmail"]
    }
  ],
  "api_route_files": [
    {
      "path": "src/app/api/users/route.ts",
      "router_type": "app",
      "http_methods": ["GET", "POST"]
    }
  ],
  "has_node_mocks_http": true,
  "kafka_infrastructure": {
    "handler_files": ["src/modules/notifications/notifications.handler.ts"],
    "mock_patterns": [
      { "path": "src/e2e/app-helpers.ts", "mock_snippet": "KafkaPublisher: { sendMessage: jest.fn() }" }
    ],
    "event_patterns_found": ["@EventPattern('user.created')"]
  },
  "callers": [
    {
      "function": "processPayment",
      "source_file": "src/payments/payment.service.ts",
      "callers": [
        {
          "file": "src/checkout/checkout.service.ts",
          "line_snippet": "await processPayment(order)",
          "confidence": "text-match"
        }
      ]
    }
  ],
  "cross_repo_consumers": [
    {
      "repo": "your-org/billing-service",
      "file": "package.json",
      "dependency": "@your-org/payments-sdk"
    }
  ],
  "ci_pipeline": {
    "test_jobs": [
      {
        "name": "unit-tests",
        "workflow_file": "ci.yml",
        "command": "npm run test:unit -- --coverage",
        "env_vars": ["NODE_ENV=test"],
        "services": ["postgres:14"],
        "has_coverage": true
      }
    ],
    "has_sonar_gate": true,
    "sonar_step": "SonarQube Quality Gate"
  },
  "sonar_config": {
    "coverage_exclusions": ["src/migrations/**", "src/main.ts", "**/*.entity.ts"],
    "source_dirs": ["src"],
    "test_dirs": ["test"],
    "report_paths": "coverage/lcov.info",
    "project_key": "your-org_user-workflow-service",
    "general_exclusions": ["node_modules/**", "dist/**"]
  }
}
```

## Output Contract

| Field | Type | Purpose |
|-------|------|---------|
| `test_framework` | object | Detected test framework, config, commands, patterns. Includes `setup_file_contents[]` with the actual code of setup files (global mocks, polyfills), and `playwright_page_objects` (object/null) with page-object classes/methods, fixture names, and a sample spec for repos using the Playwright frontend page-object pattern (Step 1b) |
| `existing_tests` | array | Existing test files for each changed source file (null test_file = coverage gap) |
| `full_file_contents` | array | Full source of changed files (not just diffs) for richer behavioral analysis |
| `code_structure` | object | Architectural file paths (routes, models, middleware) — shows what changed code connects to |
| `test_helpers` | object | Available test utilities with **content** for top 5 files (custom renderers, factories, shared mocks). `custom_renderers[]` separated for easy access |
| `sample_tests` | array | 2-3 test files from nearby features (not for changed files) as style reference for executable test generation |
| `e2e_infrastructure` | object/null | E2E test helpers (buildApp, auth fixtures), sample E2E specs, E2E command, E2E pattern type |
| `predicted_tests` | array | Test files predicted to be affected by this PR (direct + indirect + transitive), with confidence level |
| `schema_changes` | object/null | GraphQL schema breaking/non-breaking changes detected in the diff |
| `dto_files` | array | Changed DTO files with class-validator decorator details |
| `api_route_files` | array | Changed Next.js API route files with HTTP methods |
| `has_node_mocks_http` | boolean | Whether the repo has node-mocks-http in test helpers |
| `kafka_infrastructure` | object/null | Kafka handler files, mock patterns, event patterns found in changed files |
| `callers` | array | Best-effort callers of changed exported functions (~70% accurate, text-match) |
| `cross_repo_consumers` | array | Other repos that import this package (only if shared package) |
| `ci_pipeline` | object/null | CI test jobs, commands, services, coverage config from GitHub Actions |
| `sonar_config` | object/null | SonarQube coverage exclusions, source/test dirs, quality gate config |

## Error Handling

| Error | Action |
|-------|--------|
| GitHub MCP not registered/authenticated | Tell the user to register/authenticate the GitHub MCP server before continuing |
| Repo not found / no access | Verify repo name, ask user to confirm |
| Rate limited (code search) | Stop caller search / cross-repo scan gracefully, return partial results |
| File too large for `get_file_contents` | Skip the file, log which one, continue with the rest |
| No `.github/workflows` | Set `ci_pipeline` to null |
| No `sonar-project.properties` | Set `sonar_config` to null |
| No test files found | Set `test_file: null` for each — signals coverage gap |

## Graceful Degradation

Every step is independently valuable. If any step fails:
- Steps 1-5c: Core data — warn but continue. Steps 5b/5c are additive to executable test generation; if they fail, the generator falls back to patterns from existing_tests.
- Step 5d: E2E infrastructure — skip gracefully, set `e2e_infrastructure` to null. Generator will skip E2E test generation.
- Step 5e: Predictive tests — skip gracefully, set `predicted_tests` to empty array. Pipeline will still generate tests but without predictive selection.
- Step 5f: Schema analysis — skip gracefully, set `schema_changes` to null. No schema alerts in output.
- Steps 6-7: Best-effort — skip gracefully, return empty arrays
- Steps 8-9: Additive — skip gracefully, return null

The pipeline always produces output. More data just makes test cases better.
