/**
 * Unified list-hide buckets for edit mode + layout visibility.
 *
 * Keys use slash paths from the document root: "work", "education",
 * "languages", "work/0/highlights", "education/1/highlights",
 * "skills/{encodeURIComponent(category)}".
 *
 * CV legacy fields (hiddenWork, …) are merged on read and mirrored on
 * write when the payload looks CV-shaped (arrays work + education).
 */

import type { CVData, CVVisibility } from '@cv/cv';

export function skillCategoryHiddenPath(category: string): string {
	return `skills/${encodeURIComponent(category)}`;
}

export function workHighlightHiddenPath(workIdx: number): string {
	return `work/${workIdx}/highlights`;
}

export function educationHighlightHiddenPath(eduIdx: number): string {
	return `education/${eduIdx}/highlights`;
}

/** True when we should mirror hiddenIndices into legacy CVVisibility keys. */
export function isCvShapedData(data: unknown): boolean {
	if (!data || typeof data !== 'object') {
		return false;
	}
	const o = data as Record<string, unknown>;
	return Array.isArray(o.work) && Array.isArray(o.education);
}

/** Union legacy CV visibility + hiddenIndices. */
export function mergeHiddenBuckets(vis: CVVisibility | undefined): Record<string, number[]> {
	const acc: Record<string, Set<number>> = {};
	const add = (k: string, i: number): void => {
		if (!acc[k]) {
			acc[k] = new Set();
		}
		acc[k].add(i);
	};

	if (!vis) {
		return {};
	}

	for (const i of vis.hiddenWork ?? []) {
		add('work', i);
	}
	for (const i of vis.hiddenEducation ?? []) {
		add('education', i);
	}
	for (const i of vis.hiddenLanguages ?? []) {
		add('languages', i);
	}

	for (const [wk, arr] of Object.entries(vis.hiddenWorkHighlights ?? {})) {
		const k = workHighlightHiddenPath(Number(wk));
		for (const i of arr) {
			add(k, i);
		}
	}
	for (const [ek, arr] of Object.entries(vis.hiddenEducationHighlights ?? {})) {
		const k = educationHighlightHiddenPath(Number(ek));
		for (const i of arr) {
			add(k, i);
		}
	}
	for (const [cat, arr] of Object.entries(vis.hiddenSkillItems ?? {})) {
		const k = skillCategoryHiddenPath(cat);
		for (const i of arr) {
			add(k, i);
		}
	}
	for (const [k, arr] of Object.entries(vis.hiddenIndices ?? {})) {
		for (const i of arr) {
			add(k, i);
		}
	}

	const out: Record<string, number[]> = {};
	for (const [k, s] of Object.entries(acc)) {
		out[k] = [...s].sort((a, b) => a - b);
	}
	return out;
}

export function isIndexHidden(
	vis: CVVisibility | undefined,
	pathKey: string,
	index: number,
): boolean {
	return mergeHiddenBuckets(vis)[pathKey]?.includes(index) ?? false;
}

/**
 * Writes merged map to visibility. For CV-shaped data, mirrors legacy fields
 * so tag-filter and existing JSON round-trips stay stable.
 */
export function applyMergedHiddenToVisibility(
	data: unknown,
	merged: Record<string, number[]>,
): void {
	const raw = data as Record<string, unknown>;
	if (!raw.visibility || typeof raw.visibility !== 'object') {
		raw.visibility = {};
	}
	const vis = raw.visibility as CVVisibility;
	if (Object.keys(merged).length === 0) {
		delete vis.hiddenIndices;
		delete vis.hiddenWork;
		delete vis.hiddenEducation;
		delete vis.hiddenLanguages;
		delete vis.hiddenWorkHighlights;
		delete vis.hiddenEducationHighlights;
		delete vis.hiddenSkillItems;
		return;
	}
	vis.hiddenIndices = { ...merged };

	if (!isCvShapedData(data)) {
		return;
	}

	vis.hiddenWork = merged.work ?? [];
	if (vis.hiddenWork.length === 0) {
		delete vis.hiddenWork;
	}
	vis.hiddenEducation = merged.education ?? [];
	if (vis.hiddenEducation.length === 0) {
		delete vis.hiddenEducation;
	}
	vis.hiddenLanguages = merged.languages ?? [];
	if (vis.hiddenLanguages.length === 0) {
		delete vis.hiddenLanguages;
	}

	vis.hiddenWorkHighlights = {};
	vis.hiddenEducationHighlights = {};
	vis.hiddenSkillItems = {};

	for (const [key, indices] of Object.entries(merged)) {
		if (key === 'work' || key === 'education' || key === 'languages') {
			continue;
		}
		const wm = key.match(/^work\/(\d+)\/highlights$/);
		if (wm) {
			vis.hiddenWorkHighlights![wm[1]] = [...indices];
			continue;
		}
		const em = key.match(/^education\/(\d+)\/highlights$/);
		if (em) {
			vis.hiddenEducationHighlights![em[1]] = [...indices];
			continue;
		}
		if (key.startsWith('skills/')) {
			const cat = decodeURIComponent(key.slice('skills/'.length));
			vis.hiddenSkillItems![cat] = [...indices];
		}
	}

	if (Object.keys(vis.hiddenWorkHighlights).length === 0) {
		delete vis.hiddenWorkHighlights;
	}
	if (Object.keys(vis.hiddenEducationHighlights).length === 0) {
		delete vis.hiddenEducationHighlights;
	}
	if (Object.keys(vis.hiddenSkillItems).length === 0) {
		delete vis.hiddenSkillItems;
	}
}

export function toggleHiddenListIndex(
	data: unknown,
	pathKey: string,
	index: number,
): void {
	const raw = data as Record<string, unknown>;
	if (!raw.visibility || typeof raw.visibility !== 'object') {
		raw.visibility = {};
	}
	const vis = raw.visibility as CVVisibility;
	const merged = mergeHiddenBuckets(vis);
	const set = new Set(merged[pathKey] ?? []);
	if (set.has(index)) {
		set.delete(index);
	} else {
		set.add(index);
	}
	const next: Record<string, number[]> = { ...merged };
	const list = [...set].sort((a, b) => a - b);
	if (list.length === 0) {
		delete next[pathKey];
	} else {
		next[pathKey] = list;
	}
	applyMergedHiddenToVisibility(data, next);
}

/** @deprecated Call toggleHiddenListIndex + use mergeHiddenBuckets in callers */
export function toggleCvHiddenIndex(
	data: unknown,
	pathKey: string,
	index: number,
): void {
	toggleHiddenListIndex(data, pathKey, index);
}

/** Expands merged buckets into CV visibility fields (for tag-filter output). */
export function denormalizeMergedHidden(
	merged: Record<string, number[]>,
): Pick<
	CVVisibility,
	| 'hiddenWork'
	| 'hiddenEducation'
	| 'hiddenLanguages'
	| 'hiddenWorkHighlights'
	| 'hiddenEducationHighlights'
	| 'hiddenSkillItems'
	| 'hiddenIndices'
> {
	const holder: Record<string, unknown> = {
		work:       [],
		education:  [],
		visibility: {} as CVVisibility,
	};
	applyMergedHiddenToVisibility(holder, merged);
	const v = holder.visibility as CVVisibility;
	return {
		hiddenWork:              v.hiddenWork              ?? [],
		hiddenEducation:         v.hiddenEducation         ?? [],
		hiddenLanguages:         v.hiddenLanguages         ?? [],
		hiddenWorkHighlights:    v.hiddenWorkHighlights,
		hiddenEducationHighlights: v.hiddenEducationHighlights,
		hiddenSkillItems:        v.hiddenSkillItems,
		hiddenIndices:           v.hiddenIndices,
	};
}
