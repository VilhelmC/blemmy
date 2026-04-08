/**
 * blemmy-prefs.ts
 *
 * Typed preference schema for the CV layout engine, with localStorage
 * persistence and a lightweight event bus so UI components and the engine
 * can stay in sync without direct coupling.
 *
 * Preferences affect the engine's search behaviour but never override hard
 * constraints — they tune the scoring and the search space, not the rules.
 *
 *   maxDensity       0–3. Upper bound on the density level the single-page
 *                    search is allowed to apply. 0 = spacious typography only;
 *                    3 = allow maximum compaction. Default 3.
 *
 *   affinityWeight   0.5–2.5. Multiplier on the width-affinity penalty term.
 *                    Low = engine accepts aesthetically sub-optimal column
 *                    placements if they improve height balance. High = engine
 *                    strongly resists placing list-like content in oversized
 *                    columns even at the cost of height balance. Default 1.2.
 *
 *   pagePreference   'prefer-1' | 'auto' | 'prefer-2'.
 *                    prefer-1: single-page candidates searched first; two-page
 *                              only used as fallback (original behaviour).
 *                    auto:     all candidates across both page counts are
 *                              scored together; best combined score wins.
 *                    prefer-2: single-page search skipped entirely.
 *                    Default: 'prefer-1'.
 */

// ─── Schema ───────────────────────────────────────────────────────────────────

export type PagePreference = 'prefer-1' | 'auto' | 'prefer-2';

export type CvPreferences = {
	/** 0 = spacious, 3 = most compact. Upper bound for single-page search. */
	maxDensity:      0 | 1 | 2 | 3;
	/** Width-affinity penalty multiplier. 0.5 = flexible, 2.5 = strict. */
	affinityWeight:  number;
	/** Whether to bias toward fewer or more pages. */
	pagePreference:  PagePreference;
};

export const PREFS_DEFAULTS: CvPreferences = {
	maxDensity:     3,
	affinityWeight: 1.2,
	pagePreference: 'prefer-1',
};

// ─── Validation ───────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

/** Validates and clamps a raw prefs object. Safe to call on untrusted input. */
export function validatePrefs(raw: unknown): CvPreferences {
	if (raw == null || typeof raw !== 'object') { return { ...PREFS_DEFAULTS }; }
	const r = raw as Record<string, unknown>;

	const densityRaw = Number(r.maxDensity ?? PREFS_DEFAULTS.maxDensity);
	const density    = [0, 1, 2, 3].includes(Math.round(densityRaw))
		? (Math.round(densityRaw) as 0 | 1 | 2 | 3)
		: PREFS_DEFAULTS.maxDensity;

	const affinity = clamp(
		typeof r.affinityWeight === 'number' ? r.affinityWeight : PREFS_DEFAULTS.affinityWeight,
		0.5,
		2.5,
	);

	const pagePrefs: PagePreference[] = ['prefer-1', 'auto', 'prefer-2'];
	const pagePref = pagePrefs.includes(r.pagePreference as PagePreference)
		? (r.pagePreference as PagePreference)
		: PREFS_DEFAULTS.pagePreference;

	return { maxDensity: density, affinityWeight: affinity, pagePreference: pagePref };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'blemmy-layout-prefs';

export function loadPrefs(): CvPreferences {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) { return { ...PREFS_DEFAULTS }; }
		return validatePrefs(JSON.parse(raw));
	} catch {
		return { ...PREFS_DEFAULTS };
	}
}

export function savePrefs(prefs: CvPreferences): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
	} catch {
		// localStorage may be unavailable (private mode, storage quota)
	}
}

export function resetPrefs(): CvPreferences {
	try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
	return { ...PREFS_DEFAULTS };
}

// ─── Event bus ────────────────────────────────────────────────────────────────

/**
 * Dispatched on window when the user changes a preference via the UI.
 * The engine listens for this and schedules a re-layout.
 */
export const PREFS_CHANGED_EVENT = 'blemmy-prefs-changed';

export type PrefsChangedDetail = { prefs: CvPreferences };

export function dispatchPrefsChanged(prefs: CvPreferences): void {
	window.dispatchEvent(
		new CustomEvent<PrefsChangedDetail>(PREFS_CHANGED_EVENT, {
			detail: { prefs },
		}),
	);
}

/**
 * Dispatched on window by the engine when it has found multiple meaningfully
 * distinct layout alternatives. The CandidateSelector listens for this.
 */
export const ALTERNATIVES_READY_EVENT = 'blemmy-alternatives-ready';

export type AlternativeOption = {
	/** Unique ID matching LayoutCandidate.id of the cluster's best member. */
	candidateId:  string;
	/** Short human-readable description, e.g. "1 page · spacious" */
	label:        string;
	/** Combined score — lower is better. Used to order the options. */
	score:        number;
	/** Whether this is the currently active (engine-chosen) option. */
	active:       boolean;
};

export type AlternativesReadyDetail = { options: AlternativeOption[] };

export function dispatchAlternativesReady(options: AlternativeOption[]): void {
	window.dispatchEvent(
		new CustomEvent<AlternativesReadyDetail>(ALTERNATIVES_READY_EVENT, {
			detail: { options },
		}),
	);
}

/**
 * Dispatched on window when the user selects an alternative via the radio UI.
 * The engine listens for this and applies the chosen candidate.
 */
export const ALTERNATIVE_SELECTED_EVENT = 'blemmy-alternative-selected';

export type AlternativeSelectedDetail = { candidateId: string };

export function dispatchAlternativeSelected(candidateId: string): void {
	window.dispatchEvent(
		new CustomEvent<AlternativeSelectedDetail>(ALTERNATIVE_SELECTED_EVENT, {
			detail: { candidateId },
		}),
	);
}

// ─── Label helpers ────────────────────────────────────────────────────────────

/** Density level → concise human label. */
export function densityLabel(level: number): string {
	return ['Spacious', 'Balanced', 'Compact', 'Dense'][level] ?? 'Dense';
}

/** affinityWeight → concise human label. */
export function affinityLabel(weight: number): string {
	if (weight <= 0.8)  { return 'Flexible'; }
	if (weight <= 1.4)  { return 'Balanced'; }
	if (weight <= 2.0)  { return 'Strict'; }
	return 'Very strict';
}

/** pagePreference → concise human label. */
export function pagePreferenceLabel(pref: PagePreference): string {
	const map: Record<PagePreference, string> = {
		'prefer-1': '1 page',
		'auto':     'Auto',
		'prefer-2': '2 pages',
	};
	return map[pref];
}
