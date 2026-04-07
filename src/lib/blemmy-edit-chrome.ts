/**
 * Edit-mode UI mounted inside contenteditable hosts. Must never be persisted
 * as part of field text (highlights, tags, etc.).
 */
export const BLEMMY_EDIT_CHROME_SELECTORS =
	'.cv-move-controls, .cv-vis-toggle, button.cv-move-btn';

/**
 * Glyphs on reorder / visibility / drag controls. Browsers may merge these
 * into adjacent text nodes so they survive clone+strip on save.
 */
const TRAILING_EDIT_GLYPH_RUN =
	/(?:[\s\u200b\u00a0]*[👁↑↓⋮])+$/u;

export function stripTrailingBlemmyEditGlyphs(text: string): string {
	return text.replace(TRAILING_EDIT_GLYPH_RUN, '').trimEnd();
}

export function stripBlemmyEditChrome(root: HTMLElement): void {
	for (const el of root.querySelectorAll<HTMLElement>(
		BLEMMY_EDIT_CHROME_SELECTORS,
	)) {
		el.remove();
	}
}
