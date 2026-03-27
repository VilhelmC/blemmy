#!/usr/bin/env node
/**
 * apply-v3.1-document-type-spec.mjs
 *
 * Applies the Blemmy v3.1 document type spec system.
 * Run from the repo root: node scripts/apply-v3.1-document-type-spec.mjs
 *
 * New files are copied from the zip first (see integration guide).
 * This script updates existing files.
 *
 * Files modified:
 *   vite.config.ts      — adds @data/doctypes alias
 *   tsconfig.json       — adds @types/document-type-spec path
 *   package.json        — bumps version to 3.1.0
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname }            from 'path';
import { fileURLToPath }               from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

function read(rel)           { return readFileSync(resolve(ROOT, rel), 'utf8'); }
function write(rel, content) { writeFileSync(resolve(ROOT, rel), content, 'utf8'); console.log('  v ' + rel); }
function skip(rel)           { console.log('  . ' + rel + ' already patched'); }
function check(ok, msg)      { if (!ok) { console.error('\n  ABORT: ' + msg + '\n'); process.exit(1); } }

console.log('\nBlemmy v3.1 document type spec system\n');

// ─── 1. vite.config.ts — no change needed ────────────────────────────────────
// @data alias already covers src/data/ which includes src/data/doctypes/
// JSON files import directly as @data/doctypes/cv.doctype.json
console.log('  . vite.config.ts — @data alias already covers doctypes/');

// ─── 2. tsconfig.json — no change needed ─────────────────────────────────────
// @types alias already covers src/types/ which includes document-type-spec.ts
console.log('  . tsconfig.json — @types alias already covers document-type-spec.ts');

// ─── 3. src/lib/cv-document-spec.ts — replace with derived version ────────────
// The new version is in the zip. Just verify the old version is gone.
{
	const ts = read('src/lib/cv-document-spec.ts');
	if (ts.includes('deriveEngineSpec')) {
		skip('src/lib/cv-document-spec.ts (already derived)');
	} else {
		// This shouldn't happen if the zip was applied correctly
		console.warn('  ! src/lib/cv-document-spec.ts still has old hardcoded version');
		console.warn('    Make sure you copied the new cv-document-spec.ts from the zip');
	}
}

// ─── 4. package.json — bump to 3.1.0 ─────────────────────────────────────────
{
	let json = read('package.json');
	if (json.includes('"version": "3.1.0"')) { skip('package.json'); } else {
		json = json.replace(/"version": "3\.\d+\.\d+"/, '"version": "3.1.0"');
		write('package.json', json);
	}
}

console.log('\nDone. Run: npm run typecheck && npm run dev\n');
