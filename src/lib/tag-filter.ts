/**
 * blemmy-filter.ts
 *
 * Pure functions for the tag-based filtering system.
 *
 * Design principles
 * ─────────────────
 * Tags filter *entries within lists* (work items, education entries).
 * Whole-section visibility is handled by CVVisibility (already built).
 * The two systems compose via resolveFilteredVisibility(), which merges
 * manual hides with tag-filter-computed hides into one visibility object
 * that the renderer consumes unchanged.
 *
 * Filtering rule
 * ──────────────
 * When activeFilters is non-empty, an item passes through if:
 *   (a) it has no tags at all — untagged content is never hidden by filters
 *   (b) at least one of its tags appears in activeFilters (OR logic)
 *
 * When activeFilters is empty or absent, no filtering is applied.
 *
 * This means a user can safely add tags incrementally — adding a tag to
 * one work item does not hide any other items until the user actually
 * activates a filter.
 */

import type { CVData, CVVisibility } from '@cv/cv';
import {
	denormalizeMergedHidden,
	mergeHiddenBuckets,
} from '@lib/blemmy-hidden-indices';
import { hashCvForAudit, layoutAuditLog } from '@lib/engine/layout-audit';

function cloneHiddenIndexMap(
	src: Record<string, number[]> | undefined,
): Record<string, number[]> {
	if (!src) {
		return {};
	}
	const out: Record<string, number[]> = {};
	for (const k of Object.keys(src)) {
		out[k] = [...(src[k] ?? [])];
	}
	return out;
}

// ─── Tag extraction ───────────────────────────────────────────────────────────

/**
 * Collects all unique tags from work and education items, sorted
 * alphabetically. Used to render the filter bar chips.
 */
export function extractAllTags(data: CVData): string[] {
	const set = new Set<string>();

	for (const item of data.work) {
		for (const tag of item.tags ?? []) { set.add(tag.toLowerCase().trim()); }
	}
	for (const item of data.education) {
		for (const tag of item.tags ?? []) { set.add(tag.toLowerCase().trim()); }
	}

	return Array.from(set).sort();
}

/**
 * Returns every tag that is currently "active" (i.e. passes the filter)
 * for a given item. Used to highlight matching tags in edit mode.
 */
export function activeTagsForItem(
	itemTags:      string[],
	activeFilters: string[],
): string[] {
	if (activeFilters.length === 0) { return itemTags; }
	return itemTags.filter((t) => activeFilters.includes(t.toLowerCase().trim()));
}

// ─── Visibility resolution ────────────────────────────────────────────────────

/**
 * Merges manual CVVisibility with tag-filter-computed hides.
 *
 * The returned object is a *new* merged visibility that the renderer
 * uses directly. Manual hides and filter hides are kept logically separate
 * (the source arrays in CVData are not mutated) but their union is what
 * controls what renders.
 *
 * @param data           The full CVData object (reads .visibility and
 *                       .activeFilters)
 * @param activeFilters  Current active filter tags. Pass data.activeFilters
 *                       ?? [] for the standard case. Passed separately so
 *                       callers can preview a filter state without mutating data.
 */
export function resolveFilteredVisibility(
	data:          CVData,
	activeFilters: string[],
): Required<CVVisibility> {
	const merged: Record<string, number[]> = {
		...mergeHiddenBuckets(data.visibility),
	};

	if (activeFilters.length > 0) {
		const filters = activeFilters.map((f) => f.toLowerCase().trim());

		const workH = new Set(merged.work ?? []);
		for (let i = 0; i < data.work.length; i++) {
			if (workH.has(i)) { continue; }
			const tags = data.work[i].tags ?? [];
			if (
				tags.length > 0 &&
				!tags.some((t) => filters.includes(t.toLowerCase().trim()))
			) {
				workH.add(i);
			}
		}
		merged.work = [...workH].sort((a, b) => a - b);
		if (merged.work.length === 0) { delete merged.work; }

		const eduH = new Set(merged.education ?? []);
		for (let i = 0; i < data.education.length; i++) {
			if (eduH.has(i)) { continue; }
			const tags = data.education[i].tags ?? [];
			if (
				tags.length > 0 &&
				!tags.some((t) => filters.includes(t.toLowerCase().trim()))
			) {
				eduH.add(i);
			}
		}
		merged.education = [...eduH].sort((a, b) => a - b);
		if (merged.education.length === 0) { delete merged.education; }
	}

	layoutAuditLog('filter-resolve', {
		filters: activeFilters.length,
		cvHash: hashCvForAudit(data),
		hiddenWork: merged.work?.length ?? 0,
		hiddenEducation: merged.education?.length ?? 0,
	});

	const denorm  = denormalizeMergedHidden(merged);
	const sidebar = data.visibility?.sidebarOrder ?? [
		'skills',
		'languages',
		'interests',
	];
	return {
		hiddenWork: denorm.hiddenWork ?? [],
		hiddenEducation: denorm.hiddenEducation ?? [],
		hiddenSections: [...(data.visibility?.hiddenSections ?? [])],
		sidebarOrder: [...sidebar],
		skillsOrder: [
			...(data.visibility?.skillsOrder ?? Object.keys(data.skills)),
		],
		hiddenWorkHighlights: cloneHiddenIndexMap(denorm.hiddenWorkHighlights),
		hiddenSkillItems: cloneHiddenIndexMap(denorm.hiddenSkillItems),
		hiddenEducationHighlights: cloneHiddenIndexMap(
			denorm.hiddenEducationHighlights,
		),
		hiddenLanguages: [...(denorm.hiddenLanguages ?? [])],
		hiddenIndices: merged,
	};
}

// ─── Filter state helpers ─────────────────────────────────────────────────────

/** Returns true if the given tag is currently active. */
export function isFilterActive(tag: string, activeFilters: string[]): boolean {
	return activeFilters.map((f) => f.toLowerCase()).includes(tag.toLowerCase());
}

/** Toggles a tag in the activeFilters array. Returns a new array. */
export function toggleFilter(tag: string, activeFilters: string[]): string[] {
	const normalised = tag.toLowerCase().trim();
	if (isFilterActive(normalised, activeFilters)) {
		return activeFilters.filter((f) => f.toLowerCase() !== normalised);
	}
	return [...activeFilters, normalised];
}

/** How many items would be visible with the given filter set. */
export function countVisibleItems(
	data:          CVData,
	activeFilters: string[],
): { work: number; education: number } {
	const resolved = resolveFilteredVisibility(data, activeFilters);
	return {
		work:      data.work.length      - resolved.hiddenWork.length,
		education: data.education.length - resolved.hiddenEducation.length,
	};
}
