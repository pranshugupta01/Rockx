#!/usr/bin/env node
// Merges Tier 1 (static) + Tier 2 (agentic) selected spec lists into one
// deduplicated, sorted list. Trivial by design — no logic worth getting wrong.
//
// Usage: node merge-selection.mjs <tier1.json> <tier2.json>
// Output (stdout): JSON array, deduplicated + sorted.

import { readFileSync } from 'node:fs';

const [, , tier1Path, tier2Path] = process.argv;
const tier1 = JSON.parse(readFileSync(tier1Path, 'utf8'));
const tier2 = JSON.parse(readFileSync(tier2Path, 'utf8'));

const merged = [...new Set([...tier1, ...tier2])].sort();
console.log(JSON.stringify(merged, null, 2));
