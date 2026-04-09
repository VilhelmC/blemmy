/**
 * main.ts — application entry point
 */

import '@styles/fonts.css';
import '@styles/global.css';
import '@styles/print.css';
import '@styles/blemmy-print-surface.css';
import '@styles/blemmy-print-parity.css';
import '@styles/style-panel.css';
import '@styles/review-mode.css';
import '@styles/generic-editor.css';
import '@styles/letter.css';

document.documentElement.classList.add('blemmy-css-ready');

import {
	bootstrapOAuthFromUrl,
	inferDocTypeFromData,
	initPasswordlessAuthFromUrl,
	resolveShareToken,
	shouldBootMinimalOAuthPopupOnly,
	type StoredDocumentData,
} from '@lib/cloud-client';
import {
	resolveAppModeFromLocation,
	type AppMode,
} from '@lib/app-mode';
import {
	prepareBundledDefaultsResetUi,
	resetBundledDocumentCaches,
} from '@lib/blemmy-local-reset';
import {
	BLEMMY_APP_SESSION_STATE_KEY,
	LEGACY_CV_APP_SESSION_STATE_KEY,
} from '@lib/blemmy-storage-keys';
import { closeDocument } from '@lib/document-sync';
import {
	hasUploadedData,
	isLikelyCvData,
	loadCvData,
	onCvDataChanged,
} from '@lib/profile-data-loader';
import { toggleFilter, extractAllTags } from '@lib/tag-filter';
import { hashCvForAudit, initLayoutAuditUi, layoutAuditLog } from '@lib/engine/layout-audit';
import { canonicalEmbedPath, canonicalSharePath } from '@lib/share-link-url';
import { applyLayoutSnapshotToDom } from '@lib/engine/document-layout-snapshot';
import { applyRealisedLayout, migrateSnapshot } from '@lib/engine/layout-realised';
import { deriveEngineSpec, getDocTypeSpec } from '@lib/document-type';
import { isLetterData } from '@lib/composer-data-loader';
import { getRuntimeHandler, isRegisteredDocumentType } from '@lib/document-runtime-registry';
import {
	loadPortraitLocalCache,
	savePortraitLocalCache,
} from '@lib/profile-portrait';
import { syncFilterBar }                from '@renderer/profile-renderer';
import type { CVData }                  from '@cv/cv';

import { initUIComponents, initSharedReviewComponents }   from '@renderer/ui-components';
import { startUiManager } from '@renderer/ui-manager';
import { initLayoutEngine as initCvLayoutEngine } from '@lib/engine/layout-engine';
import {
	BLEMMY_DOC_ROOT_ID,
	BLEMMY_DOC_SHELL_ID,
} from '@lib/blemmy-dom-ids';
import {
	BLEMMY_ACTIVE_DOCUMENT_CHANGED,
	FALLBACK_DOCUMENT_TYPE_ID,
	getActiveDocumentData,
	getActiveDocumentSnapshot,
	validateDocumentByType,
} from '@lib/active-document-runtime';
import {
	clearDocumentEditHistory,
	cloneDocumentData,
	documentHistoryFuture,
	documentHistoryPast,
	getLastLeafChanges,
	isLeafChange,
	recordDocumentApplyHistory,
	redoDocumentEditHistory,
	sanitizeLoadedDocumentChanges,
	setDocumentDataAtPath,
	setLastLeafChanges,
	type LeafChange,
	undoDocumentEditHistory,
} from '@lib/blemmy-document-edit-history';

declare global {
	interface Window {
		cvUndo?: () => void;
		cvRedo?: () => void;
		cvCanUndo?: () => boolean;
		cvCanRedo?: () => boolean;
		cvRevertField?: (path: string) => void;
		/** DevTools: clear local document caches and remount bundled CV. */
		blemmyResetToBundledDefaults?: () => void;
	}
}

const resolvedMode = resolveAppModeFromLocation(
	window.location,
	import.meta.env.BASE_URL ?? '/',
);
const frameEmbedded = (() => {
	try {
		return window.self !== window.top;
	} catch {
		return true;
	}
})();
const ACTIVE_DOC_TYPE_STORAGE_KEY = 'blemmy-active-doc-type';
const LEGACY_ACTIVE_DOC_TYPE_STORAGE_KEY = 'cv-active-doc-type';
const appMode = (resolvedMode.mode === 'normal' && frameEmbedded)
	? 'portfolioEmbed'
	: resolvedMode.mode;

function copyText(text: string): Promise<boolean> {
	return navigator.clipboard.writeText(text)
		.then(() => true)
		.catch(() => false);
}

function persistLastActiveDocType(docType: string): void {
	if (!isRegisteredDocumentType(docType)) {
		return;
	}
	try {
		localStorage.setItem(ACTIVE_DOC_TYPE_STORAGE_KEY, docType);
		localStorage.removeItem(LEGACY_ACTIVE_DOC_TYPE_STORAGE_KEY);
	} catch { /* ignore storage issues */ }
}

function loadLastActiveDocType(): string | null {
	try {
		const rawPrimary = localStorage.getItem(ACTIVE_DOC_TYPE_STORAGE_KEY);
		const rawLegacy = rawPrimary
			? null
			: localStorage.getItem(LEGACY_ACTIVE_DOC_TYPE_STORAGE_KEY);
		const value = rawPrimary ?? rawLegacy;
		if (value && isRegisteredDocumentType(value)) {
			if (!rawPrimary && rawLegacy) {
				localStorage.setItem(ACTIVE_DOC_TYPE_STORAGE_KEY, value);
				localStorage.removeItem(LEGACY_ACTIVE_DOC_TYPE_STORAGE_KEY);
			}
			return value;
		}
	} catch { /* ignore storage issues */ }
	return null;
}

function isShareReadonlyMode(): boolean {
	return document.documentElement.classList.contains('blemmy-share-readonly');
}

function isReadonlyLikeMode(mode: AppMode): boolean {
	return mode === 'shareReadonly' || mode === 'publishedEmbed';
}

function isShareReviewModeEnabled(): boolean {
	try {
		return new URLSearchParams(location.search).get('blemmy-review') === '1';
	} catch {
		return false;
	}
}

/**
 * Layout runs at paper CSS px width; fit uses --blemmy-paper-scale + stage zoom/transform.
 * `blemmy-layout-applied` can precede a committed frame (fonts, probes), so we refit
 * across a couple of rAFs after any layout pass — filters, alternatives, resize, etc.
 */
function schedulePaperStageRefit(apply: () => void): void {
	apply();
	requestAnimationFrame(() => {
		apply();
		requestAnimationFrame(() => {
			apply();
		});
	});
	window.setTimeout(() => {
		apply();
	}, 120);
}

function setupPaperStageScale(readonlyMode: boolean): void {
	const baseW = Math.round((210 / 25.4) * 96);
	let moRaf: number | null = null;
	const apply = (): void => {
		const shell = activeDocShellEl();
		if (!shell?.isConnected) {
			return;
		}
		const html = document.documentElement;
		const vv = window.visualViewport;
		const layoutViewportW = Math.max(1, Math.floor(vv?.width ?? window.innerWidth));
		const isDesktop = window.matchMedia('(min-width: 901px)').matches;
		const shareReviewPanel = document.getElementById('blemmy-review-panel');
		const shareReviewOpen = Boolean(
			readonlyMode &&
			shareReviewPanel &&
			!shareReviewPanel.hasAttribute('hidden'),
		);
		/*
		 * Prefer html.blemmy-panel-open (synced in ui-components). Also detect any
		 * open unified dock panel in the DOM — same idea as legacy
		 * `.cv-side-panel:not([hidden])`, so we still reserve width if classes lag
		 * or edit mode only toggles data-blemmy-editing / panel mount.
		 */
		const classDesktopPanel =
			html.classList.contains('blemmy-panel-open') &&
			html.classList.contains('blemmy-panel-desktop');
		const domUnifiedDockOpen =
			isDesktop &&
			document.querySelector('.blemmy-unified-side-panel:not([hidden])') != null;
		const effectiveDesktopSidePanel = classDesktopPanel || domUnifiedDockOpen;
		const panelWStr = getComputedStyle(html).getPropertyValue('--blemmy-panel-w')
			.trim();
		const panelWPx = Number.parseFloat(panelWStr) || 344;
		const reserveRight =
			isDesktop && (effectiveDesktopSidePanel || shareReviewOpen)
				? panelWPx
				: 0;
		const horizPad = isDesktop ? 12 : 32;
		/*
		 * documentElement.clientWidth ignores body padding-right, so cap width
		 * using layout viewport width minus the same panel reserve as global.css.
		 */
		const columnBudget = Math.max(
			1,
			Math.floor(layoutViewportW - reserveRight - horizPad),
		);
		const docRoot = activeDocRootEl();
		const rawRoot =
			docRoot instanceof HTMLElement && docRoot.clientWidth > 0
				? docRoot.clientWidth
				: 0;
		const viewportBudget = Math.min(columnBudget, rawRoot > 0 ? rawRoot : columnBudget);
		/*
		 * Never let "available" width exceed the layout column: after a remount,
		 * #blemmy-doc-root can briefly report paper width (~794px) and over-scale.
		 */
		const availableW = Math.max(1, viewportBudget);
		const hasFixedPaperStage = readonlyMode ||
			Boolean(shell.classList.contains('blemmy-print-preview'));
		/*
		 * Single uniform scale (legacy behaviour): fit fixed paper width (210mm →
		 * baseW px) into the column — including when a right rail is open
		 * (reserveRight). Apply via .blemmy-paper-stage zoom only; do not squeeze
		 * inner card width with max-width clamps (that reflows and breaks aspect).
		 */
		const scale = hasFixedPaperStage ? Math.min(availableW / baseW, 1) : 1;
		document.documentElement.style.setProperty(
			'--blemmy-paper-scale',
			String(scale),
		);
		document.documentElement.style.setProperty(
			'--blemmy-paper-width',
			`${baseW}px`,
		);

		const shareHtml = document.documentElement.classList.contains(
			'blemmy-share-readonly',
		);
		const shellParent = shell.parentElement;
		const scaler =
			shellParent?.classList.contains('blemmy-paper-scaler')
				? shellParent
				: null;
		let stage: HTMLElement | null = null;
		if (scaler?.parentElement?.classList.contains('blemmy-paper-stage')) {
			stage = scaler.parentElement;
		} else if (shellParent?.classList.contains('blemmy-paper-stage')) {
			stage = shellParent;
		}
		const zoomSupported =
			typeof CSS !== 'undefined' &&
			typeof CSS.supports === 'function' &&
			CSS.supports('zoom', '1');
		const useMobileScalerZoom =
			zoomSupported &&
			!isDesktop &&
			!shareHtml &&
			hasFixedPaperStage &&
			scaler instanceof HTMLElement &&
			stage instanceof HTMLElement;
		if (stage instanceof HTMLElement) {
			if (shareHtml || !hasFixedPaperStage) {
				stage.style.removeProperty('zoom');
				stage.style.removeProperty('width');
				stage.style.removeProperty('max-width');
				stage.style.removeProperty('overflow-x');
				stage.style.removeProperty('display');
				stage.style.removeProperty('justify-content');
				stage.style.removeProperty('min-width');
				stage.style.removeProperty('margin-inline');
				if (scaler instanceof HTMLElement) {
					scaler.style.removeProperty('transform');
					scaler.style.removeProperty('transform-origin');
					scaler.style.removeProperty('width');
					scaler.style.removeProperty('zoom');
				}
			} else if (useMobileScalerZoom) {
				/*
				 * Chrome Android: stage zoom can break after remount; transform on
				 * the scaler keeps full layout height (huge scroll). Zoom on the
				 * inner scaler shrinks layout width and height in Blink and recent
				 * WebKit. Stage is a full-width flex row to center the paper.
				 */
				stage.style.removeProperty('zoom');
				stage.style.setProperty('width', '100%');
				stage.style.setProperty('max-width', '100%');
				stage.style.setProperty('display', 'flex');
				stage.style.setProperty('justify-content', 'center');
				stage.style.setProperty('overflow-x', 'clip');
				stage.style.setProperty('min-width', '0');
				stage.style.removeProperty('margin-inline');
				scaler.style.removeProperty('transform');
				scaler.style.removeProperty('transform-origin');
				scaler.style.setProperty('width', `${baseW}px`);
				scaler.style.setProperty('zoom', String(scale));
			} else if (zoomSupported) {
				stage.style.removeProperty('overflow-x');
				stage.style.removeProperty('margin-inline');
				stage.style.removeProperty('display');
				stage.style.removeProperty('justify-content');
				stage.style.removeProperty('min-width');
				if (scaler instanceof HTMLElement) {
					scaler.style.removeProperty('transform');
					scaler.style.removeProperty('transform-origin');
					scaler.style.removeProperty('width');
					scaler.style.removeProperty('zoom');
				}
				stage.style.setProperty('zoom', String(scale));
				stage.style.setProperty('width', `${baseW}px`);
				stage.style.setProperty('max-width', `${baseW}px`);
			} else {
				stage.style.removeProperty('zoom');
				stage.style.removeProperty('width');
				stage.style.removeProperty('max-width');
				stage.style.removeProperty('overflow-x');
				stage.style.removeProperty('margin-inline');
				stage.style.removeProperty('display');
				stage.style.removeProperty('justify-content');
				stage.style.removeProperty('min-width');
				if (scaler instanceof HTMLElement) {
					scaler.style.removeProperty('transform');
					scaler.style.removeProperty('transform-origin');
					scaler.style.removeProperty('width');
					scaler.style.removeProperty('zoom');
				}
			}
		}
	};
	apply();
	window.addEventListener('resize', apply);
	window.visualViewport?.addEventListener('resize', apply);
	window.addEventListener('blemmy-layout-applied', () => {
		schedulePaperStageRefit(apply);
	});
	window.addEventListener('blemmy-ui-viewport-changed', () => {
		schedulePaperStageRefit(apply);
	});
	window.addEventListener('blemmy-view-mode-changed', () => {
		schedulePaperStageRefit(apply);
	});
	const observer = new MutationObserver(() => {
		if (moRaf != null) {
			window.cancelAnimationFrame(moRaf);
		}
		moRaf = window.requestAnimationFrame(() => {
			moRaf = null;
			apply();
		});
	});
	observer.observe(document.body, {
		subtree: true,
		attributes: true,
		attributeFilter: ['hidden', 'class'],
	});
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['class'],
	});
}

function activeDocShellEl(): HTMLElement | null {
	const el = document.getElementById(BLEMMY_DOC_SHELL_ID);
	return el instanceof HTMLElement ? el : null;
}

function activeDocRootEl(): HTMLElement | null {
	const el = document.getElementById(BLEMMY_DOC_ROOT_ID);
	return el instanceof HTMLElement ? el : null;
}

function mountPaperStage(sharedMode: boolean, banner?: HTMLElement): void {
	const shell = activeDocShellEl();
	if (!(shell instanceof HTMLElement) || !shell.parentElement) {
		if (banner) { document.body.appendChild(banner); }
		return;
	}
	const existingStage = shell.parentElement;
	if (existingStage.classList.contains('blemmy-paper-stage')) {
		if (banner && banner.parentElement !== existingStage) {
			existingStage.insertBefore(banner, shell);
		}
		return;
	}
	const stage = document.createElement('div');
	stage.className = sharedMode
		? 'blemmy-paper-stage blemmy-share-stage'
		: 'blemmy-paper-stage';
	shell.parentElement.insertBefore(stage, shell);
	if (banner) {
		stage.append(banner, shell);
		return;
	}
	const scaler = document.createElement('div');
	scaler.className = 'blemmy-paper-scaler';
	scaler.appendChild(shell);
	stage.appendChild(scaler);
}

/** Screen preview needs .blemmy-paper-stage so --blemmy-paper-scale applies after each remount. */
function ensurePaperStageIfNeeded(): void {
	const readonlyMode = isReadonlyLikeMode(appMode);
	const portfolioEmbedMode = appMode === 'portfolioEmbed';
	if (!readonlyMode && !portfolioEmbedMode) {
		mountPaperStage(false);
	}
}

function activateShell(shell: HTMLElement): void {
	// Force print preview by default while web view is temporarily disabled.
	shell.classList.add('blemmy-print-preview');
}

function finishBootUi(): void {
	const html = document.documentElement;
	html.classList.remove('blemmy-booting');
	const splash = document.getElementById('blemmy-boot-splash');
	if (splash) { splash.setAttribute('hidden', ''); }
}

function mountShareError(message: string): void {
	document.documentElement.classList.add('blemmy-share-readonly');
	const priorRoot = document.getElementById(BLEMMY_DOC_ROOT_ID);
	if (priorRoot) {
		priorRoot.remove();
	}
	const panel = document.createElement('main');
	panel.className = 'blemmy-share-error';
	const title = document.createElement('h1');
	title.className = 'blemmy-share-error__title';
	title.textContent = 'Share link unavailable';
	const body = document.createElement('p');
	body.className = 'blemmy-share-error__body';
	body.textContent = message || 'This share link is not available.';
	panel.append(title, body);
	document.body.appendChild(panel);
	finishBootUi();
}

function aboutBodyNodes(): Node[] {
	const p1 = document.createElement('p');
	p1.textContent = 'I like to simplify workflows, not just for myself. ' +
		'When I needed to update my own CV, I built this headless document ' +
		'authoring app for smart layouting, editing, and cloud versioning.';
	const p2 = document.createElement('p');
	p2.textContent = 'This app separates content, rendering, and layout ' +
		'solving. CV JSON feeds a deterministic renderer, and a layout engine ' +
		'evaluates alternatives to produce a print-ready result.';
	const p3 = document.createElement('p');
	p3.textContent = 'It includes local editing with change controls, cloud ' +
		'document version history, secure share links, and privacy-aware data ' +
		'handling backed by Supabase and row-level security.';
	const p4 = document.createElement('p');
	p4.textContent = 'There is also an assistant workflow for drafting and ' +
		'refining CV content, so the app supports both writing quality and ' +
		'document engineering.';
	const p5 = document.createElement('p');
	p5.textContent = 'Note: this text describes the software project created ' +
		'by the developer of this app. It does not describe the person whose ' +
		'CV is being viewed in this shared link.';
	const repo = document.createElement('p');
	repo.className = 'blemmy-about-modal__repo';
	repo.append(
		document.createTextNode('Repository: '),
		Object.assign(document.createElement('a'), {
			className: 'blemmy-about-modal__repo-link',
			href: 'https://github.com/VilhelmC/blemmy',
			target: '_blank',
			rel: 'noopener noreferrer',
			textContent: 'github.com/VilhelmC/blemmy',
		}),
	);
	const diagram = document.createElement('figure');
	diagram.className = 'blemmy-about-arch';
	const caption = document.createElement('figcaption');
	caption.className = 'blemmy-about-arch__caption';
	caption.textContent = 'Architecture overview';
	const flow = document.createElement('ol');
	flow.className = 'blemmy-about-arch__flow';
	function flowItem(title: string, text: string): HTMLElement {
		const li = document.createElement('li');
		li.className = 'blemmy-about-arch__item';
		const t = document.createElement('strong');
		t.className = 'blemmy-about-arch__item-title';
		t.textContent = title;
		const d = document.createElement('span');
		d.className = 'blemmy-about-arch__item-text';
		d.textContent = text;
		li.append(t, d);
		return li;
	}
	flow.append(
		flowItem('Content model', 'CV JSON data structure'),
		flowItem('Rendering layer', 'Headless DOM renderer for deterministic output'),
		flowItem('Layout solver', 'Candidate search for balanced print-ready pages'),
		flowItem('Cloud layer', 'Versioning, auth, and secure share links'),
		flowItem('Assistant layer', 'Draft and refine text/content workflows'),
		flowItem('Delivery', 'Interactive web view and shareable read-only mode'),
	);
	diagram.append(caption, flow);
	return [p1, p2, p3, p4, p5, repo, diagram];
}

function mountAboutUi(sharedMode: boolean): void {
	const overlay = document.createElement('div');
	overlay.id = 'blemmy-about-modal';
	overlay.className = 'blemmy-about-modal no-print';
	overlay.setAttribute('hidden', '');
	const panel = document.createElement('section');
	panel.className = 'blemmy-about-modal__panel';
	panel.setAttribute('role', 'dialog');
	panel.setAttribute('aria-modal', 'true');
	panel.setAttribute('aria-labelledby', 'blemmy-about-title');
	const title = document.createElement('h2');
	title.id = 'blemmy-about-title';
	title.className = 'blemmy-about-modal__title';
	title.textContent = 'About this app';
	const closeBtn = document.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = 'blemmy-about-modal__close';
	closeBtn.textContent = 'Close';
	const body = document.createElement('div');
	body.className = 'blemmy-about-modal__body';
	body.append(...aboutBodyNodes());
	panel.append(title, body);
	if (!sharedMode) {
		const tools = document.createElement('div');
		tools.className = 'blemmy-about-modal__tools';
		const toolsHint = document.createElement('p');
		toolsHint.className = 'blemmy-about-modal__tools-hint';
		toolsHint.textContent =
			'If cleared storage came back after closing the tab, the page ' +
			'had already saved the open document. Reset here loads the ' +
			'bundled demo and clears related storage.';
		const resetBtn = document.createElement('button');
		resetBtn.type = 'button';
		resetBtn.className = 'blemmy-about-modal__reset';
		resetBtn.textContent = 'Reset to bundled demo';
		resetBtn.addEventListener('click', () => {
			const ok = window.confirm(
				'Clear local session, uploads, chat source, and cloud ' +
					'active document link, then load the bundled demo CV?',
			);
			if (!ok) { return; }
			resetToBundledDefaultsInApp();
			close();
		});
		tools.append(toolsHint, resetBtn);
		panel.append(tools);
	}
	panel.append(closeBtn);
	overlay.append(panel);
	document.body.appendChild(overlay);

	function open(): void {
		overlay.removeAttribute('hidden');
		overlay.scrollTop = 0;
		panel.scrollTop = 0;
	}
	function close(): void { overlay.setAttribute('hidden', ''); }
	closeBtn.addEventListener('click', close);
	overlay.addEventListener('click', (event) => {
		if (event.target === overlay) { close(); }
	});
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && !overlay.hasAttribute('hidden')) { close(); }
	});

	if (sharedMode) {
		const footer = document.createElement('footer');
		footer.className = 'blemmy-share-footer no-print';
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'blemmy-share-footer__about';
		btn.textContent = 'About app';
		btn.addEventListener('click', open);
		footer.appendChild(btn);
		document.body.appendChild(footer);
		return;
	}

	const mainBtn = document.createElement('button');
	mainBtn.type = 'button';
	mainBtn.className = 'blemmy-about-corner-btn blemmy-history-btn no-print';
	mainBtn.setAttribute('aria-label', 'About this project');
	mainBtn.textContent = 'About';
	mainBtn.addEventListener('click', open);
	document.body.appendChild(mainBtn);
}

function mountEmbedFooter(label: string, href: string): void {
	const footer = document.createElement('footer');
	footer.className = 'blemmy-share-footer no-print';
	const link = document.createElement('a');
	link.className = 'blemmy-share-footer__about';
	link.href = href;
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.textContent = label;
	footer.appendChild(link);
	document.body.appendChild(footer);
}

let engineCleanup: (() => void) | null = null;

function persistSessionState(): void {
	const snapshot = getActiveDocumentSnapshot();
	const activeDocType = snapshot.docType;
	const activeData = snapshot.data;
	if (!activeData) { return; }
	const cvForAudit = isLikelyCvData(activeData) ? activeData : undefined;
	const leafChanges = getLastLeafChanges();
	layoutAuditLog('persist-session', {
		cvHash: hashCvForAudit(cvForAudit),
		activeDocType,
		changes: leafChanges.length,
		past: documentHistoryPast.length,
		future: documentHistoryFuture.length,
	});
	try {
		const payload = {
			savedAt: Date.now(),
			activeDocument: {
				docType: activeDocType,
				data: activeData,
			},
			lastLeafChanges: leafChanges,
			historyPast: documentHistoryPast,
			historyFuture: documentHistoryFuture,
		};
		localStorage.setItem(BLEMMY_APP_SESSION_STATE_KEY, JSON.stringify({
			...payload,
		}));
		localStorage.removeItem(LEGACY_CV_APP_SESSION_STATE_KEY);
	} catch { /* ignore storage issues */ }
}

function loadSessionState(): {
	activeDocType: string | null;
	document: unknown | null;
	changes: LeafChange[];
	past: StoredDocumentData[];
	future: StoredDocumentData[];
} {
	const empty = (): ReturnType<typeof loadSessionState> => ({
		activeDocType: null,
		document: null,
		changes: [],
		past: [],
		future: [],
	});
	try {
		let raw = localStorage.getItem(BLEMMY_APP_SESSION_STATE_KEY);
		if (!raw) {
			raw = localStorage.getItem(LEGACY_CV_APP_SESSION_STATE_KEY);
			if (raw) {
				localStorage.setItem(BLEMMY_APP_SESSION_STATE_KEY, raw);
				localStorage.removeItem(LEGACY_CV_APP_SESSION_STATE_KEY);
			}
		}
		if (!raw) {
			return empty();
		}
		const parsed = JSON.parse(raw) as {
			activeDocType?: unknown;
			cv?: unknown;
			letter?: unknown;
			activeDocument?: {
				docType?: unknown;
				data?: unknown;
			};
			lastLeafChanges?: unknown;
			historyPast?: unknown;
			historyFuture?: unknown;
		};
		const fromEnvelope =
			typeof parsed.activeDocument?.docType === 'string' &&
			isRegisteredDocumentType(parsed.activeDocument.docType)
				? parsed.activeDocument.docType
				: null;
		const fromRoot =
			typeof parsed.activeDocType === 'string' &&
			isRegisteredDocumentType(parsed.activeDocType)
				? parsed.activeDocType
				: null;
		let activeDocType = fromEnvelope ?? fromRoot;
		let document: unknown | null = parsed.activeDocument?.data ?? null;
		if (document == null && isLikelyCvData(parsed.cv)) {
			document = parsed.cv;
			activeDocType = activeDocType ?? FALLBACK_DOCUMENT_TYPE_ID;
		}
		if (document == null && isLetterData(parsed.letter)) {
			document = parsed.letter;
			activeDocType = activeDocType ?? 'letter';
		}
		const changes = Array.isArray(parsed.lastLeafChanges)
			? parsed.lastLeafChanges.filter(isLeafChange)
			: [];
		const rawPast = Array.isArray(parsed.historyPast) ? parsed.historyPast : [];
		const rawFuture = Array.isArray(parsed.historyFuture)
			? parsed.historyFuture
			: [];
		const filterHistory = (items: unknown[]): StoredDocumentData[] => {
			if (!activeDocType) {
				return [];
			}
			return items.filter((x) => {
				try {
					validateDocumentByType(activeDocType, x);
					return true;
				} catch {
					return false;
				}
			}) as StoredDocumentData[];
		};
		const past = filterHistory(rawPast);
		const future = filterHistory(rawFuture);
		const cvForAudit = isLikelyCvData(document) ? document : undefined;
		layoutAuditLog('load-session', {
			cvHash: hashCvForAudit(cvForAudit),
			activeDocType,
			changes: changes.length,
			past: past.length,
			future: future.length,
		});
		return { activeDocType, document, changes, past, future };
	} catch {
		return empty();
	}
}

function dispatchHistoryChanged(): void {
	window.dispatchEvent(new CustomEvent('blemmy-history-changed', {
		detail: {
			canUndo: documentHistoryPast.length > 0,
			canRedo: documentHistoryFuture.length > 0,
		},
	}));
}

function dispatchLastChanges(): void {
	const leafChanges = getLastLeafChanges();
	window.dispatchEvent(new CustomEvent('blemmy-last-changes', {
		detail: {
			changes: leafChanges.map((c) => ({
				path: c.path,
				before: c.before,
				after: c.after,
				state: c.state,
			})),
		},
	}));
}

function remountBlemmyDocument(rawData: unknown, documentType: string): void {
	const validated = validateDocumentByType(
		documentType,
		rawData,
	) as StoredDocumentData;
	const prevType = window.__blemmyDocumentType__;
	if (prevType !== undefined && prevType !== documentType) {
		clearDocumentEditHistory();
	}
	const existingRoot = document.getElementById(BLEMMY_DOC_ROOT_ID);
	if (existingRoot) {
		existingRoot.remove();
	}
	const legacyShell = document.getElementById(BLEMMY_DOC_SHELL_ID);
	if (legacyShell) {
		legacyShell.remove();
	}
	if (engineCleanup) {
		engineCleanup();
		engineCleanup = null;
	}

	window.__blemmyDocumentType__ = documentType;
	window.__blemmyDocument__ = validated;
	persistLastActiveDocType(documentType);
	getRuntimeHandler(documentType).persistLocal?.(validated);

	if (isLikelyCvData(validated) && validated.basics.portraitDataUrl) {
		void savePortraitLocalCache(validated.basics.portraitDataUrl);
	}

	const layoutPayload = validated as unknown as {
		realisedLayout?: unknown;
		layoutSnapshot?: unknown;
	};
	if (isLikelyCvData(validated)) {
		layoutAuditLog('remount', {
			cvHash: hashCvForAudit(validated),
			documentType,
		});
	} else {
		layoutAuditLog('remount', { documentType });
	}

	window.dispatchEvent(
		new CustomEvent(BLEMMY_ACTIVE_DOCUMENT_CHANGED, {
			detail: { documentType },
		}),
	);

	const root = getRuntimeHandler(documentType).render(validated);
	document.body.insertBefore(root, document.body.firstChild);
	const shell = document.getElementById(BLEMMY_DOC_SHELL_ID);
	if (!shell) {
		throw new Error(`[main] #${BLEMMY_DOC_SHELL_ID} not found after render`);
	}
	activateShell(shell);
	ensurePaperStageIfNeeded();

	if (isLikelyCvData(validated)) {
		initFilterBar(validated);
	}

	const hasSharedLayout = Boolean(
		layoutPayload.layoutSnapshot || layoutPayload.realisedLayout,
	);
	let skipEngineForStaticLayout = false;
	const docSpec = getDocTypeSpec(documentType);
	if (isShareReadonlyMode() && docSpec) {
		if (
			layoutPayload.realisedLayout &&
			applyRealisedLayout(
				layoutPayload.realisedLayout as never,
				docSpec,
			)
		) {
			skipEngineForStaticLayout = true;
		} else if (layoutPayload.layoutSnapshot) {
			const migrated = migrateSnapshot(
				layoutPayload.layoutSnapshot as never,
				docSpec,
			);
			if (applyRealisedLayout(migrated, docSpec)) {
				skipEngineForStaticLayout = true;
			} else {
				applyLayoutSnapshotToDom(layoutPayload.layoutSnapshot as never);
				window.dispatchEvent(new Event('blemmy-layout-applied'));
				skipEngineForStaticLayout = true;
			}
		}
	} else if (isShareReadonlyMode() && layoutPayload.layoutSnapshot) {
		applyLayoutSnapshotToDom(layoutPayload.layoutSnapshot as never);
		window.dispatchEvent(new Event('blemmy-layout-applied'));
		skipEngineForStaticLayout = true;
	}
	const engineSpec = docSpec ? deriveEngineSpec(docSpec) : null;
	engineCleanup =
		isShareReadonlyMode() && hasSharedLayout && skipEngineForStaticLayout
			? null
			: (engineSpec ? initCvLayoutEngine(engineSpec) : null) ?? null;
	persistSessionState();
	queueMicrotask(() => {
		window.dispatchEvent(new Event('resize'));
		requestAnimationFrame(() => {
			window.dispatchEvent(new Event('resize'));
		});
	});
}

/** DevTools / dock: same data path as upload → remount, without full reload. */
function resetToBundledDefaultsInApp(): void {
	prepareBundledDefaultsResetUi();
	closeDocument();
	resetBundledDocumentCaches();
	clearDocumentEditHistory();
	remountBlemmyDocument(loadCvData(), FALLBACK_DOCUMENT_TYPE_ID);
	dispatchHistoryChanged();
	dispatchLastChanges();
	console.info('[blemmy] Reset to bundled defaults.');
}

function applyStoredDocumentData(
	nextData: StoredDocumentData,
	recordHistory: boolean,
): void {
	const snap = getActiveDocumentSnapshot();
	const current = snap.data ?? undefined;
	const docType = snap.docType;
	if (isLikelyCvData(nextData)) {
		const curCv = isLikelyCvData(current) ? current : undefined;
		layoutAuditLog('apply-data:start', {
			recordHistory,
			beforeHash: hashCvForAudit(curCv),
			afterHash: hashCvForAudit(nextData),
		});
	}
	recordDocumentApplyHistory(current, nextData, recordHistory);
	remountBlemmyDocument(nextData, docType);
	if (isLikelyCvData(nextData)) {
		const leafChanges = getLastLeafChanges();
		layoutAuditLog('apply-data:done', {
			recordHistory,
			leafChanges: leafChanges.length,
			canUndo: documentHistoryPast.length > 0,
			canRedo: documentHistoryFuture.length > 0,
		});
	}
	dispatchHistoryChanged();
	dispatchLastChanges();
	persistSessionState();
}

function applyData(cv: CVData, recordHistory = true): void {
	applyStoredDocumentData(
		cloneDocumentData(cv),
		recordHistory,
	);
}

function undoCvChange(): void {
	const snap = getActiveDocumentSnapshot();
	const current = snap.data ?? undefined;
	const prev = undoDocumentEditHistory(current);
	if (!prev) { return; }
	try {
		const validated = validateDocumentByType(snap.docType, prev);
		remountBlemmyDocument(validated, snap.docType);
	} catch {
		clearDocumentEditHistory();
		return;
	}
	dispatchHistoryChanged();
	dispatchLastChanges();
	persistSessionState();
}

function redoCvChange(): void {
	const snap = getActiveDocumentSnapshot();
	const current = snap.data ?? undefined;
	const nextState = redoDocumentEditHistory(current);
	if (!nextState) { return; }
	try {
		const validated = validateDocumentByType(snap.docType, nextState);
		remountBlemmyDocument(validated, snap.docType);
	} catch {
		clearDocumentEditHistory();
		return;
	}
	dispatchHistoryChanged();
	dispatchLastChanges();
	persistSessionState();
}

function revertFieldChange(path: string): void {
	const snap = getActiveDocumentSnapshot();
	const current = snap.data;
	if (!current) { return; }
	const pending = [...getLastLeafChanges()];
	const idx = pending.findIndex((c) => c.path === path);
	if (idx < 0) { return; }
	const change = pending[idx] as LeafChange;
	if (!change) { return; }
	const next = cloneDocumentData(current) as unknown as Record<string, unknown>;
	const nextValue = change.state === 'applied'
		? change.beforeValue
		: change.afterValue;
	if (!setDocumentDataAtPath(next, path, nextValue)) { return; }
	const validated = validateDocumentByType(snap.docType, next);
	applyStoredDocumentData(validated, true);
	change.state = change.state === 'applied' ? 'reverted' : 'applied';
	pending[idx] = change;
	setLastLeafChanges(pending);
	dispatchLastChanges();
	persistSessionState();
}

/**
 * Wires filter chip click handlers onto the rendered filter bar.
 * Called after every mount since the bar is re-rendered with the shell.
 */
function initFilterBar(cv: CVData): void {
	const bar = document.getElementById('blemmy-filter-bar');
	if (!bar) { return; }

	bar.addEventListener('click', (e) => {
		const target = e.target as HTMLElement;

		// Chip click
		const chip = target.closest<HTMLElement>('[data-tag]');
		if (chip) {
			const tag          = chip.dataset.tag ?? '';
			const current      = getActiveDocumentData();
			if (!isLikelyCvData(current)) { return; }
			const newFilters   = toggleFilter(tag, current.activeFilters ?? []);
			const updatedData  = { ...current, activeFilters: newFilters };
			window.__blemmyDocument__ = updatedData;
			syncFilterBar(updatedData);
			applyData(updatedData, false);
			return;
		}

		// Clear button
		if (target.closest('#blemmy-filter-clear')) {
			const current = getActiveDocumentData();
			if (!isLikelyCvData(current)) { return; }
			const updatedData = { ...current, activeFilters: [] };
			window.__blemmyDocument__ = updatedData;
			applyData(updatedData, false);
		}
	});

	// Show/hide bar based on whether tags exist
	const hasTags = extractAllTags(cv).length > 0;
	bar.hidden = !hasTags;
}

// Boot — GitHub OAuth return in named popup: auth UI only (no CV mount / layout)
async function boot(): Promise<void> {
	if (shouldBootMinimalOAuthPopupOnly()) {
		finishBootUi();
		bootstrapOAuthFromUrl();
		return;
	}
	const shareToken = resolvedMode.shareToken;
	const embedToken = resolvedMode.embedToken;
	const readonlyMode = isReadonlyLikeMode(appMode);
	const sharedMode = appMode === 'shareReadonly';
	const publishedEmbedMode = appMode === 'publishedEmbed';
	const portfolioEmbedMode = appMode === 'portfolioEmbed';
	if (readonlyMode) {
		document.documentElement.classList.add('blemmy-share-readonly');
	} else {
		document.documentElement.classList.remove('blemmy-share-readonly');
		document.documentElement.classList.remove('blemmy-share-host');
	}
	document.documentElement.classList.toggle('blemmy-portfolio-embed', portfolioEmbedMode);
	document.documentElement.classList.toggle('blemmy-published-embed', publishedEmbedMode);
	startUiManager();
	setupPaperStageScale(readonlyMode || portfolioEmbedMode || appMode === 'pdfEmbed');
	if (appMode === 'normal') {
		await initPasswordlessAuthFromUrl();
	}
	const emptySession = {
		activeDocType: null as string | null,
		document: null as unknown | null,
		changes: [] as LeafChange[],
		past: [] as StoredDocumentData[],
		future: [] as StoredDocumentData[],
	};
	const loaded = appMode === 'normal' ? loadSessionState() : emptySession;
	const preferredDocType = appMode === 'normal' ? loadLastActiveDocType() : null;

	let bootDocType = FALLBACK_DOCUMENT_TYPE_ID;
	let bootData: unknown = loadCvData();
	let bootFromPreferredFallback = false;

	if (loaded.activeDocType != null && loaded.document != null) {
		bootDocType = loaded.activeDocType;
		bootData = loaded.document;
	} else if (preferredDocType != null) {
		const h = getRuntimeHandler(preferredDocType);
		const fb = h.loadLocalFallback?.();
		if (fb != null) {
			bootDocType = preferredDocType;
			bootData = fb;
			bootFromPreferredFallback = true;
		}
	}

	if (
		(loaded.document != null && loaded.activeDocType != null) ||
		bootFromPreferredFallback
	) {
		if (loaded.past.length > 0) {
			documentHistoryPast.push(
				...loaded.past.map((x) => cloneDocumentData(x)),
			);
		}
		if (loaded.future.length > 0) {
			documentHistoryFuture.push(
				...loaded.future.map((x) => cloneDocumentData(x)),
			);
		}
	}

	if (shareToken || embedToken) {
		if (shareToken && appMode === 'shareReadonly' && !location.pathname.includes('/share/')) {
			const targetPath = canonicalSharePath(
				shareToken,
				import.meta.env.BASE_URL ?? '/',
			);
			window.history.replaceState({}, '', targetPath);
		}
		if (embedToken && appMode === 'publishedEmbed' && !location.pathname.includes('/embed/')) {
			const targetPath = canonicalEmbedPath(
				embedToken,
				import.meta.env.BASE_URL ?? '/',
			);
			window.history.replaceState({}, '', targetPath);
		}
		const shared = await resolveShareToken((shareToken ?? embedToken) as string);
		if (!shared.ok) {
			mountShareError(shared.error.message);
			return;
		}
		bootData = shared.data.data;
		bootDocType = inferDocTypeFromData(shared.data.data as StoredDocumentData);
	}

	if (
		((loaded.document != null && loaded.activeDocType != null) ||
			bootFromPreferredFallback) &&
		loaded.changes.length > 0
	) {
		const baseForChanges = validateDocumentByType(
			bootDocType,
			bootData,
		) as StoredDocumentData;
		setLastLeafChanges(
			sanitizeLoadedDocumentChanges(
				baseForChanges,
				loaded.changes.map((c) => ({ ...c })),
			),
		);
	}

	if (appMode === 'pdfEmbed') {
		const pdfRaw = resolvedMode.pdfDocType;
		const pdfType =
			typeof pdfRaw === 'string' && isRegisteredDocumentType(pdfRaw)
				? pdfRaw
				: bootDocType;
		const h = getRuntimeHandler(pdfType);
		const pdfData = h.loadLocalFallback?.() ?? bootData;
		remountBlemmyDocument(pdfData, pdfType);
		const bootTimeout = window.setTimeout(() => { finishBootUi(); }, 2200);
		window.addEventListener('blemmy-layout-applied', () => {
			window.clearTimeout(bootTimeout);
			finishBootUi();
		}, { once: true });
		return;
	}

	if (isLikelyCvData(bootData)) {
		if (!bootData.basics.portraitDataUrl && hasUploadedData()) {
			const cachedPortrait = await loadPortraitLocalCache();
			if (cachedPortrait) {
				bootData = {
					...bootData,
					basics: {
						...bootData.basics,
						portraitDataUrl: cachedPortrait,
					},
				};
			}
		}
	}

	remountBlemmyDocument(bootData, bootDocType);
	const bootTimeout = window.setTimeout(() => { finishBootUi(); }, 2200);
	window.addEventListener('blemmy-layout-applied', () => {
		window.clearTimeout(bootTimeout);
		finishBootUi();
	}, { once: true });
	if (appMode === 'normal') {
		initLayoutAuditUi();
	}
	if (appMode === 'normal') {
		window.__blemmyRemountDocument__ = remountBlemmyDocument;
		window.cvUndo = undoCvChange;
		window.cvRedo = redoCvChange;
		window.cvCanUndo = () => documentHistoryPast.length > 0;
		window.cvCanRedo = () => documentHistoryFuture.length > 0;
		window.cvRevertField = revertFieldChange;
		window.blemmyResetToBundledDefaults = resetToBundledDefaultsInApp;
		document.addEventListener('keydown', (e) => {
			const target = e.target as HTMLElement | null;
			const isTyping = Boolean(
				target &&
				(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
					target.isContentEditable),
			);
			if (isTyping) { return; }
			const key = e.key.toLowerCase();
			if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z') {
				e.preventDefault();
				undoCvChange();
				return;
			}
			if ((e.ctrlKey || e.metaKey) &&
				((e.shiftKey && key === 'z') || (!e.shiftKey && key === 'y'))) {
				e.preventDefault();
				redoCvChange();
			}
		});
		bootstrapOAuthFromUrl();
		initUIComponents((data) => { applyData(data, true); });
		dispatchHistoryChanged();
		dispatchLastChanges();
		window.addEventListener('beforeunload', () => {
			persistSessionState();
		});
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState !== 'hidden') { return; }
			persistSessionState();
		});
	}
	if (sharedMode) {
		const banner = document.createElement('div');
		banner.className = 'blemmy-share-banner no-print';
		const label = document.createElement('span');
		label.textContent = 'Shared CV view - read only';
		const copyBtn = document.createElement('button');
		copyBtn.type = 'button';
		copyBtn.className = 'blemmy-share-banner__btn';
		copyBtn.textContent = 'Copy link';
		copyBtn.addEventListener('click', () => {
			void copyText(window.location.href).then((ok) => {
				copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
				window.setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1200);
			});
		});
		banner.append(label, copyBtn);
		mountPaperStage(true, banner);
		if (isShareReviewModeEnabled()) {
			const isSmall = window.matchMedia('(max-width: 900px)').matches;
			initSharedReviewComponents(!isSmall);
		}
	}
	if (publishedEmbedMode) {
		mountPaperStage(true);
		mountEmbedFooter('Open full shared CV', window.location.href.replace('/embed/', '/share/'));
	}
	if (portfolioEmbedMode) {
		mountPaperStage(true);
		mountEmbedFooter('Open full demo', 'https://blemmy.dev/');
	}
	if (!portfolioEmbedMode && !publishedEmbedMode) {
		mountAboutUi(sharedMode);
	}
	if (appMode === 'normal') {
		onCvDataChanged((newData) => { applyData(newData, true); });
	}
}

void boot().catch((err: unknown) => {
	console.error('[cv] boot failed', err);
});
