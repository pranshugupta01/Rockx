#!/usr/bin/env node
// Tier 1 — deterministic, static predictive test selection.
// No LLM, no MCP, no network calls.
//
// Plain file-level reverse-import analysis over-selects badly in any repo using
// Playwright's fixture pattern (test.extend / base.extend): every spec imports
// the one shared fixtures file, and the fixtures file imports every page object,
// so a naive reverse-import graph says "every change affects every spec." This
// script detects that fixture-hub pattern generically (it's not specific to any
// one repo) and resolves through it at the fixture-name level instead of
// treating the hub file as one opaque node — so changing one page object only
// selects the specs that actually use that page object's fixture.
//
// Usage: node static-impact-analysis.mjs <repo-root> <changed-file-1> [<changed-file-2> ...]
// Output (stdout): JSON array of affected spec file paths, relative to <repo-root>.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative, resolve, extname } from 'node:path';

const IMPORT_RE = /(?:import|export)\s+(?:[\w*{}\s,]+\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g;
const NAMED_IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*['"](\.\.?\/[^'"]+)['"]/g;
const EXTS = ['.ts', '.tsx', '.js', '.jsx'];

function resolveImport(fromFile, importPath) {
  const base = resolve(dirname(fromFile), importPath);
  for (const ext of ['', ...EXTS]) {
    const candidate = base + ext;
    if (existsSync(candidate)) {
      try {
        if (!existsSync(candidate + '/')) return candidate;
      } catch {
        return candidate;
      }
    }
  }
  const indexCandidate = join(base, 'index');
  for (const ext of EXTS) {
    if (existsSync(indexCandidate + ext)) return indexCandidate + ext;
  }
  return null; // external package or unresolvable — not part of this repo's graph
}

function walkDir(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walkDir(full, out);
    } else if (EXTS.includes(extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function walkAllSourceFiles(root) {
  const files = [];
  walkDir(join(root, 'src'), files);
  walkDir(join(root, 'tests'), files);
  return files;
}

function buildForwardGraph(allFiles) {
  const forward = new Map();
  const contents = new Map();
  for (const file of allFiles) {
    const content = readFileSync(file, 'utf8');
    contents.set(file, content);
    const deps = new Set();
    for (const match of content.matchAll(IMPORT_RE)) {
      const resolved = resolveImport(file, match[1]);
      if (resolved) deps.add(resolved);
    }
    forward.set(file, deps);
  }
  return { forward, contents };
}

function buildReverseGraph(forward) {
  const reverse = new Map([...forward.keys()].map((f) => [f, new Set()]));
  for (const [file, deps] of forward) {
    for (const dep of deps) {
      if (!reverse.has(dep)) reverse.set(dep, new Set());
      reverse.get(dep).add(file);
    }
  }
  return reverse;
}

// A "fixture hub" is any file that calls `.extend(` on something imported from
// '@playwright/test' — the generic signature of Playwright's fixture pattern,
// regardless of what the file is actually named in a given repo.
function findFixtureHubFiles(contents) {
  const hubs = [];
  for (const [file, content] of contents) {
    if (/from\s+['"]@playwright\/test['"]/.test(content) && /\.extend\s*[<(]/.test(content)) {
      hubs.push(file);
    }
  }
  return hubs;
}

// Map each { key: async (...) => { ... new ClassName( ... } } fixture body to
// the class it instantiates, then resolve that class name back to a file via
// the hub file's own top-of-file named imports.
function extractFixtureToFile(hubFile, hubContent) {
  const classToFile = new Map();
  for (const match of hubContent.matchAll(NAMED_IMPORT_RE)) {
    const names = match[1].split(',').map((n) => n.trim()).filter(Boolean);
    const resolved = resolveImport(hubFile, match[2]);
    if (!resolved) continue;
    for (const name of names) classToFile.set(name, resolved);
  }

  const fixtureToFile = new Map();
  const FIXTURE_BODY_RE = /(\w+)\s*:\s*async\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\n\s*\},?/g;
  for (const match of hubContent.matchAll(FIXTURE_BODY_RE)) {
    const [, fixtureName, body] = match;
    const newCallMatch = body.match(/new\s+(\w+)\(/);
    if (!newCallMatch) continue;
    const className = newCallMatch[1];
    const file = classToFile.get(className);
    if (file) fixtureToFile.set(fixtureName, file);
  }
  return fixtureToFile;
}

function forwardTransitiveClosure(forward, startFile) {
  const visited = new Set([startFile]);
  const queue = [startFile];
  while (queue.length) {
    const current = queue.shift();
    for (const dep of forward.get(current) ?? []) {
      if (!visited.has(dep)) {
        visited.add(dep);
        queue.push(dep);
      }
    }
  }
  return visited;
}

function specsUsingFixture(specFiles, contents, fixtureName) {
  const re = new RegExp(`\\b${fixtureName}\\b`);
  return specFiles.filter((f) => re.test(contents.get(f) ?? ''));
}

function main() {
  const [root, ...changedFilesRel] = process.argv.slice(2);
  if (!root || changedFilesRel.length === 0) {
    console.error('Usage: node static-impact-analysis.mjs <repo-root> <changed-file...>');
    process.exit(2);
  }
  const absRoot = resolve(root);
  const existingChangedAbs = changedFilesRel.map((f) => resolve(absRoot, f)).filter((f) => existsSync(f));

  const allFiles = walkAllSourceFiles(absRoot);
  const specFiles = allFiles.filter((f) => /\.spec\.[tj]sx?$/.test(f));

  // Safe fallback: any changed file that isn't under src/ or tests/ at all
  // (e.g. the served app itself under sample-app-web/, or any extension we
  // don't parse imports for) has no representation in this repo's import
  // graph — we cannot statically know what it affects, so never guess "none":
  // select every spec rather than silently under-selecting.
  const inGraphDir = (f) => f.startsWith(join(absRoot, 'src') + '/') || f.startsWith(join(absRoot, 'tests') + '/');
  const hasOutOfGraphChange = existingChangedAbs.some((f) => !inGraphDir(f));
  if (hasOutOfGraphChange) {
    console.log(JSON.stringify(specFiles.map((f) => relative(absRoot, f)).sort(), null, 2));
    return;
  }

  const changedFilesAbs = existingChangedAbs.filter((f) => EXTS.includes(extname(f)));

  if (changedFilesAbs.length === 0) {
    console.log(JSON.stringify([]));
    return;
  }

  const { forward, contents } = buildForwardGraph(allFiles);
  const reverse = buildReverseGraph(forward);
  const hubFiles = findFixtureHubFiles(contents);

  // Per-fixture forward reachability: everything a fixture's class transitively
  // imports is "in scope" for that fixture — this is what lets us resolve
  // through the hub at fixture granularity instead of file granularity.
  const fixtureScopes = []; // { fixtureName, scope: Set<file>, specs: [file] }
  for (const hubFile of hubFiles) {
    const fixtureToFile = extractFixtureToFile(hubFile, contents.get(hubFile));
    for (const [fixtureName, classFile] of fixtureToFile) {
      const scope = forwardTransitiveClosure(forward, classFile);
      const specs = specsUsingFixture(specFiles, contents, fixtureName);
      fixtureScopes.push({ fixtureName, scope, specs });
    }
  }

  // Normal reverse-graph BFS, but treat hub files as terminal nodes — do not
  // fan out through a hub file's own (blanket) importers.
  const visited = new Set();
  const queue = [...changedFilesAbs];
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    if (hubFiles.includes(current)) continue; // terminal: don't expand hub's importers
    for (const dep of reverse.get(current) ?? []) {
      if (!visited.has(dep)) queue.push(dep);
    }
  }

  const affected = new Set();
  for (const f of visited) {
    if (specFiles.includes(f)) affected.add(f);
  }

  // Fixture-scope resolution: any changed file that falls inside a fixture's
  // forward-import scope pulls in every spec that uses that specific fixture.
  let hubItselfChanged = false;
  for (const changed of changedFilesAbs) {
    if (hubFiles.includes(changed)) hubItselfChanged = true;
    for (const { scope, specs } of fixtureScopes) {
      if (scope.has(changed)) {
        for (const s of specs) affected.add(s);
      }
    }
  }

  // Safe fallback: changing the hub file itself (or something reached at the
  // hub's own top level, outside any single fixture body) legitimately can
  // affect every spec — never under-select.
  if (hubItselfChanged || (hubFiles.some((h) => visited.has(h)) && fixtureScopes.every(({ scope }) => changedFilesAbs.every((c) => !scope.has(c))))) {
    for (const s of specFiles) affected.add(s);
  }

  // A changed file that IS itself a spec counts as directly affected too.
  for (const f of changedFilesAbs) {
    if (specFiles.includes(f)) affected.add(f);
  }

  const affectedSpecs = [...affected].map((f) => relative(absRoot, f)).sort();
  console.log(JSON.stringify(affectedSpecs, null, 2));
}

main();
