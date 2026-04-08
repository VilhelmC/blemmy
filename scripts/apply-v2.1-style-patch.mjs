#!/usr/bin/env node
/**
 * apply-v2.1-style-patch.mjs
 *
 * Applies the Blemmy v2.1 style schema patch.
 * Run from the repo root: node scripts/apply-v2.1-style-patch.mjs
 *
 * Files modified:
 *   src/styles/global.css          — font tokens + CV content override block
 *   src/styles/print.css           — var(--font-body) replaces hardcoded font
 *   src/styles/blemmy-print-parity.css — same
 *   index.html                     — Google Font preloads for all pairs
 *   src/main.ts                    — imports style-panel.css
 *   src/renderer/ui-components.ts  — style section + rehydrateStyle in prefs
 *   src/renderer/chat-panel.ts     — parses style block from bot response
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
function has(str, marker)    { return str.includes(marker); }

console.log('\nBlemmy v2.1 style schema patch\n');

// 1. global.css
{
	let css = read('src/styles/global.css');
	if (has(css, '--font-body:')) { skip('src/styles/global.css'); } else {
		const ANCHOR = '\t--color-paper:       #ffffff;';
		check(css.includes(ANCHOR), 'global.css: --color-paper anchor not found');
		css = css.replace(ANCHOR,
			'\t--color-paper:       #ffffff;\n' +
			'\t/* Font family tokens — written by document-style.ts */\n' +
			"\t--font-body:         'DM Sans', system-ui, sans-serif;\n" +
			"\t--font-heading:      'DM Sans', system-ui, sans-serif;"
		);
		css += '\n\n' +
			'/* v2.1 font token overrides — CV document content only, UI chrome excluded */\n' +
			'html                      { font-family: var(--font-body); }\n' +
			'h1, h2, h3, h4            { font-family: var(--font-heading); }\n' +
			'.cv-name                  { font-family: var(--font-heading); }\n' +
			'.cv-label,\n' +
			'.section-label,\n' +
			'.masthead-label,\n' +
			'.masthead-meta-item,\n' +
			'.contact-item,\n' +
			'.entry-company,\n' +
			'.entry-position,\n' +
			'.entry-meta,\n' +
			'.highlight-list,\n' +
			'.highlight-list li,\n' +
			'.highlight-lead,\n' +
			'.edu-degree,\n' +
			'.edu-inst,\n' +
			'.edu-score,\n' +
			'.skill-category-label,\n' +
			'.skill-tag,\n' +
			'.language-item,\n' +
			".personal-text            { font-family: var(--font-body); }\n";
		write('src/styles/global.css', css);
	}
}

// 2. print.css
{
	let css = read('src/styles/print.css');
	if (has(css, 'var(--font-body)')) { skip('src/styles/print.css'); } else {
		const OLD = "font-family: 'DM Sans', system-ui, sans-serif !important;";
		check(css.includes(OLD), 'print.css: hardcoded font-family not found');
		write('src/styles/print.css', css.replace(OLD, 'font-family: var(--font-body) !important;'));
	}
}

// 3. blemmy-print-parity.css
{
	let css = read('src/styles/blemmy-print-parity.css');
	if (has(css, 'var(--font-body)')) { skip('src/styles/blemmy-print-parity.css'); } else {
		const OLD = "font-family: 'DM Sans', system-ui, sans-serif !important;";
		check(css.includes(OLD), 'blemmy-print-parity.css: hardcoded font-family not found');
		write('src/styles/blemmy-print-parity.css', css.replace(OLD, 'font-family: var(--font-body) !important;'));
	}
}

// 4. index.html
{
	let html = read('index.html');
	if (has(html, 'Playfair+Display')) { skip('index.html'); } else {
		const ANCHOR = '\t<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />';
		check(html.includes(ANCHOR), 'index.html: gstatic preconnect anchor not found');
		html = html.replace(ANCHOR,
			'\t<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n\n' +
			'\t<!-- v2.1 style schema: all font pairs preloaded -->\n' +
			'\t<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=Playfair+Display:wght@400;500;600;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@300;400;500;600&family=Source+Sans+3:wght@300;400;500;600&display=swap" />'
		);
		write('index.html', html);
	}
}

// 5. src/main.ts
{
	let ts = read('src/main.ts');
	if (has(ts, 'style-panel.css')) { skip('src/main.ts'); } else {
		const ANCHOR = "import '@styles/blemmy-print-parity.css';";
		check(ts.includes(ANCHOR), 'main.ts: blemmy-print-parity.css import not found');
		ts = ts.replace(ANCHOR, ANCHOR + "\nimport '@styles/style-panel.css';");
		write('src/main.ts', ts);
	}
}

// 6. src/renderer/ui-components.ts
{
	let ts = read('src/renderer/ui-components.ts');
	if (has(ts, 'buildStyleSection')) { skip('src/renderer/ui-components.ts'); } else {
		// Imports
		const A1 = "} from '@lib/cv-prefs';";
		check(ts.includes(A1), 'ui-components.ts: cv-prefs import not found');
		ts = ts.replace(A1,
			"} from '@lib/cv-prefs';\n\n" +
			"import { buildStyleSection } from '@renderer/style-panel';\n" +
			"import { rehydrateStyle, type DocumentStyle } from '@lib/document-style';"
		);

		// Build styleSection in buildPreferencesPanel
		const A2 = "\tconst resetBtn = h('button', { id: 'cv-prefs-reset', class: 'cv-prefs-reset', type: 'button' }, 'Reset defaults');";
		check(ts.includes(A2), 'ui-components.ts: resetBtn build anchor not found');
		ts = ts.replace(A2,
			A2 + '\n\n' +
			'\tconst { el: styleSection, syncUI: syncStyleUI } = buildStyleSection();\n' +
			'\t(window as Window & { __blemmySyncStyleUI__?: (s: DocumentStyle) => void }).__blemmySyncStyleUI__ = syncStyleUI;'
		);

		// Add to inner div
		const A3 =
			"\tconst inner = h('div', { class: 'cv-prefs-inner' },\n" +
			"\t\th('p', { class: 'cv-prefs-heading' }, 'Layout preferences'),\n" +
			'\t\tdensityRow,\n' +
			'\t\taffinityRow,\n' +
			'\t\tpageRow,\n' +
			'\t\tresetBtn,\n' +
			'\t);';
		check(ts.includes(A3), 'ui-components.ts: inner div construction not found');
		ts = ts.replace(A3,
			"\tconst inner = h('div', { class: 'cv-prefs-inner' },\n" +
			"\t\th('p', { class: 'cv-prefs-heading' }, 'Layout preferences'),\n" +
			'\t\tdensityRow,\n' +
			'\t\taffinityRow,\n' +
			'\t\tpageRow,\n' +
			'\t\tresetBtn,\n' +
			"\t\th('hr', { class: 'cv-prefs-divider' }),\n" +
			'\t\tstyleSection,\n' +
			'\t);'
		);

		// rehydrateStyle before initBeforeUnloadGuard
		const A4 = '\tinitBeforeUnloadGuard();';
		check(ts.includes(A4), 'ui-components.ts: initBeforeUnloadGuard not found');
		ts = ts.replace(A4, '\trehydrateStyle();\n\n\tinitBeforeUnloadGuard();');

		write('src/renderer/ui-components.ts', ts);
	}
}

// 7. src/renderer/chat-panel.ts
{
	let ts = read('src/renderer/chat-panel.ts');
	if (has(ts, 'extractStyleBlock')) { skip('src/renderer/chat-panel.ts'); } else {
		// Add extractStyleBlock import
		const A1 = '\textractJsonBlock,';
		check(ts.includes(A1), 'chat-panel.ts: extractJsonBlock import not found');
		ts = ts.replace(A1, '\textractJsonBlock,\n\textractStyleBlock,');

		// Add applyDocumentStyle import
		const A2 = "} from '@lib/cv-chat-prompts';";
		check(ts.includes(A2), 'chat-panel.ts: cv-chat-prompts import not found');
		ts = ts.replace(A2,
			"} from '@lib/cv-chat-prompts';\n\n" +
			"import { applyDocumentStyle, type DocumentStyle } from '@lib/document-style';"
		);

		// Add applyStylePatch function before applyJson
		const A3 = '\tfunction applyJson(raw: string, isGenerated = false): void {';
		check(ts.includes(A3), 'chat-panel.ts: applyJson function not found');
		ts = ts.replace(A3,
			'\tfunction applyStylePatch(raw: string): void {\n' +
			'\t\ttry {\n' +
			'\t\t\tconst patch   = JSON.parse(raw) as Partial<DocumentStyle>;\n' +
			'\t\t\tconst applied = applyDocumentStyle(patch);\n' +
			'\t\t\tconst syncFn  = (window as Window & { __blemmySyncStyleUI__?: (s: DocumentStyle) => void }).__blemmySyncStyleUI__;\n' +
			'\t\t\tif (syncFn) { syncFn(applied); }\n' +
			"\t\t\tappendMessage('system', '\\u2713 Style updated.');\n" +
			'\t\t} catch (err) {\n' +
			'\t\t\tconst msg = err instanceof Error ? err.message : String(err);\n' +
			'\t\t\tappendMessage(\'system\', `\\u2717 Could not apply style: ${msg}`);\n' +
			'\t\t}\n' +
			'\t}\n\n' +
			'\tfunction applyJson(raw: string, isGenerated = false): void {'
		);

		// Generate path: extract style block alongside json block
		const B1 = '\t\t\tconst jsonRaw   = extractJsonBlock(fullText);\n\t\t\tconst autoApply = Boolean(jsonRaw);';
		if (ts.includes(B1)) {
			ts = ts.replace(B1,
				'\t\t\tconst jsonRaw   = extractJsonBlock(fullText);\n' +
				'\t\t\tconst styleRaw  = extractStyleBlock(fullText);\n' +
				'\t\t\tconst autoApply = Boolean(jsonRaw);'
			);
		}

		// Generate path: apply style block
		const B2 = '\t\t\tif (jsonRaw) {\n\t\t\t\tapplyJson(jsonRaw, true /* isGenerated */);\n\t\t\t}';
		if (ts.includes(B2)) {
			ts = ts.replace(B2,
				'\t\t\tif (jsonRaw) {\n\t\t\t\tapplyJson(jsonRaw, true /* isGenerated */);\n\t\t\t}\n' +
				'\t\t\tif (styleRaw) { applyStylePatch(styleRaw); }'
			);
		}

		// Normal chat path: extract style block
		const C1 = '\t\t\tconst jsonRaw    = extractJsonBlock(fullText);\n\t\t\tconst autoApply  = Boolean(jsonRaw && wantsApply);';
		if (ts.includes(C1)) {
			ts = ts.replace(C1,
				'\t\t\tconst jsonRaw    = extractJsonBlock(fullText);\n' +
				'\t\t\tconst styleRaw2  = extractStyleBlock(fullText);\n' +
				'\t\t\tconst autoApply  = Boolean(jsonRaw && wantsApply);'
			);
		}

		// Normal chat path: apply style block
		const C2 = '\t\t\tif (jsonRaw && wantsApply) {\n\t\t\t\tapplyJson(jsonRaw);\n\t\t\t}';
		if (ts.includes(C2)) {
			ts = ts.replace(C2,
				'\t\t\tif (jsonRaw && wantsApply) {\n\t\t\t\tapplyJson(jsonRaw);\n\t\t\t}\n' +
				'\t\t\tif (styleRaw2) { applyStylePatch(styleRaw2); }'
			);
		}

		write('src/renderer/chat-panel.ts', ts);
	}
}

console.log('\nDone. Run: npm run typecheck && npm run dev\n');
