/**
 * Single active document: type id (string) + validated JSON payload.
 * No document-kind branching outside {@link document-runtime-registry}.
 */

import type { StoredDocumentData } from '@lib/cloud-client';
import defaultBundledDoctype from '@data/doctypes/cv.doctype.json';
import { getRuntimeHandler, isRegisteredDocumentType } from '@lib/document-runtime-registry';

/** Dispatched after active document type and/or data change. */
export const BLEMMY_ACTIVE_DOCUMENT_CHANGED = 'blemmy-active-document-changed';

export type BlemmyActiveDocumentChangedDetail = { documentType: string };

export const FALLBACK_DOCUMENT_TYPE_ID: string = defaultBundledDoctype.docType;

declare global {
	interface Window {
		__blemmyDocumentType__?: string;
		__blemmyDocument__?: unknown;
		__blemmyRemountDocument__?: (data: unknown, documentType: string) => void;
	}
}

export function getActiveDocumentType(): string {
	const t = window.__blemmyDocumentType__;
	if (typeof t === 'string' && t.length > 0 && isRegisteredDocumentType(t)) {
		return t;
	}
	return FALLBACK_DOCUMENT_TYPE_ID;
}

export function getActiveDocumentData(): unknown {
	return window.__blemmyDocument__;
}

export function getActiveDocumentSnapshot(): {
	docType: string;
	data: StoredDocumentData | null;
} {
	const docType = getActiveDocumentType();
	const raw = window.__blemmyDocument__;
	return {
		docType,
		data: (raw ?? null) as StoredDocumentData | null,
	};
}

export function validateDocumentByType(
	docType: string,
	raw: unknown,
): StoredDocumentData {
	return getRuntimeHandler(docType).validate(raw) as StoredDocumentData;
}

/** Calls the app remount hook set in main (after shell exists). */
export function remountActiveDocument(
	data: unknown,
	documentType: string,
): void {
	window.__blemmyRemountDocument__?.(data, documentType);
}
