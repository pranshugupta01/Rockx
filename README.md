# Rockx — AI Test Orchestrator Hackathon Project

This repo has two halves:

1. **`playwright-study/`** — the system under test: a locally-hosted clone of the SauceLabs "Swag Labs" demo e-commerce store, plus a Playwright + TypeScript test suite (login → inventory → cart → checkout → side menu).
2. **`ai-test-orchestrator/`** — the thing this hackathon is actually about: a Claude Code plugin (agent + 4 skills) that turns a single Linear ticket into either posted BDD test scenarios, or a live pass/fail Playwright test run against a PR branch.

`prd.md` and `flowchart.md` document the concrete feature (a product search/filter box) used to demo the pipeline end-to-end.

---

## Repo layout

```text
.
├── README.md                    ← you are here
├── prd.md                       ← PRD for the demo feature: inventory search/filter box
├── flowchart.md                 ← Mermaid flowchart of the orchestrator pipeline
├── ai-test-orchestrator/        ← the Claude Code plugin (agent + skills)
│   ├── .claude-plugin/plugin.json
│   ├── agents/ai-test-orchestrator/AGENT.md   ← entry point / orchestrator
│   └── skills/
│       ├── linear-ticket-reader/SKILL.md      ← Step 1: reads the Linear ticket
│       ├── github-pr-reader/SKILL.md          ← Step 2: reads PRD/PR content from GitHub
│       ├── generate-bdd-tests/SKILL.md        ← Step 3 (generation path): writes BDD scenarios to Linear
│       └── playwright-test-executor/SKILL.md  ← Step 3 (execution path): runs scenarios live via Playwright MCP
└── playwright-study/             ← the sample app + its own Playwright test suite
    ├── sample-app-web/           ← vendored, pre-built static app (do not hand-edit main.js)
    ├── src/                      ← Page Object Model (pages/, components/)
    └── tests/                    ← Playwright specs
```

---

## What the orchestrator does

Given a `PRA-<number>` Linear ticket id, the `ai-test-orchestrator` agent:

1. Reads the ticket (`linear-ticket-reader`) to find its description, whether test scenarios already exist on it, and whether a PR is linked.
2. **If no scenarios exist yet:** fetches any linked PRD (`github-pr-reader`), generates 4–10 BDD (`Given/When/Then`) scenarios (`generate-bdd-tests`), gets the user to confirm/edit them, and posts them as a comment on the ticket.
3. **If scenarios exist and a PR is linked:** resolves the PR's repo/branch (`github-pr-reader`), then checks out that branch, starts the app, and runs every scenario live against it via the Playwright MCP (`playwright-test-executor`), reporting a pass/fail diff against the prior run.
4. **If scenarios exist but no PR is linked yet:** stops and tells the user — there's nothing to execute yet.

See [`flowchart.md`](./flowchart.md) for the full Mermaid diagram of this branching pipeline, and each skill's `SKILL.md` for its exact contract (inputs, outputs, explicit non-responsibilities).

The orchestrator never calls Linear/GitHub/Playwright MCPs itself — every one of those calls is delegated to the matching skill, so each skill can be developed, tested, and reasoned about independently.

---

## Setup

### Prerequisites

- [git](https://git-scm.com/downloads)
- Node.js 16–18 (or [nvm](https://github.com/nvm-sh/nvm) to manage versions — see `playwright-study/.nvmrc`)
- [Claude Code](https://claude.com/claude-code) with this repo's `ai-test-orchestrator` plugin loaded, plus MCP access to:
  - **Linear MCP** (for `linear-ticket-reader` and `generate-bdd-tests`)
  - **GitHub MCP** (for `github-pr-reader`)
  - **Playwright MCP** (for `playwright-test-executor`)
- Docker (optional — only needed for the containerized test run described below)

### 1. Install the sample app + test suite (`playwright-study/`)

```bash
cd playwright-study
npm ci
npx playwright install && npx playwright install-deps
```

Run the existing test suite (Chromium, 1280×720):

```bash
npm run test
```

Other useful scripts (see `playwright-study/package.json` for the full list):

| Script | Purpose |
|---|---|
| `npm run test` | Full suite, Chromium, 8 workers |
| `npm run test:e2e` | Only tests tagged `@e2e` |
| `npm run test:smoke` | Only tests tagged `@smoke` |
| `npm run test:visual` | Visual regression tests against golden snapshots |
| `npm run lint` | ESLint over the TS test code |
| `npx playwright show-report` | Open the HTML report from the last run |

To run everything inside Docker instead (see `playwright-study/README.md` for full details):

```bash
docker network create net-webapp
docker build -f Dockerfile.webapp -t webapp .
docker run --network=net-webapp --name=web -p 3000:3000 --rm -d webapp
docker build -f Dockerfile -t test:docker .
docker run --network=net-webapp --name=testing -p 80:9323 --rm test:docker
```

### 2. Load the `ai-test-orchestrator` plugin

The plugin lives under `ai-test-orchestrator/` in this repo, following the standard Claude Code plugin layout (`.claude-plugin/plugin.json`, `agents/`, `skills/`). Point your Claude Code plugin marketplace/config at this directory (or this repo) so the `ai-test-orchestrator` agent and its four skills are available in a session, then confirm the required MCPs (Linear, GitHub, Playwright) are configured and authenticated in that session.

### 3. Run the pipeline against a ticket

Once the plugin is loaded and MCPs are authenticated, invoke the agent with a ticket id:

```text
ai-test-orchestrator PRA-1234
```

The agent will report back either posted BDD scenarios (generation path) or a pass/fail report (execution path) — see [`flowchart.md`](./flowchart.md) for exactly which path fires and why.

---

## The demo feature

To have something concrete to run the pipeline against, [`prd.md`](./prd.md) specifies a small, additive feature for the sample app: a client-side product name search/filter box on the Inventory page (`playwright-study/sample-app-web/v1/inventory.html`). It's implemented as an independent script/stylesheet layered on top of the existing static pages — the vendored `main.js` React bundle is never modified. The PRD includes functional/non-functional requirements, edge cases, and a "Test Case Traceability Hooks" section (stable `data-testid`s + behavioral contracts) specifically so the orchestrator's `generate-bdd-tests` skill has a complete, realistic input to generate scenarios from.

---

## Notes

- `playwright-study/sample-app-web/` is a **vendored, pre-built** static app (minified bundle, no accompanying source) — treat it as read-only infrastructure. New UI features are added as separate scripts/stylesheets injected into the static HTML pages, never by patching `main.js`.
- Several existing specs in `playwright-study/tests/` (e.g. `inventory.spec.ts`, `cart.spec.ts`) contain `test.fixme(...)` placeholders for behavior that exists in the app but has no test coverage yet — useful reference points when validating generated scenarios.
