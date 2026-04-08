/**
 * Build a document by applying selected leaf deltas onto a base snapshot.
 * Used for "review before apply" in the assistant flow.
 */

import { validateDocumentByType } from '@lib/active-document-runtime';
import type { StoredDocumentData } from '@lib/cloud-client';
import {
	cloneDocumentData,
	setDocumentDataAtPath,
	type LeafChange,
} from '@lib/blemmy-document-edit-history';

/**
 * @param rejectedPaths — leaf paths the user excluded; all others use
 *   `afterValue` from the diff.
 */
export function buildDocumentFromLeafSelection(
	docType: string,
	base: StoredDocumentData,
	leafChanges: LeafChange[],
	rejectedPaths: Set<string>,
): StoredDocumentData {
	const merged = cloneDocumentData(base) as unknown as Record<string, unknown>;
	for (const c of leafChanges) {
		if (rejectedPaths.has(c.path)) {
			continue;
		}
		setDocumentDataAtPath(merged, c.path, c.afterValue);
	}
	return validateDocumentByType(docType, merged) as StoredDocumentData;
}

export function countAcceptedChanges(
	leafChanges: LeafChange[],
	rejectedPaths: Set<string>,
): number {
	return leafChanges.filter((c) => !rejectedPaths.has(c.path)).length;
}
