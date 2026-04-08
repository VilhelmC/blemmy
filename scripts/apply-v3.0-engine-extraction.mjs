#!/usr/bin/env node
/**
 * apply-v3.0-engine-extraction.mjs
 *
 * Applies the Blemmy v3.0 layout engine extraction.
 * Run from the repo root: node scripts/apply-v3.0-engine-extraction.mjs
 *
 * New files must be copied from the patch zip first (see integration guide).
 * This script then moves existing files and updates import paths.
 *
 * Later renames (v4.2): `cv-layout-engine.ts` → `layout-engine.ts`, and the
 * other `cv-*.ts` engine modules → `layout-*.ts`, with `@lib/engine/layout-*`
 * imports. This file is kept as a historical v3.0 migration record.
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath }   from 'url';
import { execSync }        from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

function read(rel)           { return readFileSync(resolve(ROOT, rel), 'utf8'); }
function write(rel, content) { writeFileSync(resolve(ROOT, rel), content, 'utf8'); console.log('  v ' + rel); }
function skip(rel)           { console.log('  . ' + rel + ' already patched'); }
function check(ok, msg)      { if (!ok) { console.error('\n  ABORT: ' + msg + '\n'); process.exit(1); } }
function exists(rel)         { return existsSync(resolve(ROOT, rel)); }

function gitMv(from, to) {
	const fromPath = resolve(ROOT, from);
	const toPath   = resolve(ROOT, to);
	if (!existsSync(fromPath)) {
		console.log(`  . ${from} already moved`);
		return;
	}
	try {
		execSync(`git mv "${fromPath}" "${toPath}"`, { cwd: ROOT, stdio: 'pipe' });
		console.log(`  v git mv ${from} -> ${to}`);
	} catch {
		renameSync(fromPath, toPath);
		console.log(`  v mv ${from} -> ${to} (non-git fallback)`);
	}
}

console.log('\nBlemmy v3.0 layout engine extraction\n');

// ─── Step 1: Move engine source files into src/lib/engine/ ───────────────────
// The refactored versions were copied from the zip; now move the originals out.
// If the refactored file is already in place, the old one is moved over it.
const engineFiles = [
	'cv-layout-engine.ts',
	'cv-candidate.ts',
	'cv-profile.ts',
	'cv-align.ts',
	'cv-column-slack.ts',
	'cv-layout-snapshot.ts',
	'layout-audit.ts',
];

for (const f of engineFiles) {
	gitMv(`src/lib/${f}`, `src/lib/engine/${f}`);
}

// ─── Step 2: vite.config.ts — add @lib/engine alias ──────────────────────────
{
	let ts = read('vite.config.ts');
	if (ts.includes("'@lib/engine'")) { skip('vite.config.ts'); } else {
		const ANCHOR = "'@lib':      resolve(__dirname, 'src/lib'),";
		check(ts.includes(ANCHOR), 'vite.config.ts: @lib alias not found');
		ts = ts.replace(ANCHOR,
			ANCHOR + "\n\t\t\t'@lib/engine': resolve(__dirname, 'src/lib/engine'),"
		);
		write('vite.config.ts', ts);
	}
}

// ─── Step 3: tsconfig.json — add @lib/engine path ────────────────────────────
{
	let ts = read('tsconfig.json');
	if (ts.includes('"@lib/engine/*"')) { skip('tsconfig.json'); } else {
		const ANCHOR = '"@lib/*": [\n\t\t\t\t"src/lib/*"\n\t\t\t]';
		check(ts.includes(ANCHOR), 'tsconfig.json: @lib path not found');
		ts = ts.replace(ANCHOR,
			ANCHOR + ',\n\t\t\t"@lib/engine/*": [\n\t\t\t\t"src/lib/engine/*"\n\t\t\t]'
		);
		write('tsconfig.json', ts);
	}
}

// ─── Step 4: src/renderer/ui-components.ts — update engine imports ────────────
{
	let ts = read('src/renderer/ui-components.ts');
	if (ts.includes("'@lib/engine/cv-column-slack'")) { skip('src/renderer/ui-components.ts'); } else {
		ts = ts.replace("} from '@lib/cv-column-slack';", "} from '@lib/engine/cv-column-slack';");
		ts = ts.replace("} from '@lib/cv-align';",        "} from '@lib/engine/cv-align';");
		write('src/renderer/ui-components.ts', ts);
	}
}

// ─── Step 5: src/main.ts — wire CV_DOCUMENT_SPEC ─────────────────────────────
{
	let ts = read('src/main.ts');
	if (ts.includes('CV_DOCUMENT_SPEC')) { skip('src/main.ts (already has CV_DOCUMENT_SPEC)'); } else {
		// Update initCvLayoutEngine import path
		ts = ts.replace(
			"import { initCvLayoutEngine } from '@lib/cv-layout-engine';",
			"import { initCvLayoutEngine } from '@lib/engine/cv-layout-engine';\n" +
			"import { CV_DOCUMENT_SPEC }  from '@lib/cv-document-spec';"
		);

		// Update snapshot + audit imports
		ts = ts.replace(
			"} from '@lib/cv-layout-snapshot';",
			"} from '@lib/engine/cv-layout-snapshot';"
		);
		ts = ts.replace(
			"import { hashCvForAudit, initLayoutAuditUi, layoutAuditLog } from '@lib/layout-audit';",
			"import { hashCvForAudit, initLayoutAuditUi, layoutAuditLog } from '@lib/engine/layout-audit';"
		);

		// Pass spec to initCvLayoutEngine call
		const CALL = 'initCvLayoutEngine() ?? null;';
		check(ts.includes(CALL), 'main.ts: initCvLayoutEngine() call not found');
		ts = ts.replace(CALL, 'initCvLayoutEngine(CV_DOCUMENT_SPEC) ?? null;');

		write('src/main.ts', ts);
	}
}

// ─── Step 6: Sweep remaining @lib/* → @lib/engine/* for moved files ───────────
{
	const moved = [
		['cv-layout-engine', 'engine/cv-layout-engine'],
		['cv-candidate',     'engine/cv-candidate'],
		['cv-profile',       'engine/cv-profile'],
		['cv-align',         'engine/cv-align'],
		['cv-column-slack',  'engine/cv-column-slack'],
		['cv-layout-snapshot','engine/cv-layout-snapshot'],
		['layout-audit',     'engine/layout-audit'],
	];

	const toSweep = [
		'src/renderer/ui-components.ts',
		'src/renderer/chat-panel.ts',
		'src/lib/cv-sync.ts',
		'src/lib/cv-cloud.ts',
	].filter(exists);

	for (const f of toSweep) {
		let ts = read(f);
		let changed = false;
		for (const [from, to] of moved) {
			const oldStr = `from '@lib/${from}'`;
			const newStr = `from '@lib/${to}'`;
			if (ts.includes(oldStr)) {
				ts = ts.replaceAll(oldStr, newStr);
				changed = true;
			}
		}
		if (changed) { write(f, ts); }
	}
}

// ─── Step 7: package.json — bump to 3.0.0 ────────────────────────────────────
{
	let json = read('package.json');
	if (json.includes('"version": "3.0.0"')) { skip('package.json'); } else {
		json = json.replace(/"version": "2\.\d+\.\d+"/, '"version": "3.0.0"');
		write('package.json', json);
	}
}

console.log('\nDone. Run: npm run typecheck && npm run dev\n');
