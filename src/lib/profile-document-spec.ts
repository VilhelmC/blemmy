/**
 * blemmy-document-spec.ts
 *
 * Derives the EngineDocumentSpec for the CV document type from its
 * JSON spec file (src/data/doctypes/cv.doctype.json).
 *
 * This file is now a thin derivation layer — the source of truth for
 * CV layout wiring is cv.doctype.json, not this file.
 *
 * To change how the CV document type is laid out, edit cv.doctype.json.
 * To change the DOM IDs used by the CV renderer, update the domOverrides
 * section in cv.doctype.json and the corresponding IDs in blemmy-renderer.ts.
 */

import { deriveEngineSpec, getDocTypeSpec } from '@lib/document-type';
import type { EngineDocumentSpec }           from '@lib/engine/document-spec';

const _spec = getDocTypeSpec('cv');
if (!_spec) {
	throw new Error('[blemmy-document-spec] cv.doctype.json not registered — check document-type.ts');
}

/**
 * The EngineDocumentSpec for the CV document type.
 * Passed to initLayoutEngine() on startup (see main.ts; may import as initCvLayoutEngine).
 *
 * Derived at module load time from cv.doctype.json via deriveEngineSpec().
 * The derivation is deterministic — same JSON always produces the same spec.
 */
export const CV_DOCUMENT_SPEC: EngineDocumentSpec = deriveEngineSpec(_spec);
