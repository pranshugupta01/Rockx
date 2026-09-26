---
name: generate-executable-tests
description: Convert BDD test flows into executable test code matching the repo's existing test patterns. Generates NestJS E2E tests (Supertest + buildApp), DTO validation tests (class-validator), Next.js API route tests, Kafka handler tests, guard/interceptor tests, GraphQL schema backward-compatibility tests, and Playwright page-object frontend E2E tests. Performs predictive test selection via import dependency mapping. Analyzes existing test coverage to suggest running pre-existing tests when they already cover the PR. Provides execution instructions. Use after generate-pr-test-cases in the pr-test-agent pipeline.
---

# Generate Executable Tests

Transform BDD test flows into **runnable test code** that matches the target repo's existing test patterns. This skill reads the repo's test framework, existing tests, and helper utilities to produce code that looks like a human teammate wrote it — same imports, same mock patterns, same assertion style.

This skill always runs to completion. For changes already covered by existing tests, it reports which tests to run. For uncovered or partially-covered changes, it **generates complete, runnable test files** — full code, not summaries. The output always includes the `executable_tests[]` array with actual code for every gap found.

## When to Use

- As Step 5 in the `pr-test-agent` pipeline (automated — called by the orchestrator after generate-pr-test-cases)
- Standalone: user asks "generate runnable tests for this PR", "write test code matching repo patterns"

## Prerequisites

- `repo_context` must be available (from repo-context-analyzer). Without it, this skill cannot determine test patterns and must be skipped.

## Input Contract

| Field | Required | Description |
|-------|----------|-------------|
| `bdd_test_flows` | Yes | JSON output from `generate-pr-test-cases` — the `{ testSuite, flows[] }` object |
| `repo_context` | Yes | From `repo-context-analyzer`: test_framework, existing_tests, full_file_contents, test_helpers, sample_tests, code_structure, e2e_infrastructure, predicted_tests, schema_changes, dto_files, api_route_files, has_node_mocks_http, kafka_infrastructure |
| `pr_diff` | Yes | Full unified diff content from pr-reader (all files) |
| `changed_files` | Yes | Array of `{path, status, additions, deletions}` from pr-reader |

## Workflow

```
Generate Executable Tests Progress:
- [ ] Step 1: Build test style profile from repo patterns (1a-1j: framework, imports, mocks, structure, assertions, naming, utils, setup, E2E, specialized)
- [ ] Step 2: Parse change surface from diff (2a-2c: units, file categories, schema changes)
- [ ] Step 3: Coverage gap analysis — match PR changes against existing tests
- [ ] Step 4: Suggest existing tests for covered changes + predicted tests (4a-4b)
- [ ] Step 5: Generate executable test code for uncovered changes (5a-5m: unit, E2E, DTO, API route, Kafka, guard, interceptor, schema, Playwright page-object)
- [ ] Step 6: Compile execution instructions (unit + E2E + predicted commands)
- [ ] Step 7: Output final JSON (coverage, executable_tests, predicted_tests, schema_alert, execution)
```

Print this checklist at the start and tick each step as you complete it.

---

## Step 1: Build Test Style Profile

Read `repo_context.test_framework`, `repo_context.test_helpers`, `repo_context.existing_tests`, and `repo_context.sample_tests` to extract the repo's test conventions. Build a style profile that will guide code generation in Step 5.

**Extract these attributes:**

### 1a. Framework Identity

From `repo_context.test_framework.name`:
- `vitest` → Vitest (uses `vi.mock`, `vi.fn`, `vi.mocked`, imports from `vitest`)
- `jest` → Jest (uses `jest.mock`, `jest.fn`, `jest.spyOn`, globals or imports from `@jest/globals`)
- `pytest` → pytest (uses `@pytest.fixture`, `unittest.mock.patch`, `assert` statements)
- `go` → Go test (uses `testing.T`, `testify`, table-driven tests)
- `rspec` → RSpec (uses `describe`, `it`, `let`, `before`)
- `mocha` → Mocha (uses `describe`, `it`, `chai` assertions)
- `junit` → JUnit (uses `@Test`, `@BeforeEach`, `assertEquals`)

### 1b. Import Conventions

Read 2-3 test files from `repo_context.existing_tests[].test_content` or `repo_context.sample_tests[].content`. Extract the import block at the top of each file.

Look for patterns:
- **Testing framework imports**: `import { describe, expect, it, vi } from 'vitest'` vs implicit globals
- **Testing library**: `import { render, screen } from '@testing-library/react'`, `import { renderHook } from '@testing-library/react'`
- **User event**: `import userEvent from '@testing-library/user-event'`
- **Custom utilities**: `import { customRender } from '@src/lib/test-utils/renderer'`
- **Source under test**: relative import pattern (e.g., `import { MyComponent } from '../my-component'`)
- **Assertion extensions**: `@testing-library/jest-dom` (provides `toBeInTheDocument()` etc.)

Record the exact import lines — the generated code must match these verbatim.

### 1c. Mock Patterns

From the same test files, extract how mocks are set up:
- **Module mocks**: `vi.mock('../path', () => ({ ... }))` vs `jest.mock('../path')`
- **Function mocks**: `vi.fn()` vs `jest.fn()`
- **Typed mocks**: `vi.mocked(someFunction)` vs `jest.mocked(someFunction)`
- **Hook mocks**: How hooks are mocked (return value patterns)
- **API/fetch mocks**: `msw`, manual fetch mock, `nock`, etc.
- **Provider wrapping**: `MockedProvider` for Apollo, custom render for contexts

### 1d. Test Structure

- **Nesting**: `describe('ComponentName', () => { describe('sub-group', () => { it(... }) })` — how deep?
- **Test naming**: `it('should [behavior] when [condition]')` vs `test('[scenario]')`
- **Setup**: `beforeEach(() => { vi.clearAllMocks() })` — what goes in setup?
- **Cleanup**: Explicit `afterEach` or handled by framework setup?
- **Data setup**: Inline objects vs imported fixtures vs factory functions?

### 1e. Assertion Patterns

- **DOM assertions**: `expect(screen.getByText('...')).toBeInTheDocument()`
- **Function call assertions**: `expect(mockFn).toHaveBeenCalledWith(expected)`
- **Value assertions**: `expect(result).toEqual(expected)` vs `expect(result).toBe(expected)`
- **Async patterns**: `await waitFor(() => { expect(...) })` vs `await screen.findByText(...)`
- **Partial matching**: `expect.objectContaining({...})`

### 1f. File Naming and Location

From `repo_context.existing_tests` and `repo_context.test_framework.test_patterns`:
- **Convention**: `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `test_*.py`, `*_test.go`
- **Location**: `__tests__/` subdirectory, co-located, mirror `test/` directory
- **Path derivation**: Given source `src/features/x/component.tsx`, test goes to `src/features/x/__tests__/component.test.tsx`

### 1g. Custom Utilities Available

From `repo_context.test_helpers`:
- **Custom renderers**: e.g., `customRender(ui, { mocks, messages, permissionsSet })`
- **Hook renderers**: e.g., `renderHookWithProviders(hook, { wrapper })`
- **Mock factories**: e.g., `createMockUser()`, `buildAppointment()`
- **Shared fixtures**: JSON fixtures or TypeScript fixture objects
- **Global mocks**: e.g., `__mocks__/zustand.ts` — things auto-mocked by the framework setup

### 1h. Setup File Context

From `repo_context.test_framework.setup_file_contents` (if available):
- What is globally configured (e.g., `@testing-library/jest-dom/vitest`, RTL `cleanup()`)
- What polyfills are provided (e.g., `IntersectionObserver`, `ResizeObserver`, `matchMedia`)
- What modules are globally mocked (e.g., `next/navigation`, `next-auth`)
- What env vars are set for tests

This prevents the generated code from re-mocking things that are already globally mocked.

### 1i. E2E Style Profile

If `repo_context.e2e_infrastructure` exists and `e2e_pattern` is not `"none"`:

Read `repo_context.e2e_infrastructure.app_helper.content`, `auth_fixtures[].content`, and `sample_e2e_specs[].content`. Extract:

- **App bootstrap**: How `buildApp()` creates the NestJS app, what providers it overrides (guards, Kafka, Redis, etc.)
- **Teardown**: How `teardownApp()` cleans up (close app, disconnect Redis)
- **Auth setup**: Which fixture functions generate auth headers per role (e.g., `adminTestHeaders`, `testAdminAuthHeaders`)
- **Request pattern**: `request(app.getHttpServer()).post('/graphql').set(headers).send(query)` — exact chain
- **GraphQL query shape**: How queries are built in E2E (inline template literals, imported constants, or generated)
- **Lifecycle hooks**: `beforeAll`/`afterAll` vs `beforeEach`/`afterEach` usage in E2E specs
- **E2E test command**: From `repo_context.e2e_infrastructure.e2e_test_command`

Record the E2E style profile separately from the unit test profile — E2E generation uses this, unit generation uses the main profile.

### 1i-2. Playwright Page-Object Style Profile (frontend E2E)

If `repo_context.test_framework.name` is `"playwright-page-object"` (a repo whose E2E tests are plain Playwright specs built on a page-object model, rather than a backend Supertest/buildApp E2E harness — no NestJS/GraphQL server involved):

Read `repo_context.test_framework.playwright_page_objects.fixtures_file` (the file that wires page objects into Playwright's `test` via `test.extend`, e.g. a `fixtures.ts` exporting `test`/`expect`), `repo_context.test_framework.playwright_page_objects.pages[]` (each with its `class_name`, `file`, `extends`, and `public_methods[]`), and `repo_context.test_framework.playwright_page_objects.sample_spec` (path + content). Extract:

- **Fixture import**: the exact import line specs use instead of `@playwright/test` directly — e.g. `import { expect, test } from '../src/fixtures'` — because the repo's fixtures wrap `test` with page-object injection.
- **Page-object fixtures available**: the fixture names each spec can destructure (e.g. `loginPage`, `cartPage`, `inventoryPage`) and, for each, its class's public methods/locators (e.g. `LoginPage.loginWithUser(username, password)`, `loginContainer.usernameInput`, `errorContainer.errorMessage`) — generation must call these methods rather than writing raw `page.locator(...)`/`page.click(...)` calls, the same way a NestJS E2E test calls `buildApp()` instead of constructing the server by hand.
- **Suite/test structure**: `test.describe('<Suite name>: @tag', () => { ... })`, `test.beforeEach(async ({ fixtureName, baseURL }) => { ... })` for shared setup (e.g. navigating to the base URL), and individual `test('should ...', async ({ fixtureName }) => { ... })` blocks — match the repo's exact tagging convention (e.g. `@login`, `@e2e`, `@smoke`) if `sample_tests` shows one.
- **Assertion style**: `expect(locator).toBeVisible()` / `.toHaveText(...)` / `.toHaveURL(...)` on Playwright locators (from `@playwright/test`'s `expect`, re-exported by the fixtures file) — not DOM-testing-library assertions.
- **Constants/test data source**: if specs import shared literals (e.g. `import { CREDENTIALS, ERRORS, PAGES } from '../src/consts'`), reuse those constants instead of inlining new literal strings for anything already defined there.
- **Run command**: `repo_context.test_framework.playwright_page_objects.run_command` (e.g. `npm test`, or a `--grep`-scoped variant if the repo tags suites).

Record this as its own style profile (`playwrightPageObject: { fixtureImport, availableFixtures: [...], suiteStructure, assertionStyle, constantsImport, testCommand }`), separate from both the unit profile and the backend E2E profile — Step 5m below uses this one exclusively.

### 1j. Specialized File Profiles

Scan `repo_context` for specialized file classifications:

- **DTOs**: If `repo_context.dto_files` is non-empty, note that DTO validation tests should be generated using `class-validator`'s `validate()` function and `class-transformer`'s `plainToInstance()`
- **API routes**: If `repo_context.api_route_files` is non-empty, note the router type (`app` vs `pages`) and available HTTP methods. Check `repo_context.has_node_mocks_http` for the request helper.
- **Kafka handlers**: If `repo_context.kafka_infrastructure` is non-null, note mock patterns and event patterns for handler test generation
- **Guards/Interceptors**: If any changed file matches `*.guard.ts` or `*.interceptor.ts` in `repo_context.code_structure.middleware`, note existing guard test patterns from `repo_context.sample_tests` or `repo_context.e2e_infrastructure`

**Output:** A structured style profile object (held in memory, not shown to user):

```
{
  framework: "vitest",
  imports: { framework: "...", testingLibrary: "...", userEvent: "...", customRender: "..." },
  mocks: { modulePattern: "vi.mock(...)", fnPattern: "vi.fn()", clearPattern: "vi.clearAllMocks()" },
  structure: { nesting: "describe > describe > it", naming: "should ... when ...", setup: "beforeEach" },
  assertions: { dom: "toBeInTheDocument()", async: "waitFor/findBy", equality: "toEqual" },
  fileNaming: { convention: "*.test.tsx", location: "__tests__/", pathRule: "..." },
  customUtils: { render: "customRender", hookRender: "renderHookWithProviders", factories: [...] },
  globalMocks: ["next/navigation", "next-auth", "@src/lib/client-logger"],
  globalPolyfills: ["IntersectionObserver", "ResizeObserver", "matchMedia"],
  e2e: {
    pattern: "supertest-graphql",
    buildApp: "import { buildApp, teardownApp } from './app-helpers'",
    authFixtures: { admin: "adminTestHeaders", user: "testUserAuthHeaders" },
    requestChain: "request(app.getHttpServer()).post('/graphql').set(headers).send(query)",
    lifecycle: "beforeAll/afterAll",
    testCommand: "npm run test:e2e"
  },
  specialized: {
    dtoValidation: true,
    apiRoutes: { routerType: "app", hasMockedHttp: true },
    kafkaHandlers: { mockPattern: "...", eventPatterns: [...] },
    guardTests: { samplePattern: "..." }
  }
}
```

---

## Step 2: Parse Change Surface

Analyze `pr_diff` to understand what specifically changed in each file. This is more granular than file-level — we need function/component/hook level changes.

### 2a. For each changed source file (skip test files, configs, locks)

Parse the unified diff to extract:

**TypeScript/JavaScript:**
- New or modified `export function NAME` / `export const NAME` / `export class NAME`
- New or modified React component (function component `export function MyComponent` or `export const MyComponent = `)
- New or modified hooks (`export function useMyHook` or `export const useMyHook = `)
- Changed parameters (look for parameter additions/changes in function signatures)
- New conditional branches (`if`, `switch`, ternary operators added in `+` lines)
- New error handling (`try/catch`, `throw`, `.catch()`)
- Changed JSX elements (new components rendered, changed props)
- Changed type definitions (`interface`, `type`)

**Python:**
- New or modified `def function_name` / `class ClassName`
- Changed method signatures
- New exception handling (`try/except`, `raise`)
- Changed decorators (`@app.route`, `@pytest.fixture`)

**Go:**
- New or modified `func FunctionName` / `func (r *Receiver) MethodName`
- Changed struct fields
- New error returns

### 2b. Flag specialized file types

Cross-reference each changed file against `repo_context` classifications:

- If file is in `repo_context.dto_files[]` → add `"file_category": "dto"` and include `decorators_found`
- If file is in `repo_context.api_route_files[]` → add `"file_category": "api_route"` and include `http_methods`
- If file is in `repo_context.kafka_infrastructure.handler_files[]` → add `"file_category": "kafka_handler"` and include event patterns
- If file matches `*.guard.ts` → add `"file_category": "guard"`
- If file matches `*.interceptor.ts` → add `"file_category": "interceptor"`
- If file matches `*.pipe.ts` → add `"file_category": "pipe"`
- If file matches `*.resolver.ts` or `*.controller.ts` → add `"file_category": "resolver"` or `"controller"`
- If `repo_context.schema_changes.has_schema_changes` is true, add schema units for each breaking/non-breaking change:

```json
{
  "name": "UserType.legacyId",
  "type": "schema_field_removed",
  "change_type": "removed",
  "details": "Breaking: field removed from GraphQL type"
}
```

### 2c. Output per file

```json
{
  "file": "src/features/configurator/components/dialogs/remove-exercise-dialog.tsx",
  "file_category": "component",
  "changed_units": [
    {
      "name": "RemoveExerciseDialog",
      "type": "component",
      "change_type": "modified",
      "details": "Added excludedExerciseIds prop, passed to ExerciseSelect"
    },
    {
      "name": "excludedExerciseIds",
      "type": "prop",
      "change_type": "added",
      "details": "New prop for filtering out already-removed exercises"
    }
  ]
}
```

---

## Step 3: Coverage Gap Analysis

For each changed file + changed unit from Step 2, determine if existing tests already cover the change.

### 3a. Check existing test files

For each changed source file, look up `repo_context.existing_tests[]`:
- If `test_file` is null → all units in this file are `not_covered`
- If `test_file` exists → read `test_content` and `test_names` to check each changed unit

### 3b. Match changed units against test content

For each changed unit, search the existing test content for evidence of coverage:

**Signals of coverage (strong → weak):**
1. Test name directly mentions the changed unit: `it('should handle excludedExerciseIds')` → **fully_covered**
2. Test renders/calls the changed component/function with the new parameters → **fully_covered**
3. Test file exists for the source file but no test mentions the changed unit → **partially_covered**
4. Test file mentions the component but only tests other behaviors → **partially_covered**
5. No test file exists at all → **not_covered**

### 3c. Classify each unit

| Classification | Meaning | Action |
|---|---|---|
| `fully_covered` | Existing test directly exercises the changed behavior | Suggest running existing test (Step 4) |
| `partially_covered` | Test file exists but the specific change is untested | Generate new tests to add to the existing file (Step 5) |
| `not_covered` | No test file exists for this source file | Generate a complete new test file (Step 5) |

### 3d. Handle edge cases

- If a diff only changes **types/interfaces** (no runtime behavior change): classify as `not_applicable` — no test needed
- If a diff only changes **imports/re-exports**: classify as `not_applicable`
- If a diff only adds **comments or documentation**: classify as `not_applicable`
- If the changed file is in `sonar_config.coverage_exclusions`: note it but still generate tests if the change has runtime impact

---

## Step 4: Suggest Existing Tests (for Covered Changes)

For each unit classified as `fully_covered`, produce a suggestion:

```json
{
  "source_file": "src/features/configurator/hooks/use-exercise-table-columns.tsx",
  "test_file": "src/features/configurator/hooks/__tests__/use-exercise-table-columns.test.tsx",
  "covered_units": ["useExerciseTableColumns - excludedExerciseIds parameter handling"],
  "test_names": [
    "should disable checkbox for excluded exercises",
    "should gray out text for excluded exercise rows"
  ],
  "run_command": "{test_command} {test_file_path}"
}
```

The `run_command` is constructed from `repo_context.test_framework.test_command` + the test file path. Examples:
- Vitest: `pnpm test src/features/x/__tests__/hook.test.tsx`
- Jest: `npx jest src/features/x/__tests__/hook.test.ts`
- pytest: `pytest tests/test_my_module.py`
- Go: `go test ./pkg/mypackage/...`

### 4b. Include Predicted Tests

If `repo_context.predicted_tests` is non-empty, include them in the output. These are existing tests affected by the PR changes (from the import dependency map) that are NOT the direct test file for any changed source file:

```json
{
  "predicted_tests": [
    {
      "test_file": "src/features/overview/__tests__/overview.test.tsx",
      "reason": "tests src/features/overview/overview.tsx which imports changed file src/shared/hooks/use-data.ts",
      "confidence": "medium",
      "run_command": "pnpm test src/features/overview/__tests__/overview.test.tsx"
    }
  ]
}
```

Build the `run_command` using the same pattern as Step 4.

---

## Step 5: Generate Executable Test Code (for Uncovered Changes)

For each unit classified as `not_covered` or `partially_covered`, generate runnable test code.

### 5a. Determine output strategy

- **`not_covered`** (no test file exists): **Create** a complete new test file at the correct path in the repo. Use the Write tool to create the file. The file must have proper imports, mocks, setup, and all test cases.
- **`partially_covered`** (test file exists but missing coverage): **Do NOT modify the existing file.** Present the new `describe`/`it` blocks in a fenced code block in the output, with a comment indicating the target file and insertion point. The user will copy-paste them manually.

### 5b. Map BDD flows to test cases

Use `bdd_test_flows.flows[]` as the specification for what to test. Each BDD flow maps to one or more `describe` blocks or `it` blocks:

- BDD flow `title` → `describe('title', () => { ... })`
- BDD flow `steps[]` → individual `it` blocks or sequential steps within a single `it`
- BDD flow `tags` → inform test categorization and priority

**Mapping rules:**
- Each BDD flow that exercises a `not_covered` or `partially_covered` unit → generate test code for it
- If a BDD flow spans multiple source files, generate tests in the file that owns the primary changed unit
- If a BDD flow is purely UI/E2E (e.g., "navigate to page, click button"), adapt it to component-level testing (render component, simulate click, assert DOM change)
- Skip BDD flows tagged `@cross-service` or `@deployment` — these are not unit/component testable

### 5c. Generate test file content

Apply the style profile from Step 1 to generate code. The generated file must follow this structure:

**For TypeScript/JavaScript (Vitest/Jest):**

```typescript
// Imports — match repo's exact import conventions
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { customRender } from '@src/lib/test-utils/renderer';

// Source under test
import { MyComponent } from '../my-component';

// Mocks — match repo's mock patterns
vi.mock('../dependencies', () => ({
  useSomeDependency: vi.fn(() => defaultReturnValue),
}));

describe('MyComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when [condition from BDD flow]', () => {
    it('should [behavior from BDD assertion]', () => {
      // Arrange: set up mocks and render
      // Act: simulate user interaction
      // Assert: verify expected outcome
    });
  });
});
```

**For Python (pytest):**

```python
import pytest
from unittest.mock import patch, MagicMock

from src.module_under_test import function_under_test

class TestFunctionUnderTest:
    @pytest.fixture
    def mock_dependency(self):
        with patch('src.module_under_test.dependency') as mock:
            mock.return_value = default_value
            yield mock

    def test_should_behavior_when_condition(self, mock_dependency):
        # Arrange
        # Act
        result = function_under_test(input_data)
        # Assert
        assert result == expected
```

**For Go (testing):**

```go
package mypackage_test

import (
    "testing"
    "github.com/stretchr/testify/assert"
)

func TestFunctionName(t *testing.T) {
    tests := []struct {
        name     string
        input    InputType
        expected ExpectedType
    }{
        {
            name:     "should behavior when condition",
            input:    InputType{...},
            expected: ExpectedType{...},
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            result := FunctionName(tt.input)
            assert.Equal(t, tt.expected, result)
        })
    }
}
```

### 5d. Code quality rules

- **No placeholders**: Every mock return value, test data value, and assertion must be concrete. Use realistic data inferred from the source code and BDD flows.
- **Import paths must be correct**: Derive relative import paths from the test file location to the source file location. Use the repo's alias patterns (e.g., `@src/`) if the repo uses them.
- **Mock only what's needed**: Check Step 1h (global mocks from setup files). Do NOT re-mock modules that are already globally mocked.
- **Use custom utilities**: If the repo has `customRender`, use it instead of plain `render` when the component needs providers. Infer provider needs from the source file's imports (Apollo, i18n, auth, etc.).
- **Match assertion granularity**: If the repo uses `getByRole` selectors, use `getByRole`. If it uses `getByTestId`, use `getByTestId`. Match what existing tests do.
- **Handle async correctly**: If the component has async effects, use `await waitFor(...)` or `await screen.findByText(...)` matching the repo's async patterns.

### 5e. For partially_covered files

Generate only the missing test blocks with clear insertion guidance:

```typescript
// === ADD TO EXISTING FILE: src/features/x/__tests__/component.test.tsx ===
// Insert inside the existing describe('ComponentName') block, after the last it() block:

describe('when excludedExerciseIds are provided', () => {
  it('should disable checkbox for excluded exercises', () => {
    // ... generated test code
  });

  it('should show grayed-out text for excluded exercises', () => {
    // ... generated test code
  });
});
// === END OF NEW TESTS ===
```

### 5f. NestJS E2E Test Generation

**Trigger:** Changed file has `file_category` of `"resolver"` or `"controller"` AND `repo_context.e2e_infrastructure` exists with `e2e_pattern` not `"none"`.

**Check existing E2E coverage:** Search `repo_context.e2e_infrastructure.sample_e2e_specs` for imports of the changed resolver/controller module. If an E2E spec already covers it, classify as `fully_covered` for E2E.

**Generate if uncovered:** Create a new `.e2e-spec.ts` file following the E2E style profile from Step 1i:

1. Import `buildApp`, `teardownApp` from the app helper path
2. Import auth fixtures for the appropriate role (default to admin)
3. Set up `beforeAll` with `buildApp()`, `afterAll` with `teardownApp()`
4. Extract query/mutation signatures from the resolver's method signatures (from `full_file_contents`)
5. For each `@Query` or `@Mutation` in the changed resolver, generate a test that:
   - Constructs the GraphQL query/mutation string with proper fields
   - Sends it via `request(app.getHttpServer()).post('/graphql').set(authHeaders).send({ query })`
   - Asserts status 200 and `res.body.data` contains the expected shape
   - Asserts `res.body.errors` is undefined (no GraphQL errors)
6. Place the file at `src/e2e/{feature-name}.e2e-spec.ts` matching the repo's E2E directory

For REST controllers (non-GraphQL), generate Supertest calls matching the HTTP method and route path.

The E2E run command uses `repo_context.e2e_infrastructure.e2e_test_command` instead of the unit test command.

### 5g. DTO Validation Test Generation

**Trigger:** Changed file has `file_category` of `"dto"` AND `repo_context.dto_files[]` entry has `has_validation_decorators: true`.

**Generate a validation test:**

1. Import `validate` from `class-validator` and `plainToInstance` from `class-transformer`
2. Import the DTO class from the source file
3. Construct a valid data object — populate every field with type-appropriate realistic data inferred from the DTO's property types and decorator constraints
4. Generate test cases:
   - **Valid instance:** `plainToInstance(DtoClass, validData)` → `validate()` returns empty array
   - **One test per required field:** Omit each `@IsNotEmpty` / non-`@IsOptional` field, assert `validate()` returns error for that property
   - **Type violation tests:** Provide wrong types (string where number expected, number where string expected)
   - **Decorator-specific edge cases:** Empty string for `@IsNotEmpty`, invalid email for `@IsEmail`, out-of-range for `@Min`/`@Max`, wrong enum value for `@IsEnum`
   - **Optional fields:** Omit `@IsOptional` fields, assert no validation error
5. Match the repo's test runner (`vi` or `jest` imports, `describe`/`it` structure)

Place the file following the repo's test convention (e.g., `src/modules/user/dto/__tests__/create-user.dto.spec.ts`).

### 5h. Next.js API Route Test Generation

**Trigger:** Changed file has `file_category` of `"api_route"`.

**Generate an API route test:**

1. If `repo_context.has_node_mocks_http` is true:
   - Import `createMockedRequest` from the repo's test-utils path
   - For each exported HTTP method (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`):
     - Create a mocked request with the appropriate method
     - Call the exported handler function directly
     - Assert response status and body shape
   - Test error cases: invalid request body, missing required fields, unauthorized access

2. If `node-mocks-http` is NOT available:
   - Import `NextRequest` from `next/server`
   - Construct `new NextRequest('http://localhost/api/path', { method: 'GET' })`
   - Call the handler and assert the `NextResponse`

3. Mock dependencies (database clients, external APIs) using the repo's mock patterns

Place the file following the repo's test convention (e.g., `src/app/api/users/__tests__/route.test.ts`).

### 5i. Kafka Handler Test Generation

**Trigger:** Changed file has `file_category` of `"kafka_handler"`.

**Generate a handler test:**

1. Extract `@EventPattern('topic.name')` or `@MessagePattern('topic.name')` decorators from the source file content
2. Identify the handler method signature and its constructor dependencies
3. Generate a NestJS testing module:
   - Import `Test` from `@nestjs/testing` and `baseModules()` if available
   - Mock all constructor dependencies with `vi.fn()` or `jest.fn()`
   - Use `.overrideProvider(Dep).useValue(mockDep)` or direct `providers` array
4. For each event pattern, generate test cases:
   - **Happy path:** Call handler method with a valid message payload, assert downstream service calls
   - **Malformed message:** Call with incomplete/invalid payload, assert proper error handling
   - **Service failure:** Mock downstream service to throw, assert handler handles the error (doesn't crash, logs error, etc.)
5. Use mock patterns from `repo_context.kafka_infrastructure.mock_patterns` to match the repo's Kafka mocking style

Place the file co-located with the handler (e.g., `src/modules/notifications/__tests__/notifications.handler.spec.ts`).

### 5j. Guard Test Generation

**Trigger:** Changed file has `file_category` of `"guard"`.

**Generate a guard test:**

1. Create a mock `ExecutionContext` that provides `switchToHttp().getRequest()` returning a mock request object
2. Mock any injected services (e.g., `JwtVerificationService`, `ReflectionService`)
3. Generate test cases:
   - **Valid credentials:** Set auth header/cookie with valid token, mock service to verify successfully → `canActivate` returns `true`
   - **Missing credentials:** No auth header/cookie → `canActivate` returns `false` or throws `UnauthorizedException`
   - **Invalid credentials:** Expired/malformed token → `canActivate` returns `false` or throws
   - **Role-based access (if applicable):** Test different roles against the guard's requirements
4. If an existing guard test sample exists in `repo_context.sample_tests` or `repo_context.e2e_infrastructure`, match its patterns exactly

Place the file co-located with the guard (e.g., `src/auth/__tests__/custom-auth.guard.spec.ts`).

### 5k. Interceptor/Pipe Test Generation

**Trigger:** Changed file has `file_category` of `"interceptor"` or `"pipe"`.

**For interceptors:** Generate a test that:
1. Mocks `ExecutionContext` and `CallHandler` (with `handle()` returning `of(mockResponse)`)
2. Tests that `intercept()` transforms the response correctly
3. Tests error handling within the interceptor
4. Tests any conditional logic (e.g., skip for certain routes)

**For pipes:** Generate a test that:
1. Tests `transform()` with valid input → returns transformed value
2. Tests `transform()` with invalid input → throws `BadRequestException`
3. Tests edge cases (null, undefined, empty string)

### 5l. GraphQL Schema Backward-Compatibility Tests

**Trigger:** `repo_context.schema_changes` is non-null AND `schema_changes.breaking_changes` is non-empty.

**Generate backward-compatibility tests:**

For NestJS + Supertest repos (E2E infrastructure available):
1. For each breaking change (field removed, type changed, query removed):
   - Generate an E2E spec that sends the OLD query shape (with the removed/changed fields)
   - Assert the expected behavior: either the field is still returned (backward-compatible deprecation) or a proper GraphQL error is returned (clean break)
2. This proves to the reviewer that the schema break was intentional and handled properly

For frontend repos:
1. For each breaking change in a consumed GraphQL query/mutation:
   - Generate a test that checks the updated query/fragment handles the missing field gracefully
   - Assert no runtime errors when the field is absent from the response

Place schema tests in the E2E directory for backend or co-located with the query file for frontend.

### 5m. Playwright Page-Object Frontend E2E Test Generation

**Trigger:** `repo_context.test_framework.name` is `"playwright-page-object"` (set in Step 1i-2) — this is a frontend repo with no backend/API surface, so none of 5f–5l apply; this path is the primary (often only) executable-test output for such a repo.

**Check existing coverage first**, same principle as Step 3: search the existing `sample_tests`/spec directory for a spec that already exercises the changed page/flow (by page-object fixture name or component under test). If one exists and covers the changed behavior, classify `fully_covered` and suggest running it (Step 4) instead of generating a duplicate.

**Generate if uncovered or partially covered**, driven by `bdd_test_flows.flows[]` exactly as in 5b — each BDD flow becomes one `test(...)` block, not a raw translation of Playwright actions:

1. Import from the style profile's `fixtureImport` (e.g. `import { expect, test } from '../src/fixtures'`), never `@playwright/test` directly — the repo's own fixtures wrap it with page-object injection.
2. Determine which page-object fixture(s) the flow touches (from `repo_context.test_framework.playwright_page_objects.pages[]`, matched against `fixture_names[]`) and destructure only those in the test signature: `test('should ...', async ({ loginPage, inventoryPage }) => { ... })`.
3. **Reuse existing page-object methods and locators — never write a raw `page.locator(...)`/`page.click(...)` call when an existing method already does it.** If a BDD step needs an interaction the page object doesn't expose yet, use the closest existing locator on that page object directly (e.g. `loginPage.loginContainer.usernameInput.fill(...)`) rather than inventing a new page-object method — this skill only ever creates new spec files, never edits `src/pages/*.ts`.
4. Follow the repo's suite/tagging convention from the style profile: wrap related flows in one `test.describe('<flow name>: @<tag>', () => { ... })`, with a shared `test.beforeEach` for navigation/setup if the existing specs do that.
5. Assert using the style profile's pattern — `expect(locator).toBeVisible()`, `.toHaveText(...)`, `.toHaveURL(...)` — against the exact expected values the BDD flow's assertion states, sourcing shared literals from the repo's constants file (e.g. `../src/consts`) when the value already exists there.
6. Place the new file under the same top-level directory as existing specs (e.g. `tests/`), named after the changed flow (e.g. `tests/pr-generated/<flow-name>.spec.ts`) — never inside `src/pages/` or `src/components/`, and never edit an existing `*.spec.ts` file (append-only via a new file, same as every other path in this skill).
7. Run command: the style profile's `testCommand`, optionally scoped with `--grep '<tag>'` if the repo tags suites and the generated spec reuses an existing tag.

Skip BDD flows tagged `@cross-service` or `@deployment` here too, same as 5b — a page-object frontend repo has no such flows in practice, but the rule is inherited, not special-cased away.

---

## Step 6: Compile Execution Instructions

Build run commands using `repo_context.test_framework`:

### 6a. Derive the base test command

From `repo_context.test_framework.test_command` or `repo_context.test_framework.name`:

| Framework | Base command |
|---|---|
| Vitest (pnpm) | `pnpm test` |
| Vitest (npm) | `npm test --` |
| Jest (npx) | `npx jest` |
| pytest | `pytest` |
| Go test | `go test` |
| RSpec | `bundle exec rspec` |
| Playwright (page-object) | `npm test` (or the repo's `test:*` script, e.g. `npm run test:e2e`) |

Also check `repo_context.test_framework.test_command` for the exact command from `package.json` scripts.

### 6b. Build specific commands

- **Run ALL unit tests** (new + existing): `{base_command} {all_unit_test_file_paths_space_separated}`
- **Run ONLY new unit tests**: `{base_command} {new_unit_test_file_paths}`
- **Run ONLY existing** (verify existing coverage): `{base_command} {existing_test_file_paths}`
- **Run predicted tests** (from import dependency map): `{base_command} {predicted_test_file_paths}`
- **Run E2E tests** (if generated): `{e2e_test_command} {e2e_test_file_paths}` — uses the E2E command from `repo_context.e2e_infrastructure.e2e_test_command`, NOT the unit test command
- **Watch mode** (if available): `{base_command} --watch {test_file_paths}` or `pnpm test:watch {paths}`

### 6c. Provide setup notes (if applicable)

If the repo requires specific setup before running tests (detected from CI pipeline or test framework config):
- Environment variables needed (from `repo_context.ci_pipeline.test_jobs[].env_vars`)
- Services needed (from `repo_context.ci_pipeline.test_jobs[].services` — e.g., Postgres, Redis)
- Install command (e.g., `pnpm install` if node_modules might be stale)

---

## Step 7: Output

Produce the final JSON object. This is the complete output of this skill.

```json
{
  "coverage_analysis": {
    "summary": "string — human-readable summary (e.g., '3/5 changed files have existing tests covering PR changes. 2 files need new tests.')",
    "total_changed_files": 5,
    "fully_covered": 2,
    "partially_covered": 1,
    "not_covered": 2,
    "not_applicable": 0,
    "covered": [
      {
        "source_file": "src/features/x/hooks/use-my-hook.ts",
        "test_file": "src/features/x/hooks/__tests__/use-my-hook.test.ts",
        "covered_units": ["useMyHook - new parameter handling"],
        "test_names": ["should handle new excludedIds parameter", "should filter excluded items"],
        "run_command": "pnpm test src/features/x/hooks/__tests__/use-my-hook.test.ts"
      }
    ],
    "uncovered": [
      {
        "source_file": "src/features/x/components/dialog.tsx",
        "reason": "No existing test file",
        "changed_units": ["DialogComponent - disabled state rendering", "DialogComponent - new prop excludedIds"]
      }
    ]
  },
  "executable_tests": [
    {
      "file_path": "src/features/x/components/__tests__/dialog.test.tsx",
      "type": "new",
      "content": "... full runnable test file content (complete code, not truncated) ...",
      "test_count": 5,
      "covers": ["DialogComponent - disabled state rendering", "DialogComponent - new prop excludedIds"],
      "run_command": "pnpm test src/features/x/components/__tests__/dialog.test.tsx"
    },
    {
      "file_path": "src/features/x/components/__tests__/existing-component.test.tsx",
      "type": "addition",
      "content": "... new describe/it blocks to add to the existing test file ...",
      "test_count": 2,
      "covers": ["ExistingComponent - new branch handling"],
      "insertion_point": "Inside describe('ExistingComponent'), after the last it() block",
      "run_command": "pnpm test src/features/x/components/__tests__/existing-component.test.tsx"
    }
  ],
  "predicted_tests": [
    {
      "test_file": "src/features/overview/__tests__/overview.test.tsx",
      "reason": "tests src/features/overview/overview.tsx which imports changed src/shared/hooks/use-data.ts",
      "confidence": "medium",
      "run_command": "pnpm test src/features/overview/__tests__/overview.test.tsx"
    }
  ],
  "schema_alert": {
    "has_breaking_changes": true,
    "breaking_changes": [
      {
        "type": "field_removed",
        "location": "src/modules/user/user.resolver.ts",
        "detail": "Field 'legacyId' removed from UserType"
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
  "execution": {
    "run_all_unit": "pnpm test src/features/x/hooks/__tests__/use-my-hook.test.ts src/features/x/components/__tests__/dialog.test.tsx",
    "run_new_only": "pnpm test src/features/x/components/__tests__/dialog.test.tsx",
    "run_existing_only": "pnpm test src/features/x/hooks/__tests__/use-my-hook.test.ts",
    "run_predicted": "pnpm test src/features/overview/__tests__/overview.test.tsx",
    "run_e2e": "npm run test:e2e -- src/e2e/feature.e2e-spec.ts",
    "watch": "pnpm test:watch src/features/x/components/__tests__/dialog.test.tsx",
    "setup_notes": "No additional setup required."
  }
}
```

**Output rules:**
- `content` in `executable_tests[]` must be the FULL test file content — never truncated, never placeholder
- `type` is either `"new"` (complete new file) or `"addition"` (blocks to add to existing file)
- `covers` links back to the changed units from Step 2 so the user knows what each test file addresses
- If ALL changed units are `fully_covered`, `executable_tests` is an empty array and the output focuses on the `covered` suggestions
- `predicted_tests` is always present (empty array if no predictions). These are distinct from `covered` — covered tests directly test the changed file, predicted tests are indirectly affected
- `schema_alert` is present only if `repo_context.schema_changes` is non-null. It passes through the breaking/non-breaking changes for the orchestrator to display
- `execution.run_e2e` is present only if E2E tests were generated. It uses the E2E command, not the unit test command
- `execution.run_predicted` is present only if `predicted_tests` is non-empty

---

## Error Handling

| Error | Action |
|-------|--------|
| `repo_context` is null | Abort — this skill cannot function without repo context. Return `{ "error": "repo_context required" }` |
| No test framework detected | Warn user. Generate tests in the closest common framework (Jest for JS/TS, pytest for Python). Note the assumption in `execution.setup_notes` |
| Existing test file >500 lines | Read only the first 500 lines for pattern analysis. Note potential missed coverage |
| BDD flows are empty | Skip Step 5b mapping. Generate tests directly from the change surface (Step 2) using generic test patterns |
| Generated import path cannot be resolved | Use the source file's own import patterns as reference. Flag uncertain paths with a `// TODO: verify import path` comment |

## Rules

1. **Match the repo's style exactly.** The generated test code must be indistinguishable from human-written tests in the same repo. Use the same import order, same indentation, same naming conventions, same mock patterns. If the repo uses `vi.mock`, never generate `jest.mock`. If the repo uses `customRender`, never use plain `render` for components that need providers.

2. **Concrete data, never placeholders.** Every test value must be realistic. Derive test data from the source file's types, the BDD flow's task descriptions, or the existing test fixtures. Never use `'test'`, `'foo'`, `'bar'`, or `TODO` as test data.

3. **Coverage gap analysis is an AI judgment — bias toward generating.** Reading test content and determining if it covers a specific code change is semantic, not syntactic. Read both the diff and the test carefully. A test that renders a component but doesn't exercise the newly added prop is `partially_covered`, not `fully_covered`. When in doubt between `fully_covered` and `partially_covered`, ALWAYS choose `partially_covered`. This ensures test code is generated for uncertain cases rather than silently skipping them. A false positive (generating a test that turns out to be redundant) is far less harmful than a false negative (missing a gap).

4. **Respect global mocks.** Never re-mock something that the test setup file already mocks globally. This causes conflicts and test failures.

5. **Prefer adding to existing files over creating new ones.** If a test file already exists for a source file, generate additional blocks to insert rather than a completely new file. This keeps the repo's test organization intact.

6. **Framework-agnostic detection, framework-specific generation.** The detection logic (Step 1) works for any test framework. The generation logic (Step 5) must produce idiomatic code for the specific framework detected. If an unknown framework is detected, fall back to the most common pattern for the language.

7. **NEVER ask for permission.** This skill's entire purpose is to produce executable test code. If ANY changed unit is classified as `not_covered` or `partially_covered`, you MUST generate the full test code and include it in the `executable_tests[]` array in the output JSON. Never stop at coverage analysis and ask the user what to do. Never present findings and wait for confirmation. Execute Steps 1 through 7 completely and output the final JSON with all generated code.

8. **Create NEW test files, never modify existing ones, never run tests.** For `not_covered` units: CREATE a new test file at the correct path in the repo (following the repo's `__tests__/` or co-located convention). For `partially_covered` units: present the additional test blocks in a fenced code block with insertion guidance (file path + where to insert) — do NOT write to the existing file. NEVER execute test commands (`pnpm test`, `npm test`, `pytest`, etc.) — only include run commands as strings in the output. The user decides when to run.
