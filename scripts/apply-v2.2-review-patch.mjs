#!/usr/bin/env node
/**
 * apply-v2.2-review-patch.mjs
 *
 * Applies the Blemmy v2.2 review mode patch.
 * Run from the repo root: node scripts/apply-v2.2-review-patch.mjs
 *
 * Files modified:
 *   src/types/cv.ts                — adds review?: CVReview to CVData
 *   src/lib/cv-chat.ts             — adds extractReviewBlock()
 *   src/lib/cv-chat-prompts.ts     — injects review comments into system prompt
 *   src/renderer/ui-components.ts  — mounts review panel + toggle in leftDock
 *   src/renderer/chat-panel.ts     — parses review block from bot response
 *   src/main.ts                    — imports review-mode.css
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

console.log('\nBlemmy v2.2 review mode patch\n');

// ─── 1. src/types/cv.ts — add review?: CVReview to CVData ────────────────────
{
	let ts = read('src/types/cv.ts');
	if (ts.includes('review?: CVReview')) { skip('src/types/cv.ts'); } else {
		const IMPORT_ANCHOR = '// ─── Meta ─';
		check(ts.includes(IMPORT_ANCHOR), 'cv.ts: Meta section anchor not found');
		ts = ts.replace(IMPORT_ANCHOR,
			"import type { CVReview } from '@types/cv-review';\n\n// ─── Meta ─"
		);

		const FIELD_ANCHOR = '\tlayoutSnapshot?: CVLayoutSnapshot;\n}';
		check(ts.includes(FIELD_ANCHOR), 'cv.ts: layoutSnapshot anchor not found');
		ts = ts.replace(FIELD_ANCHOR,
			'\tlayoutSnapshot?: CVLayoutSnapshot;\n' +
			'\t/**\n' +
			'\t * Optional review annotation layer.\n' +
			'\t * When present and active, review mode is available.\n' +
			'\t */\n' +
			'\treview?: CVReview;\n}'
		);
		write('src/types/cv.ts', ts);
	}
}

// ─── 2. src/lib/cv-chat.ts — add extractReviewBlock() ────────────────────────
{
	let ts = read('src/lib/cv-chat.ts');
	if (ts.includes('extractReviewBlock')) { skip('src/lib/cv-chat.ts'); } else {
		ts += [
			'',
			'/**',
			' * Extracts the first fenced ```review block from a model response.',
			' * Returns the raw JSON string (a CommentOperation[]) or null.',
			' */',
			'export function extractReviewBlock(text: string): string | null {',
			'\tconst match = text.match(/```review\\s*([\\s\\S]*?)```/);',
			'\tif (!match) { return null; }',
			'\treturn match[1].trim();',
			'}',
		].join('\n');
		write('src/lib/cv-chat.ts', ts);
	}
}

// ─── 3. src/lib/cv-chat-prompts.ts — inject review into system prompt ────────
{
	let ts = read('src/lib/cv-chat-prompts.ts');
	if (ts.includes('buildReviewPromptSection')) { skip('src/lib/cv-chat-prompts.ts'); } else {
		// Add imports
		const IMPORT_ANCHOR = "import type { CVData } from '@cv/cv';";
		check(ts.includes(IMPORT_ANCHOR), 'cv-chat-prompts.ts: CVData import not found');
		ts = ts.replace(IMPORT_ANCHOR,
			"import type { CVData } from '@cv/cv';\n" +
			"import type { CVReview } from '@types/cv-review';\n" +
			"import { buildReviewPromptSection } from '@lib/cv-review';"
		);

		// Add review param to buildSystemPrompt
		const SIG =
			'export function buildSystemPrompt(\n' +
			'\tcv:          CVData,\n' +
			'\tlayout:      LayoutState,\n' +
			'\tsourceText?: string,\n' +
			'): string {';
		check(ts.includes(SIG), 'cv-chat-prompts.ts: buildSystemPrompt signature not found');
		ts = ts.replace(SIG,
			'export function buildSystemPrompt(\n' +
			'\tcv:          CVData,\n' +
			'\tlayout:      LayoutState,\n' +
			'\tsourceText?: string,\n' +
			'\treview?:     CVReview,\n' +
			'): string {'
		);

		// Build reviewSection variable after sourceSection declaration start
		const SOURCE_ANCHOR = '\tconst sourceSection = sourceText';
		check(ts.includes(SOURCE_ANCHOR), 'cv-chat-prompts.ts: sourceSection anchor not found');
		ts = ts.replace(SOURCE_ANCHOR,
			'\tconst reviewSection = review ? buildReviewPromptSection(review) : \'\';\n\n' +
			'\tconst sourceSection = sourceText'
		);

		// Inject reviewSection before ${STYLE_SCHEMA_SUMMARY}
		const INJECT_ANCHOR = '${STYLE_SCHEMA_SUMMARY}\n\n## Current CV data';
		check(ts.includes(INJECT_ANCHOR), 'cv-chat-prompts.ts: STYLE_SCHEMA_SUMMARY anchor not found');
		ts = ts.replace(INJECT_ANCHOR,
			'${reviewSection ? reviewSection + \'\\n\\n\' : \'\'}${STYLE_SCHEMA_SUMMARY}\n\n## Current CV data'
		);

		write('src/lib/cv-chat-prompts.ts', ts);
	}
}

// ─── 4. src/renderer/ui-components.ts — mount review panel ───────────────────
{
	let ts = read('src/renderer/ui-components.ts');
	if (ts.includes('initReviewPanel')) { skip('src/renderer/ui-components.ts'); } else {
		// Add imports after style-panel import
		const IMP = "import { buildStyleSection } from '@renderer/style-panel';";
		check(ts.includes(IMP), 'ui-components.ts: style-panel import not found');
		ts = ts.replace(IMP,
			IMP + '\n' +
			"import { initReviewPanel } from '@renderer/review-panel';\n" +
			"import { initReviewOverlay, updateOverlay } from '@renderer/review-overlay';\n" +
			"import type { CVReview } from '@types/cv-review';\n" +
			"import { applyCommentOps } from '@lib/cv-review';"
		);

		// Mount after buildEditButton
		const EDIT_ANCHOR = '\tleftDock.appendChild(buildEditButton());';
		check(ts.includes(EDIT_ANCHOR), 'ui-components.ts: buildEditButton anchor not found');
		ts = ts.replace(EDIT_ANCHOR,
			'\tleftDock.appendChild(buildEditButton());\n\n' +
			'\t// v2.2 Review panel + overlay\n' +
			'\tconst reviewInst = initReviewPanel({\n' +
			'\t\tgetReview: () => (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__?.review,\n' +
			'\t\tsetReview: (r: CVReview) => {\n' +
			'\t\t\tconst d = (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__;\n' +
			'\t\t\tif (d) { d.review = r; }\n' +
			'\t\t},\n' +
			'\t\tgetData: () => (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__,\n' +
			'\t});\n' +
			'\tdocument.body.appendChild(reviewInst.panel);\n' +
			'\tleftDock.appendChild(reviewInst.toggle);\n' +
			'\tinitReviewOverlay((path) => { reviewInst.open(path); });\n' +
			'\twindow.addEventListener(\'blemmy-layout-applied\', () => {\n' +
			'\t\tconst d = (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__;\n' +
			'\t\tif (d?.review) { updateOverlay(d.review); }\n' +
			'\t});\n' +
			'\t(window as Window & { __blemmyApplyReviewOps__?: typeof applyCommentOps }).__blemmyApplyReviewOps__ = applyCommentOps;\n' +
			'\t(window as Window & { __blemmySyncReview__?: (r: CVReview) => void }).__blemmySyncReview__ = (r) => {\n' +
			'\t\treviewInst.syncReview(r);\n' +
			'\t\tupdateOverlay(r);\n' +
			'\t};'
		);

		write('src/renderer/ui-components.ts', ts);
	}
}

// ─── 5. src/renderer/chat-panel.ts — parse review block ──────────────────────
{
	let ts = read('src/renderer/chat-panel.ts');
	if (ts.includes('extractReviewBlock')) { skip('src/renderer/chat-panel.ts'); } else {
		// Add extractReviewBlock import
		const A1 = '\textractStyleBlock,';
		check(ts.includes(A1), 'chat-panel.ts: extractStyleBlock import not found');
		ts = ts.replace(A1, '\textractStyleBlock,\n\textractReviewBlock,');

		// Add cv-review imports
		const A2 = "import { applyDocumentStyle, type DocumentStyle } from '@lib/document-style';";
		check(ts.includes(A2), 'chat-panel.ts: document-style import not found');
		ts = ts.replace(A2,
			A2 + '\n' +
			"import type { CommentOperation } from '@types/cv-review';\n" +
			"import { applyCommentOps } from '@lib/cv-review';"
		);

		// Add applyReviewOps function before applyStylePatch
		const A3 = '\tfunction applyStylePatch(raw: string): void {';
		check(ts.includes(A3), 'chat-panel.ts: applyStylePatch not found');
		ts = ts.replace(A3,
			'\tfunction applyReviewOps(raw: string): void {\n' +
			'\t\ttry {\n' +
			'\t\t\tconst ops = JSON.parse(raw) as CommentOperation[];\n' +
			'\t\t\tconst cv  = window.__CV_DATA__;\n' +
			'\t\t\tif (!cv) { return; }\n' +
			'\t\t\tif (!cv.review) { cv.review = { version: 1, comments: [], active: true }; }\n' +
			'\t\t\tapplyCommentOps(cv.review, ops);\n' +
			'\t\t\tconst syncFn = (window as Window & { __blemmySyncReview__?: (r: NonNullable<typeof cv[\'review\']>) => void }).__blemmySyncReview__;\n' +
			'\t\t\tif (syncFn && cv.review) { syncFn(cv.review); }\n' +
			'\t\t\tappendMessage(\'system\', \'\\u2713 Review updated.\');\n' +
			'\t\t} catch (err) {\n' +
			'\t\t\tconst msg = err instanceof Error ? err.message : String(err);\n' +
			'\t\t\tappendMessage(\'system\', `\\u2717 Could not apply review ops: ${msg}`);\n' +
			'\t\t}\n' +
			'\t}\n\n' +
			'\tfunction applyStylePatch(raw: string): void {'
		);

		// Thread review into buildSystemPrompt call
		const B1 = '? buildSystemPrompt(cv, layout, sourceText ?? undefined, cv?.review)';
		if (!ts.includes(B1)) {
			// v2.1 not yet applied to chat-panel — use original call site
			const B1_ORIG = '? buildSystemPrompt(cv, layout, sourceText ?? undefined)';
			check(ts.includes(B1_ORIG), 'chat-panel.ts: buildSystemPrompt call not found');
			ts = ts.replace(B1_ORIG, B1);
		}

		// Normal chat path: extract + apply review block
		const C1 = '\t\t\tconst styleRaw2   = extractStyleBlock(fullText);';
		const C1_ALT = '\t\t\tconst styleRaw2  = extractStyleBlock(fullText);';
		const hasC1 = ts.includes(C1) || ts.includes(C1_ALT);
		check(hasC1, 'chat-panel.ts: styleRaw2 extraction not found');
		const c1actual = ts.includes(C1) ? C1 : C1_ALT;
		ts = ts.replace(c1actual, c1actual + '\n\t\t\tconst reviewRaw   = extractReviewBlock(fullText);');

		const C2 = '\t\t\tif (styleRaw2) { applyStylePatch(styleRaw2); }';
		check(ts.includes(C2), 'chat-panel.ts: styleRaw2 apply not found');
		ts = ts.replace(C2, C2 + '\n\t\t\tif (reviewRaw) { applyReviewOps(reviewRaw); }');

		// Generate path: extract + apply review block
		const D1 = '\t\t\tif (styleRaw) { applyStylePatch(styleRaw); }';
		if (ts.includes(D1)) {
			ts = ts.replace(D1,
				D1 + '\n' +
				'\t\t\tconst reviewRaw2 = extractReviewBlock(fullText);\n' +
				'\t\t\tif (reviewRaw2) { applyReviewOps(reviewRaw2); }'
			);
		}

		write('src/renderer/chat-panel.ts', ts);
	}
}

// ─── 6. src/main.ts — import review-mode.css ─────────────────────────────────
{
	let ts = read('src/main.ts');
	if (ts.includes('review-mode.css')) { skip('src/main.ts'); } else {
		const ANCHOR = "import '@styles/style-panel.css';";
		check(ts.includes(ANCHOR), 'main.ts: style-panel.css import not found');
		ts = ts.replace(ANCHOR, ANCHOR + "\nimport '@styles/review-mode.css';");
		write('src/main.ts', ts);
	}
}

console.log('\nDone. Run: npm run typecheck && npm run dev\n');
