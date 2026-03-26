/**
 * cv.ts
 * Type contracts for CV JSON (e.g. cv-demo.json, local cv-content.json).
 * Every component imports from here — never from the JSON directly without typing.
 */

import type { CVReview } from './cv-review';

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

export interface CVSkills {
	programming: string[];
	design_bim:  string[];
	strategic:   string[];
}

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
	| 'profile';

export type CVSidebarSectionId =
	| 'skills'
	| 'languages'
	| 'interests';

export type CVSkillsCategoryId =
	| 'programming'
	| 'design_bim'
	| 'strategic';

/**
 * Tracks which items and sections are hidden from the rendered CV.
 * Absent or empty arrays mean everything is visible (default state).
 * Hidden items remain in the JSON — they can be restored via the editor.
 */
export interface CVVisibility {
	/** Indices into the `work` array that are hidden from layout. */
	hiddenWork?:      number[];
	/** Indices into the `education` array that are hidden from layout. */
	hiddenEducation?: number[];
	/** Named sections hidden from layout. */
	hiddenSections?:  CVSectionId[];
	/** Preferred order of Page 2 sidebar sections. */
	sidebarOrder?: CVSidebarSectionId[];
	/** Preferred order of skill subsections. */
	skillsOrder?: CVSkillsCategoryId[];
}

export interface CVLayoutSnapshot {
	pages: 1 | 2;
	mastheadMode: 'full' | 'profile-sidebar-meta' | 'profile-main' | 'classic';
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
 * import raw from '@data/cv-demo.json';
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
	 * Optional review annotation layer.
	 * When present and active, review mode is available.
	 */
	review?: CVReview;
}
