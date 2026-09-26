---
name: generate-pr-test-cases
description: Generate structured E2E test flows for a Pull Request. Analyzes diffs, auto-detects tech stack, and produces prioritized end-to-end test flows with atomic step sequences ready for mobile automation execution. Each step is a {task, assertion} pair — a plain-language instruction and a specific visible outcome. Accepts Linear ticket context (Bug, Story, Task, Epic, Initiative, Spike) for richer flow generation. Output is a clean JSON with E2E flows only — no metadata, no fluff. Use when the user asks to generate test cases, QA coverage, or test plans for a PR.
---

# Generate PR Test Cases

Analyze a Pull Request's diff and produce structured E2E test flows that replace manual QA effort. Each flow is an end-to-end user journey composed of atomic `{task, assertion}` steps — a plain-language instruction paired with a specific visible outcome — ready for automated execution by the test executioner. Output is a clean JSON containing only the flows — no metadata, triage, risk analysis, or coverage summary.

**Pipeline context:** This skill's BDD flow output feeds into `generate-executable-tests`, which converts flows into runnable test code matching the repo's existing patterns. The BDD flows serve as the *specification* for what to test; the executable test generator handles *how* to write the code. Both outputs are presented to the user by the `pr-test-agent` orchestrator.

## When to Use

- User asks to generate test cases, QA coverage, or a test plan for a PR
- User says "generate tests for this PR", "what should we test", "create test cases"
- PR context (title, description, diff) is already in the conversation

## Input Contract

These fields must be present in the conversation before this skill runs. They are produced by the **pr-reader** skill, which fetches PR data via `gh` CLI.

| Field | Required | Source from pr-reader output |
|-------|----------|------------------------------|
| pr_title | Yes | `pr.title` |
| pr_description | Yes | `pr.description` (full PR body with AC) |
| changed_files | Yes | `changed_files[]` (path, status, additions, deletions) |
| code_diffs | Yes | `code_diffs[]` (path, unified diff per file) |
| linear_context | Yes | Structured Linear ticket data from linear-deep-dive. Pass `null` if no Linear ticket is associated with this PR. |
| review_comments | No | `review_comments[]` from pr-reader — reviewer insights on risks, edge cases, and code concerns. Array of `{author, body, type, file_path, line, created_at}`. |
| pr_commits | No | `commits[]` from pr-reader — per-change intent from commit messages. Array of `{sha, message, author}`. |
| pr_dependencies | No | `dependencies[]` from pr-reader — related/dependent PRs with state and relationship. Array of `{number, repo, title, state, url, relationship}`. |
| file_classifications | No | From pr-reader Step 3b — changed files grouped by category. Object with keys: `source`, `test`, `config`, `migration`, `schema_contract`, `feature_flag`, `ci_config`, `helm_k8s`. |
| change_surface | No | From pr-reader — `"single-service"`, `"cross-service"`, `"infra-only"`, or `"test-only"`. |
| has_breaking_changes | No | From pr-reader — boolean. True if schema/contract, migration, or deleted imports detected. |
| repo_context | No | From repo-context-analyzer — test framework, existing tests, full file content, code structure, callers, CI pipeline, SonarQube config. See `repo_context` schema below. |
| tech_stack | No | Auto-detected from diffs. Not provided by pr-reader. |

If the pr-reader output JSON is in the conversation, map the fields above directly. If any required field is missing, ask the user before proceeding. Do NOT guess or fabricate PR context.

When invoked by the **pr-test-agent** skill, `linear_context` is provided automatically from the linear-deep-dive output. When used standalone (without the orchestrator), pass `null` for `linear_context` and the skill works exactly as before — all Linear-dependent logic is skipped.

**Auto-detecting tech_stack:** If not explicitly provided, infer from file extensions, import statements, framework decorators, and config files visible in the diff. Common signals:

| Signal | Stack |
|--------|-------|
| `.tsx` + `react-native` imports | React Native |
| `@nestjs/` imports, `*.resolver.ts`, `*.module.ts` | NestJS |
| `@Query`, `@Mutation`, `*.gql` files | GraphQL |
| `.jsx`/`.tsx` + `next/` imports | Next.js |
| `express` imports, `app.get/post` patterns | Express |
| `*.py`, `django`/`flask` imports | Python web |

If the stack is unclear, ask the user.

## `linear_context` Schema

When `linear_context` is not null, it must conform to this structure. All string fields can be null/empty if the Linear ticket doesn't have that data. Fields are type-adaptive — populate the sections that match the ticket type, leave the rest null/empty. Supported types: Bug, Story, Task, Epic, Initiative, Spike, Sub-task.

**Universal fields (all ticket types):**

| Field | Type | Source |
|-------|------|--------|
| ticket_key | string | Linear ticket key, e.g., `"CV-6355"` |
| summary | string | Linear ticket summary |
| type | string | `"Bug"`, `"Story"`, `"Task"`, `"Epic"`, `"Initiative"`, `"Spike"`, or `"Sub-task"` |
| status | string | e.g., `"In Progress"` |
| priority | string | e.g., `"High"` |
| acceptance_criteria | string | From Acceptance Testing / Ticket Description |
| key_comments | string | Substantive findings from the comment thread |
| parent_context | string | One-line summary of the parent initiative |
| sibling_patterns | string | Patterns detected across sibling tickets (e.g., "3 siblings share the same auth refactor pattern") |
| linked_tickets_context | string | One-line summaries of directly linked tickets (blocks, blocked-by, relates-to) |
| components | string | Linear Components field (comma-separated, e.g., "payments, auth, scheduling") |
| labels | string | Linear Labels (comma-separated, e.g., "HIPAA, accessibility, performance") |
| environment_found | string | Environment Found field (e.g., "Production", "Staging", "QA") |
| supporting_information | string | Device info, user IDs, OS versions, timestamps from the ticket |
| how_discovered | string | How Discovered field (e.g., "User Report", "Automated Test", "Monitoring", "Code Review") |
| affected_versions | string | Affects Version/s field |
| fix_versions | string | Fix Version/s field |

**Bug-specific fields (populated when `type` is `"Bug"`):**

| Field | Type | Source |
|-------|------|--------|
| bug_description | string | From Bug Description custom field |
| expected_behavior | string | From Expected Results custom field |
| actual_behavior | string | From Actual Results custom field |
| steps_to_reproduce | string | From Steps to Reproduce custom field |
| root_cause | string | From Root Cause Indication or comments |

**Story/Task-specific fields (populated when `type` is `"Story"` or `"Task"`):**

| Field | Type | Source |
|-------|------|--------|
| ticket_description | string | From Ticket Description custom field or description — the full story/task scope (what's being built and how) |
| design_links | string | Design spec links, Figma URLs, RFC references from the ticket |

**Epic/Initiative-specific fields (populated when `type` is `"Epic"` or `"Initiative"`):**

| Field | Type | Source |
|-------|------|--------|
| epic_goal | string | What the initiative is about — goal and scope from description |
| children_overview | string | Summary of child tickets: count, status distribution, themes |
| children_status_distribution | string | e.g., "12 Done, 5 In Progress, 3 To Do, 2 Blocked" |
| key_children_context | string | Substantive details from deeply-read children — patterns, shared concerns, common failure modes |

**Spike-specific fields (populated when `type` is `"Spike"`):**

| Field | Type | Source |
|-------|------|--------|
| investigation_goal | string | What question the spike is answering |
| spike_findings | string | What the investigation discovered |
| spike_recommendations | string | Recommended actions from the spike |

**Sub-task handling:** Sub-tasks inherit the type-specific fields of their parent. A sub-task under a Bug populates bug-specific fields; a sub-task under a Story populates story-specific fields. The `type` field should reflect the effective type (e.g., `"Bug"` for a sub-task of a bug), not literally `"Sub-task"`.

## `repo_context` Schema

When `repo_context` is not null, it contains repo-level data from the `repo-context-analyzer` skill. All fields can be null/empty if the data wasn't available.

| Field | Type | Description |
|-------|------|-------------|
| test_framework | object | `{name, config_file, test_command, test_patterns, setup_files}` — detected test framework and its config |
| existing_tests | array | `[{source_file, test_file, test_content, test_names}]` — existing tests for changed files. `test_file: null` = coverage gap |
| full_file_contents | array | `[{path, content, language, line_count}]` — full source of changed files (not just diffs) |
| code_structure | object | `{api_routes[], db_models[], middleware[], modules[], config[]}` — architectural file paths in the repo |
| test_helpers | object | `{factories[], fixtures[], mocks[], conftest}` — available test utility files |
| callers | array | `[{function, source_file, callers: [{file, line_snippet, confidence}]}]` — best-effort callers (~70% accurate) |
| cross_repo_consumers | array | `[{repo, file, dependency}]` — other repos importing this package (if shared package) |
| ci_pipeline | object/null | `{test_jobs[], has_sonar_gate, sonar_step}` — CI test jobs from GitHub Actions |
| sonar_config | object/null | `{coverage_exclusions[], source_dirs[], test_dirs[], report_paths, project_key}` — SonarQube config |

## Workflow

```
Progress:
- [ ] Step 1: Validate context and detect tech stack
- [ ] Step 2: Extract acceptance criteria
- [ ] Step 3: Triage and filter changes
- [ ] Step 4: Classify changes
- [ ] Step 5: Identify change intent and map to test strategy
- [ ] Step 6: Analyze behavioral contracts and partition inputs
- [ ] Step 7: Compose E2E test flows
- [ ] Step 8: Risk analysis and non-functional concerns
- [ ] Step 9: Coverage summary and AC traceability
```

### Step 1: Validate Context and Detect Tech Stack

Confirm all required fields from the Input Contract are present. Auto-detect or confirm the tech stack.

### Step 2: Extract Acceptance Criteria

Scan the PR description for acceptance criteria (AC). Look for:
- Explicit "Acceptance Criteria" or "AC" sections
- Checkbox lists describing expected behavior
- "Given/When/Then" patterns
- "Should" statements describing requirements

If found, list them. These will be traced against generated test cases in Step 9. If no AC is found in the PR description, note "No explicit AC in PR description."

**Linear-sourced AC:** If `linear_context` is not null and `linear_context.acceptance_criteria` contains content, add those as additional AC items. Prefix each Linear-sourced AC with `[Linear]` to distinguish from PR-sourced AC in the traceability matrix. Linear AC comes from the Acceptance Testing field, Ticket Description, or the ticket description — it represents the product requirements that the code change must satisfy.

### Step 3: Triage and Filter Changes

Filter changed files before deep analysis. Output a triage table.

| Category | File Patterns | Action |
|----------|---------------|--------|
| Skip | Lockfiles, CI config (`.github/`), docs (`*.md`), auto-generated files, static assets, `.gitignore`, `.env.example` | List in triage, no test cases |
| Minimal | Config files (`.json`/`.yaml` not source), env templates | 1-2 test cases max |
| Full | Source files with logic (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, etc.) | Full analysis and test generation |

For large PRs (>15 source files marked "full"): prioritize files touching risky areas (auth, payments, user data, PII) and shared utilities first.

Use the triage internally to decide which files get full analysis vs. minimal vs. skip. The triage is NOT included in the final JSON output — it only guides test case generation.

### Step 4: Classify Changes

For each file marked "Full", categorize by architectural role.

**Common archetypes (adapt to the detected stack):**

- **Frontend:** component, hook, util, navigation, state management, API call, style
- **Backend:** controller/resolver, service, guard/middleware, DTO/schema, data access, module

Flag risky areas on any file touching: auth, payments, user data, PII, feature flags, encryption.

**File-classification-driven flags** (from `file_classifications` if provided):
- If `file_classifications.migration` is non-empty → flag as **"data-layer change"** — needs migration verification flows (forward migration, rollback safety, data integrity)
- If `file_classifications.schema_contract` is non-empty → flag as **"contract change"** — needs backward compatibility flows (existing consumers still work, new fields optional)
- If `file_classifications.feature_flag` is non-empty → flag as **"feature-gated change"** — needs toggle on/off flows (feature ON path, feature OFF path, default state)
- If `file_classifications.helm_k8s` is non-empty → flag as **"deployment change"** — needs config validation flows (env vars resolve, service URLs correct)
- If `file_classifications.ci_config` is non-empty → flag as **"pipeline change"** — minimal functional flows, mostly validation
- If `change_surface` is `"cross-service"` → flag ALL source files as elevated risk — the PR affects service boundaries
- If `has_breaking_changes` is true → flag as **"breaking change"** — needs explicit backward compatibility flows

**Repo-context-driven flags** (from `repo_context` if provided):
- If `repo_context.existing_tests` shows a changed file with `test_file: null` → flag as **"no existing test coverage"** — elevated priority for test generation
- If `repo_context.callers` shows a changed function has many callers (>3) → flag as **"high fan-out"** — regression risk for callers
- If `repo_context.cross_repo_consumers` is non-empty → flag as **"shared package change"** — cross-repo regression risk
- If `repo_context.sonar_config.coverage_exclusions` matches a changed file → deprioritize that file (intentionally excluded from coverage)

**Reviewer-flagged risks:** If `review_comments` is provided, scan for risk signals — comments containing keywords like "break", "careful", "edge case", "race condition", "security", "performance", "regression", "concern", "worried", "dangerous". Flag the referenced files as elevated risk regardless of their archetype. For inline comments (`type: "inline"`), flag the specific `file_path`. For review-body and PR comments, infer the file from context or flag all changed source files. Each substantive reviewer concern becomes a mandatory test anchor in Step 7.

**Component/Label risk signals:** If `linear_context` is not null and `linear_context.components` contains known risky areas (auth, payments, PII, encryption, billing, user-data) or `linear_context.labels` contains compliance/risk signals (HIPAA, SOC2, accessibility, security, PII, critical), elevate ALL changed source files to "risky" status for Step 7f security flow generation. This is additive — it doesn't replace file-level risk detection, it supplements it with business-context risk.

### Step 5: Identify Change Intent and Map to Test Strategy

Determine the PR intent from title + description + diff, then apply the strategy:

| Intent | Primary Test Focus | Secondary | Volume |
|--------|-------------------|-----------|--------|
| Bug fix | Reproduce the bug scenario; verify the fix | Regression around the fix | 2-4 unit + 1-2 regression + 1 functional |
| New feature | Full unit: happy path + edges + errors | Integration + functional user journey | 5-7 unit + 1-3 integration + 1-2 functional |
| Scope slice | Verify the implemented slice of a larger initiative; map to Epic ACs | Note out-of-scope items in coverage gaps | 4-6 unit + 1-2 integration + 1-2 functional |
| Investigation | Validate findings if code changes exist; may produce minimal tests | Regression if spike resulted in prototype code | 1-3 unit max |
| Refactor | Behavior-preserving regression | Verify no functional change leaked | 3-5 regression + 1-2 unit |
| Config change | Validate config loads correctly | Skip or minimal | 1-2 unit max |
| Dependency update | Regression on affected surfaces | Skip if internal-only | 1-3 regression |
| Migration | Verify schema migration applies cleanly; data integrity preserved | Rollback safety, existing queries still work | 2-3 migration + 1-2 regression |
| Contract update | Backward compatibility for existing consumers; new fields work | Breaking change detection, API versioning | 2-4 contract + 1-2 regression |
| Feature toggle | Feature ON path works; feature OFF path unchanged; default state correct | Toggle transition (ON→OFF, OFF→ON) | 2-3 toggle paths + 1 default |
| Cross-service | Boundary flows between this service and affected downstream services | Config validation, connection health | 2-3 boundary + 1-2 config |

If the PR mixes intents, apply the dominant intent per file.

**File-classification-informed intent:** If `file_classifications` is provided, use it to auto-detect special intents:
- `file_classifications.migration` non-empty → at least one file has `migration` intent
- `file_classifications.schema_contract` non-empty → at least one file has `contract_update` intent
- `file_classifications.feature_flag` non-empty → at least one file has `feature_toggle` intent
- `change_surface == "cross-service"` → the PR-level intent includes `cross_service`
These override or supplement the per-file intent detection from diffs.

**Linear-informed intent:** If `linear_context` is not null, use `linear_context.type` to confirm or override the detected intent:
- `Bug` → strongly signals `bug_fix` intent
- `Story` or `Task` → signals `new_feature` intent
- `Epic` or `Initiative` → signals `scope_slice` intent (the PR implements a portion of a larger initiative)
- `Spike` → signals `investigation` intent (the PR may contain experimental or prototype code)
- `Sub-task` → inherits the intent of its parent type. A sub-task under a Bug is `bug_fix`; a sub-task under a Story is `new_feature`. Use `linear_context.parent_context` to determine the parent type when the sub-task's own type is ambiguous.

This is more reliable than inferring intent from PR title alone.

**Story/Task scope awareness:** If `linear_context.type` is `Story` or `Task` and `linear_context.ticket_description` has content, compare the described feature scope against the actual diff. This tells you whether the PR implements the full story or a subset — a PR that implements 2 of 5 described requirements should generate tests only for the implemented parts, while noting the remaining scope as out-of-PR in the coverage gaps.

**Epic/Initiative scope awareness:** If `linear_context.type` is `Epic` or `Initiative` and `linear_context.epic_goal` or `linear_context.children_overview` has content, the PR implements a slice of a large initiative. Compare the Epic's goal and children themes against the diff to understand which part of the initiative this PR addresses. Generate tests only for the implemented slice.

**Commit message signals:** If `pr_commits` is provided, scan commit messages for intent keywords ("fix", "refactor", "add", "remove", "handle null", "race condition", "cleanup", "migrate"). Use these to confirm or refine the per-file intent when the PR mixes multiple intents — e.g., a commit message "fix: handle null token in biometric fallback" on a specific file confirms that file's intent is `bug_fix` even if the overall PR intent is `new_feature`.

### Step 6: Analyze Behavioral Contracts and Partition Inputs

**Do NOT skip this step.** For each changed function or component:

**6a. Behavioral Contract:**
1. **Inputs:** Arguments, props, request body, query params, headers
2. **Outputs:** Return value, rendered UI, HTTP response, side effects (DB writes, events emitted, cache updates, emails sent)
3. **Invariants:** Conditions that must always hold
4. **Error conditions:** What it throws, what fallback it renders, what error response it returns
5. **Authorization:** Who is allowed to call this? What role/permission is required?

When the diff shows only a partial view, use hedging language: "Based on the visible diff, this function appears to..."

**Linear-enriched contracts (Bugs):** If `linear_context` is not null and `linear_context.type` is `"Bug"`, use `expected_behavior` and `bug_description` to enrich the behavioral contract. The Linear expected behavior describes what the code *should* do from a product perspective — this complements what the diff shows about what it *does*. `linear_context.actual_behavior` describes the broken state the code should NOT produce after the fix.

**Linear-enriched contracts (Stories/Tasks):** If `linear_context` is not null and `linear_context.type` is `"Story"` or `"Task"`, use `ticket_description` and `acceptance_criteria` to enrich the behavioral contract. The ticket description describes the feature scope from a product perspective — map it to the functions changed in the diff to identify which parts of the story this PR implements and which parts are outside the PR scope. Each acceptance criterion becomes a behavioral expectation that the changed code must satisfy.

**Linear-enriched contracts (Epics/Initiatives):** If `linear_context.type` is `"Epic"` or `"Initiative"`, use `epic_goal` and `key_children_context` to frame the behavioral contract. The Epic's goal describes the initiative-level outcome — map it to the functions changed in the diff to understand which slice of the initiative this PR addresses. If `key_children_context` reveals shared patterns across children (e.g., "5 children all modify the same auth flow"), ensure test cases for this PR cover the shared architectural concern.

**Linear-enriched contracts (Spikes):** If `linear_context.type` is `"Spike"`, use `spike_findings` and `spike_recommendations` to inform the behavioral contract. Spike findings describe what the investigation discovered — if the PR implements code based on these findings, the test cases should validate that the implementation matches the spike's conclusions. If `spike_recommendations` suggests constraints or approaches, verify the code follows them.

**Linear-enriched contracts (all types):** If `linear_context.sibling_patterns` has content, check whether the PR touches a known pattern area. If siblings share a common failure mode or architectural concern (e.g., "3 siblings hit the same race condition in the auth flow") and this PR touches that area, flag it as elevated risk and ensure test cases cover the pattern. If `linear_context.linked_tickets_context` mentions dependencies (blocks/blocked-by), factor those into the behavioral contract — the changed code may need to satisfy constraints from linked work.

**Environment-aware preconditions:** If `linear_context.environment_found` or `linear_context.supporting_information` has content, use it to specify platform/device/OS in test preconditions. For example, if the environment is "iOS 17, iPhone 15 Pro Max, app v4.2.1", test preconditions should specify that platform and version. If `linear_context.affected_versions` has content, note which versions need regression coverage.

**Reviewer-flagged contracts:** If `review_comments` is provided and contains inline comments on specific files/lines, treat each substantive comment as a behavioral constraint. The reviewer is telling you what they're worried about — the test suite must address each concern. For example, a reviewer comment "this could break cache invalidation if TTL < 0" on line 42 of `CacheService.ts` means the behavioral contract for that function must include a "negative TTL" equivalence class.

**Discovery-informed test type:** If `linear_context.how_discovered` has content, use it to ensure the right category of test exists:
- "User Report" or "Customer Escalation" → ensure at least one functional (user journey) test exists
- "Automated Test" or "CI" → ensure regression tests cover the gap that the automated test missed
- "Monitoring" or "Alert" → ensure observability-related tests exist (metrics, logging, health checks)
- "Code Review" → ensure the specific code concern flagged in review has a targeted unit test

**Dependency-aware scope:** If `pr_dependencies` is provided and contains merged PRs touching the same service/module, note the combined change surface. Test cases should account for interactions between the current PR and its dependencies — for example, if a dependency PR added a new field and this PR validates it, the test must cover the full flow across both changes.

**Existing test alignment** (from `repo_context`): If `repo_context` is not null and `repo_context.existing_tests` has entries with non-null `test_file`, study the existing test patterns:
- Match the naming convention used (e.g., `describe('ServiceName', () => { it('should ...') })` vs `test('action: expected outcome')`)
- Match assertion patterns (e.g., `expect(result).toBe(...)` vs `assert.equal(...)`)
- Match setup patterns (e.g., `beforeEach` with factory functions vs inline setup)
- Use existing `test_names` as style reference for new flow titles
This ensures generated flows are consistent with the repo's testing culture.

**Full file contracts** (from `repo_context`): If `repo_context.full_file_contents` is available, use the full source code (not just diffs) to extract richer behavioral contracts:
- Read function signatures, return types, and error handling patterns from the complete file
- Identify validation logic that may not be visible in the diff alone (e.g., a validator called by the changed function)
- Identify side effects (DB writes, event emissions) from the full function body, not just the changed lines
- If `repo_context.callers` shows other functions calling the changed code, add their expectations as additional invariants

**Cross-repo contracts** (from `repo_context`): If `repo_context.cross_repo_consumers` is non-empty, add consumer-perspective contracts: "repos importing this package must still work"

**CI-pipeline-informed contracts** (from `repo_context`): If `repo_context.ci_pipeline` is not null:
- If CI has integration test jobs with database services (e.g., `postgres:14`), the behavioral contracts should include DB-level assertions
- If CI has a SonarQube quality gate, note the 80% new-code coverage requirement — flows must be thorough enough to meet this bar
- If `repo_context.sonar_config.coverage_exclusions` matches changed files, those files can have lighter coverage

**Historical bug contracts** (from `linear_context`): If `linear_context.historical_bugs` has entries matching the changed component/area, add regression contracts for each historical bug's root cause. The generated flows must verify the past bug doesn't recur.

**6b. Input Partitioning (Equivalence Classes):**

For each input parameter, identify:
- **Valid equivalence classes:** Groups of inputs that should produce the same type of behavior (e.g., "valid email addresses" is one class)
- **Invalid equivalence classes:** Groups that should produce the same error (e.g., "malformed emails", "empty string", "null")
- **Boundary values:** The exact edges between classes (e.g., for a 255-char max field: 254, 255, 256)

Document briefly. This drives systematic test case generation in Step 7.

**Example:**

```
Function: UsersService.updateProfile(userId, dto)
- Inputs: userId (string), dto (UpdateProfileDto with optional name, email)
- Outputs: Updated User entity
- Side effects: DB write via repository.save()
- Invariants: email must be unique across users
- Error conditions: NotFoundException (user not found), ConflictException (duplicate email)
- Authorization: Based on visible diff, no authorization check visible -- potential gap

Input Partitioning for dto.email:
  Valid classes: [valid email not taken], [user's own current email]
  Invalid classes: [email taken by another user], [malformed email string], [empty string ""], [null/undefined]
  Boundaries: empty string "" vs null (truthy/falsy behavior in `if (dto.email)` guard)
```

### Step 7: Compose E2E Test Flows

From the behavioral contracts (Step 6) and change intent (Step 5), compose end-to-end test flows. Each flow is a complete user journey through the app — from launch to final verification. Each step within a flow is atomic: one task, one assertion.

Every step follows this schema:

```json
{
  "task": "plain-language instruction for what to do (e.g. 'Launch the app', 'Tap the Sign in button', 'Type newemail@example.com into the email field')",
  "assertion": "visual verification after this step completes (e.g. 'Home screen is visible', 'Email field shows newemail@example.com')"
}
```

**`task` field guidance:**
- Write as a plain-language imperative sentence the executioner can interpret directly.
- Include the action, the target element, and any data value in one sentence. Examples:
  - `"Launch the app"` — app start
  - `"Tap the Sign in button"` — tap action
  - `"Type qauser@example.com into the email field"` — type with value
  - `"Scroll down to the Save button"` — scroll action
  - `"Navigate to profile settings"` — navigation
  - `"Press the back button"` — back action
- Be specific about element names: use the label, text, or visible identifier from the diff, not generic names like "the button".

**`assertion` field guidance:**
- Describe the specific visible state after the step completes.
- Every step must have a non-empty assertion. Be specific: `"Error message 'Email already in use' is displayed"`, not `"error appears"`.

Compose flows using these sub-steps in order:

**7a. Identify User Flows** — from the behavioral contracts (Step 6) and change intent (Step 5), identify the distinct user-facing flows affected by the PR. Each flow = one end-to-end journey through the app. Group by module and user journey. Example: "Login flow", "Profile edit flow", "Exercise playback flow".

**7b. Compose Prerequisite Steps** — for each flow, determine and prepend:
- App launch step (always first): `{ "task": "Launch the app", "assertion": "Splash screen is visible" }`
- **Environment setup (React Native flows only — always second, before login):**
  1. `{ "task": "Open the debug menu", "assertion": "Debug menu is visible" }`
  2. `{ "task": "Tap Change Base URI", "assertion": "Base URI selection screen is visible" }`
  3. `{ "task": "Select EKS Stage", "assertion": "Base URI is set to EKS Stage and the app restarts or returns to the launch screen" }`
- Login/auth steps (after environment setup, if the flow requires authentication)
- Navigation steps to reach the starting screen
- Prerequisite state setup (e.g., "ensure user has existing profile data")
- These are inferred from the `given` preconditions in the behavioral contracts

**7c. Compose Action Steps** — for each behavioral change identified in Step 6:
- Convert each input equivalence class into a concrete step
- Each step has ONE task (atomic — no multi-action tasks)
- `task` describes the action, the element, and any data value in a single sentence
- `assertion` describes what changes on screen immediately after that step
- Use concrete test data from the equivalence class (e.g., a valid email, a duplicate email, an empty string)

**7d. Compose Verification Steps** — for the final assertion of each flow:
- Map each `then` outcome from Step 6 into a verify step with a specific `assertion`
- Success paths: assert the expected result is visible
- Error paths: assert the error message is visible AND the previous state is preserved

**7e. Compose Negative/Edge Case Branches** — for each negative equivalence class:
- Share prerequisite steps with the happy path (same flow up to the divergence point)
- Branch at the specific action that differs (e.g., type a duplicate email instead of a valid one)
- Each branch becomes a separate flow
- Insert reset steps between branches if needed (back navigation, clear fields)

**7f. Security-Relevant Steps** (if risky files flagged in Step 4):
- Only include security scenarios that are testable through UI interaction
- Example: attempt an action as a different user, verify forbidden response
- Skip code-level security tests (injection, token forgery) — those need API-level testing

**7g. Bug Reproduction Flow** (from Linear, if applicable): If `linear_context` is not null, `linear_context.type` is `"Bug"`, and `linear_context.steps_to_reproduce` has content:
- Convert `linear_context.steps_to_reproduce` into a dedicated flow
- Each reproduction step becomes an E2E step
- The final assertion verifies the FIXED behavior from `linear_context.expected_behavior`, NOT `linear_context.actual_behavior`
- Priority: `P0`, tags: `@bug-repro`, `@{linear_context.ticket_key}`
- If `linear_context.key_comments` mentions platform variations (e.g., "also fails on Android 14"), generate a separate flow per platform

**7h. Feature Acceptance Flows** (from Linear, if applicable): If `linear_context` is not null, `linear_context.type` is `"Story"` or `"Task"`, and `linear_context.acceptance_criteria` or `linear_context.ticket_description` has content:
- Each acceptance criterion that has a UI-observable outcome becomes a flow
- Only generate flows for ACs the PR actually implements (visible from comparing ticket scope vs. diff scope)
- If `linear_context.design_links` references design specs, use those to inform expected UI states in verification steps
- Tags: `@acceptance`, `@{linear_context.ticket_key}`

**7i. Reviewer Concern Flows** (from `review_comments`, if applicable): If `review_comments` is provided and contains substantive concerns (not "LGTM", style nits, or formatting):
- Each substantive reviewer concern with a UI-testable scenario becomes additional steps in the relevant flow (or a dedicated flow if the concern spans a distinct journey)
- Skip trivial comments. If a concern is already covered by steps in an existing flow, add the reviewer's tag to that flow instead of duplicating
- Tags: `@reviewer-concern`, `@{reviewer_login}`

**7j. Migration Verification Flows** (triggered when `file_classifications.migration` is non-empty):
- Flow verifying the migration applies successfully (e.g., new table/column exists, data can be written and read)
- Flow verifying rollback doesn't corrupt data (if rollback is detectable via UI — e.g., feature still works after revert)
- Flow verifying existing queries/features still work after migration (regression)
- Tags: `@migration`, `@data-integrity`

**7k. Contract Backward Compatibility Flows** (triggered when `file_classifications.schema_contract` is non-empty):
- Flow verifying existing API consumers still receive expected responses (old fields present, old behavior preserved)
- Flow verifying new schema fields are optional and don't break clients that don't send them
- Flow verifying schema validation rejects invalid new field values
- Tags: `@contract`, `@backward-compat`

**7l. Feature Flag Toggle Flows** (triggered when `file_classifications.feature_flag` is non-empty):
- Flow with feature flag ON — verify the new behavior works end-to-end
- Flow with feature flag OFF — verify the old behavior is completely unchanged
- Flow verifying the default state (what happens when the flag config is missing)
- Tags: `@feature-flag`, `@toggle`

**7m. Cross-Service Boundary Flows** (triggered when `change_surface == "cross-service"`):
- For each affected downstream service, create a flow verifying the integration still works (e.g., API call succeeds, response is valid)
- If config files changed (Helm values, env vars), verify the service starts with the new config and can reach downstream services
- Tags: `@cross-service`, `@boundary`

**7n. Config Validation Flows** (triggered when `file_classifications.helm_k8s` or `file_classifications.config` is non-empty):
- Flow verifying the service starts successfully with the new config
- Flow verifying environment-specific config values resolve correctly
- If Docker/Compose files changed, verify the container builds and starts
- Tags: `@config`, `@deployment`

**Volume caps:** 3-8 flows per PR (expanded from 3-6 to accommodate specialized flows). Each flow should have 5-15 steps. Max ~80 total steps across all flows. Prefer merging related specialized flows into existing journeys rather than creating separate small flows.

### Step 8: Internal Risk Analysis (does NOT appear in output)

Perform risk analysis internally to inform flow priority and completeness. This step drives which flows get P0 priority and whether additional security/regression flows are needed. Do NOT include any of this in the final JSON output.

Assess internally:
- **Breaking changes:** Modified public interfaces, deleted code impact on callers. If `has_breaking_changes` is true, verify backward compatibility flows exist (Step 7k)
- **Security risks:** Auth gaps, PII exposure, input validation — ensure Step 7f produced flows for each
- **Reviewer-informed risks:** Map each substantive reviewer comment to the flow that addresses it — if any concern lacks coverage, go back to Step 7i
- **Component/Label-informed risks:** If `linear_context.components` or `linear_context.labels` triggered elevated risk in Step 4, verify Step 7f produced security-relevant flows
- **Environment-informed risks:** If `linear_context.environment_found` is "Production", verify regression flows exist (P0 severity)
- **Historical bug correlation:** If `linear_context.historical_bugs` shows past bugs in the same component, verify flows exist that prevent recurrence. Flag as elevated risk if the current change touches the same code path as a historical bug
- **Missing test coverage:** If `repo_context.existing_tests` shows changed files with `test_file: null`, those files are at higher risk — verify they have adequate flow coverage. Each untested file should have at least one dedicated flow
- **Caller regression risk:** If `repo_context.callers` shows a changed function has many callers, verify regression flows exist for the primary caller paths
- **Cross-repo consumer risk:** If `repo_context.cross_repo_consumers` is non-empty, verify Step 7m or Step 7k produced flows validating the package contract

Use these findings to adjust flow priorities and add missing flows. Then move to Step 9.

### Step 9: Internal Coverage Check (does NOT appear in output)

Perform a coverage check internally to identify gaps. If gaps are found, go back to Step 7 and generate missing flows or steps. Do NOT include any of this in the final JSON output.

Check internally:
- **AC traceability:** If AC was found in Step 2, verify each AC has at least one flow covering it. If any AC is uncovered and the PR implements it, add a flow
- **File coverage:** Verify every "full" triage file has at least one flow exercising it. If a file has zero coverage and it contains logic, add steps
- **Side effect coverage:** Verify every side effect from Step 6a has a verification step in at least one flow
- **Security coverage:** Verify every risky file from Step 4 has at least one security-relevant flow
- **Specialized flow coverage:** Verify each triggered specialized flow type was produced:
  - Migration files present → migration flows exist (7j)
  - Contract files present → backward compat flows exist (7k)
  - Feature flag files present → toggle flows exist (7l)
  - Cross-service impact → boundary flows exist (7m)
  - Config/Helm files present → config validation flows exist (7n)

After this check, the flows are final. Proceed to output.

## Output Format

The final output must be a single JSON object containing flows with their steps. No metadata, triage, risk analysis, or coverage summary — just the flows. This keeps the output clean and directly consumable by the test executioner. All internal analysis (Steps 3-6, 8-9) informs which flows are generated, but does not appear in the output.

```json
{
  "testSuite": "PR #{number} - {pr_title}",
  "pr_number": 1234,
  "total_flows": 3,
  "flows": [
    {
      "id": "flow-{n}",
      "title": "string (specific user journey — names the scenario, not the function)",
      "priority": "P0 | P1 | P2 | P3",
      "module": "string (primary source file this flow exercises, from the diff)",
      "tags": ["@positive | @negative", "@functional", "@area"],
      "steps": [
        {
          "task": "string (plain-language instruction: action + element + data in one sentence)",
          "assertion": "string (specific visible state after this step completes)"
        }
      ]
    }
  ]
}
```

**Flow field rules:**

- `id` — unique flow identifier. Pattern: `flow-{n}` (sequential)
- `title` — must describe the specific user journey. Ban generic phrases like "it should work correctly". Good: "Happy Path - Update email successfully". Bad: "Test the profile feature"
- `priority` — P0/P1/P2/P3 per the criteria below
- `module` — the primary source file from the diff that this flow exercises
- `tags` — for filtering and categorization. Include `@positive` or `@negative`, domain tags like `@auth`, `@profile`, `@payments`. Add `@bug-repro`, `@acceptance`, `@reviewer-concern`, or `@{linear-ticket-key}` where applicable

**Step field rules:**

- `task` — a single plain-language imperative sentence describing what to do. Must include the action, the target element, and any data value. Never combine two actions in one task.
- `assertion` — the specific visible state that must be true after the task completes. Every step must have a non-empty assertion. Be specific: `"Email field shows newemail@example.com"`, not `"field is updated"`

**Priority criteria:**
- **P0:** Auth/authorization bypass, data loss, payment errors, PII exposure, bug reproduction
- **P1:** Core business logic, happy path user journeys, acceptance criteria validation
- **P2:** Error handling, boundary conditions, secondary flows, negative paths
- **P3:** Cosmetic verification, non-critical config, observability

Order flows by priority (P0 first), then by journey (happy path before negative paths).

## Quality Guardrails

1. **Diff-anchored:** Only reference functions, components, arguments, and types visible in the diff. Use hedging language when ambiguous.
2. **No generic titles or assertions:** Ban phrases like "it should work correctly", "it should handle edge cases". Each flow `title` must name the specific user journey. Each step `assertion` must describe a specific visible outcome.
3. **No hallucinated elements:** Only reference UI elements that can be inferred from the diff (component labels, text content, visible identifiers). Do not invent element names.
4. **Volume control:** Max 3-8 flows per PR, 5-15 steps per flow, ~80 total steps. Merge overlapping journeys. Prefer integrating specialized flows (migration, contract, toggle) into existing journeys rather than creating many small flows.
5. **Non-testable changes:** Handled internally via triage. Do not force flows for non-testable files.
6. **Security flows are mandatory for risky files:** If Step 4 flagged a file as risky, Step 7f must produce at least one security-relevant flow.
7. **Side effects must be verified:** Every side effect in Step 6a must have at least one step with a specific `assertion` confirming it occurs on success and does not leak on failure.
8. **Step completeness:** Every step must have a non-empty `task` and a non-empty `assertion`. A step missing either field is invalid.
9. **Atomic tasks:** Each step performs exactly one action. Never combine multiple actions in a single `task` (e.g., "Tap Save and verify success" is two steps — split them).
10. **Output is flows only:** The final JSON contains the `testSuite`, `pr_number`, `total_flows`, and `flows` array. No triage, risk analysis, or coverage summary. All analysis is internal.

## Worked Example

Condensed example (2 of 3 flows) for a NestJS backend PR adding email uniqueness to `updateProfile`.

```json
{
  "testSuite": "PR #1234 - Add email uniqueness to updateProfile",
  "pr_number": 1234,
  "total_flows": 3,
  "flows": [
    {
      "id": "flow-1",
      "title": "Happy Path - Update email successfully",
      "priority": "P1",
      "module": "src/users/users.service.ts",
      "tags": ["@positive", "@functional", "@profile"],
      "steps": [
        { "task": "Launch the app", "assertion": "Splash screen is visible" },
        { "task": "Open the debug menu", "assertion": "Debug menu is visible" },
        { "task": "Tap Change Base URI", "assertion": "Base URI selection screen is visible" },
        { "task": "Select EKS Stage", "assertion": "Base URI is set to EKS Stage and app returns to launch screen" },
        { "task": "Tap the Sign in button", "assertion": "Login form is visible" },
        { "task": "Tap the email field", "assertion": "Email field is focused" },
        { "task": "Type qauser@example.com into the email field", "assertion": "Email field shows qauser@example.com" },
        { "task": "Tap the password field", "assertion": "Password field is focused" },
        { "task": "Type TestPass123 into the password field", "assertion": "Password field is filled" },
        { "task": "Tap the Submit button", "assertion": "User is logged in and home screen is visible" },
        { "task": "Navigate to profile settings", "assertion": "Profile settings page is visible" },
        { "task": "Clear the email field", "assertion": "Email field is empty" },
        { "task": "Type newemail@example.com into the email field", "assertion": "Email field shows newemail@example.com" },
        { "task": "Tap the Save button", "assertion": "Success message is visible and email is updated to newemail@example.com" }
      ]
    },
    {
      "id": "flow-2",
      "title": "Negative - Duplicate email shows error",
      "priority": "P0",
      "module": "src/users/users.service.ts",
      "tags": ["@negative", "@functional", "@validation"],
      "steps": [
        { "task": "Launch the app", "assertion": "Splash screen is visible" },
        { "task": "Open the debug menu", "assertion": "Debug menu is visible" },
        { "task": "Tap Change Base URI", "assertion": "Base URI selection screen is visible" },
        { "task": "Select EKS Stage", "assertion": "Base URI is set to EKS Stage and app returns to launch screen" },
        { "task": "Tap the Sign in button", "assertion": "Login form is visible" },
        { "task": "Tap the email field", "assertion": "Email field is focused" },
        { "task": "Type qauser@example.com into the email field", "assertion": "Email field shows qauser@example.com" },
        { "task": "Tap the password field", "assertion": "Password field is focused" },
        { "task": "Type TestPass123 into the password field", "assertion": "Password field is filled" },
        { "task": "Tap the Submit button", "assertion": "User is logged in and home screen is visible" },
        { "task": "Navigate to profile settings", "assertion": "Profile settings page is visible" },
        { "task": "Clear the email field", "assertion": "Email field is empty" },
        { "task": "Type taken@example.com into the email field", "assertion": "Email field shows taken@example.com" },
        { "task": "Tap the Save button", "assertion": "Error message 'Email already in use' is displayed" },
        { "task": "Verify the email field still shows taken@example.com", "assertion": "Email field retains taken@example.com so the user can correct and retry" }
      ]
    }
  ]
}
```

## Anti-Patterns

Do NOT generate flows that:
- Test framework internals (NestJS module resolution, React Navigation routing, Next.js file-based routing)
- Test auto-generated types or GraphQL codegen output
- Test third-party library behavior (e.g., verifying `@IsEmail()` works — that's class-validator's job)
- Test style values unless behavior-altering (e.g., `display: none`)
- Include code-level security tests not observable through UI (SQL injection, token forgery — those need API-level testing)
- Combine multiple actions in a single `task` (each step must be atomic)
- Use vague element references in `task` like "the button" or "the field" — always name the element specifically

Do NOT include in the output:
- Metadata beyond `testSuite`, `pr_number`, and `total_flows` (no tech stack, change intent, Linear summary)
- Triage tables (file categorization)
- Risk analysis (breaking changes, security risks, non-functional concerns)
- Coverage summaries (file counts, AC traceability, gaps, overall assessment)

The output is `{ "testSuite", "pr_number", "total_flows", "flows": [...] }` and nothing else.
