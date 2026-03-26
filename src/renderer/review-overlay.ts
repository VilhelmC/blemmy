/**
 * review-overlay.ts
 *
 * Renders review comment indicators as absolutely-positioned dots
 * over the CV shell. The overlay is a transparent full-screen div
 * that sits above the CV but below all chrome UI.
 *
 * Each indicator is a small coloured dot anchored to the bounding
 * rect of its target element. Clicking an indicator fires a callback
 * so the review panel can navigate to that comment.
 *
 * Indicators re-position on window resize and on each updateOverlay() call.
 */

import type { CVReview, ReviewComment, ContentPath } from '@cv/cv-review';
import { resolvePathToElement, commentsForPath, openCommentCount } from '@lib/cv-review';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IndicatorClickHandler = (path: ContentPath) => void;

// ─── State ────────────────────────────────────────────────────────────────────

let overlayEl:    HTMLElement | null = null;
let clickHandler: IndicatorClickHandler | null = null;
let activeReview: CVReview | null = null;
let resizeObserver: ResizeObserver | null = null;

// ─── DOM helper ───────────────────────────────────────────────────────────────

function h(
	tag:   string,
	attrs: Record<string, string> = {},
): HTMLElement {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		el.setAttribute(k, v);
	}
	return el;
}

// ─── Indicator dot ────────────────────────────────────────────────────────────

/**
 * Status → CSS class. Controls dot colour.
 *   open     → amber
 *   flagged  → orange
 *   resolved → muted green (briefly shown then fades)
 */
function indicatorClass(comments: ReviewComment[]): string {
	if (comments.some(c => c.status === 'flagged'))  { return 'blemmy-review-dot--flagged'; }
	if (comments.some(c => c.status === 'open'))     { return 'blemmy-review-dot--open'; }
	return 'blemmy-review-dot--resolved';
}

function buildIndicator(
	path:     ContentPath,
	comments: ReviewComment[],
	el:       HTMLElement,
): HTMLElement {
	const count = comments.filter(c => c.status !== 'resolved').length;
	const dot   = h('button', {
		type:         'button',
		class:        `blemmy-review-dot ${indicatorClass(comments)}`,
		'data-path':  path,
		'aria-label': `${count} comment${count !== 1 ? 's' : ''} on ${path}`,
		title:        comments[0]?.text.slice(0, 60) ?? path,
	});

	if (count > 1) {
		dot.textContent = String(count);
	}

	// Position relative to the target element
	positionDot(dot, el);

	dot.addEventListener('click', (e) => {
		e.stopPropagation();
		if (clickHandler) { clickHandler(path); }
	});

	return dot;
}

function positionDot(dot: HTMLElement, target: HTMLElement): void {
	const rect   = target.getBoundingClientRect();
	const scrollX = window.scrollX;
	const scrollY = window.scrollY;

	dot.style.position = 'absolute';
	dot.style.left     = `${rect.right  + scrollX + 4}px`;
	dot.style.top      = `${rect.top    + scrollY + 2}px`;
}

// ─── Hover highlight ──────────────────────────────────────────────────────────

let hoverTarget: HTMLElement | null = null;

function setHoverHighlight(el: HTMLElement | null): void {
	if (hoverTarget) {
		hoverTarget.classList.remove('blemmy-review-highlight');
		hoverTarget = null;
	}
	if (el) {
		el.classList.add('blemmy-review-highlight');
		hoverTarget = el;
	}
}

// ─── Build / update overlay ───────────────────────────────────────────────────

/** Groups comments by path, deduplicated. */
function groupByPath(review: CVReview): Map<ContentPath, ReviewComment[]> {
	const map = new Map<ContentPath, ReviewComment[]>();
	for (const c of review.comments) {
		const existing = map.get(c.path);
		if (existing) {
			existing.push(c);
		} else {
			map.set(c.path, [c]);
		}
	}
	return map;
}

export function updateOverlay(review: CVReview): void {
	if (!overlayEl) { return; }
	activeReview = review;

	// Clear existing dots
	overlayEl.innerHTML = '';

	// Show open-comment count badge on review toggle button
	const btn = document.getElementById('blemmy-review-toggle');
	if (btn) {
		const n = openCommentCount(review);
		btn.setAttribute('data-count', n > 0 ? String(n) : '');
		btn.setAttribute('aria-label', n > 0 ? `Review mode (${n} open)` : 'Review mode');
	}

	const groups = groupByPath(review);

	for (const [path, comments] of groups) {
		// Only show indicators for non-resolved comments
		const visible = comments.filter(c => c.status !== 'resolved');
		if (visible.length === 0) { continue; }

		const targetEl = resolvePathToElement(path);
		if (!targetEl) { continue; }

		const dot = buildIndicator(path, visible, targetEl);

		// Hover highlights the target element
		dot.addEventListener('mouseenter', () => setHoverHighlight(targetEl));
		dot.addEventListener('mouseleave', () => setHoverHighlight(null));

		overlayEl.appendChild(dot);
	}
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initReviewOverlay(onIndicatorClick: IndicatorClickHandler): HTMLElement {
	clickHandler = onIndicatorClick;

	overlayEl = h('div', {
		id:    'blemmy-review-overlay',
		class: 'blemmy-review-overlay no-print',
		'aria-hidden': 'true',
	});
	overlayEl.style.position      = 'absolute';
	overlayEl.style.inset          = '0';
	overlayEl.style.pointerEvents = 'none';
	overlayEl.style.zIndex         = '90';

	// Allow dots (pointer-events: auto) while overlay itself is transparent
	document.body.appendChild(overlayEl);

	// Reposition dots on resize
	const reposition = (): void => {
		if (!activeReview || !overlayEl) { return; }
		const dots = overlayEl.querySelectorAll<HTMLElement>('.blemmy-review-dot');
		dots.forEach(dot => {
			const path     = dot.dataset.path ?? '';
			const targetEl = resolvePathToElement(path);
			if (targetEl) { positionDot(dot, targetEl); }
		});
	};

	window.addEventListener('resize', reposition);
	window.addEventListener('cv-layout-applied', reposition);

	resizeObserver = new ResizeObserver(reposition);
	const shell = document.getElementById('cv-shell');
	if (shell) { resizeObserver.observe(shell); }

	return overlayEl;
}

export function showOverlay(): void {
	if (overlayEl) { overlayEl.hidden = false; }
}

export function hideOverlay(): void {
	if (overlayEl) { overlayEl.hidden = true; }
	setHoverHighlight(null);
}

export function destroyOverlay(): void {
	resizeObserver?.disconnect();
	overlayEl?.remove();
	overlayEl    = null;
	activeReview = null;
}
