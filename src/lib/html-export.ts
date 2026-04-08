/**
 * html-export.ts
 *
 * Exports the currently rendered document as a self-contained HTML file.
 *
 * The exported file:
 *   - Contains the full rendered shell DOM (outerHTML)
 *   - Inlines all print-mode CSS so the file is portable and offline-capable
 *   - Strips all edit-mode, review, and chrome UI elements (.no-print)
 *   - Works for both CV and letter document types
 *
 * Vite resolves the ?raw imports as string literals at build time —
 * the CSS content is embedded directly in the bundle.
 */

import printCss       from '@styles/print.css?raw';
import surfaceCss     from '@styles/blemmy-print-surface.css?raw';
import parityCss      from '@styles/blemmy-print-parity.css?raw';
import letterCss      from '@styles/letter.css?raw';
import { BLEMMY_DOC_SHELL_ID } from '@lib/blemmy-dom-ids';
import { getActiveDocumentType } from '@lib/active-document-runtime';

const PRINT_SURFACE_HTML_CLASS = 'blemmy-print-surface';

/** CSS vars and selectors: strip legacy blemmy-/letter- prefixes in exports. */
function portableizeExportCss(css: string): string {
	let s = css.replace(/--blemmy-/g, '--blemmy-');
	s = s.replace(/--letter-/g, '--blemmy-');
	s = s.replace(/\bblemmy-print-parity\b/g, 'blemmy-print-parity');
	s = s.replace(/\bblemmy-print\b/g, 'blemmy-print');
	const tokenRe = /(^|[^a-zA-Z0-9_])(cv|letter)-/gm;
	let prev = '';
	while (s !== prev) {
		prev = s;
		s = s.replace(tokenRe, '$1blemmy-');
	}
	return s;
}

function portableizeExportedDom(root: Element): void {
	const visit = (el: Element): void => {
		if (el.id) {
			el.id = el.id.replace(/^(cv|letter)-/, 'blemmy-');
		}
		if (el.hasAttribute('class')) {
			const c = el.getAttribute('class');
			if (c) {
				const next = c
					.split(/\s+/)
					.filter(Boolean)
					.map((t) => t.replace(/^(cv|letter)-/, 'blemmy-'))
					.join(' ');
				el.setAttribute('class', next);
			}
		}
		const st = el.getAttribute('style');
		if (st) {
			el.setAttribute(
				'style',
				st
					.replace(/--blemmy-/g, '--blemmy-')
					.replace(/--letter-/g, '--blemmy-'),
			);
		}
		for (const ch of Array.from(el.children)) {
			visit(ch);
		}
	};
	visit(root);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type HtmlExportOptions = {
	/** The document type being exported. Used for filename and CSS selection. */
	docType?: string;
	/** Document title for the <title> element. */
	title?:   string;
	/** Language code for the <html lang> attribute. */
	lang?:    string;
};

// ─── CSS assembly ─────────────────────────────────────────────────────────────

/**
 * Assembles the inline CSS for the export.
 * Only includes print-relevant CSS — screen-only UI is stripped.
 */
function buildExportCss(docType: string): string {
	const parts: string[] = [
		'/* @blemmy/engine print surface */',
		surfaceCss,
		'/* print layout */',
		printCss,
		'/* print parity (masthead + portrait) */',
		parityCss,
	];

	if (docType === 'letter') {
		parts.push('/* letter layout */');
		parts.push(letterCss);
	}

	// Add minimal screen presentation so the file looks good when opened in a browser
	parts.push(`
/* standalone viewer */
@media screen {
	body {
		margin: 0;
		padding: 2rem;
		background: #e8e8e8;
		display: flex;
		flex-direction: column;
		align-items: center;
		font-family: system-ui, sans-serif;
	}
	.blemmy-shell, .blemmy-shell {
		box-shadow: 0 4px 32px rgba(0,0,0,0.18);
	}
	.no-print { display: none !important; }
}
@media print {
	body { margin: 0; padding: 0; background: none; }
	.no-print { display: none !important; }
}
`);

	return portableizeExportCss(parts.join('\n\n'));
}

// ─── Shell capture ────────────────────────────────────────────────────────────

/**
 * Captures the current document shell DOM, stripping all non-print elements.
 * Returns null if no shell is found.
 */
function captureShell(): string | null {
	const shell = document.getElementById(BLEMMY_DOC_SHELL_ID);
	if (!shell) { return null; }

	// Deep clone so we don't mutate the live DOM
	const clone = shell.cloneNode(true) as HTMLElement;

	// Strip all .no-print elements from the clone
	clone.querySelectorAll('.no-print').forEach((el) => el.remove());

	// Strip edit-mode attributes
	clone.removeAttribute('data-blemmy-editing');
	clone.querySelectorAll('[data-blemmy-editing]').forEach((el) => {
		el.removeAttribute('data-blemmy-editing');
	});

	// Strip contenteditable
	clone.querySelectorAll('[contenteditable]').forEach((el) => {
		el.removeAttribute('contenteditable');
		el.removeAttribute('spellcheck');
	});

	// Strip blemmy-edit-mode / blemmy-edit-mode from documentElement class
	// (has no effect in the export but keeps the HTML clean)
	clone.classList.remove('blemmy-edit-mode', 'blemmy-edit-mode');

	portableizeExportedDom(clone);

	return clone.outerHTML;
}

// ─── HTML assembly ────────────────────────────────────────────────────────────

function buildHtml(shellHtml: string, css: string, title: string, lang: string): string {
	return `<!DOCTYPE html>
<html lang="${lang}" class="${PRINT_SURFACE_HTML_CLASS}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${css}
</style>
</head>
<body>
${shellHtml}
</body>
</html>`;
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Exports the currently rendered document as a self-contained HTML file
 * and triggers a browser download.
 *
 * Returns false if no shell element was found.
 */
function exportFilenameSlug(docType: string): string {
	if (docType === 'cv') { return 'profile'; }
	if (docType === 'letter') { return 'letter'; }
	const safe = docType.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
	return safe.replace(/^-+|-+$/g, '') || 'document';
}

export function exportStandaloneHtml(opts: HtmlExportOptions = {}): boolean {
	const docType = opts.docType ?? getActiveDocumentType();
	const title   = opts.title ?? (document.title || 'Blemmy document');
	const lang    = opts.lang  ?? (document.documentElement.lang || 'en');

	const shellHtml = captureShell();
	if (!shellHtml) { return false; }

	const css      = buildExportCss(docType);
	const html     = buildHtml(shellHtml, css, title, lang);
	const filename = `blemmy-${exportFilenameSlug(docType)}-${Date.now()}.html`;

	const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
	const url  = URL.createObjectURL(blob);
	const a    = document.createElement('a');
	a.href     = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	// Revoke after a short delay to allow the download to start
	setTimeout(() => URL.revokeObjectURL(url), 2000);

	return true;
}
