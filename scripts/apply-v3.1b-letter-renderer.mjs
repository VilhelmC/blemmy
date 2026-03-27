#!/usr/bin/env node
/**
 * apply-v3.1b-letter-renderer.mjs
 *
 * Applies the Blemmy v3.1b letter renderer.
 * Run from the repo root: node scripts/apply-v3.1b-letter-renderer.mjs
 *
 * New files must be copied from the zip first.
 * This script makes two small additions to existing files.
 *
 * Files modified:
 *   src/main.ts        — imports letter.css
 *   package.json       — bumps version to 3.1.1
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

console.log('\nBlemmy v3.1b letter renderer\n');

// ─── 1. src/main.ts — import letter.css ──────────────────────────────────────
{
	let ts = read('src/main.ts');
	if (ts.includes("'@styles/letter.css'")) { skip('src/main.ts'); } else {
		const ANCHOR = "import '@styles/review-mode.css';";
		check(ts.includes(ANCHOR), 'main.ts: review-mode.css import not found');
		ts = ts.replace(ANCHOR, ANCHOR + "\nimport '@styles/letter.css';");
		write('src/main.ts', ts);
	}
}

// ─── 2. package.json — bump version ──────────────────────────────────────────
{
	let json = read('package.json');
	if (json.includes('"version": "3.1.1"')) { skip('package.json'); } else {
		json = json.replace(/"version": "\d+\.\d+\.\d+"/, '"version": "3.1.1"');
		write('package.json', json);
	}
}

console.log('\nDone. Run: npm run typecheck && npm run dev\n');
console.log('To render a letter, call renderLetter(loadLetterData()) in main.ts');
console.log('and mount the result with initCvLayoutEngine(LETTER_DOCUMENT_SPEC).\n');
