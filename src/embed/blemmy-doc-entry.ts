/**
 * Standalone entry: registers <blemmy-doc> and loads embed styles + fonts.
 * Built as dist/blemmy-doc.js for host pages.
 */

import '@styles/fonts.css';
import '@styles/global.css';
import '@styles/print.css';
import '@styles/letter.css';
import '@styles/blemmy-doc-embed.css';

import surfaceCss from '@styles/blemmy-print-surface.css?raw';
import parityCss from '@styles/blemmy-print-parity.css?raw';

import { registerBlemmyDocElement } from './blemmy-doc-element';

const PREVIEW_SCOPE = 'blemmy-doc.blemmy-doc-embed.blemmy-print-surface';

function scopeBlemmyPreviewCss(css: string): string {
	return css.replace(/html\.blemmy-print-surface/g, PREVIEW_SCOPE);
}

if (typeof document !== 'undefined') {
	const tag = document.createElement('style');
	tag.setAttribute('data-blemmy-embed-print-preview', '');
	tag.textContent =
		scopeBlemmyPreviewCss(surfaceCss) + '\n' + scopeBlemmyPreviewCss(parityCss);
	document.head.appendChild(tag);
}

registerBlemmyDocElement();
