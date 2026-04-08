/**
 * One-shot document token migration: cv-/letter- layout & document surface → blemmy-*.
 * Does not touch app chrome (cv-ui-, cv-chat-, cv-panel-, cv-filter-, etc.).
 * Run from repo root: node scripts/migrate-blemmy-document-tokens.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Longest keys first so cv-page-1 is not clobbered by cv-page */
const REPLACEMENTS = [
	['letter-recipient-address-line', 'blemmy-recipient-address-line'],
	['letter-closing-salutation', 'blemmy-closing-salutation'],
	['letter-masthead-identity', 'blemmy-masthead-identity'],
	['letter-section-recipient', 'blemmy-section-recipient'],
	['letter-section-closing', 'blemmy-section-closing'],
	['letter-recipient-title', 'blemmy-recipient-title'],
	['letter-recipient-name', 'blemmy-recipient-name'],
	['letter-recipient-org', 'blemmy-recipient-org'],
	['letter-recipient-address', 'blemmy-recipient-address'],
	['letter-sender-contact', 'blemmy-sender-contact'],
	['letter-contact-item', 'blemmy-contact-item'],
	['letter-sender-label', 'blemmy-sender-label'],
	['letter-sender-name', 'blemmy-sender-name'],
	['letter-signature-name', 'blemmy-signature-name'],
	['letter-signature-title', 'blemmy-signature-title'],
	['letter-section-body', 'blemmy-section-body'],
	['letter-paragraph', 'blemmy-paragraph'],
	['cv-layout-measure-intrinsic', 'blemmy-layout-measure-intrinsic'],
	['cv-portrait-upload-hint', 'blemmy-portrait-upload-hint'],
	['cv-name-label-block', 'blemmy-name-label-block'],
	['cv-sidebar-tail-spacer', 'blemmy-sidebar-tail-spacer'],
	['cv-body-column-footer', 'blemmy-body-column-footer'],
	['cv-masthead-collapsed', 'blemmy-masthead-collapsed'],
	['cv-page-1-body-footer', 'blemmy-page-1-body-footer'],
	['cv-page-2-body-footer', 'blemmy-page-2-body-footer'],
	['cv-page-1-masthead', 'blemmy-page-1-masthead'],
	['cv-masthead-profile-col', 'blemmy-masthead-profile-col'],
	['cv-rebalance-languages', 'blemmy-rebalance-languages'],
	['cv-rebalance-interests', 'blemmy-rebalance-interests'],
	['cv-rebalance-skills', 'blemmy-rebalance-skills'],
	['cv-rebalance-profile', 'blemmy-rebalance-profile'],
	['cv-rebalance-contact', 'blemmy-rebalance-contact'],
	['cv-rebalance-label', 'blemmy-rebalance-label'],
	['cv-p1-portrait-cell', 'blemmy-p1-portrait-cell'],
	['cv-portrait-img', 'blemmy-portrait-img'],
	['cv-layout-status', 'blemmy-layout-status'],
	['cv-work-pool', 'blemmy-work-pool'],
	['cv-sidebar-1', 'blemmy-sidebar-1'],
	['cv-sidebar-2', 'blemmy-sidebar-2'],
	['cv-main-1', 'blemmy-main-1'],
	['cv-main-2', 'blemmy-main-2'],
	['letter-main-1', 'blemmy-main-1'],
	['letter-page-1', 'blemmy-page-1'],
	['letter-masthead', 'blemmy-masthead'],
	['letter-card', 'blemmy-card'],
	['cv-page-1', 'blemmy-page-1'],
	['cv-education', 'blemmy-education'],
	['cv-card', 'blemmy-card'],
	['letter-subject', 'blemmy-subject'],
	['letter-opening', 'blemmy-opening'],
	['letter-closing', 'blemmy-closing-block'],
	['letter-signature', 'blemmy-signature'],
	['letter-body', 'blemmy-body'],
	['letter-date', 'blemmy-date'],
	['letter-page', 'blemmy-page'],
	['letter-shell', 'blemmy-shell'],
	['cv-print-preview', 'blemmy-print-preview'],
	['cv-print-surface', 'blemmy-print-surface'],
	['cv-single-page', 'blemmy-single-page'],
	['cv-masthead-right', 'blemmy-masthead-right'],
	['cv-masthead-col-profile', 'blemmy-masthead-col-profile'],
	['cv-main-masthead', 'blemmy-main-masthead'],
	['cv-p1-top-band', 'blemmy-p1-top-band'],
	['cv-header-block', 'blemmy-header-block'],
	['cv-portrait-wrap', 'blemmy-portrait-wrap'],
	['cv-label-part', 'blemmy-label-part'],
	['cv-name-label', 'blemmy-name-label'],
	['cv-sidebar', 'blemmy-sidebar'],
	['cv-section-profile', 'blemmy-section-profile'],
	['cv-zone-header-profile', 'blemmy-zone-header-profile'],
	['cv-zone-header-right', 'blemmy-zone-header-right'],
	['cv-zone-main-body', 'blemmy-zone-main-body'],
	['cv-zone-header', 'blemmy-zone-header'],
	['cv-summary', 'blemmy-summary'],
	['cv-label', 'blemmy-label'],
	['cv-name', 'blemmy-name'],
	['cv-page-2', 'blemmy-page-2'],
	['cv-shell', 'blemmy-shell'],
	['cv-grid', 'blemmy-grid'],
	['cv-main', 'blemmy-main'],
	['cv-page', 'blemmy-page'],
	['letter-section', 'blemmy-section'],
	['cv-density-', 'blemmy-density-'],
	['cv-fill-', 'blemmy-fill-'],
];

const EXT = new Set(['.ts', '.css', '.html', '.json', '.mts', '.cts']);
const SKIP_DIR = new Set([
	'node_modules', 'dist', '.git', 'playwright-report', 'test-results',
	'.tmp-import', '.tmp-v3.3-import', '.tmp-v3.3-zip', '.tmp-patch-v41',
	'patch', 'debug',
]);

function walk(dir, out) {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) {
			if (SKIP_DIR.has(ent.name)) { continue; }
			walk(p, out);
		} else {
			const ext = path.extname(ent.name);
			if (EXT.has(ext)) { out.push(p); }
		}
	}
}

function migrateFile(fp) {
	let s = fs.readFileSync(fp, 'utf8');
	const orig = s;
	for (const [from, to] of REPLACEMENTS) {
		s = s.split(from).join(to);
	}
	if (s !== orig) {
		fs.writeFileSync(fp, s, 'utf8');
		return true;
	}
	return false;
}

const files = [];
walk(path.join(root, 'src'), files);
walk(path.join(root, 'e2e'), files);
for (const extra of ['index.html', path.join('scripts', 'capture-layout-gif.mjs')]) {
	const fp = path.join(root, extra);
	if (fs.existsSync(fp)) { files.push(fp); }
}

let n = 0;
for (const fp of files) {
	if (migrateFile(fp)) { n++; }
}
console.log(`Updated ${n} files (blemmy document tokens).`);
