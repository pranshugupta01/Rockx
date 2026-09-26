#!/usr/bin/env node
// Tier 2 — targeted blast-radius check via a plain OpenAI-compatible chat
// completion (TrueFoundry's LLM gateway serving an OpenAI model). No agent
// framework, no MCP, no sandbox — the CI runner already has the full repo
// checked out locally, so this just reads the relevant files off disk and
// asks the model one direct question. Only catches what Tier 1's static
// import graph structurally cannot see: blast radius with NO import edge at
// all (a changed literal/constant/route string that a spec asserts against
// by value, without importing the file that defines it).
//
// Required env vars: TRUEFOUNDRY_MODEL_BASE_URL, TRUEFOUNDRY_MODEL_API_KEY,
// TRUEFOUNDRY_MODEL_ID. Missing any of them = graceful no-op, never fatal.
//
// Usage: node agentic-blast-radius.mjs <repo-root> <changed-file-1> [...]
// Output (stdout): JSON array of additional spec file paths to run.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';

const [, , root, ...changedFilesRel] = process.argv;

if (!root || changedFilesRel.length === 0) {
  console.error('Usage: node agentic-blast-radius.mjs <repo-root> <changed-file...>');
  console.log(JSON.stringify([]));
  process.exit(0);
}

const requiredEnv = ['TRUEFOUNDRY_MODEL_BASE_URL', 'TRUEFOUNDRY_MODEL_API_KEY', 'TRUEFOUNDRY_MODEL_ID'];
const missing = requiredEnv.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Tier 2: missing env vars (${missing.join(', ')}) — skipping, Tier 1 result stands alone.`);
  console.log(JSON.stringify([]));
  process.exit(0);
}

function walkDir(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walkDir(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  const absRoot = resolve(root);
  const changedPairs = changedFilesRel
    .map((rel) => ({ rel, abs: resolve(absRoot, rel) }))
    .filter(({ abs }) => existsSync(abs));

  if (changedPairs.length === 0) {
    console.log(JSON.stringify([]));
    return;
  }

  const changedContents = changedPairs
    .map(({ rel, abs }) => `--- ${rel} ---\n${readFileSync(abs, 'utf8')}`)
    .join('\n\n');

  const specFiles = [];
  walkDir(join(absRoot, 'tests'), specFiles);
  const specContents = specFiles
    .map((f) => `--- ${f.slice(absRoot.length + 1)} ---\n${readFileSync(f, 'utf8')}`)
    .join('\n\n');

  const prompt = `You are checking test-impact blast radius for a code change.

CHANGED FILES:
${changedContents}

ALL TEST SPEC FILES (path shown in each "---" header):
${specContents}

Task: identify every spec file whose test coverage could be affected by these changes.
This includes BOTH: (a) specs that exercise the changed files directly or transitively
through imports/fixtures, AND (b) specs coupled only through a shared literal value,
constant, route path, or exported symbol name (no import edge at all). If you are
genuinely unsure whether a spec is affected, include it — under-selecting and missing a
real regression is worse than running one extra test.

Respond with ONLY a JSON array of affected spec file paths exactly as shown in their
"---" headers, e.g. ["tests/checkout.spec.ts"]. If none are found, respond with [].`;

  let client;
  try {
    const { default: OpenAI } = await import('openai');
    client = new OpenAI({
      baseURL: process.env.TRUEFOUNDRY_MODEL_BASE_URL,
      apiKey: process.env.TRUEFOUNDRY_MODEL_API_KEY,
    });
  } catch (err) {
    console.error(`Tier 2: openai package unavailable (${err.message}) — skipping.`);
    console.log(JSON.stringify([]));
    return;
  }

  let completion;
  try {
    completion = await client.chat.completions.create({
      model: process.env.TRUEFOUNDRY_MODEL_ID,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    });
  } catch (err) {
    console.error(`Tier 2: API call failed (${err.message}) — treating as no additional specs found.`);
    console.log(JSON.stringify([]));
    return;
  }

  const text = completion.choices?.[0]?.message?.content ?? '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error('Tier 2: could not parse a JSON array from model output — treating as no additional specs found.');
    console.log(JSON.stringify([]));
    return;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    console.log(JSON.stringify(Array.isArray(parsed) ? parsed : [], null, 2));
  } catch {
    console.error('Tier 2: JSON parse failed — treating as no additional specs found.');
    console.log(JSON.stringify([]));
  }
}

main().catch((err) => {
  console.error(`Tier 2 failed (non-fatal): ${err.message}`);
  console.log(JSON.stringify([]));
});
