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
import surfaceCss     from '@styles/cv-print-surface.css?raw';
import parityCss      from '@styles/cv-print-parity.css?raw';
import letterCss      from '@styles/letter.css?raw';

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
	.cv-shell, .letter-shell {
		box-shadow: 0 4px 32px rgba(0,0,0,0.18);
	}
	.no-print { display: none !important; }
}
@media print {
	body { margin: 0; padding: 0; background: none; }
	.no-print { display: none !important; }
}
`);

	return parts.join('\n\n');
}

// ─── Shell capture ────────────────────────────────────────────────────────────

/**
 * Captures the current document shell DOM, stripping all non-print elements.
 * Returns null if no shell is found.
 */
function captureShell(docType: string): string | null {
	const shellId = docType === 'letter' ? 'letter-shell' : 'cv-shell';
	const shell   = document.getElementById(shellId);
	if (!shell) { return null; }

	// Deep clone so we don't mutate the live DOM
	const clone = shell.cloneNode(true) as HTMLElement;

	// Strip all .no-print elements from the clone
	clone.querySelectorAll('.no-print').forEach((el) => el.remove());

	// Strip edit-mode attributes
	clone.removeAttribute('data-blemmy-editing');
	clone.removeAttribute('data-cv-editing');
	clone.querySelectorAll('[data-blemmy-editing],[data-cv-editing]').forEach((el) => {
		el.removeAttribute('data-blemmy-editing');
		el.removeAttribute('data-cv-editing');
	});

	// Strip contenteditable
	clone.querySelectorAll('[contenteditable]').forEach((el) => {
		el.removeAttribute('contenteditable');
		el.removeAttribute('spellcheck');
	});

	// Strip blemmy-edit-mode / cv-edit-mode from documentElement class
	// (has no effect in the export but keeps the HTML clean)
	clone.classList.remove('blemmy-edit-mode', 'cv-edit-mode');

	return clone.outerHTML;
}

// ─── HTML assembly ────────────────────────────────────────────────────────────

function buildHtml(shellHtml: string, css: string, title: string, lang: string): string {
	return `<!DOCTYPE html>
<html lang="${lang}">
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
export function exportStandaloneHtml(opts: HtmlExportOptions = {}): boolean {
	const winType = (window as Window & { __ACTIVE_DOC_TYPE__?: string }).__ACTIVE_DOC_TYPE__;
	const docType = opts.docType ?? winType ?? 'cv';
	const title   = opts.title ?? (document.title || 'Blemmy document');
	const lang    = opts.lang  ?? (document.documentElement.lang || 'en');

	const shellHtml = captureShell(docType);
	if (!shellHtml) { return false; }

	const css      = buildExportCss(docType);
	const html     = buildHtml(shellHtml, css, title, lang);
	const filename = `${docType}-${Date.now()}.html`;

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
