/**
 * cv-align.ts
 * Cross-column alignment, safe-zone validation, and gap-cap enforcement.
 *
 * Called by cv-layout-engine after the iterative slack-absorption pass.
 * This module adds three capabilities the engine alone does not have:
 *
 *  1. CROSS-COLUMN ALIGNMENT
 *     Measures Y positions of section labels in both columns on a given
 *     page. If any sidebar label sits within ALIGN_THRESHOLD_MM of a main-
 *     column label, the lagging column receives extra gap (up to
 *     ALIGN_STEP_MAX_MM) to snap both labels to the same baseline. This
 *     produces the "grid register" that makes two-column documents feel
 *     intentional rather than accidental.
 *
 *  2. SAFE-ZONE VALIDATION
 *     Detects content blocks whose bounding boxes fall within
 *     SAFE_TOP_MM of the page top or SAFE_BOTTOM_MM of the page bottom.
 *     Returns a list of violations so the engine can trim slack vars back
 *     until the safe zone is restored.
 *
 *  3. GAP CAP
 *     Exposes `enforcedGapCap(current, base)` so the engine can clamp any
 *     accumulated gap variable to BASE × MAX_GAP_RATIO. Without a cap,
 *     the iterative absorption loop can produce gaps that are visually
 *     disproportionate.
 *
 * None of these functions mutate the DOM. All adjustments are returned as
 * numeric values; the engine owns all CSS-variable writes.
 */

// ─── Physical constants ───────────────────────────────────────────────────────

export const MM_TO_PX = 96 / 25.4;
const A4_H_PX = 297 * MM_TO_PX;

// ─── Tuning parameters ────────────────────────────────────────────────────────

/**
 * Two landmarks are "near-aligned" if their Y distance is at or below this
 * value. Too small → rarely fires; too large → forces mismatched pairs.
 */
const ALIGN_THRESHOLD_MM = 6.5;
const ALIGN_THRESHOLD_PX = ALIGN_THRESHOLD_MM * MM_TO_PX;

/**
 * Maximum extra gap added in a single alignment step. Prevents the engine
 * from consuming so much slack that downstream sections become under-spaced.
 */
const ALIGN_STEP_MAX_MM = 4;
const ALIGN_STEP_MAX_PX = ALIGN_STEP_MAX_MM * MM_TO_PX;

/**
 * Minimum extra gap applied; smaller adjustments are noise and ignored.
 */
const ALIGN_MIN_DELTA_PX = 0.6;

/**
 * Content must not start closer than this to the page top (post-padding).
 * Violations trigger a slack trim in the engine.
 */
export const SAFE_TOP_MM = 5;
export const SAFE_TOP_PX = SAFE_TOP_MM * MM_TO_PX;

/**
 * Content must not end closer than this to the page bottom.
 * The sidebar has its own CSS `padding-bottom` tail (--print-sidebar-column-
 * tail), so violations here indicate over-absorption.
 */
export const SAFE_BOTTOM_MM = 7;
export const SAFE_BOTTOM_PX = SAFE_BOTTOM_MM * MM_TO_PX;

/**
 * Gap is capped at BASE × this ratio. Keeps rhythm even when a column has
 * only two or three sections and lots of spare height.
 */
const MAX_GAP_RATIO = 2.4;

/**
 * Reference base gap values, mirroring the print token defaults.
 * If you change --print-main-stack-gap or --print-sidebar-stack-gap in CSS,
 * update these too so the cap stays calibrated.
 */
export const BASE_MAIN_GAP_PX    = 5.5 * MM_TO_PX;  // --print-main-stack-gap
export const BASE_SIDEBAR_GAP_PX = 4.0 * MM_TO_PX;  // --print-sidebar-stack-gap

// ─── Types ────────────────────────────────────────────────────────────────────

export type ColumnId = 'sidebar' | 'main';

/** A measurable anchor point in a column. */
export type Landmark = {
	el: HTMLElement;
	/** Y offset from the page's border-box top (px). */
	yPage: number;
	column: ColumnId;
};

/** A sidebar–main pair whose Y positions are within ALIGN_THRESHOLD_PX. */
export type AlignPair = {
	sidebar: Landmark;
	main: Landmark;
	/**
	 * main.yPage − sidebar.yPage.
	 * Positive → main label is below sidebar label.
	 * Negative → sidebar label is below main label.
	 */
	delta: number;
};

/** A content element that violates a page-edge safe zone. */
export type SafeZoneViolation = {
	column: ColumnId;
	edge: 'top' | 'bottom';
	el: HTMLElement;
	/** Distance from the violated boundary in px (how far inside the zone). */
	distancePx: number;
};

/** Full analysis result for one page. */
export type AlignReport = {
	sidebarLandmarks: Landmark[];
	mainLandmarks: Landmark[];
	pairs: AlignPair[];
	violations: SafeZoneViolation[];
	/**
	 * Extra gap to add to the **sidebar** column gap var to snap the best
	 * near-aligned pair. 0 when no actionable pair is found.
	 */
	alignExtraSidebarPx: number;
	/**
	 * Extra gap to add to the **main** column gap var. Exactly one of the
	 * two is non-zero per report; the lagging column receives the adjustment.
	 */
	alignExtraMainPx: number;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function isVisible(el: HTMLElement): boolean {
	const st = getComputedStyle(el);
	if (st.display === 'none' || st.visibility === 'hidden') {
		return false;
	}
	const r = el.getBoundingClientRect();
	return r.height > 0.5;
}

// ─── Landmark collection ──────────────────────────────────────────────────────

/**
 * Collects section-label Y positions within a column, relative to the page
 * border-box top. Only visible, non-print-hidden elements are included.
 */
function collectLandmarks(
	col: HTMLElement,
	page: HTMLElement,
	colId: ColumnId,
): Landmark[] {
	const pageRect = page.getBoundingClientRect();
	const out: Landmark[] = [];

	const labels = col.querySelectorAll<HTMLElement>('.section-label');
	for (let i = 0; i < labels.length; i++) {
		const el = labels[i];
		if (!isVisible(el) || el.closest('.no-print') !== null) {
			continue;
		}
		out.push({
			el,
			yPage: el.getBoundingClientRect().top - pageRect.top,
			column: colId,
		});
	}

	return out;
}

// ─── Alignment pair detection ─────────────────────────────────────────────────

/**
 * For each sidebar landmark, finds the nearest main-column landmark within
 * ALIGN_THRESHOLD_PX. Each sidebar landmark produces at most one pair.
 */
function findAlignPairs(
	sbLandmarks: Landmark[],
	mnLandmarks: Landmark[],
): AlignPair[] {
	const pairs: AlignPair[] = [];

	for (let si = 0; si < sbLandmarks.length; si++) {
		const sb = sbLandmarks[si];
		let best: Landmark | null = null;
		let bestAbs = Infinity;

		for (let mi = 0; mi < mnLandmarks.length; mi++) {
			const mn = mnLandmarks[mi];
			const abs = Math.abs(mn.yPage - sb.yPage);
			if (abs <= ALIGN_THRESHOLD_PX && abs < bestAbs) {
				best = mn;
				bestAbs = abs;
			}
		}

		if (best !== null) {
			pairs.push({
				sidebar: sb,
				main: best,
				delta: best.yPage - sb.yPage,
			});
		}
	}

	return pairs;
}

// ─── Adjustment computation ───────────────────────────────────────────────────

/**
 * Chooses the most actionable pair (smallest absolute delta, easiest to snap)
 * and returns the incremental extra-gap amounts for each column.
 *
 * Only one of the returned values is non-zero: the lagging column receives the
 * adjustment so its section label rises to meet the leading column.
 *
 * Returns {0, 0} when:
 *  - no pairs exist
 *  - best delta is below noise threshold
 *  - best delta exceeds ALIGN_STEP_MAX_PX (too large, would distort rhythm)
 */
function computeAdjustments(pairs: AlignPair[]): {
	sidebarExtraPx: number;
	mainExtraPx: number;
} {
	if (pairs.length === 0) {
		return { sidebarExtraPx: 0, mainExtraPx: 0 };
	}

	// Select pair with smallest absolute delta
	let target = pairs[0];
	let targetAbs = Math.abs(pairs[0].delta);
	for (let i = 1; i < pairs.length; i++) {
		const abs = Math.abs(pairs[i].delta);
		if (abs < targetAbs) {
			target = pairs[i];
			targetAbs = abs;
		}
	}

	if (targetAbs < ALIGN_MIN_DELTA_PX || targetAbs > ALIGN_STEP_MAX_PX) {
		return { sidebarExtraPx: 0, mainExtraPx: 0 };
	}

	if (target.delta > 0) {
		// Main label is below sidebar label → add gap to sidebar
		return { sidebarExtraPx: targetAbs, mainExtraPx: 0 };
	} else {
		// Sidebar label is below main label → add gap to main
		return { sidebarExtraPx: 0, mainExtraPx: targetAbs };
	}
}

// ─── Safe-zone validation ─────────────────────────────────────────────────────

/**
 * Checks whether direct content children of each column land within the
 * safe-zone boundaries. The sidebar tail spacer is excluded.
 *
 * @param pagePx  The logical page height in px. Use A4_HEIGHT_MM * MM_TO_PX
 *                for both print and preview contexts.
 */
function validateSafeZones(
	page: HTMLElement,
	sidebar: HTMLElement,
	main: HTMLElement,
	pagePx: number,
): SafeZoneViolation[] {
	const violations: SafeZoneViolation[] = [];
	const pageRect = page.getBoundingClientRect();

	function checkColumn(col: HTMLElement, colId: ColumnId): void {
		const kids = col.children;
		for (let i = 0; i < kids.length; i++) {
			const el = kids[i] as HTMLElement;
			if (!isVisible(el)) continue;
			if (el.classList.contains('cv-sidebar-tail-spacer')) continue;

			const r = el.getBoundingClientRect();
			const topRel    = r.top    - pageRect.top;
			const bottomRel = r.bottom - pageRect.top;

			// Top zone: content begins too close to the page top
			if (topRel > 0 && topRel < SAFE_TOP_PX) {
				violations.push({
					column:     colId,
					edge:       'top',
					el,
					distancePx: topRel,
				});
			}

			// Bottom zone: content ends too close to the page bottom
			if (bottomRel > pagePx - SAFE_BOTTOM_PX && bottomRel <= pagePx + 1) {
				violations.push({
					column:     colId,
					edge:       'bottom',
					el,
					distancePx: Math.max(0, pagePx - bottomRel),
				});
			}
		}
	}

	checkColumn(sidebar, 'sidebar');
	checkColumn(main, 'main');
	return violations;
}

// ─── Gap cap ──────────────────────────────────────────────────────────────────

/**
 * Clamps a gap value to BASE × MAX_GAP_RATIO.
 * Pass the base gap px for the column type (BASE_MAIN_GAP_PX or
 * BASE_SIDEBAR_GAP_PX). Returns the capped value; may equal `currentGapPx`
 * if already within the limit.
 */
export function enforcedGapCap(
	currentGapPx: number,
	baseGapPx: number,
): number {
	return Math.min(currentGapPx, baseGapPx * MAX_GAP_RATIO);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Full cross-column alignment analysis for one page.
 *
 * The caller (cv-layout-engine) must ensure:
 *  - The page is NOT in `cv-layout-measure-intrinsic` mode.
 *  - All relevant slack CSS variables have already been applied and at least
 *    one `requestAnimationFrame` has settled.
 *
 * @param page     The `.cv-page` element for this page
 * @param sidebar  The `#cv-sidebar-{1|2}` element
 * @param main     The `#cv-main-{1|2}` element
 * @param pagePx   Logical page height in px (typically A4_H_PX)
 */
export function analysePageAlignment(
	page: HTMLElement,
	sidebar: HTMLElement,
	main: HTMLElement,
	pagePx: number = A4_H_PX,
): AlignReport {
	const sbLandmarks = collectLandmarks(sidebar, page, 'sidebar');
	const mnLandmarks = collectLandmarks(main,    page, 'main');
	const pairs       = findAlignPairs(sbLandmarks, mnLandmarks);
	const adj         = computeAdjustments(pairs);
	const violations  = validateSafeZones(page, sidebar, main, pagePx);

	return {
		sidebarLandmarks:   sbLandmarks,
		mainLandmarks:      mnLandmarks,
		pairs,
		violations,
		alignExtraSidebarPx: adj.sidebarExtraPx,
		alignExtraMainPx:    adj.mainExtraPx,
	};
}
