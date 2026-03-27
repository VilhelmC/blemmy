/**
 * Column slack below the last **content** direct `div` (sidebar tail spacer
 * excluded). Used by `cv-layout-engine` and `LayoutDiagnostics`.
 */

export const CV_SIDEBAR_TAIL_SPACER_CLASS = 'cv-sidebar-tail-spacer';

export function isCvSidebarTailSpacer(el: HTMLElement): boolean {
	return el.classList.contains(CV_SIDEBAR_TAIL_SPACER_CLASS);
}

export function removeSidebarTailSpacers(sidebar: HTMLElement): void {
	sidebar
		.querySelectorAll('.' + CV_SIDEBAR_TAIL_SPACER_CLASS)
		.forEach((n) => {
			n.remove();
		});
}

/**
 * Keeps exactly one tail node and **moves it to the last child** so reorder
 * helpers (e.g. `appendChild` on `#cv-rebalance-*`) cannot leave the spacer
 * above content.
 */
export function ensureSidebarTailSpacer(sidebar: HTMLElement): void {
	const found = sidebar.querySelectorAll('.' + CV_SIDEBAR_TAIL_SPACER_CLASS);
	let el: HTMLElement;
	if (found.length === 0) {
		el = document.createElement('div');
		el.className = CV_SIDEBAR_TAIL_SPACER_CLASS;
		el.setAttribute('aria-hidden', 'true');
	} else {
		el = found[0] as HTMLElement;
		for (let i = 1; i < found.length; i += 1) {
			found[i].remove();
		}
	}
	sidebar.appendChild(el);
}

export function isCvLayoutSlackElementVisible(el: HTMLElement): boolean {
	if (el.closest('.no-print')) {
		return false;
	}
	const s = getComputedStyle(el);
	if (s.display === 'none' || s.visibility === 'hidden') {
		return false;
	}
	const r = el.getBoundingClientRect();
	return r.height > 0.5 && r.width >= 0;
}

/**
 * Viewport Y of the bottom of the lowest visible **content** direct `div`
 * (not the fixed tail spacer), clamped to the column border box.
 */
export function maxDirectDivChildBottomForSlack(scope: HTMLElement): number {
	const sr = scope.getBoundingClientRect();
	let maxB = sr.top;
	let any = false;
	const divs = scope.querySelectorAll(':scope > div');
	for (let i = 0; i < divs.length; i += 1) {
		const el = divs[i];
		if (!(el instanceof HTMLElement)) {
			continue;
		}
		if (isCvSidebarTailSpacer(el)) {
			continue;
		}
		const st = getComputedStyle(el);
		if (st.display === 'none' || st.visibility === 'hidden') {
			continue;
		}
		const rect = el.getBoundingClientRect();
		if (rect.height < 1) {
			continue;
		}
		any = true;
		maxB = Math.max(maxB, rect.bottom);
	}
	if (!any) {
		return sr.top;
	}
	return Math.min(maxB, sr.bottom);
}

/** Visible direct **element** children (flex items; includes tail spacer). */
export function visibleDirectFlexItemCount(scope: HTMLElement): number {
	let n = 0;
	const kids = scope.children;
	for (let i = 0; i < kids.length; i += 1) {
		const el = kids[i];
		if (!(el instanceof HTMLElement)) {
			continue;
		}
		if (!isCvLayoutSlackElementVisible(el)) {
			continue;
		}
		n += 1;
	}
	return n;
}

/** Pixels of empty space below last **content** direct `div`. */
export function columnSlackBelowDirectDivBlocksPx(col: HTMLElement): number {
	void col.offsetHeight;
	if (!isCvLayoutSlackElementVisible(col)) {
		return 0;
	}
	const colRect = col.getBoundingClientRect();
	if (colRect.height < 8) {
		return 0;
	}
	const contentBottom = maxDirectDivChildBottomForSlack(col);
	return Math.max(0, colRect.bottom - contentBottom);
}
