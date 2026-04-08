/**
 * layout-candidate.ts
 *
 * Defines the canonical LayoutCandidate struct that covers every layout axis,
 * and provides the constraint-driven generator that produces only structurally
 * valid candidates before any reflow is attempted.
 *
 * The engine (layout-engine.ts) owns all DOM mutations and reflow
 * measurements. This module is purely declarative: it works with types,
 * profiles, and arithmetic — never touches the DOM.
 *
 * Axes encoded in LayoutCandidate
 * ────────────────────────────────
 *   pages            1 or 2 printed pages
 *   pageSplitWork    how many work entries appear on page 1
 *   mastheadMode     which masthead topology to use
 *   sidebarMm        sidebar grid track width in mm (continuous)
 *   sections         placement of each movable section
 *   p1FooterCols     column count of page-1 footer (0 = footer hidden)
 *   p2FooterCols     column count of page-2 footer (0 = footer hidden)
 *
 * Hard constraints (applied during generation, before any reflow)
 * ───────────────────────────────────────────────────────────────
 *   C1  pageSplitWork = workCount on single-page; 1…workCount-1 on two-page
 *   C2  p1-footer placement only valid on single-page candidates
 *       p2-footer placement only valid on two-page candidates
 *   C3  footer col count = section count in that footer
 *   C4  Each section must fit in its assigned column: fitsInColumn(profile, colMm)
 *   C5  Sidebar must contain at least one movable section on two-page p2
 *       (prevents Skills/Lang/Int all moving to footer, leaving sidebar empty)
 *   C6  On two-page candidates only the multi-page default topology variant
 *       is allowed (single-page may try rescue variants)
 *
 * Soft constraints (contribute to widthAffinityPenalty score)
 * ────────────────────────────────────────────────────────────
 *   S1  Footer with 1 section whose widthSensitivity is very low looks stranded
 *   S2  Section placed wider than maxComfortableWidthMm → quadratic penalty
 *   S3  Section placed narrower than minUsefulWidthMm → quadratic penalty
 *   S4  Single-page: non-default topology variant slightly penalised
 */

import {
	type SectionId,
	type SectionProfile,
	type SectionProfileMap,
	type ProbeWidthMm,
	PROBE_WIDTHS_MM,
	recommendedSidebarWidthMm,
	MIN_SIDEBAR_MM,
	MAX_SIDEBAR_MM,
	MM_TO_PX,
} from '@lib/engine/layout-profile';

// ─── Re-export types the engine imports from here ─────────────────────────────

export type { SectionId, SectionProfile, SectionProfileMap };

// ─── Constants ────────────────────────────────────────────────────────────────

/** A4 page width in mm. */
const A4_MM = 210;

/**
 * Approximate combined horizontal padding inside .blemmy-main (print mode).
 * Used to compute footer column content width from track width.
 * 8.5mm × 2 sides = 17mm (matches --print-main-padding default).
 */
const MAIN_H_PAD_MM = 17;

/**
 * Approximate gap between footer columns (auto-fit grid gap).
 * ~1.15rem ≈ 5mm at 10pt root (matches gap in #blemmy-page-*-body-footer).
 */
const FOOTER_COL_GAP_MM = 5;

/**
 * Masthead rescue modes incur a small preference penalty: we prefer the
 * full masthead when a single-page fit is possible. Score is additive.
 */
const MASTHEAD_RESCUE_PENALTY = 8;

/**
 * A single-section footer with a very narrow section (widthSensitivity < 0.1)
 * placed in a wide slot incurs a "stranded" penalty on top of the quadratic
 * width-affinity penalty.
 */
const STRANDED_PENALTY = 15;

// ─── Candidate types ──────────────────────────────────────────────────────────

/**
 * Topology variant ID for the primary header/search zone.
 * @deprecated Prefer plain string; alias kept for older call sites.
 */
export type MastheadMode = string;

export type MovableSectionPlacement =
	| 'sidebar'   // stays in sidebar-1 (single-page) or sidebar-2 (two-page)
	| 'p1-footer' // moves to #blemmy-page-1-body-footer  (single-page only)
	| 'p2-footer' // moves to #blemmy-page-2-body-footer  (two-page only)

/**
 * Generic map of section name → placement.
 * Used by the engine to represent which sections go where, without
 * encoding the specific section names (skills, languages, interests).
 */
export type MovableSectionMap = Record<string, MovableSectionPlacement>;

/**
 * @deprecated Use MovableSectionMap. Kept for backwards compatibility
 * with CVLayoutSnapshot which still uses the named-key form.
 */
export type MovableSections = MovableSectionMap;

export type LayoutCandidate = {
	/** Unique descriptive label — used as a key and for console output. */
	readonly id: string;
	readonly pages:          1 | 2;
	/** Number of work entries on page 1 (equals workCount on single-page). */
	readonly pageSplitWork:  number;
	/** Zone topology variant ID. Empty string = default variant. */
	readonly mastheadMode:   string;
	/** First variant in the search axis for this page count (for scoring C6 / affinity). */
	readonly _defaultVariant?: string;
	/** Sidebar grid track width in mm. */
	readonly sidebarMm:      number;
	readonly sections:       MovableSectionMap;
	/** Columns in page-1 body footer; 0 = footer hidden. */
	readonly p1FooterCols:   0 | 1 | 2 | 3;
	/** Columns in page-2 body footer; 0 = footer hidden. */
	readonly p2FooterCols:   0 | 1 | 2 | 3;
};

export type CandidateGenerationDiagnostics = {
	totalCombinations: number;
	accepted: number;
	rejected: number;
	rejectionsByRule: Record<string, number>;
};

// ─── Derived geometry ─────────────────────────────────────────────────────────

/** Main column track width in mm for a given sidebar width. */
export function mainTrackMm(sidebarMm: number): number {
	return A4_MM - sidebarMm;
}

/**
 * Effective content width of a single footer column in mm.
 * Accounts for horizontal padding inside .blemmy-main and gaps between columns.
 */
export function footerColContentMm(
	sidebarMm: number,
	cols: 1 | 2 | 3,
): number {
	const trackMm = mainTrackMm(sidebarMm) - MAIN_H_PAD_MM;
	const gapsMm  = FOOTER_COL_GAP_MM * (cols - 1);
	return Math.max(1, (trackMm - gapsMm) / cols);
}

// ─── Section-to-ID mapping ────────────────────────────────────────────────────

// Section DOM IDs and movable keys are no longer hardcoded here.
// They are injected via the sectionDomIds parameter to generateCandidates()
// and related functions. The CV application provides these via CV_DOCUMENT_SPEC.

function sectionsInPlacement(
	sections:  MovableSectionMap,
	placement: MovableSectionPlacement,
): string[] {
	return Object.keys(sections).filter((k) => sections[k] === placement);
}

// ─── Sidebar width ────────────────────────────────────────────────────────────

/**
 * Derives the recommended sidebar width for a candidate from the profiles of
 * sections assigned to the sidebar, plus Education (always in sidebar).
 */
function candidateSidebarMm(
	sections:         MovableSectionMap,
	profiles:         SectionProfileMap,
	pages:            1 | 2,
	sectionDomIds:    Record<string, string>,
	alwaysSidebarIds: string[],
): number {
	// Sections in sidebar for this candidate
	const inSidebar: SectionId[] = [...alwaysSidebarIds];
	for (const k of Object.keys(sections)) {
		if (sections[k] === 'sidebar') {
			inSidebar.push(sectionDomIds[k]);
		}
	}
	// On single-page, all sidebar sections merge into sidebar-1
	// On two-page, sidebar-2 sections don't constrain sidebar-1 width
	// but we use the same width for both pages (engine constraint)
	const base = recommendedSidebarWidthMm(profiles, inSidebar);
	return Math.min(Math.max(base, MIN_SIDEBAR_MM), MAX_SIDEBAR_MM);
}

// ─── Hard constraint checks ───────────────────────────────────────────────────

function colCount(n: number): 0 | 1 | 2 | 3 {
	if (n === 0) { return 0; }
	if (n === 1) { return 1; }
	if (n === 2) { return 2; }
	return 3;
}

/**
 * Checks all hard constraints for a proposed candidate configuration.
 * Returns null if valid (no violations), or a reason string if invalid.
 */
function hardConstraintViolation(
	pages:            1 | 2,
	pageSplitWork:    number,
	workCount:        number,
	mastheadMode:     string,
	sections:         MovableSectionMap,
	sidebarMm:        number,
	profiles:         SectionProfileMap,
	sectionDomIds:    Record<string, string>,
	alwaysSidebarIds: string[],
	twoPageDefaultMasthead: string,
): string | null {
	function fitsHardMin(p: SectionProfile, widthMm: number): boolean {
		return widthMm >= p.minUsefulWidthMm;
	}

	// C1: page split
	if (pages === 1 && pageSplitWork !== workCount) {
		return 'C1: single-page requires pageSplitWork === workCount';
	}
	if (pages === 2 && (pageSplitWork < 1 || pageSplitWork >= workCount)) {
		return 'C1: two-page requires pageSplitWork in [1, workCount-1]';
	}

	// C2: footer placement page-consistency
	for (const k of Object.keys(sectionDomIds)) {
		if (pages === 1 && sections[k] === 'p2-footer') {
			return 'C2: p2-footer placement not valid on single-page';
		}
		if (pages === 2 && sections[k] === 'p1-footer') {
			return 'C2: p1-footer placement not valid on two-page';
		}
	}

	// C3 + C4: footer columns = section count, and each section fits its slot
	const p1Secs = sectionsInPlacement(sections, 'p1-footer');
	const p2Secs = sectionsInPlacement(sections, 'p2-footer');

	if (p1Secs.length > 3) { return 'C3: too many sections in p1-footer'; }
	if (p2Secs.length > 3) { return 'C3: too many sections in p2-footer'; }

	if (p1Secs.length > 0) {
		const cols   = colCount(p1Secs.length) as 1 | 2 | 3;
		const colMm  = footerColContentMm(sidebarMm, cols);
		for (const k of p1Secs) {
			const p = profiles.get(sectionDomIds[k]);
			if (p && !fitsHardMin(p, colMm)) {
				return `C4: ${k} does not fit in p1-footer at ${colMm.toFixed(1)}mm`;
			}
		}
	}

	if (p2Secs.length > 0) {
		const cols   = colCount(p2Secs.length) as 1 | 2 | 3;
		const colMm  = footerColContentMm(sidebarMm, cols);
		for (const k of p2Secs) {
			const p = profiles.get(sectionDomIds[k]);
			if (p && !fitsHardMin(p, colMm)) {
				return `C4: ${k} does not fit in p2-footer at ${colMm.toFixed(1)}mm`;
			}
		}
	}

	// C4: sidebar sections must fit in sidebarMm
	const sbSecs = sectionsInPlacement(sections, 'sidebar');
	for (const k of sbSecs) {
		const p = profiles.get(sectionDomIds[k]);
		if (p && !fitsHardMin(p, sidebarMm)) {
			return `C4: ${k} does not fit in sidebar at ${sidebarMm.toFixed(1)}mm`;
		}
	}
	// Always-sidebar sections — check they all fit
	for (const sId of alwaysSidebarIds) {
		const alwaysP = profiles.get(sId);
		if (alwaysP && !fitsHardMin(alwaysP, sidebarMm)) {
			return `C4: ${sId} does not fit in sidebar at ${sidebarMm.toFixed(1)}mm`;
		}
	}
	const eduProfile = profiles.get('blemmy-education'); // legacy compat check
	if (eduProfile && !fitsHardMin(eduProfile, sidebarMm) && !alwaysSidebarIds.includes('blemmy-education')) {
		return `C4: education does not fit in sidebar at ${sidebarMm.toFixed(1)}mm`;
	}

	// C5: two-page sidebar-2 must have at least one section
	if (pages === 2) {
		const inSidebar2 = Object.keys(sectionDomIds).filter((k) => sections[k] === 'sidebar');
		if (inSidebar2.length === 0) {
			return 'C5: sidebar-2 would be empty on two-page layout';
		}
	}

	// C6: non-default topology variants only on single-page
	if (pages === 2 && mastheadMode !== twoPageDefaultMasthead) {
		return 'C6: non-default topology variants only valid on single-page';
	}

	return null; // all constraints satisfied
}

// ─── Candidate generation ─────────────────────────────────────────────────────

/**
 * Generates all structurally valid LayoutCandidates for the given content
 * configuration, pruned by hard constraints using section profiles.
 *
 * The returned array is ordered by heuristic quality (fewer rescue modes
 * first, most content-preserving dispositions first) so the engine can
 * short-circuit once a sufficiently good candidate is found.
 *
 * @param workCount   Total number of work entries in blemmy-content.json
 * @param profiles    Section profile map from profileAllSections()
 */
export function generateCandidates(
	workCount:        number,
	profiles:         SectionProfileMap,
	sectionDomIds:    Record<string, string>,
	alwaysSidebarIds: string[],
	zoneVariantIds?:  Record<string, string[]>,
	multiPageDefaults?: Record<string, string>,
	diagnostics?:     CandidateGenerationDiagnostics,
): LayoutCandidate[] {
	const candidates: LayoutCandidate[] = [];
	const diag: CandidateGenerationDiagnostics = diagnostics ?? {
		totalCombinations: 0,
		accepted: 0,
		rejected: 0,
		rejectionsByRule: {},
	};

	const pagesOptions: (1 | 2)[] = [1, 2];

	const hasVariants = zoneVariantIds && Object.keys(zoneVariantIds).length > 0;
	const primaryZoneId = hasVariants ? Object.keys(zoneVariantIds!)[0] : null;
	const mastheadModes1: string[] = primaryZoneId
		? (zoneVariantIds![primaryZoneId] ?? ['full'])
		: ['full', 'profile-sidebar-meta', 'profile-main', 'classic'];
	const mastheadModes2: string[] = primaryZoneId
		? [(multiPageDefaults?.[primaryZoneId] ?? mastheadModes1[0])]
		: ['full'];
	const twoPageDefaultMasthead = mastheadModes2[0] ?? 'full';

	// All combinations of movable section placements we want to consider.
	// We enumerate only semantically distinct arrangements (not the full 3^3
	// power-set, which would include obviously invalid or uninteresting configs).
	const sectionArrangements: MovableSectionMap[] = buildSectionArrangements(Object.keys(sectionDomIds));

	for (const pages of pagesOptions) {
		const mastheadModes = pages === 1 ? mastheadModes1 : mastheadModes2;

		// Page-split options
		const splits: number[] = pages === 1
			? [workCount]
			: range(1, workCount - 1);

		for (const pageSplitWork of splits) {
			for (const sections of sectionArrangements) {
				for (const mastheadMode of mastheadModes) {
					// Derive sidebar width from profiles for this section arrangement
					const sidebarMm = candidateSidebarMm(sections, profiles, pages, sectionDomIds, alwaysSidebarIds);

					// Derive footer column counts from section placements
					const p1FooterSecs = sectionsInPlacement(sections, 'p1-footer');
					const p2FooterSecs = sectionsInPlacement(sections, 'p2-footer');
					const p1FooterCols = colCount(p1FooterSecs.length) as 0 | 1 | 2 | 3;
					const p2FooterCols = colCount(p2FooterSecs.length) as 0 | 1 | 2 | 3;

					// Hard constraint check
					const violation = hardConstraintViolation(
						pages, pageSplitWork, workCount, mastheadMode,
						sections, sidebarMm, profiles,
						sectionDomIds, alwaysSidebarIds,
						twoPageDefaultMasthead,
					);
					diag.totalCombinations += 1;
					if (violation !== null) {
						diag.rejected += 1;
						const rule = violation.split(':')[0];
						diag.rejectionsByRule[rule] = (diag.rejectionsByRule[rule] ?? 0) + 1;
						continue;
					}

					const id = buildCandidateId(
						pages,
						pageSplitWork,
						mastheadMode,
						sidebarMm,
						sections,
						Object.keys(sectionDomIds),
					);

					candidates.push({
						id,
						pages,
						pageSplitWork,
						mastheadMode,
						_defaultVariant: mastheadModes[0],
						sidebarMm,
						sections,
						p1FooterCols,
						p2FooterCols,
					});
					diag.accepted += 1;
				}
			}
		}
	}

	return candidates;
}

// ─── Section arrangement enumeration ─────────────────────────────────────────

/**
 * Returns the set of MovableSections arrangements we consider during search.
 *
 * Covers:
 *   - All three in sidebar (default)
 *   - Interests to footer only
 *   - Languages to footer only
 *   - Languages + Interests to footer
 *   - Skills to footer only (only makes sense when Skills is very small)
 *   - All three permutations of 1-section footer
 *   - 2-section footer combinations
 *
 * Does NOT enumerate arrangements where Skills leaves the sidebar alongside
 * Languages (sidebar would then only have Interests — unusual and rarely
 * better than any footer arrangement).
 */
/**
 * Returns all MovableSectionMap arrangements for the given section keys.
 * Generates all placement^N combinations (where N = sectionKeys.length)
 * and returns them as a flat array. Hard constraints in generateCandidates
 * prune structurally invalid ones before any reflow.
 */
function buildSectionArrangements(sectionKeys: string[]): MovableSectionMap[] {
	const placements: MovableSectionPlacement[] = ['sidebar', 'p1-footer', 'p2-footer'];

	function cartesian(keys: string[]): MovableSectionMap[] {
		if (keys.length === 0) { return [{}]; }
		const [first, ...rest] = keys as [string, ...string[]];
		const restArrangements = cartesian(rest);
		const result: MovableSectionMap[] = [];
		for (const placement of placements) {
			for (const restMap of restArrangements) {
				result.push({ [first]: placement, ...restMap });
			}
		}
		return result;
	}

	return cartesian(sectionKeys);
}

function range(from: number, to: number): number[] {
	const out: number[] = [];
	for (let i = from; i <= to; i++) { out.push(i); }
	return out;
}

function buildCandidateId(
	pages:         1 | 2,
	pageSplitWork: number,
	mastheadMode:  string,
	sidebarMm:     number,
	sections:      MovableSections,
	sectionKeys:   string[],
): string {
	const sectionParts = sectionKeys
		.map((k) => `${k[0]}:${sections[k][0]}`)  // e.g. "s:s l:p i:p"
		.join(' ');
	const mh = mastheadMode === 'full' ? '' : `·mh:${mastheadMode.replace('profile-', '')}`;
	return `p${pages}·split${pageSplitWork}·sb${Math.round(sidebarMm)}mm·${sectionParts}${mh}`;
}

// ─── Width-affinity scoring ───────────────────────────────────────────────────

/**
 * Computes the width-affinity penalty for a candidate given section profiles.
 * Returns a non-negative score — 0 means every section is in an ideal column.
 *
 * This score is added to the height-balance score computed by the engine
 * after reflowing the candidate. A candidate with near-perfect height balance
 * but terrible width affinity should lose to a slightly less balanced but
 * aesthetically appropriate one.
 *
 * Penalty components:
 *   - Quadratic excess: (actual - maxComfortable)²
 *   - Quadratic deficit: (minUseful - actual)²
 *   - Stranded bonus: extra penalty for a single list-like section in a wide col
 *   - Masthead rescue cost: slight preference for 'full' mode
 */
export function widthAffinityPenalty(
	candidate:     LayoutCandidate,
	profiles:      SectionProfileMap,
	sectionDomIds: Record<string, string>,
): number {
	let penalty = 0;

	function penaliseSection(
		k:     string,
		colMm: number,
	): void {
		const p = profiles.get(sectionDomIds[k]);
		if (!p) { return; }

		const excess  = Math.max(0, colMm - p.maxComfortableWidthMm);
		const deficit = Math.max(0, p.minUsefulWidthMm - colMm);
		penalty += (excess * excess + deficit * deficit) * 0.08;

		// Stranded: very insensitive section in a significantly oversized column
		if (
			p.widthSensitivity < 0.10 &&
			colMm > p.saturationWidthMm * 1.6
		) {
			penalty += STRANDED_PENALTY;
		}
	}

	const sbMm = candidate.sidebarMm;
	const mn   = mainTrackMm(sbMm);

	// Sidebar sections
	for (const k of sectionsInPlacement(candidate.sections, 'sidebar')) {
		penaliseSection(k, sbMm);
	}

	// P1 footer sections
	const p1fc = candidate.p1FooterCols;
	if (p1fc > 0) {
		const colMm = footerColContentMm(sbMm, p1fc as 1 | 2 | 3);
		for (const k of sectionsInPlacement(candidate.sections, 'p1-footer')) {
			penaliseSection(k, colMm);
		}
	}

	// P2 footer sections
	const p2fc = candidate.p2FooterCols;
	if (p2fc > 0) {
		const colMm = footerColContentMm(sbMm, p2fc as 1 | 2 | 3);
		for (const k of sectionsInPlacement(candidate.sections, 'p2-footer')) {
			penaliseSection(k, colMm);
		}
	}

	const defaultMh = candidate._defaultVariant ?? 'full';
	if (candidate.mastheadMode && candidate.mastheadMode !== defaultMh) {
		penalty += MASTHEAD_RESCUE_PENALTY;
	}

	return penalty;
}

// ─── Sidebar width binary search ──────────────────────────────────────────────

/**
 * Given a candidate's recommended sidebarMm, performs a focused binary search
 * in [recommended - margin, recommended + margin] to find the width that
 * minimises the probe score returned by the caller's reflow callback.
 *
 * The probe callback receives a candidate with its sidebarMm field replaced by
 * the trial width and should return a scalar score (lower = better). It is
 * called at most log2(2*margin/step)+1 times.
 *
 * Returns the best sidebar width found.
 *
 * @param base     Starting width in mm (from candidateSidebarMm)
 * @param margin   Search radius in mm (default 5mm)
 * @param step     Minimum step size (default 1mm)
 * @param probe    Score callback — lower is better
 */
export async function refineSidebarWidth(
	base:   number,
	probe:  (widthMm: number) => Promise<number>,
	margin: number = 5,
	step:   number = 1,
): Promise<number> {
	const lo   = Math.max(MIN_SIDEBAR_MM, Math.round(base - margin));
	const hi   = Math.min(MAX_SIDEBAR_MM, Math.round(base + margin));

	let bestMm    = base;
	let bestScore = await probe(base);

	// Coarse sweep first (2mm steps) to find the basin
	for (let w = lo; w <= hi; w += Math.max(2, step)) {
		if (w === base) { continue; }
		const score = await probe(w);
		if (score < bestScore) {
			bestScore = score;
			bestMm    = w;
		}
	}

	// Fine sweep in a ±2mm neighbourhood around the best coarse width
	const flo = Math.max(MIN_SIDEBAR_MM, bestMm - 2);
	const fhi = Math.min(MAX_SIDEBAR_MM, bestMm + 2);
	for (let w = flo; w <= fhi; w += step) {
		if (w === bestMm) { continue; }
		const score = await probe(w);
		if (score < bestScore) {
			bestScore = score;
			bestMm    = w;
		}
	}

	return bestMm;
}

// ─── Candidate scoring weights ────────────────────────────────────────────────

/**
 * Weights for combining the reflow-measured height-balance score (from the
 * engine) with the profile-based width-affinity score (from this module).
 *
 * The height score operates on a scale of 0–100+ (see scorePage2Balance in the
 * engine). The width-affinity score is calibrated to similar magnitude via the
 * 0.08 quadratic coefficient above. Equal weighting is a reasonable default;
 * increase AFFINITY_WEIGHT to make the engine more aggressive about rejecting
 * aesthetically inappropriate placements.
 */
export const HEIGHT_WEIGHT   = 1.0;
export const AFFINITY_WEIGHT = 1.2;

/**
 * Combined score for ranking candidates after reflow measurement.
 * Lower is better.
 * Weights default to the module constants so callers that don't have
 * preference state yet still work without changes.
 */
export function combinedScore(
	heightScore:   number,
	affinityScore: number,
	heightWeight:  number = HEIGHT_WEIGHT,
	affinityWeight: number = AFFINITY_WEIGHT,
): number {
	return heightScore * heightWeight + affinityScore * affinityWeight;
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

/**
 * Logs the candidate list and their affinity scores to the console.
 * Called before the reflow loop begins so the full search space is visible.
 */
export function logCandidates(
	candidates:    LayoutCandidate[],
	profiles:      SectionProfileMap,
	sectionDomIds: Record<string, string>,
): void {
	console.groupCollapsed(`[layout-candidate] ${candidates.length} candidates generated`);
	const rows = candidates.map((c) => {
		const sectionCols = Object.fromEntries(
			Object.keys(c.sections).map((k) => [k.slice(0, 4), c.sections[k][0]])
		);
		return {
			id:      c.id,
			pages:   c.pages,
			split:   c.pageSplitWork,
			mh:      c.mastheadMode,
			sb:      c.sidebarMm.toFixed(0) + 'mm',
			...sectionCols,
			p1fc:    c.p1FooterCols,
			p2fc:    c.p2FooterCols,
			affinity: widthAffinityPenalty(c, profiles, sectionDomIds).toFixed(1),
		};
	});
	console.table(rows);
	console.groupEnd();
}

// ─── Candidate clustering ─────────────────────────────────────────────────────

export type ScoredCandidate = {
	candidate:     LayoutCandidate;
	heightScore:   number;
	affinityScore: number;
	combined:      number;
};

/**
 * Groups scored candidates into perceptually distinct clusters, keeping only
 * the best-scoring member of each cluster.
 *
 * Fingerprint encodes what a human would notice visually: page count, masthead
 * visibility, and whether each movable section is in the sidebar or footer.
 *
 * Returns clusters sorted by combined score (best first), limited to
 * maxClusters, pruning any cluster whose score exceeds the top by > scoreGap.
 */
export function clusterCandidates(
	scored:      ScoredCandidate[],
	maxClusters: number = 4,
	scoreGap:    number = 60,
): ScoredCandidate[] {
	if (scored.length === 0) { return []; }

	const sorted   = [...scored].sort((a, b) => a.combined - b.combined);
	const topScore = sorted[0].combined;

	function fingerprint(c: LayoutCandidate): string {
		const sectionKey = Object.keys(c.sections)
			.map((k) => c.sections[k] === 'sidebar' ? 's' : 'f')
			.join('');
		const def = c._defaultVariant ?? 'full';
		const mh =
			(!c.mastheadMode || c.mastheadMode === def) ? 'full' : 'slim';
		return `${c.pages}p·${mh}·${sectionKey}`;
	}

	const seen = new Map<string, ScoredCandidate>();
	for (const s of sorted) {
		if (s.combined > topScore + scoreGap) { break; }
		const fp = fingerprint(s.candidate);
		if (!seen.has(fp)) { seen.set(fp, s); }
	}

	return Array.from(seen.values()).slice(0, maxClusters);
}

/**
 * Generates a short human-readable label for a scored candidate cluster.
 * Used by the CandidateSelector UI.
 */
export function clusterLabel(s: ScoredCandidate): string {
	const c = s.candidate;
	const parts: string[] = [];

	parts.push(c.pages === 1 ? '1 page' : '2 pages');

	const def = c._defaultVariant ?? 'full';
	if (c.mastheadMode && c.mastheadMode !== def) {
		parts.push(c.mastheadMode.replace(/-/g, ' '));
	}

	const inFooter = Object.keys(c.sections)
		.filter((k) => c.sections[k] !== 'sidebar');
	if (inFooter.length > 0) {
		parts.push(inFooter.map((k) => k.slice(0, 4)).join('+') + ' below');
	}

	if (c.sidebarMm <= 48) { parts.push('wide main'); }

	return parts.join(' · ');
}
