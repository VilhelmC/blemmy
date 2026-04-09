/**
 * ui-components.ts
 *
 * Builds and mounts fixed UI chrome outside #blemmy-doc-shell:
 *   - Layout status badge           (#blemmy-layout-status)
 *   - Debug toggle button           (#blemmy-layout-debug-toggle)
 *   - Dev console help (dev only)   (#blemmy-dev-console-help-trigger, …)
 *   - View mode toggle              (#blemmy-view-mode-toggle)
 *   - Preferences panel + trigger   (#blemmy-prefs-panel, #blemmy-prefs-trigger)
 *   - Export menu (JSON + HTML)     (#blemmy-export-menu-trigger, …)
 *   - Cloud drawer + trigger        (#blemmy-cloud-drawer, #blemmy-cloud-trigger)
 *   - Candidate selector logic      (HTML is in blemmy-renderer.ts; script wired here)
 *   - Print / PDF button + modal    (#blemmy-download-pdf, #blemmy-pdf-modal)
 *   - Dark mode toggle              (#theme-toggle)
 *
 * Call initUIComponents() once after renderCV() has run.
 */

import {
	loadPrefs,
	savePrefs,
	dispatchPrefsChanged,
	dispatchAlternativeSelected,
	densityLabel,
	affinityLabel,
	ALTERNATIVES_READY_EVENT,
	PREFS_DEFAULTS,
	type CvPreferences,
	type PagePreference,
	type AlternativesReadyDetail,
	type AlternativeOption,
} from '@lib/layout-preferences';
import { rehydrateStyle, type DocumentStyle } from '@lib/document-style';

import { uploadCvData, hasUploadedData } from '@lib/profile-data-loader';

import { activateGenericEdit } from '@renderer/profile-editor';
import {
	loadDraft as loadGenericDraft,
	clearDraftByKey,
	type EditModeInstance as GenericEditModeInstance,
} from '@renderer/generic-editor';
import { getDocTypeSpec } from '@lib/document-type';
import { getRuntimeHandler } from '@lib/document-runtime-registry';
import {
	getActiveDocumentData,
	getActiveDocumentType,
} from '@lib/active-document-runtime';
import { commitDocumentEditFromUi } from '@lib/blemmy-document-apply';
import { isLikelyCvData } from '@lib/profile-data-loader';
import {
	BLEMMY_DOC_ROOT_ID,
	BLEMMY_DOC_SHELL_ID,
} from '@lib/blemmy-dom-ids';
import { buildStyleSection } from '@renderer/style-panel';
import { initReviewPanel } from '@renderer/review-panel';
import { REVIEW_PANEL_OPEN_EVENT } from '@renderer/review-panel';
import { initReviewOverlay, updateOverlay } from '@renderer/review-overlay';
import type { CVReview, ContentPath } from '@cv/review-types';
import { applyCommentOps } from '@lib/review-dom';

import { stripPortraitForJsonExport } from '@lib/profile-json-export';
import { exportStandaloneHtml } from '@lib/html-export';
import { CLOUD_ENABLED, type StoredDocumentData } from '@lib/cloud-client';
import {
	ASSISTANT_APPLY_MODE_CHANGED_EVENT,
	loadAssistantApplyMode,
	saveAssistantApplyMode,
	type AssistantApplyMode,
	type AssistantApplyModeChangedDetail,
} from '@lib/assistant-apply-preferences';
import { initBeforeUnloadGuard } from '@lib/document-sync';
import { initChatPanel } from '@renderer/chat-panel';
import { CHAT_OPEN_EVENT } from '@renderer/chat-panel';
import { DOCK_CONTROLS, buildDockButton } from '@renderer/dock-controls';
import { refreshDockPeekSlide } from '@renderer/ui-manager';
import { initDefaultHoverPinController } from '@renderer/hover-pin-controller';
import { initMobileUtilityBar } from '@renderer/mobile-utility-bar';
import { initDockedPopover } from '@renderer/docked-popover';
import { initDockedSidePanelFlow } from '@renderer/docked-side-panels';
import {
	DOCKED_PANEL_OPEN_EVENT,
	dispatchDockedPanelClose,
	dispatchDockedPanelOpen,
	type RightDockedPanelId,
} from '@renderer/docked-side-panels';
import {
	AUTH_CHANGED_EVENT,
	initAuthPanel,
	type AuthChangedDetail,
} from '@renderer/auth-panel';
import { initDocumentPanel } from '@renderer/document-panel';
import { BLEMMY_RESET_BUNDLED_UI_EVENT } from '@lib/blemmy-local-reset';
import {
	BLEMMY_DEV_CONSOLE_ENTRIES,
	copyBlemmyDevConsoleExpr,
	formatBlemmyDevConsoleHelpText,
	printBlemmyDevConsoleHelp,
	runBlemmyDevConsoleExpr,
} from '@lib/dev-console-help';

import type { CVData } from '@cv/cv';
import {
	columnSlackBelowDirectDivBlocksPx,
} from '@lib/engine/layout-slack';
import {
	analysePageAlignment,
} from '@lib/engine/layout-align';

// ─── DOM helper ───────────────────────────────────────────────────────────────

function h(
	tag:   string,
	attrs: Record<string, string> = {},
	...children: (Node | string | null | undefined)[]
): HTMLElement {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		el.setAttribute(k === 'className' ? 'class' : k, v);
	}
	for (const child of children) {
		if (child == null) { continue; }
		el.append(typeof child === 'string' ? document.createTextNode(child) : child);
	}
	return el;
}

type LastChangeDetail = {
	changes: Array<{
		path: string;
		before: string;
		after: string;
		state: 'applied' | 'reverted';
	}>;
};

let latestChanges: Array<{
	path: string;
	before: string;
	after: string;
	state: 'applied' | 'reverted';
}> = [];

// ─── Layout status ────────────────────────────────────────────────────────────

function buildLayoutStatus(): HTMLElement {
	return h('div', {
		id:         'blemmy-layout-status',
		class:      'blemmy-layout-status no-print',
		'aria-live': 'polite',
	});
}

// ─── Debug toggle ─────────────────────────────────────────────────────────────

function buildDebugToggle(): HTMLElement {
	return buildDockButton(h, DOCK_CONTROLS.debugLayout, {
		id: DOCK_CONTROLS.debugLayout.id,
		className: 'blemmy-layout-debug-toggle blemmy-history-btn',
		pressed: 'false',
	});
}

function buildDevConsoleHelpPanel(): {
	panel: HTMLElement;
	trigger: HTMLButtonElement;
} {
	const intro = h(
		'p',
		{ class: 'blemmy-dev-console-help__intro blemmy-prefs-heading' },
		'Browser console',
	);
	const note = h(
		'p',
		{ class: 'blemmy-dev-console-help__note' },
		'Normal app mode only. Open DevTools → Console, then paste or type.',
	);
	const list = h('ul', { class: 'blemmy-dev-console-help__list' });
	BLEMMY_DEV_CONSOLE_ENTRIES.forEach((e) => {
		const codeBtn = h(
			'button',
			{
				type: 'button',
				class: 'blemmy-dev-console-help__code-btn',
				title: 'Copy to clipboard',
				'aria-label': `Copy ${e.expr}`,
			},
			e.expr,
		) as HTMLButtonElement;
		const runBtn = h(
			'button',
			{
				type: 'button',
				class: 'blemmy-dev-console-help__run',
				title: e.kind === 'call' ? 'Run in page' : 'Inspect (log to console)',
				'aria-label':
					e.kind === 'call'
						? `Run ${e.expr}`
						: `Log ${e.expr} to console`,
			},
			'▶',
		) as HTMLButtonElement;
		const row = h(
			'div',
			{ class: 'blemmy-dev-console-help__row' },
			codeBtn,
			runBtn,
		);
		const hint = h('span', { class: 'blemmy-dev-console-help__hint' }, e.hint);
		codeBtn.addEventListener('click', () => {
			void (async (): Promise<void> => {
				const ok = await copyBlemmyDevConsoleExpr(e.expr);
				if (!ok) {
					window.alert('Clipboard unavailable.');
					return;
				}
				const prevTitle = codeBtn.title;
				codeBtn.title = 'Copied';
				window.setTimeout(() => { codeBtn.title = prevTitle; }, 1200);
			})();
		});
		runBtn.addEventListener('click', (ev) => {
			ev.stopPropagation();
			runBlemmyDevConsoleExpr(e.expr, e.kind);
		});
		list.appendChild(
			h('li', { class: 'blemmy-dev-console-help__item' }, row, hint),
		);
	});
	const logBtn = h(
		'button',
		{
			type: 'button',
			class: 'blemmy-dev-console-help__btn blemmy-dev-console-help__btn--ghost',
		},
		'Log to console',
	) as HTMLButtonElement;
	const copyBtn = h(
		'button',
		{ type: 'button', class: 'blemmy-dev-console-help__btn' },
		'Copy all',
	) as HTMLButtonElement;
	const actions = h(
		'div',
		{ class: 'blemmy-dev-console-help__actions' },
		copyBtn,
		logBtn,
	);
	logBtn.addEventListener('click', () => { printBlemmyDevConsoleHelp(); });
	copyBtn.addEventListener('click', () => {
		void navigator.clipboard.writeText(formatBlemmyDevConsoleHelpText()).catch(
			() => { window.alert('Clipboard unavailable.'); },
		);
	});
	const inner = h(
		'div',
		{ class: 'blemmy-prefs-inner blemmy-dev-console-help__inner' },
		intro,
		note,
		list,
		actions,
	);
	const panel = h(
		'div',
		{
			id: 'blemmy-dev-console-help-panel',
			class:
				'blemmy-dev-console-help blemmy-prefs-panel blemmy-docked-popover no-print',
			'aria-label': 'Developer console commands',
			hidden: '',
		},
		inner,
	);
	const trigger = buildDockButton(h, DOCK_CONTROLS.devConsoleHelp, {
		id: DOCK_CONTROLS.devConsoleHelp.id,
		className: 'blemmy-dev-console-help-trigger blemmy-history-btn',
		extraAttrs: {
			'aria-expanded': 'false',
			'aria-controls': 'blemmy-dev-console-help-panel',
		},
	});
	return { panel, trigger };
}

function initDevConsoleHelpPopover(): void {
	const panel = document.getElementById('blemmy-dev-console-help-panel');
	const trigger = document.getElementById('blemmy-dev-console-help-trigger');
	if (!panel || !trigger) { return; }
	initDockedPopover({
		panel,
		trigger,
		openClass: 'blemmy-dev-console-help-trigger--open',
		group: 'right-docked-panels',
		marginPx: 12,
	});
}

/** Debug overlays stay under dock chrome (z-index 220). */
const LAYOUT_DEBUG_OVERLAY_Z = 80;

/** Above dock shells / popovers so the export menu is not covered. */
const EXPORT_MENU_Z = 10060;

/**
 * Dock `.blemmy-ui-dock__zoom-shell` uses overflow auto/hidden, which clips an
 * absolutely positioned dropdown above the trigger. Fixed viewport coords
 * escape that clipping.
 */
function positionExportMenuPanel(
	trigger: HTMLButtonElement,
	panel: HTMLElement,
): void {
	if (panel.hidden) {
		return;
	}
	const gap = 8;
	const r = trigger.getBoundingClientRect();
	const pw = panel.offsetWidth;
	const ph = panel.offsetHeight;
	let left = r.right - pw;
	left = Math.min(
		Math.max(gap, left),
		window.innerWidth - gap - pw,
	);
	let top = r.top - ph - gap;
	if (top < gap) {
		top = r.bottom + gap;
	}
	if (top + ph > window.innerHeight - gap) {
		top = Math.max(gap, window.innerHeight - gap - ph);
	}
	panel.style.position = 'fixed';
	panel.style.left     = `${Math.round(left)}px`;
	panel.style.top      = `${Math.round(top)}px`;
	panel.style.right    = 'auto';
	panel.style.bottom   = 'auto';
	panel.style.zIndex   = String(EXPORT_MENU_Z);
}

function clearExportMenuPanelPosition(panel: HTMLElement): void {
	panel.style.removeProperty('position');
	panel.style.removeProperty('left');
	panel.style.removeProperty('top');
	panel.style.removeProperty('right');
	panel.style.removeProperty('bottom');
	panel.style.removeProperty('z-index');
}

function buildExportMenu(hCreate: typeof h): {
	root: HTMLElement;
	downloadJsonBtn: HTMLButtonElement;
	exportHtmlBtn: HTMLButtonElement;
} {
	const root = hCreate('div', { class: 'blemmy-export-menu-wrap' });
	const trigger = buildDockButton(hCreate, DOCK_CONTROLS.exportMenu, {
		id: DOCK_CONTROLS.exportMenu.id,
		className: 'blemmy-export-menu-trigger blemmy-history-btn',
		extraAttrs: {
			'aria-haspopup': 'true',
			'aria-expanded': 'false',
			'aria-controls': 'blemmy-export-menu-dropdown',
		},
	});
	const panel = hCreate('div', {
		id: 'blemmy-export-menu-dropdown',
		class: 'blemmy-export-menu-dropdown no-print',
		role: 'menu',
		hidden: '',
	});
	const downloadJsonBtn = buildDockButton(hCreate, DOCK_CONTROLS.downloadJson, {
		id: DOCK_CONTROLS.downloadJson.id,
		className: 'blemmy-export-menu__item blemmy-history-btn',
	});
	const exportHtmlBtn = buildDockButton(hCreate, DOCK_CONTROLS.exportHtml, {
		id: DOCK_CONTROLS.exportHtml.id,
		className: 'blemmy-export-menu__item blemmy-history-btn',
	});
	downloadJsonBtn.setAttribute('role', 'menuitem');
	exportHtmlBtn.setAttribute('role', 'menuitem');
	panel.append(downloadJsonBtn, exportHtmlBtn);
	root.append(trigger, panel);
	function close(): void {
		panel.hidden = true;
		clearExportMenuPanelPosition(panel);
		trigger.setAttribute('aria-expanded', 'false');
	}
	function open(): void {
		panel.hidden = false;
		trigger.setAttribute('aria-expanded', 'true');
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				positionExportMenuPanel(trigger, panel);
			});
		});
	}
	function onResizeOrScroll(): void {
		positionExportMenuPanel(trigger, panel);
	}
	trigger.addEventListener('click', (ev) => {
		ev.stopPropagation();
		if (panel.hidden) { open(); }
		else { close(); }
	});
	downloadJsonBtn.addEventListener('click', () => { close(); });
	exportHtmlBtn.addEventListener('click', () => { close(); });
	document.addEventListener('click', (ev) => {
		if (!root.contains(ev.target as Node)) { close(); }
	});
	document.addEventListener('keydown', (ev) => {
		if (ev.key === 'Escape') { close(); }
	});
	window.addEventListener('resize', onResizeOrScroll);
	window.addEventListener('scroll', onResizeOrScroll, true);
	return { root, downloadJsonBtn, exportHtmlBtn };
}

function initDebugToggle(): void {
	const html      = document.documentElement;
	const toggleEl  = document.getElementById('blemmy-layout-debug-toggle');
	const MM_TO_PX  = 96 / 25.4;
	let rafPending  = false;

	function setDebugState(on: boolean): void {
		html.classList.toggle('blemmy-debug-mode', on);
		if (toggleEl) {
			toggleEl.setAttribute('aria-pressed', String(on));
			toggleEl.textContent = on ? 'Debug On' : 'Debug';
			toggleEl.setAttribute(
				'title',
				on ? 'Disable layout debugging' : 'Enable layout debugging',
			);
		}
		if (on) { runDiagnostics(); }
		else    { clearHighlights(); }
	}

	function clearHighlights(): void {
		document.querySelectorAll('.blemmy-debug-ws-highlight').forEach((n) => n.remove());
	}

	function runDiagnostics(): void {
		clearHighlights();
		function mm(px: number): string {
			return `${(px / MM_TO_PX).toFixed(1)}mm`;
		}
		const cols = document.querySelectorAll<HTMLElement>('.blemmy-sidebar, .blemmy-main');
		cols.forEach((col) => {
			const slack = columnSlackBelowDirectDivBlocksPx(col);
			if (slack > 5 * MM_TO_PX) {
				const r     = col.getBoundingClientRect();
				const ov    = document.createElement('div');
				ov.className = 'blemmy-debug-ws-highlight ' +
					(col.classList.contains('blemmy-sidebar') ? 'blemmy-debug-ws-col-slack--sidebar' : 'blemmy-debug-ws-col-slack--main');
				ov.style.cssText = [
					`position:fixed`,
					`left:${r.left}px`,
					`top:${r.bottom - slack}px`,
					`width:${r.width}px`,
					`height:${slack}px`,
					`pointer-events:none`,
					`z-index:${LAYOUT_DEBUG_OVERLAY_Z}`,
				].join(';');
				document.body.appendChild(ov);

				const dim = document.createElement('div');
				dim.className = 'blemmy-debug-ws-highlight blemmy-debug-ws-dim';
				dim.style.cssText = [
					'position:fixed',
					`left:${Math.round(r.left + r.width - 18)}px`,
					`top:${Math.round(r.bottom - slack + 2)}px`,
					`height:${Math.max(4, Math.round(slack - 4))}px`,
					'pointer-events:none',
					`z-index:${LAYOUT_DEBUG_OVERLAY_Z + 1}`,
				].join(';');
				const line = document.createElement('div');
				line.className = 'blemmy-debug-ws-dim__line';
				const topArrow = document.createElement('div');
				topArrow.className = 'blemmy-debug-ws-dim__arrow blemmy-debug-ws-dim__arrow--top';
				const bottomArrow = document.createElement('div');
				bottomArrow.className = 'blemmy-debug-ws-dim__arrow blemmy-debug-ws-dim__arrow--bottom';
				const label = document.createElement('div');
				label.className = 'blemmy-debug-ws-dim__label';
				label.textContent = mm(slack);
				dim.append(topArrow, line, bottomArrow, label);
				document.body.appendChild(dim);
			}
		});

		const pages = [
			{
				page: document.getElementById('blemmy-page-1') as HTMLElement | null,
				sidebar: document.getElementById('blemmy-sidebar-1') as HTMLElement | null,
				main: document.getElementById('blemmy-main-1') as HTMLElement | null,
			},
			{
				page: document.getElementById('blemmy-page-2') as HTMLElement | null,
				sidebar: document.getElementById('blemmy-sidebar-2') as HTMLElement | null,
				main: document.getElementById('blemmy-main-2') as HTMLElement | null,
			},
		];
		pages.forEach(({ page, sidebar, main }) => {
			if (!page || !sidebar || !main) { return; }
			if (getComputedStyle(page).display === 'none') { return; }
			const report = analysePageAlignment(page, sidebar, main);
			report.pairs.forEach((pair) => {
				const sbRect = pair.sidebar.el.getBoundingClientRect();
				const mnRect = pair.main.el.getBoundingClientRect();
				const y = Math.round((sbRect.top + mnRect.top) / 2);
				const line = document.createElement('div');
				line.className = 'blemmy-debug-ws-highlight blemmy-debug-ws-align-line';
				line.style.cssText = [
					'position:fixed',
					`left:${Math.round(sbRect.left)}px`,
					`top:${y}px`,
					`width:${Math.round(mnRect.right - sbRect.left)}px`,
					'height:1px',
					'pointer-events:none',
					`z-index:${LAYOUT_DEBUG_OVERLAY_Z}`,
				].join(';');
				document.body.appendChild(line);
			});
		});

		const portraitCell = document.getElementById('blemmy-p1-portrait-cell');
		const portraitWrap = portraitCell?.querySelector<HTMLElement>('.blemmy-portrait-wrap');
		if (portraitCell && portraitWrap) {
			const cellRect = portraitCell.getBoundingClientRect();
			const wrapRect = portraitWrap.getBoundingClientRect();
			const topGap = Math.max(0, wrapRect.top - cellRect.top);
			if (topGap > 2) {
				const ov = document.createElement('div');
				ov.className = 'blemmy-debug-ws-highlight blemmy-debug-ws-portrait-gap';
				ov.style.cssText = [
					'position:fixed',
					`left:${cellRect.left}px`,
					`top:${cellRect.top}px`,
					`width:${cellRect.width}px`,
					`height:${topGap}px`,
					'pointer-events:none',
					`z-index:${LAYOUT_DEBUG_OVERLAY_Z}`,
				].join(';');
				document.body.appendChild(ov);
			}
		}
	}

	function scheduleDiagnostics(): void {
		if (!html.classList.contains('blemmy-debug-mode')) { return; }
		if (rafPending) { return; }
		rafPending = true;
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				rafPending = false;
				runDiagnostics();
			});
		});
	}

	toggleEl?.addEventListener('click', () => {
		const on = html.classList.contains('blemmy-debug-mode');
		setDebugState(!on);
	});

	const debugScrollRoots = new WeakSet<Element>();
	function bindDocRootScroll(): void {
		for (const id of [BLEMMY_DOC_ROOT_ID] as const) {
			const el = document.getElementById(id);
			if (!el || debugScrollRoots.has(el)) { continue; }
			debugScrollRoots.add(el);
			el.addEventListener('scroll', scheduleDiagnostics, { passive: true });
		}
	}

	// Re-run diagnostics after each layout pass (+ track doc root after remount).
	window.addEventListener('blemmy-layout-applied', () => {
		bindDocRootScroll();
		scheduleDiagnostics();
	});

	// Keep overlays aligned while scrolling, resizing, and dock/panel layout.
	window.addEventListener('scroll', scheduleDiagnostics, { passive: true });
	window.addEventListener('resize', scheduleDiagnostics);
	window.addEventListener('blemmy-ui-viewport-changed', scheduleDiagnostics);
	bindDocRootScroll();

	// Init from URL param
	const flag = new URL(window.location.href).searchParams.get('debug-layout');
	if (flag === '1') { setDebugState(true); }
}

/** Document shell for the mounted CV or letter (single id). */
function activeDocumentShell(): HTMLElement | null {
	const el = document.getElementById(BLEMMY_DOC_SHELL_ID);
	return el instanceof HTMLElement ? el : null;
}

function activeLayoutCard(): HTMLElement | null {
	const el = document.getElementById('blemmy-card');
	return el instanceof HTMLElement ? el : null;
}

/** Web view → “Preview PDF”; Print view → “Print”. */
function syncPrintFabLabel(): void {
	const fab   = document.getElementById('blemmy-download-pdf');
	const shell = activeDocumentShell();
	if (!fab || !shell) { return; }
	const printView = shell.classList.contains('blemmy-print-preview');
	if (printView) {
		fab.setAttribute('aria-label', 'Print or save as PDF');
		fab.setAttribute('title', 'Print or save as PDF');
		fab.textContent = 'Print';
	} else {
		fab.setAttribute('aria-label', 'Preview PDF');
		fab.setAttribute('title', 'Preview PDF');
		fab.textContent = 'Preview PDF';
	}
}

// ─── View mode toggle ─────────────────────────────────────────────────────────

function buildViewModeToggle(): HTMLElement {
	return buildDockButton(h, DOCK_CONTROLS.viewMode, {
		id: DOCK_CONTROLS.viewMode.id,
		className: 'blemmy-view-mode-toggle',
		pressed: 'false',
	});
}

function initViewModeToggle(): void {
	const btn   = document.getElementById('blemmy-view-mode-toggle') as HTMLButtonElement | null;
	const KEY   = 'blemmy-view-mode';
	function currentShell(): HTMLElement | null {
		return activeDocumentShell();
	}

	function setLabel(): void {
		const shell = currentShell();
		if (!btn || !shell) { return; }
		const on = shell.classList.contains('blemmy-print-preview');
		btn.setAttribute('aria-pressed', String(on));
		btn.textContent = on ? 'Web view' : 'Print view';
		btn.setAttribute(
			'title',
			on ? 'Switch to web view' : 'Switch to print view',
		);
	}

	function apply(mode: 'print' | 'web'): void {
		const shell = currentShell();
		if (!shell) { return; }
		document.documentElement.classList.toggle('blemmy-print-surface', mode === 'print');
		shell.classList.toggle('blemmy-print-preview', mode === 'print');
		try { localStorage.setItem(KEY, mode); } catch { /* ignore */ }
		setLabel();
		syncPrintFabLabel();
		window.dispatchEvent(new Event('blemmy-view-mode-changed'));
		window.dispatchEvent(new Event('resize'));
	}

	btn?.addEventListener('click', () => {
		const shell = currentShell();
		apply(shell?.classList.contains('blemmy-print-preview') ? 'web' : 'print');
	});
	window.addEventListener('blemmy-layout-applied', () => {
		setLabel();
		syncPrintFabLabel();
	});

	setLabel();
	syncPrintFabLabel();
}

// ─── Preferences panel ────────────────────────────────────────────────────────

// Affinity slider: 5 discrete steps mapped to weight values
const AFFINITY_STEPS = [0.5, 0.8, 1.2, 1.8, 2.5] as const;

function stepToWeight(step: number): number {
	return AFFINITY_STEPS[Math.max(0, Math.min(AFFINITY_STEPS.length - 1, step))] ?? 1.2;
}

function weightToStep(weight: number): number {
	let closest = 0;
	let minDiff = Infinity;
	for (let i = 0; i < AFFINITY_STEPS.length; i++) {
		const diff = Math.abs((AFFINITY_STEPS[i] as number) - weight);
		if (diff < minDiff) { minDiff = diff; closest = i; }
	}
	return closest;
}

function buildPreferencesPanel(): { panel: HTMLElement; trigger: HTMLElement } {
	// Density row
	const densityVal    = h('span', { id: 'blemmy-prefs-density-val', class: 'blemmy-prefs-val' }, 'Balanced');
	const densitySlider = h('input', {
		id:    'blemmy-prefs-density',
		class: 'blemmy-prefs-slider',
		type:  'range',
		min:   '0', max: '3', step: '1', value: '3',
		'aria-valuetext': 'Dense',
	});
	const densityRow = h('div', { class: 'blemmy-prefs-row' },
		h('label', { class: 'blemmy-prefs-label', for: 'blemmy-prefs-density' },
			h('span', {}, 'Typography'),
			densityVal,
		),
		h('div', { class: 'blemmy-prefs-track-row' },
			h('span', { class: 'blemmy-prefs-tick-label' }, 'Spacious'),
			densitySlider,
			h('span', { class: 'blemmy-prefs-tick-label blemmy-prefs-tick-right' }, 'Dense'),
		),
	);

	// Affinity row
	const affinityVal    = h('span', { id: 'blemmy-prefs-affinity-val', class: 'blemmy-prefs-val' }, 'Balanced');
	const affinitySlider = h('input', {
		id:    'blemmy-prefs-affinity',
		class: 'blemmy-prefs-slider',
		type:  'range',
		min:   '0', max: '4', step: '1', value: '2',
		'aria-valuetext': 'Balanced',
	});
	const affinityRow = h('div', { class: 'blemmy-prefs-row' },
		h('label', { class: 'blemmy-prefs-label', for: 'blemmy-prefs-affinity' },
			h('span', {}, 'Column fit'),
			affinityVal,
		),
		h('div', { class: 'blemmy-prefs-track-row' },
			h('span', { class: 'blemmy-prefs-tick-label' }, 'Flexible'),
			affinitySlider,
			h('span', { class: 'blemmy-prefs-tick-label blemmy-prefs-tick-right' }, 'Strict'),
		),
	);

	// Page preference row
	const pageBtns: HTMLButtonElement[] = [
		h('button', { class: 'blemmy-prefs-page-btn', 'data-pref': 'prefer-1', type: 'button' }, '1 page') as HTMLButtonElement,
		h('button', { class: 'blemmy-prefs-page-btn blemmy-prefs-page-btn--active', 'data-pref': 'auto', type: 'button' }, 'Auto') as HTMLButtonElement,
		h('button', { class: 'blemmy-prefs-page-btn', 'data-pref': 'prefer-2', type: 'button' }, '2 pages') as HTMLButtonElement,
	];
	const pageToggle = h('div', { class: 'blemmy-prefs-page-toggle', role: 'group', 'aria-label': 'Page preference' },
		...pageBtns,
	);
	const pageRow = h('div', { class: 'blemmy-prefs-row' },
		h('p', { class: 'blemmy-prefs-label' }, h('span', {}, 'Pages')),
		pageToggle,
	);

	const assistantApplyBtns: HTMLButtonElement[] = [
		h(
			'button',
			{
				class: 'blemmy-prefs-page-btn blemmy-prefs-page-btn--active',
				'data-assistant-apply': 'auto',
				type: 'button',
			},
			'Auto-apply',
		) as HTMLButtonElement,
		h(
			'button',
			{
				class: 'blemmy-prefs-page-btn',
				'data-assistant-apply': 'review',
				type: 'button',
			},
			'Review first',
		) as HTMLButtonElement,
	];
	const assistantApplyToggle = h(
		'div',
		{
			class: 'blemmy-prefs-page-toggle',
			role: 'group',
			'aria-label': 'Assistant document JSON',
		},
		...assistantApplyBtns,
	);
	const assistantRow = h('div', { class: 'blemmy-prefs-row' },
		h(
			'p',
			{ class: 'blemmy-prefs-label' },
			h('span', {}, 'Assistant'),
			h(
				'span',
				{ class: 'blemmy-prefs-assistant-hint' },
				' — JSON from the assistant',
			),
		),
		assistantApplyToggle,
	);

	const resetBtn = h('button', { id: 'blemmy-prefs-reset', class: 'blemmy-prefs-reset', type: 'button' }, 'Reset defaults');
	const { el: styleSection, syncUI: syncStyleUI } = buildStyleSection();
	(window as Window & {
		__blemmySyncStyleUI__?: (style: DocumentStyle) => void;
	}).__blemmySyncStyleUI__ = syncStyleUI;

	const inner = h('div', { class: 'blemmy-prefs-inner' },
		h('p', { class: 'blemmy-prefs-heading' }, 'Layout preferences'),
		densityRow,
		affinityRow,
		pageRow,
		assistantRow,
		resetBtn,
		h('hr', { class: 'blemmy-prefs-divider' }),
		styleSection,
	);

	const panel = h('div', {
		id:           'blemmy-prefs-panel',
		class:        'blemmy-prefs-panel blemmy-docked-popover no-print',
		'aria-label': 'Layout preferences',
		hidden:       '',
	}, inner);

	const trigger = buildDockButton(h, DOCK_CONTROLS.layoutPreferences, {
		id: DOCK_CONTROLS.layoutPreferences.id,
		className: 'blemmy-prefs-trigger',
		extraAttrs: {
			'aria-expanded': 'false',
			'aria-controls': 'blemmy-prefs-panel',
		},
	});

	return { panel, trigger };
}

function initPreferencesPanel(): void {
	const panel          = document.getElementById('blemmy-prefs-panel');
	const trigger        = document.getElementById('blemmy-prefs-trigger');
	const densitySlider  = document.getElementById('blemmy-prefs-density') as HTMLInputElement | null;
	const densityValEl   = document.getElementById('blemmy-prefs-density-val');
	const affinitySlider = document.getElementById('blemmy-prefs-affinity') as HTMLInputElement | null;
	const affinityValEl  = document.getElementById('blemmy-prefs-affinity-val');
	const resetBtn = document.getElementById('blemmy-prefs-reset');

	if (!panel || !trigger || !densitySlider || !affinitySlider) { return; }

	const pageBtns = panel.querySelectorAll<HTMLButtonElement>(
		'.blemmy-prefs-page-btn:not([data-assistant-apply])',
	);
	const assistantApplyBtns = panel.querySelectorAll<HTMLButtonElement>(
		'[data-assistant-apply]',
	);

	// Narrowed non-nullable references for use inside closures.
	const densityEl  = densitySlider;
	const affinityEl = affinitySlider;

	let current: CvPreferences = loadPrefs();

	function syncUI(p: CvPreferences): void {
		densityEl.value = String(p.maxDensity);
		const dLabel = densityLabel(p.maxDensity);
		if (densityValEl)  { densityValEl.textContent = dLabel; }
		densityEl.setAttribute('aria-valuetext', dLabel);

		const aStep = weightToStep(p.affinityWeight);
		affinityEl.value = String(aStep);
		const aLabel = affinityLabel(p.affinityWeight);
		if (affinityValEl) { affinityValEl.textContent = aLabel; }
		affinityEl.setAttribute('aria-valuetext', aLabel);

		pageBtns.forEach((btn) => {
			const active = btn.dataset.pref === p.pagePreference;
			btn.classList.toggle('blemmy-prefs-page-btn--active', active);
			btn.setAttribute('aria-pressed', String(active));
		});
	}

	function syncAssistantApplyUI(mode: AssistantApplyMode): void {
		assistantApplyBtns.forEach((btn) => {
			const active = btn.dataset.assistantApply === mode;
			btn.classList.toggle('blemmy-prefs-page-btn--active', active);
			btn.setAttribute('aria-pressed', String(active));
		});
	}

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	function emit(p: CvPreferences): void {
		current = p;
		syncUI(p);
		if (debounceTimer) { clearTimeout(debounceTimer); }
		debounceTimer = setTimeout(() => {
			// Persist from UI side and trigger both update channels:
			// 1) explicit prefs event, 2) resize fallback.
			savePrefs(p);
			dispatchPrefsChanged(p);
			window.dispatchEvent(new Event('resize'));
		}, 250);
	}

	densityEl.addEventListener('input', () => {
		const level = parseInt(densityEl.value, 10) as 0 | 1 | 2 | 3;
		emit({ ...current, maxDensity: level });
	});

	affinityEl.addEventListener('input', () => {
		emit({ ...current, affinityWeight: stepToWeight(parseInt(affinityEl.value, 10)) });
	});

	pageBtns.forEach((btn) => {
		btn.addEventListener('click', () => {
			emit({ ...current, pagePreference: btn.dataset.pref as PagePreference });
		});
	});

	syncAssistantApplyUI(loadAssistantApplyMode());
	assistantApplyBtns.forEach((btn) => {
		btn.addEventListener('click', () => {
			const m = btn.dataset.assistantApply;
			if (m !== 'auto' && m !== 'review') {
				return;
			}
			saveAssistantApplyMode(m);
			syncAssistantApplyUI(m);
		});
	});
	window.addEventListener(
		ASSISTANT_APPLY_MODE_CHANGED_EVENT,
		((ev: Event) => {
			const e = ev as CustomEvent<AssistantApplyModeChangedDetail>;
			if (e.detail?.mode) {
				syncAssistantApplyUI(e.detail.mode);
			}
		}) as EventListener,
	);

	resetBtn?.addEventListener('click', () => { emit({ ...PREFS_DEFAULTS }); });
	initDockedPopover({
		panel,
		trigger,
		openClass: 'blemmy-prefs-trigger--open',
		group: 'left-docked-popovers',
		marginPx: 12,
	});

	syncUI(current);
}

// ─── Candidate selector logic ─────────────────────────────────────────────────

function initCandidateSelector(): void {
	const container = document.getElementById('blemmy-layout-alternatives');
	const optionsEl = document.getElementById('blemmy-layout-alternative-options');
	if (!container || !optionsEl) { return; }

	// Non-nullable refs for closure use
	const opts = optionsEl;
	const cont = container;

	function applySizeClass(): void {
		const w = cont.getBoundingClientRect().width;
		cont.classList.remove(
			'blemmy-layout-alternatives--s',
			'blemmy-layout-alternatives--m',
			'blemmy-layout-alternatives--l',
		);
		if (w < 360) {
			cont.classList.add('blemmy-layout-alternatives--s');
			return;
		}
		if (w < 620) {
			cont.classList.add('blemmy-layout-alternatives--m');
			return;
		}
		cont.classList.add('blemmy-layout-alternatives--l');
	}

	function renderOptions(options: AlternativeOption[]): void {
		opts.innerHTML = '';
		if (options.length < 2) {
			cont.hidden = true;
			return;
		}
		cont.hidden = false;
		options.forEach((opt, i) => {
			const btn = document.createElement('button') as HTMLButtonElement;
			btn.type      = 'button';
			btn.className = 'blemmy-layout-alternative' +
				(opt.active ? ' blemmy-layout-alternative--active' : '');
			btn.dataset.candidateId = opt.candidateId;
			btn.setAttribute('role',         'radio');
			btn.setAttribute('aria-checked', String(opt.active));
			btn.setAttribute('aria-label',   `Layout ${i + 1}: ${opt.label}`);
			const inner       = document.createElement('span');
			inner.className   = 'blemmy-layout-alternative__inner';
			inner.textContent = opt.label;
			btn.appendChild(inner);
			btn.addEventListener('click', () => { dispatchAlternativeSelected(opt.candidateId); });
			opts.appendChild(btn);
		});
		applySizeClass();
	}

	window.addEventListener(ALTERNATIVES_READY_EVENT, (e) => {
		renderOptions((e as CustomEvent<AlternativesReadyDetail>).detail.options);
	});
	window.addEventListener('resize', applySizeClass);
	window.visualViewport?.addEventListener('resize', applySizeClass);
	window.addEventListener('blemmy-ui-viewport-changed', applySizeClass);
}

// ─── Print / PDF button + modal ───────────────────────────────────────────────

function buildPrintButton(): { fab: HTMLElement; modal: HTMLElement } {
	const fab = buildDockButton(h, DOCK_CONTROLS.printPdf, {
		id: DOCK_CONTROLS.printPdf.id,
		className: 'blemmy-download-pdf-btn',
	});

	const backdrop     = h('div', { class: 'blemmy-pdf-modal-backdrop', id: 'blemmy-pdf-modal-backdrop' });
	const downloadBtn  = h('button', { type: 'button', id: 'blemmy-pdf-modal-download', class: 'blemmy-pdf-modal-download-btn' }, 'Print / Save PDF');
	const closeBtn     = h('button', { type: 'button', id: 'blemmy-pdf-modal-close', class: 'blemmy-pdf-modal-close', 'aria-label': 'Close' }, 'Close');
	const loadingEl    = h('p', { id: 'blemmy-pdf-modal-loading', class: 'blemmy-pdf-modal-loading', 'aria-live': 'polite' }, 'Loading preview…');
	const frameEl      = h('iframe', {
		id: 'blemmy-pdf-modal-frame',
		class: 'blemmy-pdf-modal-embed',
		title: 'Live PDF preview',
	});

	const modalScroll  = h('div', { class: 'blemmy-pdf-modal-scroll' }, frameEl);
	const modalBody    = h('div', { class: 'blemmy-pdf-modal-body' }, loadingEl, modalScroll);
	const modalHeader  = h('header', { class: 'blemmy-pdf-modal-header' },
		h('h2', { id: 'blemmy-pdf-modal-title', class: 'blemmy-pdf-modal-title' }, 'PDF Preview'),
		h('div', { class: 'blemmy-pdf-modal-actions' }, downloadBtn, closeBtn),
	);
	const modalPanel   = h('div', { class: 'blemmy-pdf-modal-panel' }, modalHeader, modalBody);
	const modal = h('div', {
		id:               'blemmy-pdf-modal',
		class:            'blemmy-pdf-modal no-print',
		role:             'dialog',
		'aria-modal':     'true',
		'aria-labelledby': 'blemmy-pdf-modal-title',
		hidden:           '',
	}, backdrop, modalPanel);

	return { fab, modal };
}

const PDF_MODAL_LOADING_TEXT = 'Loading preview…';

/** Print view + engine ready: same document, no iframe. */
function canPrintCurrentDocument(): boolean {
	const shell = activeDocumentShell();
	const card  = activeLayoutCard();
	const ready = card?.getAttribute('data-blemmy-layout-ready') === 'true';
	return Boolean(shell?.classList.contains('blemmy-print-preview') && ready);
}

function initPrintButton(): void {
	const modal       = document.getElementById('blemmy-pdf-modal');
	const frame       = document.getElementById('blemmy-pdf-modal-frame') as HTMLIFrameElement | null;
	const loadingEl   = document.getElementById('blemmy-pdf-modal-loading');
	const downloadBtn = document.getElementById('blemmy-pdf-modal-download');
	const closeBtn    = document.getElementById('blemmy-pdf-modal-close');
	const backdrop    = document.getElementById('blemmy-pdf-modal-backdrop');

	function openModalIframe(url: string): void {
		modal?.removeAttribute('hidden');
		document.body.style.overflow = 'hidden';
		if (loadingEl) {
			loadingEl.textContent = PDF_MODAL_LOADING_TEXT;
			loadingEl.style.display = '';
		}
		if (frame) {
			frame.style.display = 'none';
			frame.setAttribute('src', url);
		}
	}

	function closeModal(): void {
		modal?.setAttribute('hidden', '');
		document.body.style.overflow = '';
		if (frame) { frame.removeAttribute('src'); }
		if (loadingEl) {
			loadingEl.textContent = PDF_MODAL_LOADING_TEXT;
			loadingEl.style.display = '';
		}
	}

	document.getElementById('blemmy-download-pdf')?.addEventListener('click', (e) => {
		e.preventDefault();
		if (canPrintCurrentDocument()) {
			window.print();
			return;
		}
		const u = new URL(window.location.href);
		u.search = '';
		u.hash = '';
		u.searchParams.set('blemmy-pdf', '1');
		u.searchParams.set('blemmy-embed', '1');
		const docType = getActiveDocumentType();
		u.searchParams.set('doc-type', docType);
		u.searchParams.set('preview', String(Date.now()));
		openModalIframe(u.pathname + u.search);
	});

	downloadBtn?.addEventListener('click', () => {
		const w = frame?.contentWindow;
		if (!w) { return; }
		w.focus();
		w.print();
	});

	frame?.addEventListener('load', () => {
		if (modal?.hasAttribute('hidden')) { return; }
		if (loadingEl) { loadingEl.style.display = 'none'; }
		if (frame) { frame.style.display = ''; }
	});

	closeBtn?.addEventListener('click', closeModal);
	backdrop?.addEventListener('click', closeModal);
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && modal && !modal.hasAttribute('hidden')) {
			closeModal();
		}
	});

	syncPrintFabLabel();
}

// ─── Dark mode toggle ─────────────────────────────────────────────────────────

function buildThemeToggle(): HTMLElement {
	return buildDockButton(h, DOCK_CONTROLS.theme, {
		id: DOCK_CONTROLS.theme.id,
		className: 'theme-toggle',
	});
}

function initThemeToggle(): void {
	const toggle = document.getElementById('theme-toggle');
	const html   = document.documentElement;

	function setIcon(): void {
		if (!toggle) { return; }
		const isDark = html.classList.contains('dark');
		toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
		toggle.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
		toggle.setAttribute('aria-pressed', String(isDark));
		toggle.textContent = DOCK_CONTROLS.theme.label;
	}

	toggle?.addEventListener('click', () => {
		html.classList.toggle('dark');
		try {
			localStorage.setItem('theme', html.classList.contains('dark') ? 'dark' : 'light');
		} catch { /* ignore */ }
		setIcon();
	});

	setIcon();
}

// ─── JSON upload button ───────────────────────────────────────────────────────

function buildUploadButton(): HTMLElement {
	return buildDockButton(h, DOCK_CONTROLS.uploadJson, {
		id: DOCK_CONTROLS.uploadJson.id,
		className: 'blemmy-upload-btn blemmy-history-btn',
	});
}

function buildUploadStatus(): HTMLElement {
	return h('div', {
		id:    'blemmy-upload-status',
		class: 'blemmy-upload-status no-print',
		hidden: '',
	});
}

function initUploadButton(
	onUploaded: (data: CVData) => void,
): void {
	const btnEl  = document.getElementById('blemmy-upload-btn');
	const status = document.getElementById('blemmy-upload-status') as HTMLElement | null;
	if (!btnEl) { return; }
	const btn = btnEl; // narrowed non-nullable for closures

	// Hidden file input
	const input       = document.createElement('input');
	input.type        = 'file';
	input.accept      = '.json,application/json';
	input.style.display = 'none';
	document.body.appendChild(input);

	function showStatus(msg: string, kind: 'ok' | 'err'): void {
		if (!status) { return; }
		status.textContent = msg;
		status.hidden      = false;
		status.className   = `blemmy-upload-status no-print blemmy-upload-status--${kind}`;
	}

	function hideStatus(): void {
		if (!status) { return; }
		status.hidden = true;
	}

	btn.addEventListener('click', () => {
		input.click();
	});

	input.addEventListener('change', async () => {
		const file = input.files?.[0];
		if (!file) { return; }
		input.value = ''; // reset so same file can be reloaded
		try {
			showStatus('Validating…', 'ok');
			const data = await uploadCvData(file);
			showStatus(`Loaded: ${file.name}`, 'ok');
			setTimeout(hideStatus, 3000);
			onUploaded(data);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Unknown error';
			showStatus(`Error: ${msg}`, 'err');
		}
	});

	// Sync button label to upload state
	function syncLabel(): void {
		btn.textContent = DOCK_CONTROLS.uploadJson.label;
		btn.setAttribute(
			'title',
			hasUploadedData()
				? 'Upload JSON (custom data currently loaded)'
				: DOCK_CONTROLS.uploadJson.title,
		);
	}

	window.addEventListener('blemmy-layout-applied', syncLabel);
	syncLabel();
}

// ─── Edit mode button ─────────────────────────────────────────────────────────

function buildEditButton(): HTMLElement {
	return buildDockButton(h, DOCK_CONTROLS.editMode, {
		id: DOCK_CONTROLS.editMode.id,
		className: 'blemmy-edit-btn',
		pressed: 'false',
	});
}

let lastUnifiedPanelSig: string | null = null;

function syncUnifiedPanelState(): void {
	const html = document.documentElement;
	const isDesktop = window.matchMedia('(min-width: 901px)').matches;
	const chatOpen = Boolean(
		document.getElementById('blemmy-chat-panel')
		&& !document.getElementById('blemmy-chat-panel')?.hasAttribute('hidden'),
	);
	const reviewOpen = Boolean(
		document.getElementById('blemmy-review-panel')
		&& !document.getElementById('blemmy-review-panel')?.hasAttribute('hidden'),
	);
	const editingShell = document.querySelector(
		'.blemmy-shell[data-blemmy-editing="true"]',
	);
	const editOpen = Boolean(
		document.getElementById('blemmy-edit-panel')
			&& document.documentElement.classList.contains('blemmy-edit-mode'),
	) || Boolean(editingShell);
	const anyOpen = chatOpen || reviewOpen || editOpen;
	html.classList.toggle('blemmy-panel-open', anyOpen);
	html.classList.toggle('blemmy-panel-desktop', anyOpen && isDesktop);
	html.classList.toggle('blemmy-panel-mobile', anyOpen && !isDesktop);
	const sig = [
		Number(anyOpen),
		Number(isDesktop),
		Number(reviewOpen),
		Number(chatOpen),
		Number(editOpen),
	].join('|');
	if (lastUnifiedPanelSig !== sig) {
		lastUnifiedPanelSig = sig;
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				window.dispatchEvent(
					new CustomEvent('blemmy-ui-viewport-changed', {
						detail: { source: 'panel-state' },
					}),
				);
			});
		});
	}
}

function initResponsiveDockMode(
	leftDock: HTMLElement,
	rightDock: HTMLElement,
): void {
	const mobileMq = window.matchMedia('(max-width: 1100px)');
	let rafScheduled = false;
	const syncDock = (dock: HTMLElement): void => {
		if (mobileMq.matches) {
			dock.classList.add('blemmy-ui-dock--compact', 'blemmy-ui-dock--peek');
			return;
		}
		dock.classList.remove(
			'blemmy-ui-dock--peek',
			'blemmy-ui-dock--expanded',
		);
		if (dock.classList.contains('blemmy-ui-dock--compact')) {
			dock.classList.remove('blemmy-ui-dock--compact');
		}
		requestAnimationFrame(() => {
			const needsCompact = dock.scrollWidth > dock.clientWidth + 1;
			const hasCompact = dock.classList.contains('blemmy-ui-dock--compact');
			if (needsCompact !== hasCompact) {
				dock.classList.toggle('blemmy-ui-dock--compact', needsCompact);
			}
		});
	};
	const sync = (): void => {
		if (rafScheduled) { return; }
		rafScheduled = true;
		requestAnimationFrame(() => {
			rafScheduled = false;
			syncDock(leftDock);
			syncDock(rightDock);
			refreshDockPeekSlide();
		});
	};
	syncDock(leftDock);
	syncDock(rightDock);
	refreshDockPeekSlide();
	sync();
	window.addEventListener('resize', sync);
	window.visualViewport?.addEventListener('resize', sync);
	window.addEventListener('blemmy-layout-applied', sync);
	const observer = new MutationObserver(() => { sync(); });
	observer.observe(leftDock, { subtree: true, childList: true });
	observer.observe(rightDock, { subtree: true, childList: true });
}

function initNarrowDockPeek(
	leftAnchor: HTMLElement,
	rightAnchor: HTMLElement,
	leftDock: HTMLElement,
	rightDock: HTMLElement,
): void {
	const leftHandle = document.getElementById('blemmy-ui-dock-left-handle');
	const rightHandle = document.getElementById('blemmy-ui-dock-right-handle');
	if (!(leftHandle instanceof HTMLElement) || !(rightHandle instanceof HTMLElement)) {
		return;
	}
	const mq = window.matchMedia('(max-width: 1100px)');
	const controller = initDefaultHoverPinController([
		{
			id: 'left',
			handle: leftHandle,
			panel: leftDock,
			hoverRegion: leftAnchor,
		},
		{
			id: 'right',
			handle: rightHandle,
			panel: rightDock,
			hoverRegion: rightAnchor,
		},
	], {
		isEnabled: () => mq.matches,
		openClass: 'blemmy-ui-dock--expanded',
	});
	const onMq = (): void => {
		if (!mq.matches) { controller.closeAll(); }
	};
	if (typeof mq.addEventListener === 'function') {
		mq.addEventListener('change', onMq);
	} else {
		mq.addListener(onMq);
	}
}

function initNarrowUtilityBar(): void {
	const mq = window.matchMedia('(max-width: 760px)');
	const moreActionsBase = [
		{
			id: 'debug-layout',
			label: 'Debug',
			icon: DOCK_CONTROLS.debugLayout.icon,
			targetId: DOCK_CONTROLS.debugLayout.id,
		},
		{
			id: 'theme',
			label: 'Theme',
			icon: DOCK_CONTROLS.theme.icon,
			targetId: DOCK_CONTROLS.theme.id,
		},
		{
			id: 'cloud',
			label: 'Cloud',
			icon: DOCK_CONTROLS.cloud.icon,
			targetId: DOCK_CONTROLS.cloud.id,
		},
		{
			id: 'layout',
			label: 'Layout',
			icon: DOCK_CONTROLS.layoutPreferences.icon,
			targetId: DOCK_CONTROLS.layoutPreferences.id,
		},
		{
			id: 'upload-json',
			label: 'Upload JSON',
			icon: DOCK_CONTROLS.uploadJson.icon,
			targetId: DOCK_CONTROLS.uploadJson.id,
		},
		{
			id: 'download-json',
			label: 'Download JSON',
			icon: DOCK_CONTROLS.downloadJson.icon,
			targetId: DOCK_CONTROLS.downloadJson.id,
		},
		{
			id: 'export-html',
			label: 'Export HTML',
			icon: DOCK_CONTROLS.exportHtml.icon,
			targetId: DOCK_CONTROLS.exportHtml.id,
		},
		{
			id: 'print-pdf',
			label: 'Print / PDF',
			icon: DOCK_CONTROLS.printPdf.icon,
			targetId: DOCK_CONTROLS.printPdf.id,
		},
	] as const;
	const moreActions = import.meta.env.DEV
		? [
			...moreActionsBase,
			{
				id: 'dev-console-help',
				label: 'Console',
				icon: DOCK_CONTROLS.devConsoleHelp.icon,
				targetId: DOCK_CONTROLS.devConsoleHelp.id,
			},
		]
		: [...moreActionsBase];
	const utility = initMobileUtilityBar({
		isEnabled: () => mq.matches,
		primaryActions: [
			{
				id: 'edit',
				label: 'Edit',
				icon: DOCK_CONTROLS.editMode.icon,
				targetId: DOCK_CONTROLS.editMode.id,
			},
			{
				id: 'review',
				label: 'Review',
				icon: DOCK_CONTROLS.reviewMode.icon,
				targetId: DOCK_CONTROLS.reviewMode.id,
			},
			{
				id: 'chat',
				label: 'Assistant',
				icon: DOCK_CONTROLS.chat.icon,
				targetId: DOCK_CONTROLS.chat.id,
			},
		],
		moreActions,
	});
	const sync = (): void => { utility.sync(); };
	sync();
	window.addEventListener('resize', sync);
	window.visualViewport?.addEventListener('resize', sync);
	window.addEventListener('blemmy-layout-applied', sync);
	if (typeof mq.addEventListener === 'function') {
		mq.addEventListener('change', sync);
	} else {
		mq.addListener(sync);
	}
}

function initUnifiedPanelState(): void {
	syncUnifiedPanelState();
	const sync = (): void => { syncUnifiedPanelState(); };
	window.addEventListener('resize', sync);
	window.visualViewport?.addEventListener('resize', sync);
	window.addEventListener('blemmy-layout-applied', sync);
	window.addEventListener('blemmy-view-mode-changed', sync);
	const observer = new MutationObserver(() => { sync(); });
	observer.observe(document.body, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: ['hidden', 'class'],
	});
}

function buildHistoryControls(): HTMLElement {
	return h('div', {
		id:    'blemmy-history-controls',
		class: 'blemmy-history-controls no-print',
	},
		buildDockButton(h, DOCK_CONTROLS.undo, {
			id: DOCK_CONTROLS.undo.id,
			className: 'blemmy-history-btn',
		}),
		buildDockButton(h, DOCK_CONTROLS.redo, {
			id: DOCK_CONTROLS.redo.id,
			className: 'blemmy-history-btn',
		}),
		buildDockButton(h, DOCK_CONTROLS.resetDraft, {
			id: DOCK_CONTROLS.resetDraft.id,
			className: 'blemmy-history-btn blemmy-history-btn--danger',
		}),
	);
}

function initHistoryControls(): void {
	const undoBtn = document.getElementById('blemmy-undo-btn') as HTMLButtonElement | null;
	const redoBtn = document.getElementById('blemmy-redo-btn') as HTMLButtonElement | null;
	if (!undoBtn || !redoBtn) { return; }
	const undo = undoBtn;
	const redo = redoBtn;

	function syncState(): void {
		undo.disabled = !(window.cvCanUndo?.() ?? false);
		redo.disabled = !(window.cvCanRedo?.() ?? false);
	}

	undo.addEventListener('click', () => { window.cvUndo?.(); });
	redo.addEventListener('click', () => { window.cvRedo?.(); });
	window.addEventListener('blemmy-history-changed', syncState as EventListener);
	syncState();
}

function initChangeHighlighter(): void {
	const pop = h('div', {
		id:     'blemmy-ai-compare-popover',
		class:  'blemmy-ai-compare-popover no-print',
		hidden: '',
	});
	pop.appendChild(
		h('div', { class: 'blemmy-ai-compare-popover__col' },
			h('div', {
				id: 'blemmy-ai-compare-label',
				class: 'blemmy-ai-compare-popover__label',
			}, 'Previous value'),
			h('div', { id: 'blemmy-ai-compare-before', class: 'blemmy-ai-compare-popover__text' }),
		),
	);
	document.body.appendChild(pop);
	const labelEl = pop.querySelector('#blemmy-ai-compare-label') as HTMLElement | null;
	const beforeEl = pop.querySelector('#blemmy-ai-compare-before') as HTMLElement | null;

	function hidePopover(): void {
		pop.hidden = true;
	}

	function showPopover(target: HTMLElement): void {
		if (!beforeEl || !labelEl) { return; }
		const before = target.dataset.aiBefore ?? '';
		const after  = target.dataset.aiAfter ?? '';
		const state  = target.dataset.aiState ?? 'applied';
		const compareText = state === 'reverted' ? after : before;
		if (!compareText) {
			hidePopover();
			return;
		}
		beforeEl.textContent = compareText;
		labelEl.textContent = state === 'reverted'
			? 'Proposed value'
			: 'Previous value';
		const cs = window.getComputedStyle(target);
		pop.style.setProperty('--blemmy-ai-compare-font-size', cs.fontSize);
		pop.style.setProperty('--blemmy-ai-compare-line-height', cs.lineHeight);
		pop.style.setProperty('--blemmy-ai-compare-font-family', cs.fontFamily);
		const r = target.getBoundingClientRect();
		const panelW = 340;
		const gap = 12;
		let left = Math.round(r.right + gap);
		if (left + panelW > window.innerWidth - 8) {
			left = Math.round(r.left - panelW - gap);
		}
		if (left < 8) { left = 8; }
		const top = Math.max(8, Math.min(
			window.innerHeight - 120,
			Math.round(r.top),
		));
		pop.style.top = `${top}px`;
		pop.style.left = `${left}px`;
		pop.hidden = false;
	}

	document.addEventListener('mouseover', (e) => {
		const t = e.target;
		const changed = t instanceof Element
			? t.closest<HTMLElement>('.blemmy-ai-changed')
			: null;
		if (!changed) {
			hidePopover();
			return;
		}
		showPopover(changed);
	});
	document.addEventListener('mousemove', (e) => {
		const t = e.target;
		const changed = t instanceof Element
			? t.closest<HTMLElement>('.blemmy-ai-changed')
			: null;
		if (changed) { return; }
		hidePopover();
	});
	document.addEventListener('mouseout', (e) => {
		const to = (e.relatedTarget as HTMLElement | null);
		if (to?.closest('#blemmy-ai-compare-popover')) { return; }
		if (to?.closest('.blemmy-ai-changed')) { return; }
		hidePopover();
	});
	window.addEventListener('mouseout', (e) => {
		const rel = e.relatedTarget as Node | null;
		if (rel) { return; }
		hidePopover();
	});
	document.addEventListener('mouseleave', hidePopover);
	document.addEventListener('scroll', hidePopover, true);
	document.addEventListener('pointerdown', hidePopover, true);
	window.addEventListener('blur', hidePopover);
	window.addEventListener('blemmy-layout-applied', hidePopover);

	function clearBadges(): void {
		hidePopover();
		document.querySelectorAll('.blemmy-ai-undo-btn').forEach((n) => n.remove());
		document.querySelectorAll<HTMLElement>('.blemmy-ai-changed').forEach((el) => {
			el.classList.remove('blemmy-ai-changed');
			el.removeAttribute('title');
			delete el.dataset.aiBefore;
			delete el.dataset.aiAfter;
			delete el.dataset.aiState;
		});
	}

	function isFieldAffected(fieldPath: string, changePath: string): boolean {
		return (
			fieldPath === changePath ||
			fieldPath.startsWith(changePath + '.') ||
			changePath.startsWith(fieldPath + '.')
		);
	}

	function maybeAddUndoButton(
		el: HTMLElement,
		fieldPath: string,
		changePath: string,
	): void {
		const canUndoFromHere = (
			fieldPath === changePath ||
			fieldPath.startsWith(changePath + '.')
		);
		if (!canUndoFromHere || el.querySelector('.blemmy-ai-undo-btn')) { return; }
		if (window.getComputedStyle(el).display === 'none') { return; }
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'blemmy-ai-undo-btn no-print';
		const ch = latestChanges.find((c) => c.path === changePath);
		const isReverted = ch?.state === 'reverted';
		btn.textContent = isReverted ? 'Redo' : 'Undo';
		btn.title = isReverted
			? 'Re-apply this field change'
			: 'Undo this field change';
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			window.cvRevertField?.(changePath);
		});
		el.appendChild(btn);
	}

	function applyHighlights(): void {
		clearBadges();
		if (latestChanges.length === 0) { return; }
		const fields = document.querySelectorAll<HTMLElement>('[data-blemmy-field]');
		fields.forEach((el) => {
			const path = el.dataset.blemmyField ?? '';
			if (!path) { return; }
			for (const c of latestChanges) {
				if (!isFieldAffected(path, c.path)) { continue; }
				el.classList.add('blemmy-ai-changed');
				el.dataset.aiBefore = c.before;
				el.dataset.aiAfter  = c.after;
				el.dataset.aiState  = c.state;
				maybeAddUndoButton(el, path, c.path);
				break;
			}
		});
	}

	window.addEventListener('blemmy-last-changes', (e) => {
		latestChanges = (e as CustomEvent<LastChangeDetail>).detail?.changes ?? [];
		applyHighlights();
	});
	window.addEventListener('blemmy-layout-applied', applyHighlights);
}

function buildRecentChangesPanel(): HTMLElement {
	return h('div', {
		id:    'blemmy-recent-changes',
		class: 'blemmy-recent-changes no-print',
		hidden: '',
	},
		h('div', { class: 'blemmy-recent-changes__head' },
			h('span', { id: 'blemmy-recent-changes-title' }, 'Recent AI changes'),
			h('button', {
				id: 'blemmy-recent-changes-toggle',
				class: 'blemmy-recent-changes__toggle',
				type: 'button',
				'aria-expanded': 'true',
				title: 'Collapse recent changes',
			}, '−'),
		),
		h('div', { id: 'blemmy-recent-changes-list', class: 'blemmy-recent-changes__list' }),
	);
}

function initRecentChangesPanel(): void {
	const panel = document.getElementById('blemmy-recent-changes') as HTMLElement | null;
	const list  = document.getElementById('blemmy-recent-changes-list') as HTMLElement | null;
	const title = document.getElementById('blemmy-recent-changes-title') as HTMLElement | null;
	const toggle = document.getElementById('blemmy-recent-changes-toggle') as
		HTMLButtonElement | null;
	if (!panel || !list || !title || !toggle) { return; }
	const panelEl = panel;
	const listEl  = list;
	const titleEl = title;
	const toggleEl = toggle;
	const COLLAPSE_KEY = 'blemmy-recent-changes-collapsed';
	let collapsed = false;
	try { collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { /* ignore */ }

	function syncCollapsedUi(): void {
		listEl.hidden = collapsed;
		toggleEl.textContent = collapsed ? '+' : '−';
		toggleEl.setAttribute('aria-expanded', String(!collapsed));
		toggleEl.title = collapsed
			? 'Expand recent changes'
			: 'Collapse recent changes';
	}

	toggleEl.addEventListener('click', () => {
		collapsed = !collapsed;
		try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
		syncCollapsedUi();
	});

	function clip(text: string, max = 80): string {
		return text.length > max ? text.slice(0, max - 1) + '…' : text;
	}

	function render(changes: Array<{
		path: string;
		before: string;
		after: string;
		state: 'applied' | 'reverted';
	}>): void {
		listEl.innerHTML = '';
		if (changes.length === 0) {
			panelEl.hidden = true;
			return;
		}
		panelEl.hidden = false;
		titleEl.textContent = `Recent AI changes (${changes.length})`;
		syncCollapsedUi();
		changes.slice(0, 8).forEach((c) => {
			const row = h('div', { class: 'blemmy-recent-changes__item' },
				h('div', { class: 'blemmy-recent-changes__path' }, c.path),
				h('div', { class: 'blemmy-recent-changes__delta' },
					h('span', { class: 'blemmy-recent-changes__before', title: c.before }, `Before: ${clip(c.before)}`),
					h('span', { class: 'blemmy-recent-changes__after', title: c.after }, `After: ${clip(c.after)}`),
				),
			);
			const btn = h('button', {
				class: 'blemmy-recent-changes__undo',
				type:  'button',
				title: c.state === 'reverted'
					? `Redo ${c.path}`
					: `Undo ${c.path}`,
			}, c.state === 'reverted' ? 'Redo' : 'Undo');
			btn.addEventListener('click', () => { window.cvRevertField?.(c.path); });
			row.appendChild(btn);
			listEl.appendChild(row);
		});
	}

	window.addEventListener('blemmy-last-changes', (e) => {
		const detail = (e as CustomEvent<LastChangeDetail>).detail;
		render(detail?.changes ?? []);
	});
}

function buildEditToolbar(): HTMLElement {
	return h('div', {
		id:     'blemmy-edit-toolbar',
		class:  'blemmy-edit-toolbar no-print',
		hidden: '',
	},
		h('span', { class: 'blemmy-edit-toolbar__hint' },
			'Click any text to edit  ·  Drag work items to reorder  ·  Click portrait to replace',
		),
	);
}

function initCloudSyncDrawer(): {
	onDataChange: (data: StoredDocumentData) => void;
	cloudTrigger: HTMLButtonElement;
} {
	const drawer = h('div', {
		id:           'blemmy-cloud-drawer',
		class:        'blemmy-side-panel blemmy-cloud-drawer blemmy-docked-popover no-print',
		hidden:       '',
		'aria-label': 'Cloud sync',
	});
	const inner = h('div', { class: 'blemmy-cloud-drawer__inner blemmy-prefs-inner' });
	const tabAuth = h('button', {
		type:              'button',
		role:              'tab',
		id:                'blemmy-cloud-tab-auth',
		class:             'blemmy-cloud-drawer__seg blemmy-cloud-drawer__seg--active',
		'aria-selected':   'true',
		'aria-controls':   'blemmy-cloud-pane-auth',
	}, 'Account') as HTMLButtonElement;
	const tabDocs = h('button', {
		type:              'button',
		role:              'tab',
		id:                'blemmy-cloud-tab-docs',
		class:             'blemmy-cloud-drawer__seg',
		'aria-selected':   'false',
		'aria-controls':   'blemmy-cloud-pane-docs',
	}, 'Documents') as HTMLButtonElement;
	const tabToggle = h('div', {
		class:        'blemmy-cloud-drawer__seg-wrap',
		role:         'tablist',
		'aria-label': 'Cloud sections',
	}, tabAuth, tabDocs);
	const syncChip = h('span', {
		id: 'blemmy-cloud-sync-chip', class: 'blemmy-cloud-drawer__sync', hidden: '',
	});
	const tabRow = h('div', { class: 'blemmy-cloud-drawer__tabrow', hidden: '' }, tabToggle, syncChip);
	const paneAuth = h('div', {
		id:                'blemmy-cloud-pane-auth',
		class:             'blemmy-cloud-drawer__pane',
		role:              'tabpanel',
		'aria-labelledby': 'blemmy-cloud-tab-auth',
	});
	const paneDocs = h('div', {
		id:                'blemmy-cloud-pane-docs',
		class:             'blemmy-cloud-drawer__pane',
		role:              'tabpanel',
		hidden:            '',
		'aria-labelledby': 'blemmy-cloud-tab-docs',
	});

	inner.append(
		h('p', { class: 'blemmy-prefs-heading' }, 'Cloud'),
		tabRow,
		paneAuth,
		paneDocs,
	);
	drawer.append(inner);
	document.body.appendChild(drawer);

	const cloudTrigger = buildDockButton(h, DOCK_CONTROLS.cloud, {
		id: DOCK_CONTROLS.cloud.id,
		className: 'blemmy-cloud-dock-trigger blemmy-history-btn',
		extraAttrs: {
			'aria-expanded': 'false',
			'aria-controls': 'blemmy-cloud-drawer',
		},
	});
	if (!CLOUD_ENABLED) {
		cloudTrigger.hidden = true;
	}

	let drawerOpen = false;
	let popover: ReturnType<typeof initDockedPopover> | null = null;

	function closeDrawer(): void {
		popover?.close();
	}

	function openDrawer(): void {
		popover?.open();
	}

	function setSyncIndicator(short: string, title: string): void {
		syncChip.textContent = short;
		syncChip.title = title;
		syncChip.hidden = !short;
	}

	window.addEventListener(AUTH_CHANGED_EVENT, (ev) => {
		const user = (ev as CustomEvent<AuthChangedDetail>).detail.user;
		setCloudAuthedChrome(Boolean(user));
		if (!user) {
			closeDrawer();
			setSyncIndicator('', '');
		}
	});

	const docApi = initDocumentPanel({
		mount: paneDocs,
		closeDrawer,
		setSyncIndicator,
	});

	initAuthPanel({ mount: paneAuth, closeDrawer });

	let cloudAuthed = false;

	function activateTab(which: 'auth' | 'docs'): void {
		if (which === 'docs' && !cloudAuthed) { return; }
		const authOn = which === 'auth';
		tabAuth.classList.toggle('blemmy-cloud-drawer__seg--active', authOn);
		tabAuth.setAttribute('aria-selected', String(authOn));
		tabDocs.classList.toggle('blemmy-cloud-drawer__seg--active', !authOn);
		tabDocs.setAttribute('aria-selected', String(!authOn));
		paneAuth.toggleAttribute('hidden', !authOn);
		paneDocs.toggleAttribute('hidden', authOn);
		if (!authOn) { void docApi.refreshDocs(); }
	}

	function setCloudAuthedChrome(authed: boolean): void {
		cloudAuthed = authed;
		tabRow.hidden = !authed;
		if (!authed) {
			activateTab('auth');
		}
	}

	tabAuth.addEventListener('click', () => activateTab('auth'));
	tabDocs.addEventListener('click', () => activateTab('docs'));

	popover = initDockedPopover({
		panel: drawer,
		trigger: cloudTrigger,
		openClass: 'blemmy-cloud-dock-trigger--open',
		group: 'left-docked-popovers',
		marginPx: 12,
		onOpen: () => { drawerOpen = true; },
		onClose: () => { drawerOpen = false; },
	});
	popover.refreshViewportFit();

	return { onDataChange: docApi.onDataChange, cloudTrigger };
}

// ─── Top-level init ───────────────────────────────────────────────────────────

/**
 * Builds and mounts all fixed-position UI chrome.
 * Takes a remount callback so the edit mode and upload handler can trigger
 * full re-renders when needed.
 *
 * Must be called after renderCV() has run.
 */
export function initUIComponents(
	remount: (data: CVData) => void = () => { /* noop if not provided */ },
): void {
	const leftAnchor = h('div', {
		id:    'blemmy-ui-dock-left-anchor',
		class: 'blemmy-ui-dock-anchor blemmy-ui-dock-anchor--left no-print',
	});
	const leftDock = h('div', { id: 'blemmy-ui-dock-left', class: 'blemmy-ui-dock no-print' });
	const leftZoomShell = h('div', { class: 'blemmy-ui-dock__zoom-shell' });
	const leftRail = h('div', {
		id:    'blemmy-ui-dock-left-rail',
		class: 'blemmy-ui-dock__rail',
	});
	const leftHandle = h('button', {
		type:            'button',
		id:              'blemmy-ui-dock-left-handle',
		class:           'blemmy-ui-dock__handle blemmy-ui-dock__handle--left no-print',
		'aria-expanded': 'false',
		'aria-label':    'Open or close left tool strip',
		'aria-controls': 'blemmy-ui-dock-left',
	});
	const rightAnchor = h('div', {
		id:    'blemmy-ui-dock-right-anchor',
		class: 'blemmy-ui-dock-anchor blemmy-ui-dock-anchor--right no-print',
	});
	const rightDock = h('div', { id: 'blemmy-ui-dock-right', class: 'blemmy-ui-dock no-print' });
	const rightZoomShell = h('div', { class: 'blemmy-ui-dock__zoom-shell' });
	const rightRail = h('div', {
		id:    'blemmy-ui-dock-right-rail',
		class: 'blemmy-ui-dock__rail',
	});
	const rightHandle = h('button', {
		type:            'button',
		id:              'blemmy-ui-dock-right-handle',
		class:           'blemmy-ui-dock__handle blemmy-ui-dock__handle--right no-print',
		'aria-expanded': 'false',
		'aria-label':    'Open or close right tool strip',
		'aria-controls': 'blemmy-ui-dock-right',
	});
	leftZoomShell.appendChild(leftRail);
	rightZoomShell.appendChild(rightRail);
	leftDock.appendChild(leftZoomShell);
	rightDock.appendChild(rightZoomShell);
	leftAnchor.append(leftHandle, leftDock);
	rightAnchor.append(rightDock, rightHandle);
	document.body.appendChild(leftAnchor);
	document.body.appendChild(rightAnchor);

	// Layout status + debug toggle
	document.body.appendChild(buildLayoutStatus());
	rightRail.appendChild(buildDebugToggle());
	if (import.meta.env.DEV) {
		const devHelp = buildDevConsoleHelpPanel();
		document.body.appendChild(devHelp.panel);
		rightRail.appendChild(devHelp.trigger);
	}

	// Candidate selector (content inside #blemmy-doc-shell, script wired here)

	// Preferences panel + trigger
	const { panel, trigger } = buildPreferencesPanel();
	document.body.appendChild(panel);
	leftRail.appendChild(trigger);

	const docPanelApi = initCloudSyncDrawer();

	// Upload + export menu (JSON / HTML) + status
	const uploadBtn = buildUploadButton();
	const exportMenu = buildExportMenu(h);
	leftRail.appendChild(uploadBtn);
	leftRail.appendChild(exportMenu.root);
	const dlBtn = exportMenu.downloadJsonBtn;
	const htmlExportBtn = exportMenu.exportHtmlBtn;
	document.body.appendChild(buildUploadStatus());

	// Edit button + history controls
	leftRail.appendChild(buildHistoryControls());
	rightRail.appendChild(buildEditButton());

	// v2.2 Review panel + overlay
	const reviewInst = initReviewPanel({
		getReview: () => {
			const d = getActiveDocumentData();
			return isLikelyCvData(d) ? d.review : undefined;
		},
		setReview: (r: CVReview) => {
			const d = getActiveDocumentData();
			if (isLikelyCvData(d)) {
				d.review = r;
			}
		},
		getData: () => {
			const d = getActiveDocumentData();
			return isLikelyCvData(d) ? d : undefined;
		},
	});
	document.body.appendChild(reviewInst.panel);
	rightRail.appendChild(reviewInst.toggle);
	initReviewOverlay((path) => { reviewInst.open(path); });
	window.addEventListener('blemmy-layout-applied', () => {
		const d = getActiveDocumentData();
		if (isLikelyCvData(d) && d.review) {
			updateOverlay(d.review);
		}
	});
	(window as Window & { __blemmyApplyReviewOps__?: typeof applyCommentOps }).__blemmyApplyReviewOps__ = applyCommentOps;
	(window as Window & { __blemmySyncReview__?: (r: CVReview) => void }).__blemmySyncReview__ = (r) => {
		reviewInst.syncReview(r);
		updateOverlay(r);
	};
	function toContentPath(raw: string): ContentPath {
		const parts = raw.split('.');
		let out = '';
		for (const part of parts) {
			if (/^\d+$/.test(part)) {
				out += `[${part}]`;
				continue;
			}
			out += out ? `.${part}` : part;
		}
		return out as ContentPath;
	}
	function resolveClickedPath(target: HTMLElement): ContentPath | null {
		const fieldHost = target.closest<HTMLElement>('[data-blemmy-field]');
		const fieldPath = fieldHost?.dataset.blemmyField?.trim();
		if (fieldPath) { return toContentPath(fieldPath); }
		const workEl = target.closest<HTMLElement>('.experience-block');
		const workIdx = workEl?.dataset.blemmyDragIdx;
		if (workIdx && /^\d+$/.test(workIdx)) {
			return `work[${workIdx}]` as ContentPath;
		}
		const eduField = target
			.closest<HTMLElement>('.education-block')
			?.querySelector<HTMLElement>('[data-blemmy-field^="education."]')
			?.dataset.blemmyField;
		if (eduField) { return toContentPath(eduField).replace(/(\.\w+)+$/, '') as ContentPath; }
		return null;
	}
	document.body.addEventListener('click', (event) => {
		if (!document.documentElement.classList.contains('blemmy-review-mode')) {
			return;
		}
		const target = event.target as HTMLElement | null;
		if (!target?.closest('.blemmy-shell')) { return; }
		const path = resolveClickedPath(target);
		if (!path) { return; }
		event.preventDefault();
		reviewInst.open(path);
	});

	// Print button + modal
	const { fab, modal } = buildPrintButton();
	rightRail.appendChild(fab);
	document.body.appendChild(modal);

	// Theme toggle, chat, cloud — circular dock controls grouped together
	rightRail.appendChild(buildThemeToggle());

	const { panel: chatPanel, toggle: chatTrigger } = initChatPanel();
	document.body.appendChild(chatPanel);
	rightRail.appendChild(chatTrigger);
	rightRail.appendChild(docPanelApi.cloudTrigger);
	chatPanel.appendChild(buildRecentChangesPanel());

	rehydrateStyle();
	initBeforeUnloadGuard();
	initUnifiedPanelState();
	initResponsiveDockMode(leftDock, rightDock);
	initNarrowDockPeek(leftAnchor, rightAnchor, leftDock, rightDock);
	initNarrowUtilityBar();
	requestAnimationFrame(() => {
		refreshDockPeekSlide();
	});

	const sideFlow = initDockedSidePanelFlow({
		getPanels: () => {
			const ids = ['blemmy-edit-panel', 'blemmy-review-panel', 'blemmy-chat-panel'];
			return ids
				.map((id) => document.getElementById(id))
				.filter((el): el is HTMLElement => el instanceof HTMLElement);
		},
	});

	// ── Wire up event listeners ───────────────────────────────────────────────
	initDebugToggle();
	if (import.meta.env.DEV) {
		initDevConsoleHelpPopover();
	}
	initPreferencesPanel();
	initCandidateSelector();
	initPrintButton();
	initThemeToggle();
	initHistoryControls();
	initChangeHighlighter();
	initRecentChangesPanel();

	// Download JSON action
	dlBtn.addEventListener('click', () => {
		const activeType = getActiveDocumentType();
		const raw = getActiveDocumentData();
		if (!raw || typeof raw !== 'object') {
			return;
		}
		const payload =
			activeType === 'cv' && isLikelyCvData(raw)
				? stripPortraitForJsonExport(raw)
				: raw;
		const forFile = {
			docType: activeType,
			...(payload as unknown as Record<string, unknown>),
		};
		const blob = new Blob([JSON.stringify(forFile, null, '\t')], {
			type: 'application/json',
		});
		const url  = URL.createObjectURL(blob);
		const a    = document.createElement('a');
		a.href     = url;
		a.download = activeType === 'letter'
			? 'letter-content.json'
			: 'blemmy-content.json';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	});

	htmlExportBtn.addEventListener('click', () => {
		const ok = exportStandaloneHtml();
		if (!ok) {
			window.alert('No document shell found — make sure a document is loaded.');
		}
	});

	// Upload button — triggers re-render via remount
	initUploadButton((uploadedData) => {
		remount(uploadedData);
	});

	// Edit mode — toggle button + toolbar
	let editInstance: GenericEditModeInstance | null = null;
	// Track whether edit mode was active before a remount
	let editWasActive = false;

	const editBtn = document.getElementById('blemmy-edit-btn');
	const resetDraftBtn = document.getElementById('blemmy-reset-draft-btn');

	function setEditActive(on: boolean): void {
		if (!editBtn) { return; }
		editBtn.setAttribute('aria-pressed', String(on));
		editBtn.textContent = on ? 'Editing' : 'Edit';
		editBtn.classList.toggle('blemmy-edit-btn--active', on);
	}

	function closeChatPanelIfOpen(): void {
		const panel = document.getElementById('blemmy-chat-panel');
		if (!(panel instanceof HTMLElement) || panel.hidden) { return; }
		const triggerEl = document.getElementById('blemmy-chat-trigger');
		if (triggerEl instanceof HTMLElement) { triggerEl.click(); }
	}

	function closeEditPanelIfOpen(): void {
		if (!editInstance) { return; }
		editInstance.deactivate();
		editInstance = null;
		editWasActive = false;
		setEditActive(false);
		dispatchDockedPanelClose('blemmy-edit-panel');
	}

	window.addEventListener(BLEMMY_RESET_BUNDLED_UI_EVENT, () => {
		closeEditPanelIfOpen();
		sideFlow.sync();
	});

	window.addEventListener(CHAT_OPEN_EVENT, () => {
		reviewInst.close();
		closeEditPanelIfOpen();
		sideFlow.sync();
	});
	window.addEventListener(REVIEW_PANEL_OPEN_EVENT, () => {
		closeChatPanelIfOpen();
		closeEditPanelIfOpen();
		sideFlow.sync();
	});
	window.addEventListener(DOCKED_PANEL_OPEN_EVENT, (event) => {
		const panelId = (event as CustomEvent<{ panelId: RightDockedPanelId }>)
			.detail?.panelId;
		if (!panelId) { return; }
		if (panelId !== 'blemmy-chat-panel') { closeChatPanelIfOpen(); }
		if (panelId !== 'blemmy-review-panel') { reviewInst.close(); }
		if (panelId !== 'blemmy-edit-panel') { closeEditPanelIfOpen(); }
		sideFlow.sync();
	});

	function activateEdit(): void {
		const activeDocType = getActiveDocumentType();
		const base = getActiveDocumentData();
		if (base == null) {
			return;
		}
		const spec = getDocTypeSpec(activeDocType);
		if (!spec) {
			return;
		}
		const draftKey = `blemmy-doc-draft-${activeDocType}`;
		const data = loadGenericDraft<unknown>(draftKey) ?? base;
		editInstance = activateGenericEdit(
			data,
			BLEMMY_DOC_SHELL_ID,
			draftKey,
			spec,
			(newData) => {
				editWasActive = true;
				editInstance?.deactivate();
				editInstance = null;
				setEditActive(false);
				commitDocumentEditFromUi(newData, true);
				docPanelApi.onDataChange(newData as StoredDocumentData);
			},
			(updatedData) => {
				window.__blemmyDocument__ = updatedData;
				getRuntimeHandler(activeDocType).persistLocal?.(updatedData);
				docPanelApi.onDataChange(updatedData as StoredDocumentData);
			},
		);

		setEditActive(true);
		dispatchDockedPanelOpen('blemmy-edit-panel');
		closeChatPanelIfOpen();
		reviewInst.close();
		sideFlow.sync();
	}

	editBtn?.addEventListener('click', () => {
		if (editInstance) {
			editInstance.deactivate();
			editInstance = null;
			editWasActive = false;
			setEditActive(false);
			dispatchDockedPanelClose('blemmy-edit-panel');
			sideFlow.sync();
			return;
		}
		activateEdit();
	});

	resetDraftBtn?.addEventListener('click', () => {
		const activeDocType2 = getActiveDocumentType();
		const spec = getDocTypeSpec(activeDocType2);
		const label = spec?.label ?? 'document';
		if (!window.confirm(
			`Reset local draft edits to the currently loaded ${label}?`,
		)) {
			return;
		}
		clearDraftByKey(`blemmy-doc-draft-${activeDocType2}`);
		editInstance?.clearDraft();
		editInstance?.deactivate();
		editInstance = null;
		editWasActive = false;
		setEditActive(false);
		const base = getActiveDocumentData();
		if (base != null) {
			window.__blemmyRemountDocument__?.(base, activeDocType2);
		}
	});

	// After a remount (visibility change), auto-reactivate edit mode
	window.addEventListener('blemmy-layout-applied', () => {
		if (editWasActive && !editInstance) {
			editWasActive = false;
			activateEdit();
		}
		sideFlow.sync();
	});

}

export function initSharedReviewComponents(autoOpen = false): void {
	const leftDock = h('div', {
		id: 'blemmy-share-review-dock',
		class: 'blemmy-ui-dock no-print',
	});
	document.body.appendChild(leftDock);
	const reviewInst = initReviewPanel({
		getReview: () => {
			const d = getActiveDocumentData();
			return isLikelyCvData(d) ? d.review : undefined;
		},
		setReview: (r: CVReview) => {
			const d = getActiveDocumentData();
			if (isLikelyCvData(d)) {
				d.review = r;
			}
		},
		getData: () => {
			const d = getActiveDocumentData();
			return isLikelyCvData(d) ? d : undefined;
		},
	});
	document.body.appendChild(reviewInst.panel);
	leftDock.appendChild(reviewInst.toggle);
	initReviewOverlay((path) => { reviewInst.open(path); });
	window.addEventListener('blemmy-layout-applied', () => {
		const d = getActiveDocumentData();
		if (isLikelyCvData(d) && d.review) {
			updateOverlay(d.review);
		}
	});
	function toContentPath(raw: string): ContentPath {
		const parts = raw.split('.');
		let out = '';
		for (const part of parts) {
			if (/^\d+$/.test(part)) {
				out += `[${part}]`;
				continue;
			}
			out += out ? `.${part}` : part;
		}
		return out as ContentPath;
	}
	function resolveClickedPath(target: HTMLElement): ContentPath | null {
		const fieldHost = target.closest<HTMLElement>('[data-blemmy-field]');
		const fieldPath = fieldHost?.dataset.blemmyField?.trim();
		if (fieldPath) { return toContentPath(fieldPath); }
		const workEl = target.closest<HTMLElement>('.experience-block');
		const workIdx = workEl?.dataset.blemmyDragIdx;
		if (workIdx && /^\d+$/.test(workIdx)) {
			return `work[${workIdx}]` as ContentPath;
		}
		const eduField = target
			.closest<HTMLElement>('.education-block')
			?.querySelector<HTMLElement>('[data-blemmy-field^="education."]')
			?.dataset.blemmyField;
		if (eduField) {
			return toContentPath(eduField).replace(/(\.\w+)+$/, '') as ContentPath;
		}
		return null;
	}
	document.body.addEventListener('click', (event) => {
		if (!document.documentElement.classList.contains('blemmy-review-mode')) {
			return;
		}
		const target = event.target as HTMLElement | null;
		if (!target?.closest('.blemmy-shell')) { return; }
		const path = resolveClickedPath(target);
		if (!path) { return; }
		event.preventDefault();
		reviewInst.open(path);
	});
	const d0 = getActiveDocumentData();
	if (isLikelyCvData(d0) && d0.review) {
		reviewInst.syncReview(d0.review);
		updateOverlay(d0.review);
	}
	if (autoOpen) { reviewInst.open(); }
	initUnifiedPanelState();
}

