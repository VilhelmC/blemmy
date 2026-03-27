/**
 * letter-document-spec.ts
 *
 * Derives the EngineDocumentSpec for the cover letter document type from
 * letter.doctype.json via deriveEngineSpec().
 *
 * The letter uses layout.model: 'single-column' — the engine runs in
 * fill+slack mode only (no candidate search, no movable sections).
 * The spec is provided to initCvLayoutEngine() to give it the correct
 * element IDs for the letter DOM.
 */

import { deriveEngineSpec, getDocTypeSpec } from '@lib/document-type';
import type { EngineDocumentSpec }           from '@lib/engine/document-spec';

const _spec = getDocTypeSpec('letter');
if (!_spec) {
	throw new Error('[letter-document-spec] letter.doctype.json not registered');
}

/**
 * The EngineDocumentSpec for the cover letter document type.
 * Passed to initCvLayoutEngine() when a letter document is active.
 *
 * Single-column: movableSections is empty, alwaysSidebarIds is empty.
 * The engine runs fill+slack only — sidebar binary search is skipped.
 */
export const LETTER_DOCUMENT_SPEC: EngineDocumentSpec = deriveEngineSpec(_spec);
