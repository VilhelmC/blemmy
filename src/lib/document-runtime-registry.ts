/**
 * Maps document type ids (from DocumentTypeSpec.docType / cloud doc_type) to
 * validation, rendering, and optional local persistence. Application code
 * should route through {@link getRuntimeHandler} instead of branching on ids.
 */

import type { CVData } from '@cv/cv';
import type { LetterData } from '@cv/letter';
import { loadLetterData, saveLetterData, validateLetterData } from '@lib/composer-data-loader';
import { validateCvData } from '@lib/profile-data-loader';
import { renderLetter } from '@renderer/composer-renderer';
import { renderCV } from '@renderer/profile-renderer';

export type BlemmyDocumentRenderOptions = {
	skipDocumentMeta?: boolean;
};

export type RuntimeHandler = {
	validate: (raw: unknown) => unknown;
	render: (
		data: unknown,
		opts?: BlemmyDocumentRenderOptions,
	) => HTMLElement;
	persistLocal?: (data: unknown) => void;
	loadLocalFallback?: () => unknown;
};

const handlers = new Map<string, RuntimeHandler>();

function registerHandler(docType: string, handler: RuntimeHandler): void {
	handlers.set(docType, handler);
}

registerHandler('cv', {
	validate: validateCvData,
	render: (d, opts) => renderCV(d as CVData, opts),
});

registerHandler('letter', {
	validate: validateLetterData,
	render: (d, opts) => renderLetter(d as LetterData, opts),
	persistLocal: (d) => saveLetterData(d as LetterData),
	loadLocalFallback: () => loadLetterData(),
});

export function getRuntimeHandler(docType: string): RuntimeHandler {
	const handler = handlers.get(docType);
	if (!handler) {
		throw new Error(`Unsupported document type: ${docType}`);
	}
	return handler;
}

export function isRegisteredDocumentType(docType: string): boolean {
	return handlers.has(docType);
}

export function listRegisteredDocumentTypeIds(): string[] {
	return [...handlers.keys()];
}
