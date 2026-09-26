---
name: linear-deep-dive
description: Thorough, opinionated engineering analysis of a Linear ticket. Reads the ticket's title, description, labels, priority, state, attachments, and full comment thread, plus the parent, relevant siblings, and historical bugs in the same area — then produces a substantive briefing that synthesizes the full content plus original insight. Use when the user provides a ticket key or asks about a ticket.
---

# Linear Deep Dive

Take a single Linear ticket key and produce a **thorough, opinionated engineering analysis**. Read the ticket, every comment, every related ticket — then synthesize it all into a briefing that lets the user understand the full substance without opening Linear, plus adds original engineering insight on top.

The output should read like a senior engineer who has spent 20 minutes reading everything and is now giving you the full picture.

**Data-gathering vs. analysis boundary (load-bearing):** Steps 0–3 are pure data gathering — no synthesis, no writing. Steps 4–5 are the analysis and briefing output. This split matters because `pr-test-agent`'s Track B calls this skill for Steps 0–3 only (it wants the raw knowledge base to enrich test cases with, not a written report) — keep that boundary intact even as the rest of this skill's content changes.

## When to Use

- User provides a Linear ticket key (e.g., "deep dive APP-104", "tell me about ENG-567")
- User asks "what's the status of this ticket?", "what's blocking this?", "summarize this ticket"
- User mentions a ticket key in conversation — proactively offer to deep-dive
- User wants a standup/status summary for a piece of work

## Workflow

```
Linear Deep Dive Progress:
- [ ] Step 0: Verify Linear MCP is available
- [ ] Step 1: Get the ticket key
- [ ] Step 2: Smart data gathering (ticket + relevant neighborhood + historical bugs)
- [ ] Step 3: Note any linked doc/spec URLs (do not fetch them)
- [ ] Step 4: Think — construct the analysis
- [ ] Step 4g: Validate ticket quality
- [ ] Step 5: Present the briefing
```

---

## Step 0: Verify Linear MCP Is Available

Check that the Linear MCP's tools (`get_issue`, `list_comments`, `list_issues`, etc.) are present in the tool list — assumed already connected, no token/OAuth setup flow needed. If they're genuinely missing, tell the user which tool is absent and stop; don't attempt a Jira-style manual credential flow, there isn't one here.

---

## Step 1: Get the Ticket Key

Accept the ticket key from:
- Direct user input ("deep dive APP-104")
- Current git branch name (extract pattern `[A-Z]+-[0-9]+`)
- Conversation context (ticket key mentioned earlier)

Validate the format matches `[A-Z]+-[0-9]+`. If invalid, ask the user for the correct key.

---

## Step 2: Smart Data Gathering

Gather data efficiently. Depth on what matters, breadth only for context. The goal is to understand the engineering situation, not to build a complete inventory.

### 2a. Fetch the input ticket — read EVERYTHING

`get_issue` on the ticket: `title`, `description`, `labels`, `state`, `priority`, `assignee`, `parent`, `project`, `attachments`. Then `list_comments` for the full comment thread, chronological.

**Critical: unlike Jira, Linear has no custom fields.** There is no "Bug Description" or "Steps to Reproduce" field to read separately — everything lives in `description` and the comment thread as free text. Read the description and every comment closely and look for these commonly-occurring shapes (they won't always be labeled, and when they are labeled the wording varies team to team):

| Look for a section shaped like... | Treat it as |
|---|---|
| "Expected:" / "Should:" / "What should happen" | Expected behavior |
| "Actual:" / "What happens instead" / "Currently" | Actual behavior |
| "Steps to reproduce:" / "Repro:" / a numbered list after a bug description | Reproduction steps |
| "Root cause:" / "Turns out..." / "The issue is..." (often in a comment, not the description) | Root cause |
| "Acceptance criteria:" / "AC:" / "Given/When/Then" / "User should be able to..." | Acceptance criteria |
| "Blocked by..." / "Waiting on..." | Blocker |
| A Figma/Google-Doc/Confluence/Notion URL anywhere | Design or spec reference (Step 3 — note, don't fetch) |
| Device/OS/version mentions | Supporting/environment information |

If the ticket has none of this structure — just a title and a one-line description — that's a real signal about ticket quality, not something to paper over; carry it into Step 4g.

Read all standard fields: title, state, assignee, priority, labels, project, created/updated dates. Note `parent` (Linear's native parent-issue link) and any sub-issues.

**The goal:** After reading, you should be able to explain what the ticket is about in full detail — the problem, the expected behavior, the root cause, the reproduction steps, and any discussion from comments — without the user needing to open Linear.

### 2b. Zoom out if the input is a child ticket

Check `parent` on the input ticket. **If it has one:** `get_issue` + `list_comments` on the parent with the same thoroughness as 2a. The parent's description and comments often contain critical context about the broader initiative that the child ticket doesn't repeat. If the parent also has a parent, climb one more level (max 2 levels) — the highest ancestor found becomes the **context anchor**, but the input ticket always remains the primary focus.

**If the input is NOT a child:** skip this sub-step.

### 2c. Understand the neighborhood — depth on the relevant ones

**Children (when the input ticket has sub-issues):** `list_issues` filtered by `parentId = input.id`. Bulk-scan up to 50 for a status overview (key, title, state, priority). Deep-fetch the 5–8 most relevant with the same depth as 2a.

**Siblings:** if the input has a `parent`, `list_issues` filtered by `parentId = parent.id` for a bulk overview. If the input has **no** parent but belongs to a `project`, `list_issues` filtered by `project.id = input.project.id` instead — this is the only way to find siblings for project-grouped tickets that share no common parent. Deep-fetch the 5–8 most relevant siblings (same-area title match, currently blocked/in-progress, highest priority, or recently created) with the same depth as 2a — read their description and comments, not just title and state, so you can detect patterns (e.g., "3 siblings all describe the same lifecycle issue").

**Linked tickets:** any ticket referenced in `attachments[]` or in comment text as a Linear URL. Fetch each with full depth — usually only a handful.

**Historical bugs (same area):** after siblings/linked tickets, look for past resolved bugs in the same area:
1. If the input has **labels**, `list_issues` filtered by that label + `state = done/completed`/canceled-with-resolution, excluding the input ticket.
2. If no useful labels, fall back to `list_issues` filtered by the same `team`/`project` + a label matching "bug", scanning titles for keyword overlap with the input ticket.
3. If neither narrows it usefully, skip — don't force a noisy search.

Bulk-scan results (key, title, state, resolved date). Deep-fetch the top 2–3 most relevant — read their description and comments for root cause and resolution. Look for recurring root causes, previously applied fixes that may relate, or a pattern suggesting a systemic weakness.

**Cap:** deep-fetch at most 12 total associated tickets (parent + children + siblings + linked + historical bugs). Bulk-scan up to 50 children/siblings for status overview.

### 2d. Build the knowledge base

After fetching, you should have in memory: the input ticket (fully read, including comments), the parent/ancestor if any (fully read), a bulk overview of siblings/children plus 5–8 deeply-read ones, all linked tickets, and 2–3 deeply-read historical bugs if any were found. Do NOT present any of this raw data to the user — it's input for Step 4.

---

## Step 3: Note Linked Docs (do not fetch them)

Scan everything fetched (description, comments, attachments across all tickets) for design/spec links — Figma, Google Docs, Confluence, Notion, or anything else. **Note the URL and what it appears to be (from surrounding text), but do not fetch or read its content** — this skill only reads what's actually inside Linear. If the real spec lives entirely in one of these external docs and isn't restated in the ticket itself, say so plainly in Step 4 rather than treating the ticket's own text as complete.

---

## Step 4: Think, Then Write

Using ALL the data from Steps 2–3, construct a thorough analysis. **Do not start writing until you have read everything.** The output has two jobs: (1) synthesize the full substance so the user doesn't need to open Linear, and (2) add original engineering insight on top.

### 4a. The Story

3–5 sentences. The narrative arc — what's actually going on, how we got here, where this fits in the broader picture if it has a parent, and what a sibling pattern implies if one exists. Connect dots the ticket itself doesn't connect.

### 4b. The Substance — What's Actually in the Ticket

Synthesize the full content in your own words, pulling from the parsed sections in 2a (expected/actual/repro/root-cause/AC) and the comment thread — not a field dump, since there are no fields to dump.

For **bugs** (inferred from a "bug" label, or bug-shaped content even if unlabeled): what's broken (plain English), expected behavior, root cause if identified, simplified reproduction steps, key findings from comments.

For **features/tasks**: what's being built, acceptance criteria, any design links noted in Step 3, key discussion from comments.

For a **ticket acting as an epic/initiative** (has children, or lives at the top of a project's issue tree): the goal/scope, children status distribution (N done, N in progress, N to do, N blocked), patterns across the deeply-read children.

For a **spike-shaped ticket** (investigation-framed title/description, no direct deliverable): the question being investigated, what was found, recommended next actions — usually pulled entirely from comments since there's no dedicated field for this in Linear.

Be thorough if the ticket is rich; if it's sparse, say so briefly and move on — don't manufacture substance that isn't there.

### 4c. Engineering Analysis

Original insight beyond the ticket's own content: is the root cause well-identified or just asserted? Is a proposed fix sound, or does it risk masking the real problem? Is this a one-off or part of a systemic pattern visible across the deeply-read siblings/historical bugs? What ripple effects should the reader worry about?

### 4d. Context

2–3 dense prose sentences: parent status if any, sibling/children progress summary, anything else relevant (team, project). No tables, no ticket lists.

### 4e. What Should Happen Next

2–4 opinionated, actionable recommendations. Skip generic filler.

### 4f. Blockers (only if real)

Only if something is genuinely stuck. Describe the blocker in plain English, not just ticket keys.

### 4g. Ticket Quality Validation

An honest audit of what's there and what's missing — no additional calls needed, just review what Step 2 already gathered.

**Check for (by ticket shape):**
- Bugs: a real expected/actual/repro-steps shape in the description or comments (not just a one-line complaint), priority set, assignee set, parent linked if this is part of a larger effort.
- Features/tasks: a real scope description, acceptance criteria stated somewhere, assignee set, parent/project linked.
- Epic-shaped tickets: a real description of the initiative's goal, children actually exist.
- Spike-shaped tickets: findings and a recommendation actually present in comments, linked to the implementation ticket(s) it should inform.

**Quality, not just presence:** is the description a real technical account or a restatement of the title? Are repro steps specific enough to actually follow? Do the comments contain a decision or root cause that never made it into the description (knowledge buried in a thread is effectively lost to anyone who doesn't read the whole thing)?

**Scoring guide:** 9–10 exemplary; 7–8 good, minor gaps; 5–6 adequate but missing context a new engineer would need; 3–4 weak, significant gaps; 1–2 a title with no actionable substance.

---

## Step 5: Present the Briefing

Be **proportional to the content**. A rich bug ticket with detailed root cause, repro steps, and related siblings warrants 40–60 lines. A one-liner task warrants 10–15 lines.

```
DEEP DIVE: {TICKET_KEY} — {Title}
{State} | {Assignee} | {Project} | Created: {date} | Updated: {date}

THE STORY
{3-5 sentences — the narrative arc.}

THE BUG (or THE WORK / THE INITIATIVE / THE INVESTIGATION, per ticket shape)
{5-15 lines — the full substance, synthesized from description + comments.}

ENGINEERING ANALYSIS
{3-5 sentences of original insight beyond the ticket's own content.}

CONTEXT
{2-3 sentences — parent/sibling/project status. No tables.}

{ONLY if something is genuinely stuck:}
BLOCKERS
{1-2 sentences per real blocker.}

HISTORICAL BUGS (same area)
{Only if found. 2-3 max: {key}: {title} — root cause / resolution / resolved date.
One-sentence pattern assessment.}

WHAT SHOULD HAPPEN NEXT
{2-4 actionable, opinionated bullets.}

{ONLY if there are real quality gaps:}
TICKET HEALTH: {score}/10
{One-sentence assessment, then Missing / Weak / Process-gap bullets.}
```

**Hard rules:** zero ticket tables, zero field dumps (there are no fields to dump — synthesize instead), zero empty sections, every sentence earns its place, THE BUG/WORK section is mandatory before opinions.

---

## Rules

1. **There are no custom fields to fall back on.** Everything comes from `description` + comments. If the analysis feels thin, re-read the comment thread — Linear tickets frequently carry the real decision/root-cause/scope-correction in a comment, not the description.
2. **Synthesize, don't skip.** Present the full substance in your own words.
3. **Proportional length.**
4. **Be opinionated** in the Engineering Analysis section specifically — description is not analysis.
5. **No ticket inventories** — reference keys only when directly relevant.
6. **Depth over breadth** — 5–8 deeply-read siblings beat 26 superficially-scanned ones.
7. **Patterns over counts.**
8. **THE BUG/WORK section is mandatory** before any opinion section.
9. **Skip empty sections** rather than padding.
10. **Graceful degradation** — if a linked ticket can't be fetched, note it and move on.
11. **Proactive trigger** — offer a deep dive whenever a `[A-Z]+-[0-9]+`-shaped key appears in conversation.
12. **Ticket quality is additive, never destructive** — always synthesize whatever substance exists, even for a 2/10 ticket; skip the TICKET HEALTH section entirely for a 9–10.
