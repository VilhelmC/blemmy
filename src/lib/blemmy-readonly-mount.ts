/**
 * Read-only document mount for <blemmy-doc> and similar light-DOM hosts.
 */

import { BLEMMY_DOC_SHELL_ID } from '@lib/blemmy-dom-ids';
import { validateDocumentByType } from '@lib/active-document-runtime';
import type { StoredDocumentData } from '@lib/cloud-client';
import { inferDocTypeFromData } from '@lib/cloud-client';
import {
	getRuntimeHandler,
	isRegisteredDocumentType,
} from '@lib/document-runtime-registry';
import { deriveEngineSpec, getDocTypeSpec } from '@lib/document-type';
import { applyLayoutSnapshotToDom } from '@lib/engine/document-layout-snapshot';
import { applyRealisedLayout, migrateSnapshot } from '@lib/engine/layout-realised';
import { initCvLayoutEngine } from '@lib/engine/layout-engine';
import { hashCvForAudit, layoutAuditLog } from '@lib/engine/layout-audit';
import { isLikelyCvData } from '@lib/profile-data-loader';

const BASE_PAPER_PX = Math.round((210 / 25.4) * 96);

export type ReadonlyBlemmyMountOptions = {
	/** When set, must be a registered document type id. */
	docType?: string;
};

/**
 * Mounts a validated document with paper stage + layout engine (or static
 * snapshot) inside `container`. Requires global layout CSS and fonts loaded.
 */
export function mountReadonlyBlemmyInContainer(
	container: HTMLElement,
	rawData: unknown,
	options?: ReadonlyBlemmyMountOptions,
): { cleanup: () => void } {
	let engineCleanup: (() => void) | null = null;

	const resolvedType =
		options?.docType && isRegisteredDocumentType(options.docType)
			? options.docType
			: inferDocTypeFromData(rawData as StoredDocumentData);

	const validated = validateDocumentByType(resolvedType, rawData);

	if (isLikelyCvData(validated)) {
		layoutAuditLog('blemmy-embed-mount', {
			cvHash:       hashCvForAudit(validated),
			documentType: resolvedType,
		});
	} else {
		layoutAuditLog('blemmy-embed-mount', { documentType: resolvedType });
	}

	const root = getRuntimeHandler(resolvedType).render(validated, {
		skipDocumentMeta: true,
	});

	const stage = document.createElement('div');
	stage.className = 'blemmy-paper-stage blemmy-share-stage';
	const scaler = document.createElement('div');
	scaler.className = 'blemmy-paper-scaler';
	scaler.appendChild(root);
	stage.appendChild(scaler);
	container.appendChild(stage);

	const shell = document.getElementById(BLEMMY_DOC_SHELL_ID);
	if (!(shell instanceof HTMLElement)) {
		throw new Error(
			`[blemmy-embed] #${BLEMMY_DOC_SHELL_ID} missing after render`,
		);
	}
	shell.classList.add('blemmy-print-preview');

	const layoutPayload = validated as {
		realisedLayout?: unknown;
		layoutSnapshot?: unknown;
	};
	const hasStatic = Boolean(
		layoutPayload.layoutSnapshot || layoutPayload.realisedLayout,
	);
	let skipEngine = false;
	const docSpec = getDocTypeSpec(resolvedType);

	if (docSpec && hasStatic) {
		if (
			layoutPayload.realisedLayout &&
			applyRealisedLayout(
				layoutPayload.realisedLayout as never,
				docSpec,
			)
		) {
			skipEngine = true;
		} else if (layoutPayload.layoutSnapshot) {
			const migrated = migrateSnapshot(
				layoutPayload.layoutSnapshot as never,
				docSpec,
			);
			if (applyRealisedLayout(migrated, docSpec)) {
				skipEngine = true;
			} else {
				applyLayoutSnapshotToDom(layoutPayload.layoutSnapshot as never);
				window.dispatchEvent(new Event('blemmy-layout-applied'));
				skipEngine = true;
			}
		}
	}

	const engineSpec = docSpec ? deriveEngineSpec(docSpec) : null;
	engineCleanup =
		hasStatic && skipEngine
			? null
			: (engineSpec ? initCvLayoutEngine(engineSpec) : null) ?? null;

	const stopScale = attachBlemmyEmbedPaperScale(container);

	const cleanup = (): void => {
		stopScale();
		engineCleanup?.();
		engineCleanup = null;
		container.replaceChildren();
	};

	queueMicrotask(() => {
		window.dispatchEvent(new Event('resize'));
		requestAnimationFrame(() => {
			window.dispatchEvent(new Event('resize'));
		});
	});

	return { cleanup };
}

/**
 * Fits embed paper zoom to the host width (share-like scaling, scoped to host).
 */
export function attachBlemmyEmbedPaperScale(host: HTMLElement): () => void {
	const apply = (): void => {
		if (!host.isConnected) { return; }
		const w = Math.max(1, Math.floor(host.getBoundingClientRect().width));
		const available = Math.max(1, w - 12);
		const scale = Math.min(1, available / BASE_PAPER_PX);
		host.style.setProperty('--blemmy-paper-scale', String(scale));
		host.style.setProperty('--blemmy-paper-width', `${BASE_PAPER_PX}px`);
	};
	apply();
	const onWin = (): void => { apply(); };
	window.addEventListener('resize', onWin);
	window.visualViewport?.addEventListener('resize', onWin);
	window.addEventListener('blemmy-layout-applied', onWin);
	let ro: ResizeObserver | null = null;
	if (typeof ResizeObserver !== 'undefined') {
		ro = new ResizeObserver(() => { apply(); });
		ro.observe(host);
	}
	return (): void => {
		window.removeEventListener('resize', onWin);
		window.visualViewport?.removeEventListener('resize', onWin);
		window.removeEventListener('blemmy-layout-applied', onWin);
		ro?.disconnect();
		host.style.removeProperty('--blemmy-paper-scale');
		host.style.removeProperty('--blemmy-paper-width');
	};
}
