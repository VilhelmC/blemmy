#!/usr/bin/env node
/**
 * apply-v3.1c-doctype-switching.mjs
 *
 * Wires the letter document type into the application:
 *   - main.ts: LETTER_DOCUMENT_SPEC, __LETTER_DATA__, switchDocType()
 *   - document-panel.ts: type picker on new doc, openDoc branches on doc_type
 *   - package.json: bump to 3.2.0
 *
 * New files must be copied first (letter-document-spec.ts).
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

console.log('\nBlemmy v3.2.0 document type switching\n');

// ─── 1. src/main.ts ──────────────────────────────────────────────────────────
{
	let ts = read('src/main.ts');
	if (ts.includes('LETTER_DOCUMENT_SPEC')) { skip('src/main.ts'); } else {
		// a) Add imports for letter
		const IMP = "import { CV_DOCUMENT_SPEC }  from '@lib/cv-document-spec';";
		check(ts.includes(IMP), 'main.ts: CV_DOCUMENT_SPEC import not found');
		ts = ts.replace(IMP,
			IMP + '\n' +
			"import { LETTER_DOCUMENT_SPEC } from '@lib/letter-document-spec';\n" +
			"import { renderLetter }         from '@renderer/letter-renderer';\n" +
			"import { loadLetterData, saveLetterData, validateLetterData, newLetterFromBasics } from '@lib/letter-loader';\n" +
			"import type { LetterData }      from '@types/letter';"
		);

		// b) Extend Window declaration to include letter state
		const WIN_DECL = `\t\t__CV_DATA__?: CVData;`;
		check(ts.includes(WIN_DECL), 'main.ts: __CV_DATA__ window declaration not found');
		ts = ts.replace(WIN_DECL,
			WIN_DECL + '\n\t\t__LETTER_DATA__?: LetterData;\n\t\t__ACTIVE_DOC_TYPE__?: string;'
		);

		// c) Add activeDocType tracking and switchDocType function after mount()
		const MOUNT_END = 'function applyData(cv: CVData, recordHistory = true): void {';
		check(ts.includes(MOUNT_END), 'main.ts: applyData function not found');
		ts = ts.replace(MOUNT_END,
			`// ─── Active document type ──────────────────────────────────────────────────
function getActiveDocType(): string {
\treturn window.__ACTIVE_DOC_TYPE__ ?? 'cv';
}

/**
 * Switches the active document type, re-mounts the correct renderer,
 * and re-initialises the layout engine with the correct spec.
 */
function switchToLetter(data?: LetterData): void {
\tconst letterData = data ?? loadLetterData();
\twindow.__ACTIVE_DOC_TYPE__ = 'letter';
\twindow.__LETTER_DATA__     = letterData;

\tconst existingRoot = document.getElementById('letter-root') ??
\t                     document.getElementById('cv-root');
\tif (existingRoot) { existingRoot.remove(); }
\tconst legacyShell = document.getElementById('letter-shell') ??
\t                    document.getElementById('cv-shell');
\tif (legacyShell) { legacyShell.remove(); }
\tif (engineCleanup) { engineCleanup(); engineCleanup = null; }

\tconst root = renderLetter(letterData);
\tdocument.body.insertBefore(root, document.body.firstChild);
\tconst shell = document.getElementById('letter-shell');
\tif (!shell) { throw new Error('[main] #letter-shell not found after render'); }
\tactivateShell(shell);

\tengineCleanup = initCvLayoutEngine(LETTER_DOCUMENT_SPEC) ?? null;
\tpersistSessionState();
}

function switchToCv(data?: CVData): void {
\twindow.__ACTIVE_DOC_TYPE__ = 'cv';
\twindow.__LETTER_DATA__     = undefined;
\tconst d = data ?? window.__CV_DATA__ ?? loadCvData();
\tmount(d);
}

// Expose for document-panel and other callers
(window as Window & {
\t__blemmySwitchToLetter__?: (data?: LetterData) => void;
\t__blemmySwitchToCv__?:     (data?: CVData)     => void;
}).__blemmySwitchToLetter__ = switchToLetter;
(window as Window & {
\t__blemmySwitchToCv__?: (data?: CVData) => void;
}).__blemmySwitchToCv__ = switchToCv;

function applyData(cv: CVData, recordHistory = true): void {`
		);

		write('src/main.ts', ts);
	}
}

// ─── 2. src/renderer/document-panel.ts ───────────────────────────────────────
{
	let ts = read('src/renderer/document-panel.ts');
	if (ts.includes('__blemmySwitchToLetter__')) { skip('src/renderer/document-panel.ts'); } else {
		// a) Add validateLetterData import
		const IMP = "import { validateCvData } from '@lib/cv-loader';";
		check(ts.includes(IMP), 'document-panel.ts: validateCvData import not found');
		ts = ts.replace(IMP,
			IMP + '\n' +
			"import { validateLetterData } from '@lib/letter-loader';\n" +
			"import type { LetterData }     from '@types/letter';"
		);

		// b) Update openDoc to branch on doc_type
		const OLD_OPEN = `\tasync function openDoc(doc: CloudDocument): Promise<void> {
\t\tif (!doc.latest) { setStatus('No versions for document', true); return; }
\t\ttry {
\t\t\tconst cv = validateCvData(doc.latest);
\t\t\topenDocument(doc);
\t\t\tremount(cv);
\t\t\tcloseDrawer?.();
\t\t} catch (err) {
\t\t\tsetStatus(err instanceof Error ? err.message : 'Invalid CV', true);
\t\t}
\t}`;

		check(ts.includes(OLD_OPEN), 'document-panel.ts: openDoc function not found');
		ts = ts.replace(OLD_OPEN,
			`\tasync function openDoc(doc: CloudDocument): Promise<void> {
\t\tif (!doc.latest) { setStatus('No versions for document', true); return; }
\t\ttry {
\t\t\tif (doc.doc_type === 'letter') {
\t\t\t\tconst letter = validateLetterData(doc.latest);
\t\t\t\topenDocument(doc);
\t\t\t\tconst switchFn = (window as Window & { __blemmySwitchToLetter__?: (d: LetterData) => void }).__blemmySwitchToLetter__;
\t\t\t\tswitchFn?.(letter);
\t\t\t\tcloseDrawer?.();
\t\t\t} else {
\t\t\t\tconst cv = validateCvData(doc.latest);
\t\t\t\topenDocument(doc);
\t\t\t\tremount(cv);
\t\t\t\tcloseDrawer?.();
\t\t\t}
\t\t} catch (err) {
\t\t\tsetStatus(err instanceof Error ? err.message : 'Invalid document', true);
\t\t}
\t}`
		);

		// c) Update doc list to show doc_type badge
		const OLD_OPEN_BTN = `\t\t\tconst openBtn = h(
\t\t\t\t'button',
\t\t\t\t{
\t\t\t\t\ttype: 'button',
\t\t\t\t\tclass: 'cv-doc-row__name',
\t\t\t\t\ttitle: \`Open "\${doc.name}"\`,
\t\t\t\t\t'aria-label': \`Open document \${doc.name}\`,
\t\t\t\t},
\t\t\t\tdoc.name,
\t\t\t);`;

		if (ts.includes(OLD_OPEN_BTN)) {
			ts = ts.replace(OLD_OPEN_BTN,
				`\t\t\tconst docTypeBadge = doc.doc_type && doc.doc_type !== 'cv'
\t\t\t\t? h('span', { class: 'cv-doc-row__type-badge' }, doc.doc_type)
\t\t\t\t: null;
\t\t\tconst openBtn = h(
\t\t\t\t'button',
\t\t\t\t{
\t\t\t\t\ttype: 'button',
\t\t\t\t\tclass: 'cv-doc-row__name',
\t\t\t\t\ttitle: \`Open "\${doc.name}"\`,
\t\t\t\t\t'aria-label': \`Open document \${doc.name}\`,
\t\t\t\t},
\t\t\t\tdoc.name,
\t\t\t\tdocTypeBadge,
\t\t\t);`
			);
		}

		// d) Update newBtn click to show doc type picker
		const OLD_NEW_BTN = `\tnewBtn.addEventListener('click', async () => {
\t\tconst name = prompt('Document name', 'Untitled CV')?.trim();
\t\tif (!name) { return; }
\t\tconst data = window.__CV_DATA__;
\t\tif (!data) { setStatus('No CV loaded', true); return; }
\t\tconst res = await createDocument(name, data);
\t\tif (!res.ok) { setStatus(res.error.message, true); return; }
\t\tdocs.unshift(res.data);
\t\topenDocument(res.data);
\t\trenderDocs();
\t\tsetStatus(\`Created "\${name}"\`);
\t});`;

		check(ts.includes(OLD_NEW_BTN), 'document-panel.ts: newBtn click handler not found');
		ts = ts.replace(OLD_NEW_BTN,
			`\tnewBtn.addEventListener('click', async () => {
\t\t// Let user choose document type first
\t\tconst typeChoice = window.prompt(
\t\t\t'Document type:\\n  1 = CV (Curriculum Vitae)\\n  2 = Letter (Cover Letter)\\n\\nEnter 1 or 2:',
\t\t\t'1',
\t\t)?.trim();
\t\tif (!typeChoice) { return; }
\t\tconst docType = typeChoice === '2' ? 'letter' : 'cv';
\t\tconst defaultName = docType === 'letter' ? 'Untitled Letter' : 'Untitled CV';
\t\tconst name = window.prompt('Document name', defaultName)?.trim();
\t\tif (!name) { return; }

\t\tif (docType === 'letter') {
\t\t\tconst cvData = window.__CV_DATA__;
\t\t\tconst letterData = cvData
\t\t\t\t? (() => {
\t\t\t\t\tconst { newLetterFromBasics: nlf } = await import('@lib/letter-loader').catch(() => ({ newLetterFromBasics: null })) as { newLetterFromBasics: typeof import('@lib/letter-loader').newLetterFromBasics | null };
\t\t\t\t\treturn nlf?.(cvData.basics.name, cvData.basics.label, cvData.basics.email, cvData.basics.phone, cvData.basics.location);
\t\t\t\t})()
\t\t\t\t: null;
\t\t\t// For simplicity, create a placeholder and switch — user edits content
\t\t\tconst { loadLetterData: lld } = await import('@lib/letter-loader');
\t\t\tconst data = letterData ?? lld();
\t\t\tconst res = await createDocument(name, data as unknown as import('@cv/cv').CVData, 'letter');
\t\t\tif (!res.ok) { setStatus(res.error.message, true); return; }
\t\t\tdocs.unshift(res.data);
\t\t\topenDocument(res.data);
\t\t\tconst switchFn = (window as Window & { __blemmySwitchToLetter__?: (d: typeof data) => void }).__blemmySwitchToLetter__;
\t\t\tswitchFn?.(data);
\t\t\tcloseDrawer?.();
\t\t\trenderDocs();
\t\t\tsetStatus(\`Created "\${name}"\`);
\t\t} else {
\t\t\tconst data = window.__CV_DATA__;
\t\t\tif (!data) { setStatus('No CV loaded', true); return; }
\t\t\tconst res = await createDocument(name, data);
\t\t\tif (!res.ok) { setStatus(res.error.message, true); return; }
\t\t\tdocs.unshift(res.data);
\t\t\topenDocument(res.data);
\t\t\trenderDocs();
\t\t\tsetStatus(\`Created "\${name}"\`);
\t\t}
\t});`
		);

		write('src/renderer/document-panel.ts', ts);
	}
}

// ─── 3. package.json ─────────────────────────────────────────────────────────
{
	let json = read('package.json');
	if (json.includes('"version": "3.2.0"')) { skip('package.json'); } else {
		json = json.replace(/"version": "\d+\.\d+\.\d+"/, '"version": "3.2.0"');
		write('package.json', json);
	}
}

console.log('\nDone. Run: npm run typecheck && npm run dev\n');
