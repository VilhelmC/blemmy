/**
 * CV-centric persistence helpers + a single entry for activating edit mode.
 *
 * All edit behaviour lives in {@link activateEditMode} from generic-editor:
 * DOM attributes and data shape only — no document-type branching here.
 */

import type { DocumentTypeSpec } from '@lib/document-type';
import { isLikelyCvData } from '@lib/profile-data-loader';
import {
	BLEMMY_CV_EDIT_DRAFT_KEY,
	LEGACY_CV_EDIT_DRAFT_KEY,
} from '@lib/blemmy-storage-keys';
import {
	activateEditMode as activateGenericEditInner,
	type EditModeInstance,
} from '@renderer/generic-editor';

export type GenericEditModeInstance = EditModeInstance;

export function saveDraft(data: unknown): void {
	try {
		localStorage.setItem(BLEMMY_CV_EDIT_DRAFT_KEY, JSON.stringify(data));
		localStorage.removeItem(LEGACY_CV_EDIT_DRAFT_KEY);
	} catch {
		/* quota or private mode */
	}
}

export function loadDraft(): unknown | null {
	try {
		let raw = localStorage.getItem(BLEMMY_CV_EDIT_DRAFT_KEY);
		if (!raw) {
			raw = localStorage.getItem(LEGACY_CV_EDIT_DRAFT_KEY);
			if (raw) {
				localStorage.setItem(BLEMMY_CV_EDIT_DRAFT_KEY, raw);
				localStorage.removeItem(LEGACY_CV_EDIT_DRAFT_KEY);
			}
		}
		return raw ? JSON.parse(raw) as unknown : null;
	} catch {
		return null;
	}
}

export function clearDraft(): void {
	try {
		localStorage.removeItem(BLEMMY_CV_EDIT_DRAFT_KEY);
		localStorage.removeItem(LEGACY_CV_EDIT_DRAFT_KEY);
	} catch {
		/* ignore */
	}
}

/**
 * Activates field edit mode for the active document type (including CV).
 */
export function activateGenericEdit(
	initialData: unknown,
	shellId: string,
	draftKey: string,
	spec: DocumentTypeSpec,
	remount: (data: unknown) => void,
	onDataChange: (data: unknown) => void,
): GenericEditModeInstance {
	if (spec.docType === 'cv' && !isLikelyCvData(initialData)) {
		throw new Error('[profile-editor] CV doc type requires CV-shaped data');
	}
	return activateGenericEditInner(initialData, {
		spec,
		shellId,
		draftKey,
		onDataChange,
		remount,
	});
}
