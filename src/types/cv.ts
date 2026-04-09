/**
 * cv.ts
 * Type contracts for CV JSON (e.g. blemmy-demo.json, local blemmy-content.json).
 * Every component imports from here — never from the JSON directly without typing.
 */

import type { CVReview } from './review-types';
import type { RealisedLayout } from './document-type-spec';

// ─── Meta ────────────────────────────────────────────────────────────────────

export interface CVMeta {
	lastUpdated: string;   // ISO date string e.g. "2026-03-15"
	version:     string;
	language:    string;   // BCP-47 e.g. "en"
}

// ─── Basics ──────────────────────────────────────────────────────────────────

export interface CVBasics {
	name:        string;
	label:       string;   // Hybrid title / tagline
	email:       string;
	phone:       string;
	location:    string;
	nationality: string;
	born:        string;   // ISO date string e.g. "1991-10-28"
	summary:     string;
	/**
	 * Optional data URL (image/jpeg, image/png, or image/webp) after upload
	 * processing. Used in the app; cloud rows may reference {@link portraitSha256}
	 * instead to deduplicate storage.
	 */
	portraitDataUrl?: string;
	/** SHA-256 hex (64 chars) of portrait bytes; resolved via `cv_portrait_assets`. */
	portraitSha256?: string;
}

// ─── Education ───────────────────────────────────────────────────────────────

export interface CVEducation {
	institution: string;
	area:        string;
	degree:      string;
	startDate:   string;   // Year string e.g. "2020"
	endDate:     string;
	score?:      string;   // Optional — only KADK has a grade
	highlights:  string[];
	/** Optional tags for filtering (e.g. ["academic", "computational"]) */
	tags?:       string[];
}

// ─── Work ────────────────────────────────────────────────────────────────────

export interface CVWork {
	company:    string;
	position:   string;
	startDate:  string;
	endDate:    string;
	summary?:   string;   // Optional — not all roles have a summary line
	highlights: string[];
	/** Optional tags for filtering (e.g. ["research", "technical"]) */
	tags?:      string[];
}

// ─── Skills ──────────────────────────────────────────────────────────────────

/**
 * Skill groups are dynamic: each top-level key in `skills` is a category whose
 * value is a string array. Keys must not contain `.` (field paths); otherwise
 * `[a-zA-Z][a-zA-Z0-9_ -]*` (see validateSkills).
 */
export type CVSkills = Record<string, string[]>;

// ─── Languages ───────────────────────────────────────────────────────────────

export type FluencyLevel =
	| 'Native'
	| 'Fluent'
	| 'Professional Working Proficiency'
	| 'Conversational'
	| 'Basic';

export interface CVLanguage {
	language: string;
	fluency:  FluencyLevel;
}

// ─── Personal ────────────────────────────────────────────────────────────────

export interface CVPersonal {
	interests: string;
}

// ─── Visibility ──────────────────────────────────────────────────────────────

/**
 * Sections that can be hidden from the CV layout entirely.
 * 'profile' = the summary paragraph in the masthead.
 */
export type CVSectionId =
	| 'skills'
	| 'languages'
	| 'interests'
	| 'profile'
	| 'education';

export type CVSidebarSectionId =
	| 'skills'
	| 'languages'
	| 'interests';

/**
 * Tracks which items and sections are hidden from the rendered CV.
 * Absent or empty arrays mean everything is visible (default state).
 * Hidden items remain in the JSON — they can be restored via the editor.
 */
export interface CVVisibility {
	/**
	 * Unified slash-path hide buckets (see `blemmy-hidden-indices.ts`).
	 * When present alongside legacy fields, readers merge both.
	 */
	hiddenIndices?: Record<string, number[]>;
	/** Indices into the `work` array that are hidden from layout. */
	hiddenWork?:      number[];
	/** Indices into the `education` array that are hidden from layout. */
	hiddenEducation?: number[];
	/** Named sections hidden from layout. */
	hiddenSections?:  CVSectionId[];
	/** Preferred order of Page 2 sidebar sections. */
	sidebarOrder?: CVSidebarSectionId[];
	/** Preferred order of skill subsection keys (matches `Object.keys(skills)`). */
	skillsOrder?: string[];
	/**
	 * Work index (string key) → highlight indices hidden from layout.
	 * Indices refer to `work[i].highlights` in the source data.
	 */
	hiddenWorkHighlights?: Record<string, number[]>;
	/**
	 * Skill category key → skill tag indices hidden from layout
	 * (indices into `skills[category]`).
	 */
	hiddenSkillItems?: Record<string, number[]>;
	/**
	 * Education index (string key) → highlight indices hidden from layout.
	 */
	hiddenEducationHighlights?: Record<string, number[]>;
	/** Indices into `languages` hidden from layout. */
	hiddenLanguages?: number[];
}

/** Header topology stored in layout snapshots (legacy + cv.doctype v2 names). */
export type CVLayoutSnapshotMastheadMode =
	| 'full'
	| 'compact'
	| 'minimal'
	| 'strip'
	| 'profile-sidebar-meta'
	| 'profile-main'
	| 'classic';

export interface CVLayoutSnapshot {
	pages: 1 | 2;
	mastheadMode: CVLayoutSnapshotMastheadMode;
	sections: {
		skills: 'sidebar' | 'p1-footer' | 'p2-footer';
		languages: 'sidebar' | 'p1-footer' | 'p2-footer';
		interests: 'sidebar' | 'p1-footer' | 'p2-footer';
	};
	pageSplitWork: number;
	sidebarMm: number;
	density: 0 | 1 | 2 | 3;
	fill: 0 | 1 | 2 | 3;
	p1FooterCols: 0 | 1 | 2 | 3;
	p2FooterCols: 0 | 1 | 2 | 3;
}

// ─── Root ────────────────────────────────────────────────────────────────────

/**
 * The complete shape of a CV JSON document.
 * Import this as the return type whenever you import the JSON.
 *
 * @example
 * import type { CVData } from '@cv/cv';
 * import raw from '@data/blemmy-demo.json';
 * const cv = raw as CVData;
 */
export interface CVData {
	meta:        CVMeta;
	basics:      CVBasics;
	education:   CVEducation[];
	work:        CVWork[];
	skills:      CVSkills;
	languages:   CVLanguage[];
	personal:    CVPersonal;
	/** Optional — absence means everything visible. */
	visibility?: CVVisibility;
	/**
	 * Active tag filters. Empty / absent = show everything (minus manual hides).
	 * When set, only tagged items sharing at least one tag are shown.
	 * Untagged items always pass through.
	 */
	activeFilters?: string[];
	layoutSnapshot?: CVLayoutSnapshot;
	/**
	 * Generic solved layout (zone tree spec). When valid, share/readonly loads
	 * can skip the layout engine via applyRealisedLayout().
	 */
	realisedLayout?: RealisedLayout;
	/**
	 * Optional review annotation layer.
	 * When present and active, review mode is available.
	 */
	review?: CVReview;
}
