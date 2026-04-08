import { BLEMMY_DOC_SHELL_ID } from '@lib/blemmy-dom-ids';

type ClampReport = {
	applied: boolean;
	shellWidth: number;
	cardWidth: number;
	overflowPx: number;
};

/** Desktop CV column narrowed by any right docked panel (review, chat, edit). */
function desktopSidePanelActive(doc: Document, isDesktop: boolean): boolean {
	if (!isDesktop) {
		return false;
	}
	const html = doc.documentElement;
	const review = doc.getElementById('blemmy-review-panel');
	const reviewOpen = Boolean(
		review && !review.hasAttribute('hidden'),
	);
	const unifiedOpen = Boolean(
		html.classList.contains('blemmy-panel-open') &&
			html.classList.contains('blemmy-panel-desktop'),
	);
	return reviewOpen || unifiedOpen;
}

function clearNodeStyles(node: HTMLElement): void {
	node.style.removeProperty('max-width');
	node.style.removeProperty('min-width');
	node.style.removeProperty('width');
	node.style.removeProperty('box-sizing');
}

export function clearReviewWidthClamp(doc: Document = document): void {
	const card = doc.getElementById('blemmy-card') as HTMLElement | null;
	const page1 = doc.getElementById('blemmy-page-1') as HTMLElement | null;
	const page2 = doc.getElementById('blemmy-page-2') as HTMLElement | null;
	const grids = doc.querySelectorAll<HTMLElement>(
		`#${BLEMMY_DOC_SHELL_ID} .blemmy-page .blemmy-grid`,
	);
	for (const node of [card, page1, page2]) {
		if (node) { clearNodeStyles(node); }
	}
	grids.forEach((grid) => { clearNodeStyles(grid); });
}

export function applyReviewWidthClamp(
	doc: Document = document,
	isDesktop = window.matchMedia('(min-width: 901px)').matches,
): ClampReport {
	const html = doc.documentElement;
	const shell = doc.getElementById(BLEMMY_DOC_SHELL_ID) as HTMLElement | null;
	const card = doc.getElementById('blemmy-card') as HTMLElement | null;
	if (
		html.classList.contains('blemmy-share-readonly')
		|| !isDesktop
		|| !shell
		|| !card
		|| !desktopSidePanelActive(doc, isDesktop)
	) {
		clearReviewWidthClamp(doc);
		return { applied: false, shellWidth: 0, cardWidth: 0, overflowPx: 0 };
	}
	const shellWidth = Math.floor(shell.getBoundingClientRect().width);
	if (shellWidth <= 0) {
		return { applied: false, shellWidth: 0, cardWidth: 0, overflowPx: 0 };
	}
	const max = `${shellWidth}px`;
	const shellSel = `#${BLEMMY_DOC_SHELL_ID}`;
	const targets = [card, ...Array.from(
		doc.querySelectorAll<HTMLElement>(
			`${shellSel} .blemmy-page, ${shellSel} .blemmy-page .blemmy-grid`,
		),
	)];
	targets.forEach((node) => {
		node.style.setProperty('width', '100%');
		node.style.setProperty('max-width', max);
		node.style.setProperty('min-width', '0');
		node.style.setProperty('box-sizing', 'border-box');
	});
	const cardWidth = Math.ceil(card.getBoundingClientRect().width);
	const overflowPx = Math.max(0, cardWidth - shellWidth);
	return { applied: true, shellWidth, cardWidth, overflowPx };
}
