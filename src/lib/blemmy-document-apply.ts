/**
 * UI entry for committing generic editor output with shared undo history.
 */

import type { StoredDocumentData } from '@lib/cloud-client';
import { getActiveDocumentType } from '@lib/active-document-runtime';
import { recordDocumentApplyHistory } from '@lib/blemmy-document-edit-history';

export function commitDocumentEditFromUi(
	newData: unknown,
	recordHistory: boolean,
): void {
	const docType = getActiveDocumentType();
	const current = window.__blemmyDocument__;
	recordDocumentApplyHistory(
		current as StoredDocumentData | undefined,
		newData as StoredDocumentData,
		recordHistory,
	);
	window.__blemmyRemountDocument__?.(newData, docType);
}
