/**
 * cv-profile.ts
 *
 * Measures how each section's rendered height responds to container width
 * changes. From those measurements, derives:
 *
 *   widthSensitivity     0 = height invariant (list rows); 1 = highly elastic (prose)
 *   saturationWidthMm    width above which further increase gives <5% height saving
 *   minUsefulWidthMm     narrowest width before text wraps excessively (>40% jump)
 *   maxComfortableWidthMm widest width before content looks stranded (wasted whitespace)
 *
 * These four values feed directly into cv-candidate.ts:
 *   fitsInColumn(profile, widthMm) is the gate that every section-to-zone
 *   assignment must pass before a candidate is considered structurally valid.
 *
 * Measurement approach
 * ─────────────────────
 * Each section element is cloned into an off-screen container whose width is
 * forced to each probe value in turn. scrollHeight is read synchronously after
 * a forced reflow. The container is removed immediately after each probe.
 * No async required — these are pure style/layout queries.
 *
 * The profiling pass runs once at engine startup (before any DOM mutations)
 * and its results are cached. Re-running on resize is unnecessary because
 * content doesn't change; only column widths change, and those are exactly
 * what the profile describes.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const MM_TO_PX = 96 / 25.4;

/**
 * Probe widths in mm, covering the range from narrowest viable sidebar to
 * full main-column width on A4 with a standard sidebar.
 * Sorted narrow → wide.
 */
export const PROBE_WIDTHS_MM = [44, 52, 62, 75, 95, 120, 150] as const;
export type ProbeWidthMm = (typeof PROBE_WIDTHS_MM)[number];

/**
 * A section is considered to have stopped benefiting from additional width
 * when widening reduces its height by less than this fraction of the narrowest
 * probe height.
 */
const SATURATION_DELTA_FRACTION = 0.05;

/**
 * Going narrower triggers a "problem" when it increases height by more than
 * this fraction relative to the next-wider probe.
 */
const MIN_WIDTH_GROWTH_THRESHOLD = 0.40;

/**
 * Sections with widthSensitivity below this value are treated as "list-like"
 * content (rows with fixed natural width) for the stranding calculation.
 */
const LIST_SENSITIVITY_CUTOFF = 0.20;

/**
 * For list-like sections, max comfortable width = saturationWidth / this
 * value. A fill ratio below this value means the column is too wide and the
 * content looks stranded.
 * 0.55 → maxComf = saturation / 0.55 ≈ saturation × 1.82
 */
const LIST_FILL_THRESHOLD = 0.55;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Identifies a movable section by its DOM element ID. */
export type SectionId =
	| 'cv-rebalance-skills'
	| 'cv-rebalance-languages'
	| 'cv-rebalance-interests'
	| 'cv-rebalance-profile'
	| 'cv-education'       // synthetic id for the education div in sidebar-1
	| string;              // fallback for work items etc.

export type SectionProfile = {
	readonly sectionId: SectionId;
	/** Measured scrollHeight in px at each probe width. */
	readonly heightByWidthMm: ReadonlyMap<ProbeWidthMm, number>;
	/**
	 * 0 = completely insensitive to width (e.g. a language list where every
	 * row is a single short line at all widths).
	 * 1 = strongly elastic (e.g. a long prose paragraph that halves in height
	 * when you double its width).
	 */
	readonly widthSensitivity: number;
	/**
	 * Width in mm above which additional width yields less than 5% height
	 * reduction. Below this the section is meaningfully width-constrained.
	 */
	readonly saturationWidthMm: number;
	/**
	 * Narrowest width in mm before height grows by >40% vs the next-wider
	 * probe. Placing the section in a column narrower than this will cause
	 * excessive line-wrapping.
	 */
	readonly minUsefulWidthMm: number;
	/**
	 * Widest width in mm before the content looks stranded (line-fill ratio
	 * too low for the column width). For prose, this is effectively infinite.
	 * For list-like content, it is approximately saturationWidth / 0.55.
	 */
	readonly maxComfortableWidthMm: number;
};

/** Map from section ID to its profile. Built once per layout engine init. */
export type SectionProfileMap = ReadonlyMap<SectionId, SectionProfile>;

// ─── Placement gate ───────────────────────────────────────────────────────────

/**
 * Returns true if this section is comfortable at the given column width.
 * Used as a hard constraint in candidate generation.
 */
export function fitsInColumn(profile: SectionProfile, widthMm: number): boolean {
	return (
		widthMm >= profile.minUsefulWidthMm &&
		widthMm <= profile.maxComfortableWidthMm
	);
}

/**
 * Returns a human-readable summary of what column widths are acceptable.
 * Useful for console diagnostics.
 */
export function columnRangeLabel(profile: SectionProfile): string {
	const max = profile.maxComfortableWidthMm >= 500
		? '∞'
		: profile.maxComfortableWidthMm.toFixed(0) + 'mm';
	return `[${profile.minUsefulWidthMm.toFixed(0)}mm – ${max}]`;
}

// ─── Off-screen measurement ───────────────────────────────────────────────────

/**
 * Creates a hidden off-screen container of the given pixel width.
 * The container mimics the essential font/sizing context used in print mode
 * (10pt base, DM Sans, hyphens off) so measurements match rendered output.
 *
 * The caller is responsible for appending it to document.body and removing it.
 */
function createMeasureContainer(widthPx: number): HTMLDivElement {
	const div = document.createElement('div');
	div.setAttribute('aria-hidden', 'true');
	div.style.cssText = [
		'position:absolute',
		'left:-99999px',
		'top:-99999px',
		`width:${widthPx}px`,
		'overflow:hidden',
		'visibility:hidden',
		'pointer-events:none',
		// Mirror print-surface root so rem/pt measurements are consistent
		'font-size:10pt',
		'line-height:1.4',
		'font-family:"DM Sans",system-ui,sans-serif',
		'hyphens:none',
		'-webkit-hyphens:none',
		'box-sizing:border-box',
	].join(';');
	return div;
}

/**
 * Measures the scrollHeight of el when its container is exactly widthPx wide.
 * Uses a deep clone so the original element is never disturbed.
 * Synchronous — forces a single reflow per call.
 */
function measureHeightAtWidthPx(el: HTMLElement, widthPx: number): number {
	const container = createMeasureContainer(widthPx);
	const clone = el.cloneNode(true) as HTMLElement;
	// Ensure the clone fills the container exactly
	clone.style.width = '100%';
	clone.style.maxWidth = '100%';
	clone.style.minWidth = '0';
	container.appendChild(clone);
	document.body.appendChild(container);
	// Force reflow
	void container.offsetHeight;
	const h = clone.scrollHeight;
	document.body.removeChild(container);
	return Math.max(h, 1); // never 0
}

// ─── Derived metrics ──────────────────────────────────────────────────────────

/**
 * widthSensitivity: fraction of the narrowest-probe height that is "released"
 * by going from the narrowest to the widest probe.
 *
 *   0.0 → height does not change at all (pure list rows)
 *   1.0 → widest probe height is 0 (impossible; indicates full elasticity)
 *
 * Using the narrowest probe as denominator makes the metric invariant to
 * absolute section size.
 */
function computeWidthSensitivity(heights: number[]): number {
	const hNarrow = heights[0];
	const hWide   = heights[heights.length - 1];
	if (hNarrow <= 0) { return 0; }
	return Math.max(0, Math.min(1, (hNarrow - hWide) / hNarrow));
}

/**
 * saturationWidthMm: smallest probe width where the next-wider probe reduces
 * height by less than SATURATION_DELTA_FRACTION of the narrowest-probe height.
 *
 * Returns the widest probe width if no saturation is detected (very elastic
 * content that keeps benefiting from width increases throughout the range).
 */
function computeSaturationWidthMm(
	heights: number[],
	probesMm: readonly number[],
): number {
	const hNarrow = heights[0];
	const delta   = hNarrow * SATURATION_DELTA_FRACTION;

	for (let i = 0; i < probesMm.length - 1; i++) {
		if (heights[i] - heights[i + 1] < delta) {
			// The step from probesMm[i] to probesMm[i+1] gives negligible saving
			// → content is already saturated at probesMm[i]
			return probesMm[i];
		}
	}
	// Content benefits from every width increase in range; cap at widest probe
	return probesMm[probesMm.length - 1];
}

/**
 * minUsefulWidthMm: widest probe where going narrower causes a height jump
 * exceeding MIN_WIDTH_GROWTH_THRESHOLD.
 *
 * Walking wide→narrow, we find steps where h[i-1] > h[i] × (1 + threshold).
 * The minimum is the wider probe of the last such problematic step — meaning
 * "don't go narrower than this."
 *
 * Returns the narrowest probe if no problematic step is found (section is
 * comfortable at all widths).
 */
function computeMinUsefulWidthMm(
	heights: number[],
	probesMm: readonly number[],
): number {
	let minUseful = probesMm[0]; // default: narrowest probe is fine
	for (let i = 1; i < probesMm.length; i++) {
		// heights[i-1] is at probesMm[i-1] (narrower)
		// heights[i]   is at probesMm[i]   (wider)
		if (heights[i - 1] > heights[i] * (1 + MIN_WIDTH_GROWTH_THRESHOLD)) {
			// Going from probesMm[i] to probesMm[i-1] would increase height by >40%
			// → probesMm[i] is the safe minimum
			minUseful = Math.max(minUseful, probesMm[i]);
		}
	}
	return minUseful;
}

/**
 * maxComfortableWidthMm: beyond this width, the section looks stranded.
 *
 * For prose (widthSensitivity ≥ LIST_SENSITIVITY_CUTOFF): no stranding risk —
 * prose fills any column width by rewrapping. Returns a large sentinel value.
 *
 * For list-like content (low sensitivity): the "natural line width" is
 * approximated by saturationWidthMm (the width where content stops benefiting
 * from extra space, i.e. all rows fit on one line). A column much wider than
 * this has most of each line wasted.
 *
 * The column fill ratio at width W = saturationMm / W.
 * We require fill ratio ≥ LIST_FILL_THRESHOLD → maxComf = sat / threshold.
 *
 * A ramp on [0, cutoff] blends from pure-list to prose behaviour so there is
 * no hard discontinuity at the cutoff.
 */
function computeMaxComfortableWidthMm(
	widthSensitivity: number,
	saturationWidthMm: number,
): number {
	if (widthSensitivity >= LIST_SENSITIVITY_CUTOFF) {
		// Interpolate: at the cutoff, use the list formula; above it, relax rapidly
		const blend     = (widthSensitivity - LIST_SENSITIVITY_CUTOFF) / (1 - LIST_SENSITIVITY_CUTOFF);
		const listMax   = saturationWidthMm / LIST_FILL_THRESHOLD;
		const proseMax  = 999;
		return listMax + (proseMax - listMax) * blend * blend; // quadratic ease
	}
	// Pure list content
	return saturationWidthMm / LIST_FILL_THRESHOLD;
}

// ─── Section profiling ────────────────────────────────────────────────────────

/**
 * Profiles a single section element.
 * Runs PROBE_WIDTHS_MM.length synchronous reflows.
 * Element must be in the DOM (but need not be visible).
 */
export function profileSection(
	el: HTMLElement,
	sectionId: SectionId,
): SectionProfile {
	const heightByWidthMm = new Map<ProbeWidthMm, number>();

	// Collect heights at each probe width
	for (const probeMm of PROBE_WIDTHS_MM) {
		const probePx = probeMm * MM_TO_PX;
		heightByWidthMm.set(probeMm, measureHeightAtWidthPx(el, probePx));
	}

	const heights = PROBE_WIDTHS_MM.map((w) => heightByWidthMm.get(w) as number);

	const widthSensitivity    = computeWidthSensitivity(heights);
	const saturationWidthMm   = computeSaturationWidthMm(heights, PROBE_WIDTHS_MM);
	const minUsefulWidthMm    = computeMinUsefulWidthMm(heights, PROBE_WIDTHS_MM);
	const maxComfortableWidthMm = computeMaxComfortableWidthMm(widthSensitivity, saturationWidthMm);

	return {
		sectionId,
		heightByWidthMm,
		widthSensitivity,
		saturationWidthMm,
		minUsefulWidthMm,
		// Ensure max is always ≥ min (guards against degenerate measurement)
		maxComfortableWidthMm: Math.max(maxComfortableWidthMm, minUsefulWidthMm),
	};
}

// ─── Batch profiling ──────────────────────────────────────────────────────────

type ProfilableEls = {
	elSkills:    HTMLElement | null;
	elLang:      HTMLElement | null;
	elInt:       HTMLElement | null;
	elProfile:   HTMLElement | null;
	sidebar1:    HTMLElement;
};

/**
 * Profiles all movable/constraint-relevant sections in one pass.
 * Should be called before any DOM mutations (merge, move, etc.).
 * Returns a map from section ID to profile.
 *
 * Sections profiled:
 *   cv-rebalance-skills      → candidate for p2 sidebar or footer
 *   cv-rebalance-languages   → candidate for p2 sidebar or footer (list-like)
 *   cv-rebalance-interests   → candidate for p2 sidebar or footer (prose)
 *   cv-rebalance-profile     → must stay in wide column (masthead or main-1)
 *   cv-education             → sidebar-1, informs min sidebar width
 */
export function profileAllSections(els: ProfilableEls): SectionProfileMap {
	const map = new Map<SectionId, SectionProfile>();

	const toProfile: Array<[SectionId, HTMLElement | null]> = [
		['cv-rebalance-skills',    els.elSkills],
		['cv-rebalance-languages', els.elLang],
		['cv-rebalance-interests', els.elInt],
		['cv-rebalance-profile',   els.elProfile],
	];

	// Education: first direct div child of sidebar-1 (not the tail spacer)
	const eduDiv = Array.from(els.sidebar1.children).find(
		(c): c is HTMLElement =>
			c instanceof HTMLElement &&
			!c.classList.contains('cv-sidebar-tail-spacer'),
	) ?? null;
	toProfile.push(['cv-education', eduDiv]);

	for (const [id, el] of toProfile) {
		if (el == null) { continue; }
		map.set(id, profileSection(el, id));
	}

	return map;
}

// ─── Sidebar width recommendation ────────────────────────────────────────────

/**
 * Derives the optimal sidebar width from the profiles of all sections that
 * will reside in the sidebar, without any reflowing.
 *
 * The result is the narrowest width at which every sidebar section is still
 * comfortable (≥ its minUsefulWidthMm), rounded up to the nearest mm and
 * clamped to [MIN_SIDEBAR_MM, MAX_SIDEBAR_MM].
 *
 * The caller should then probe a small neighbourhood around this value (+/- a
 * few mm) to find the actual reflow-optimal width.
 */
export const MIN_SIDEBAR_MM = 44;
export const MAX_SIDEBAR_MM = 70;

export function recommendedSidebarWidthMm(
	profiles: SectionProfileMap,
	sidebarSectionIds: SectionId[],
): number {
	let minRequired = MIN_SIDEBAR_MM;
	for (const id of sidebarSectionIds) {
		const p = profiles.get(id);
		if (p == null) { continue; }
		minRequired = Math.max(minRequired, p.minUsefulWidthMm);
	}
	return Math.min(Math.ceil(minRequired), MAX_SIDEBAR_MM);
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

/**
 * Emits a concise console table of all profiled sections.
 * Intended to be called at the end of a layout pass when debug mode is active.
 */
export function logProfiles(profiles: SectionProfileMap): void {
	const rows: Record<string, string | number>[] = [];
	for (const [id, p] of profiles) {
		rows.push({
			section:       id.replace('cv-rebalance-', '').replace('cv-', ''),
			sensitivity:   Number(p.widthSensitivity.toFixed(2)),
			'sat (mm)':    Number(p.saturationWidthMm.toFixed(1)),
			'min (mm)':    Number(p.minUsefulWidthMm.toFixed(1)),
			'max (mm)':    p.maxComfortableWidthMm >= 500
				? '∞'
				: Number(p.maxComfortableWidthMm.toFixed(1)),
			range:         columnRangeLabel(p),
		});
	}
	console.groupCollapsed('[cv-profile] Section profiles');
	console.table(rows);
	console.groupEnd();
}
