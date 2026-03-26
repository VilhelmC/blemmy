/**
 * ui-components.ts
 *
 * Builds and mounts all fixed-position UI chrome that lives outside #cv-shell:
 *   - Layout status badge           (#cv-layout-status)
 *   - Debug toggle button           (#cv-layout-debug-toggle)
 *   - View mode toggle              (#cv-view-mode-toggle)
 *   - Preferences panel + trigger   (#cv-prefs-panel, #cv-prefs-trigger)
 *   - Cloud drawer + trigger        (#cv-cloud-drawer, #cv-cloud-trigger)
 *   - Candidate selector logic      (HTML is in cv-renderer.ts; script wired here)
 *   - Print / PDF button + modal    (#cv-download-pdf, #cv-pdf-modal)
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
} from '@lib/cv-prefs';
import { rehydrateStyle, type DocumentStyle } from '@lib/document-style';

import {
	uploadCvData,
	clearUploadedCvData,
	clearLegacyPortraitStorage,
	hasUploadedData,
} from '@lib/cv-loader';

import {
	activateEditMode,
	loadDraft,
	clearDraft,
	type EditModeInstance,
} from '@renderer/cv-editor';
import { buildStyleSection } from '@renderer/style-panel';
import { initReviewPanel } from '@renderer/review-panel';
import { initReviewOverlay, updateOverlay } from '@renderer/review-overlay';
import type { CVReview, ContentPath } from '@cv/cv-review';
import { applyCommentOps } from '@lib/cv-review';

import { stripPortraitForJsonExport } from '@lib/cv-json-export';
import { CLOUD_ENABLED } from '@lib/cv-cloud';
import { initBeforeUnloadGuard } from '@lib/cv-sync';
import { initChatPanel } from '@renderer/chat-panel';
import {
	AUTH_CHANGED_EVENT,
	initAuthPanel,
	type AuthChangedDetail,
} from '@renderer/auth-panel';
import { initDocumentPanel } from '@renderer/document-panel';

import type { CVData } from '@cv/cv';

import {
	columnSlackBelowDirectDivBlocksPx,
} from '@lib/cv-column-slack';
import {
	analysePageAlignment,
} from '@lib/cv-align';

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
		id:         'cv-layout-status',
		class:      'cv-layout-status no-print',
		'aria-live': 'polite',
	});
}

// ─── Debug toggle ─────────────────────────────────────────────────────────────

function buildDebugToggle(): HTMLElement {
	return h('button', {
		id:             'cv-layout-debug-toggle',
		type:           'button',
		class:          'cv-layout-debug-toggle cv-history-btn no-print',
		'aria-pressed': 'false',
	}, 'Debug Layout');
}

function initDebugToggle(): void {
	const html      = document.documentElement;
	const toggleEl  = document.getElementById('cv-layout-debug-toggle');
	const MM_TO_PX  = 96 / 25.4;
	let rafPending  = false;

	function setDebugState(on: boolean): void {
		html.classList.toggle('cv-debug-mode', on);
		if (toggleEl) {
			toggleEl.setAttribute('aria-pressed', String(on));
			toggleEl.textContent = on ? 'Debug Layout: ON' : 'Debug Layout';
		}
		if (on) { runDiagnostics(); }
		else    { clearHighlights(); }
	}

	function clearHighlights(): void {
		document.querySelectorAll('.cv-debug-ws-highlight').forEach((n) => n.remove());
	}

	function runDiagnostics(): void {
		clearHighlights();
		function mm(px: number): string {
			return `${(px / MM_TO_PX).toFixed(1)}mm`;
		}
		const cols = document.querySelectorAll<HTMLElement>('.cv-sidebar, .cv-main');
		cols.forEach((col) => {
			const slack = columnSlackBelowDirectDivBlocksPx(col);
			if (slack > 5 * MM_TO_PX) {
				const r     = col.getBoundingClientRect();
				const ov    = document.createElement('div');
				ov.className = 'cv-debug-ws-highlight ' +
					(col.classList.contains('cv-sidebar') ? 'cv-debug-ws-col-slack--sidebar' : 'cv-debug-ws-col-slack--main');
				ov.style.cssText = [
					`position:fixed`,
					`left:${r.left}px`,
					`top:${r.bottom - slack}px`,
					`width:${r.width}px`,
					`height:${slack}px`,
					`pointer-events:none`,
					`z-index:9999`,
				].join(';');
				document.body.appendChild(ov);

				const dim = document.createElement('div');
				dim.className = 'cv-debug-ws-highlight cv-debug-ws-dim';
				dim.style.cssText = [
					'position:fixed',
					`left:${Math.round(r.left + r.width - 18)}px`,
					`top:${Math.round(r.bottom - slack + 2)}px`,
					`height:${Math.max(4, Math.round(slack - 4))}px`,
					'pointer-events:none',
					'z-index:10000',
				].join(';');
				const line = document.createElement('div');
				line.className = 'cv-debug-ws-dim__line';
				const topArrow = document.createElement('div');
				topArrow.className = 'cv-debug-ws-dim__arrow cv-debug-ws-dim__arrow--top';
				const bottomArrow = document.createElement('div');
				bottomArrow.className = 'cv-debug-ws-dim__arrow cv-debug-ws-dim__arrow--bottom';
				const label = document.createElement('div');
				label.className = 'cv-debug-ws-dim__label';
				label.textContent = mm(slack);
				dim.append(topArrow, line, bottomArrow, label);
				document.body.appendChild(dim);
			}
		});

		const pages = [
			{
				page: document.getElementById('cv-page-1') as HTMLElement | null,
				sidebar: document.getElementById('cv-sidebar-1') as HTMLElement | null,
				main: document.getElementById('cv-main-1') as HTMLElement | null,
			},
			{
				page: document.getElementById('cv-page-2') as HTMLElement | null,
				sidebar: document.getElementById('cv-sidebar-2') as HTMLElement | null,
				main: document.getElementById('cv-main-2') as HTMLElement | null,
			},
		];
		pages.forEach(({ page, sidebar, main }) => {
			if (!page || !sidebar || !main) { return; }
			if (getComputedStyle(page).display === 'none') { return; }
			const report = analysePageAlignment(page, sidebar, main);
			const pageRect = page.getBoundingClientRect();
			report.pairs.forEach((pair) => {
				const y = Math.round(pageRect.top + (pair.sidebar.yPage + pair.main.yPage) / 2);
				const sbRect = pair.sidebar.el.getBoundingClientRect();
				const mnRect = pair.main.el.getBoundingClientRect();
				const line = document.createElement('div');
				line.className = 'cv-debug-ws-highlight cv-debug-ws-align-line';
				line.style.cssText = [
					'position:fixed',
					`left:${Math.round(sbRect.left)}px`,
					`top:${y}px`,
					`width:${Math.round(mnRect.right - sbRect.left)}px`,
					'height:1px',
					'pointer-events:none',
					'z-index:9999',
				].join(';');
				document.body.appendChild(line);
			});
		});

		const portraitCell = document.getElementById('cv-p1-portrait-cell');
		const portraitWrap = portraitCell?.querySelector<HTMLElement>('.cv-portrait-wrap');
		if (portraitCell && portraitWrap) {
			const cellRect = portraitCell.getBoundingClientRect();
			const wrapRect = portraitWrap.getBoundingClientRect();
			const topGap = Math.max(0, wrapRect.top - cellRect.top);
			if (topGap > 2) {
				const ov = document.createElement('div');
				ov.className = 'cv-debug-ws-highlight cv-debug-ws-portrait-gap';
				ov.style.cssText = [
					'position:fixed',
					`left:${cellRect.left}px`,
					`top:${cellRect.top}px`,
					`width:${cellRect.width}px`,
					`height:${topGap}px`,
					'pointer-events:none',
					'z-index:9999',
				].join(';');
				document.body.appendChild(ov);
			}
		}
	}

	function scheduleDiagnostics(): void {
		if (!html.classList.contains('cv-debug-mode')) { return; }
		if (rafPending) { return; }
		rafPending = true;
		requestAnimationFrame(() => {
			rafPending = false;
			runDiagnostics();
		});
	}

	toggleEl?.addEventListener('click', () => {
		const on = html.classList.contains('cv-debug-mode');
		setDebugState(!on);
	});

	// Re-run diagnostics after each layout pass
	window.addEventListener('cv-layout-applied', () => {
		scheduleDiagnostics();
	});

	// Keep overlays aligned while scrolling and resizing.
	window.addEventListener('scroll', scheduleDiagnostics, { passive: true });
	window.addEventListener('resize', scheduleDiagnostics);

	// Init from URL param
	const flag = new URL(window.location.href).searchParams.get('debug-layout');
	if (flag === '1') { setDebugState(true); }
}

/** Web view → “Preview PDF”; Print view → “Print”. */
function syncPrintFabLabel(): void {
	const fab   = document.getElementById('cv-download-pdf');
	const label = document.getElementById('cv-download-pdf-label');
	const shell = document.getElementById('cv-shell');
	if (!fab || !label || !shell) { return; }
	const printView = shell.classList.contains('cv-print-preview');
	if (printView) {
		fab.setAttribute('aria-label', 'Print or save as PDF');
		label.textContent = 'Print';
	} else {
		fab.setAttribute('aria-label', 'Preview PDF');
		label.textContent = 'Preview PDF';
	}
}

// ─── View mode toggle ─────────────────────────────────────────────────────────

function buildViewModeToggle(): HTMLElement {
	return h('button', {
		type:           'button',
		id:             'cv-view-mode-toggle',
		class:          'cv-view-mode-toggle no-print',
		'aria-pressed': 'false',
	}, 'Print view');
}

function initViewModeToggle(): void {
	const btn   = document.getElementById('cv-view-mode-toggle') as HTMLButtonElement | null;
	const KEY   = 'cv-view-mode';
	function currentShell(): HTMLElement | null {
		const el = document.getElementById('cv-shell');
		return el instanceof HTMLElement ? el : null;
	}

	function setLabel(): void {
		const shell = currentShell();
		if (!btn || !shell) { return; }
		const on = shell.classList.contains('cv-print-preview');
		btn.setAttribute('aria-pressed', String(on));
		btn.textContent = on ? 'Web view' : 'Print view';
	}

	function apply(mode: 'print' | 'web'): void {
		const shell = currentShell();
		if (!shell) { return; }
		document.documentElement.classList.toggle('cv-print-surface', mode === 'print');
		shell.classList.toggle('cv-print-preview', mode === 'print');
		try { localStorage.setItem(KEY, mode); } catch { /* ignore */ }
		setLabel();
		syncPrintFabLabel();
		window.dispatchEvent(new Event('cv-view-mode-changed'));
		window.dispatchEvent(new Event('resize'));
	}

	btn?.addEventListener('click', () => {
		const shell = currentShell();
		apply(shell?.classList.contains('cv-print-preview') ? 'web' : 'print');
	});
	window.addEventListener('cv-layout-applied', () => {
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
	const densityVal    = h('span', { id: 'cv-prefs-density-val', class: 'cv-prefs-val' }, 'Balanced');
	const densitySlider = h('input', {
		id:    'cv-prefs-density',
		class: 'cv-prefs-slider',
		type:  'range',
		min:   '0', max: '3', step: '1', value: '3',
		'aria-valuetext': 'Dense',
	});
	const densityRow = h('div', { class: 'cv-prefs-row' },
		h('label', { class: 'cv-prefs-label', for: 'cv-prefs-density' },
			h('span', {}, 'Typography'),
			densityVal,
		),
		h('div', { class: 'cv-prefs-track-row' },
			h('span', { class: 'cv-prefs-tick-label' }, 'Spacious'),
			densitySlider,
			h('span', { class: 'cv-prefs-tick-label cv-prefs-tick-right' }, 'Dense'),
		),
	);

	// Affinity row
	const affinityVal    = h('span', { id: 'cv-prefs-affinity-val', class: 'cv-prefs-val' }, 'Balanced');
	const affinitySlider = h('input', {
		id:    'cv-prefs-affinity',
		class: 'cv-prefs-slider',
		type:  'range',
		min:   '0', max: '4', step: '1', value: '2',
		'aria-valuetext': 'Balanced',
	});
	const affinityRow = h('div', { class: 'cv-prefs-row' },
		h('label', { class: 'cv-prefs-label', for: 'cv-prefs-affinity' },
			h('span', {}, 'Column fit'),
			affinityVal,
		),
		h('div', { class: 'cv-prefs-track-row' },
			h('span', { class: 'cv-prefs-tick-label' }, 'Flexible'),
			affinitySlider,
			h('span', { class: 'cv-prefs-tick-label cv-prefs-tick-right' }, 'Strict'),
		),
	);

	// Page preference row
	const pageBtns: HTMLButtonElement[] = [
		h('button', { class: 'cv-prefs-page-btn', 'data-pref': 'prefer-1', type: 'button' }, '1 page') as HTMLButtonElement,
		h('button', { class: 'cv-prefs-page-btn cv-prefs-page-btn--active', 'data-pref': 'auto', type: 'button' }, 'Auto') as HTMLButtonElement,
		h('button', { class: 'cv-prefs-page-btn', 'data-pref': 'prefer-2', type: 'button' }, '2 pages') as HTMLButtonElement,
	];
	const pageToggle = h('div', { class: 'cv-prefs-page-toggle', role: 'group', 'aria-label': 'Page preference' },
		...pageBtns,
	);
	const pageRow = h('div', { class: 'cv-prefs-row' },
		h('p', { class: 'cv-prefs-label' }, h('span', {}, 'Pages')),
		pageToggle,
	);

	const resetBtn = h('button', { id: 'cv-prefs-reset', class: 'cv-prefs-reset', type: 'button' }, 'Reset defaults');
	const { el: styleSection, syncUI: syncStyleUI } = buildStyleSection();
	(window as Window & {
		__blemmySyncStyleUI__?: (style: DocumentStyle) => void;
	}).__blemmySyncStyleUI__ = syncStyleUI;

	const inner = h('div', { class: 'cv-prefs-inner' },
		h('p', { class: 'cv-prefs-heading' }, 'Layout preferences'),
		densityRow,
		affinityRow,
		pageRow,
		resetBtn,
		h('hr', { class: 'cv-prefs-divider' }),
		styleSection,
	);

	const panel = h('div', {
		id:           'cv-prefs-panel',
		class:        'cv-prefs-panel no-print',
		'aria-label': 'Layout preferences',
		hidden:       '',
	}, inner);

	const trigger = h('button', {
		id:              'cv-prefs-trigger',
		class:           'cv-prefs-trigger no-print',
		type:            'button',
		'aria-expanded': 'false',
		'aria-controls': 'cv-prefs-panel',
		'aria-label':    'Layout preferences',
		title:           'Layout preferences',
	}, '⚙');

	return { panel, trigger };
}

function initPreferencesPanel(): void {
	const panel          = document.getElementById('cv-prefs-panel');
	const trigger        = document.getElementById('cv-prefs-trigger');
	const densitySlider  = document.getElementById('cv-prefs-density') as HTMLInputElement | null;
	const densityValEl   = document.getElementById('cv-prefs-density-val');
	const affinitySlider = document.getElementById('cv-prefs-affinity') as HTMLInputElement | null;
	const affinityValEl  = document.getElementById('cv-prefs-affinity-val');
	const resetBtn = document.getElementById('cv-prefs-reset');

	if (!panel || !trigger || !densitySlider || !affinitySlider) { return; }

	const pageBtns = panel.querySelectorAll<HTMLButtonElement>('.cv-prefs-page-btn');

	// Narrowed non-nullable references for use inside closures.
	const densityEl  = densitySlider;
	const affinityEl = affinitySlider;

	let current: CvPreferences = loadPrefs();
	let panelOpen = false;

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
			btn.classList.toggle('cv-prefs-page-btn--active', active);
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

	resetBtn?.addEventListener('click', () => { emit({ ...PREFS_DEFAULTS }); });

	trigger.addEventListener('click', () => {
		panelOpen = !panelOpen;
		(panel as HTMLElement & { hidden: boolean }).hidden = !panelOpen;
		trigger.setAttribute('aria-expanded', String(panelOpen));
		trigger.classList.toggle('cv-prefs-trigger--open', panelOpen);
	});

	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && panelOpen) {
			panelOpen = false;
			(panel as HTMLElement & { hidden: boolean }).hidden = true;
			trigger.setAttribute('aria-expanded', 'false');
			trigger.classList.remove('cv-prefs-trigger--open');
		}
	});

	syncUI(current);
}

// ─── Candidate selector logic ─────────────────────────────────────────────────

function initCandidateSelector(): void {
	const container = document.getElementById('cv-candidate-selector');
	const optionsEl = document.getElementById('cv-candidate-options');
	if (!container || !optionsEl) { return; }

	// Non-nullable refs for closure use
	const opts = optionsEl;
	const cont = container;

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
			btn.className = 'cv-candidate-option' + (opt.active ? ' cv-candidate-option--active' : '');
			btn.dataset.candidateId = opt.candidateId;
			btn.setAttribute('role',         'radio');
			btn.setAttribute('aria-checked', String(opt.active));
			btn.setAttribute('aria-label',   `Layout ${i + 1}: ${opt.label}`);
			const inner       = document.createElement('span');
			inner.className   = 'cv-candidate-option__inner';
			inner.textContent = opt.label;
			btn.appendChild(inner);
			btn.addEventListener('click', () => { dispatchAlternativeSelected(opt.candidateId); });
			opts.appendChild(btn);
		});
	}

	window.addEventListener(ALTERNATIVES_READY_EVENT, (e) => {
		renderOptions((e as CustomEvent<AlternativesReadyDetail>).detail.options);
	});
}

// ─── Print / PDF button + modal ───────────────────────────────────────────────

function buildPrintButton(): { fab: HTMLElement; modal: HTMLElement } {
	const svgNS = 'http://www.w3.org/2000/svg';
	const svg   = document.createElementNS(svgNS, 'svg');
	svg.setAttribute('class',      'print-fab-icon');
	svg.setAttribute('viewBox',    '0 0 16 16');
	svg.setAttribute('fill',       'none');
	svg.setAttribute('width',      '14');
	svg.setAttribute('height',     '14');
	svg.setAttribute('aria-hidden','true');
	svg.innerHTML = `
		<rect x="3" y="1" width="10" height="7" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
		<rect x="4" y="10" width="8" height="5" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
		<path d="M3 8H1.5A0.5 0.5 0 0 0 1 8.5V12.5A0.5 0.5 0 0 0 1.5 13H3" stroke="currentColor" stroke-width="1.2"/>
		<path d="M13 8H14.5A0.5 0.5 0 0 1 15 8.5V12.5A0.5 0.5 0 0 1 14.5 13H13" stroke="currentColor" stroke-width="1.2"/>
		<line x1="5.5" y1="12" x2="10.5" y2="12" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
		<line x1="5.5" y1="13.5" x2="8.5" y2="13.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
		<circle cx="12.5" cy="6" r="0.75" fill="currentColor"/>
	`;

	const fab = h('button', {
		class:        'print-fab no-print',
		id:           'cv-download-pdf',
		type:         'button',
		'aria-label': 'Preview PDF',
	});
	const fabLabel = h('span', { id: 'cv-download-pdf-label' }, 'Preview PDF');
	fab.appendChild(svg);
	fab.appendChild(fabLabel);

	const backdrop     = h('div', { class: 'cv-pdf-modal-backdrop', id: 'cv-pdf-modal-backdrop' });
	const downloadBtn  = h('button', { type: 'button', id: 'cv-pdf-modal-download', class: 'cv-pdf-modal-download-btn' }, 'Print / Save PDF');
	const closeBtn     = h('button', { type: 'button', id: 'cv-pdf-modal-close', class: 'cv-pdf-modal-close', 'aria-label': 'Close' }, 'Close');
	const loadingEl    = h('p', { id: 'cv-pdf-modal-loading', class: 'cv-pdf-modal-loading', 'aria-live': 'polite' }, 'Loading preview…');
	const frameEl      = h('iframe', {
		id: 'cv-pdf-modal-frame',
		class: 'cv-pdf-modal-embed',
		title: 'Live PDF preview',
	});

	const modalScroll  = h('div', { class: 'cv-pdf-modal-scroll' }, frameEl);
	const modalBody    = h('div', { class: 'cv-pdf-modal-body' }, loadingEl, modalScroll);
	const modalHeader  = h('header', { class: 'cv-pdf-modal-header' },
		h('h2', { id: 'cv-pdf-modal-title', class: 'cv-pdf-modal-title' }, 'PDF Preview'),
		h('div', { class: 'cv-pdf-modal-actions' }, downloadBtn, closeBtn),
	);
	const modalPanel   = h('div', { class: 'cv-pdf-modal-panel' }, modalHeader, modalBody);
	const modal = h('div', {
		id:               'cv-pdf-modal',
		class:            'cv-pdf-modal no-print',
		role:             'dialog',
		'aria-modal':     'true',
		'aria-labelledby': 'cv-pdf-modal-title',
		hidden:           '',
	}, backdrop, modalPanel);

	return { fab, modal };
}

const PDF_MODAL_LOADING_TEXT = 'Loading preview…';

/** Print view + engine ready: same document, no iframe. */
function canPrintCurrentDocument(): boolean {
	const shell = document.getElementById('cv-shell');
	const card  = document.getElementById('cv-card');
	const ready = card?.getAttribute('data-cv-layout-ready') === 'true';
	return !!shell?.classList.contains('cv-print-preview') && ready;
}

function initPrintButton(): void {
	const modal       = document.getElementById('cv-pdf-modal');
	const frame       = document.getElementById('cv-pdf-modal-frame') as HTMLIFrameElement | null;
	const loadingEl   = document.getElementById('cv-pdf-modal-loading');
	const downloadBtn = document.getElementById('cv-pdf-modal-download');
	const closeBtn    = document.getElementById('cv-pdf-modal-close');
	const backdrop    = document.getElementById('cv-pdf-modal-backdrop');

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

	document.getElementById('cv-download-pdf')?.addEventListener('click', (e) => {
		e.preventDefault();
		if (canPrintCurrentDocument()) {
			window.print();
			return;
		}
		const u = new URL(window.location.href);
		u.search = '';
		u.hash = '';
		u.searchParams.set('cv-pdf', '1');
		u.searchParams.set('cv-embed', '1');
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
	return h('button', {
		id:           'theme-toggle',
		class:        'theme-toggle no-print',
		type:         'button',
		'aria-label': 'Toggle dark mode',
	}, '☽');
}

function initThemeToggle(): void {
	const toggle = document.getElementById('theme-toggle');
	const html   = document.documentElement;

	function setIcon(): void {
		if (!toggle) { return; }
		const isDark = html.classList.contains('dark');
		toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
		toggle.textContent = isDark ? '☀︎' : '☽';
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
	return h('button', {
		id:           'cv-upload-btn',
		class:        'cv-upload-btn cv-history-btn no-print',
		type:         'button',
		'aria-label': 'Load CV data from JSON file',
		title:        'Load JSON data file',
	}, '↑ Load JSON');
}

function buildUploadStatus(): HTMLElement {
	return h('div', {
		id:    'cv-upload-status',
		class: 'cv-upload-status no-print',
		hidden: '',
	});
}

function initUploadButton(
	onUploaded: (data: CVData) => void,
): void {
	const btnEl  = document.getElementById('cv-upload-btn');
	const status = document.getElementById('cv-upload-status') as HTMLElement | null;
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
		status.className   = `cv-upload-status no-print cv-upload-status--${kind}`;
	}

	function hideStatus(): void {
		if (!status) { return; }
		status.hidden = true;
	}

	btn.addEventListener('click', () => {
		// If using uploaded data, offer to reset
		if (hasUploadedData()) {
			const confirmed = window.confirm('Clear uploaded data and revert to default CV?');
			if (confirmed) {
				clearUploadedCvData();
				clearDraft();
				clearLegacyPortraitStorage();
				showStatus('Reverted to default CV data.', 'ok');
				setTimeout(hideStatus, 3000);
			}
			return;
		}
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
		btn.textContent = hasUploadedData() ? '↑ Custom data ×' : '↑ Load JSON';
	}

	window.addEventListener('cv-layout-applied', syncLabel);
	syncLabel();
}

// ─── Edit mode button ─────────────────────────────────────────────────────────

function buildEditButton(): HTMLElement {
	return h('button', {
		id:           'cv-edit-btn',
		class:        'cv-edit-btn no-print',
		type:         'button',
		'aria-pressed':'false',
		title:        'Toggle edit mode',
	}, '✎ Edit');
}

function buildHistoryControls(): HTMLElement {
	return h('div', {
		id:    'cv-history-controls',
		class: 'cv-history-controls no-print',
	},
		h('button', {
			id:           'cv-undo-btn',
			class:        'cv-history-btn',
			type:         'button',
			title:        'Undo last change (Ctrl/Cmd+Z)',
			'aria-label': 'Undo last change',
		}, '↶ Undo'),
		h('button', {
			id:           'cv-redo-btn',
			class:        'cv-history-btn',
			type:         'button',
			title:        'Redo last change (Ctrl/Cmd+Shift+Z)',
			'aria-label': 'Redo last change',
		}, '↷ Redo'),
		h('button', {
			id:           'cv-reset-draft-btn',
			class:        'cv-history-btn cv-history-btn--danger',
			type:         'button',
			title:        'Reset local draft edits to current loaded CV',
			'aria-label': 'Reset local draft edits',
		}, 'Reset draft'),
	);
}

function initHistoryControls(): void {
	const undoBtn = document.getElementById('cv-undo-btn') as HTMLButtonElement | null;
	const redoBtn = document.getElementById('cv-redo-btn') as HTMLButtonElement | null;
	if (!undoBtn || !redoBtn) { return; }
	const undo = undoBtn;
	const redo = redoBtn;

	function syncState(): void {
		undo.disabled = !(window.cvCanUndo?.() ?? false);
		redo.disabled = !(window.cvCanRedo?.() ?? false);
	}

	undo.addEventListener('click', () => { window.cvUndo?.(); });
	redo.addEventListener('click', () => { window.cvRedo?.(); });
	window.addEventListener('cv-history-changed', syncState as EventListener);
	syncState();
}

function initChangeHighlighter(): void {
	const pop = h('div', {
		id:     'cv-ai-compare-popover',
		class:  'cv-ai-compare-popover no-print',
		hidden: '',
	});
	pop.appendChild(
		h('div', { class: 'cv-ai-compare-popover__col' },
			h('div', {
				id: 'cv-ai-compare-label',
				class: 'cv-ai-compare-popover__label',
			}, 'Previous value'),
			h('div', { id: 'cv-ai-compare-before', class: 'cv-ai-compare-popover__text' }),
		),
	);
	document.body.appendChild(pop);
	const labelEl = pop.querySelector('#cv-ai-compare-label') as HTMLElement | null;
	const beforeEl = pop.querySelector('#cv-ai-compare-before') as HTMLElement | null;

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
		pop.style.setProperty('--cv-ai-compare-font-size', cs.fontSize);
		pop.style.setProperty('--cv-ai-compare-line-height', cs.lineHeight);
		pop.style.setProperty('--cv-ai-compare-font-family', cs.fontFamily);
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
		const t = e.target as HTMLElement | null;
		const changed = t?.closest<HTMLElement>('.cv-ai-changed');
		if (!changed) {
			hidePopover();
			return;
		}
		showPopover(changed);
	});
	document.addEventListener('mousemove', (e) => {
		const t = e.target as HTMLElement | null;
		const changed = t?.closest<HTMLElement>('.cv-ai-changed');
		if (changed) { return; }
		hidePopover();
	});
	document.addEventListener('mouseout', (e) => {
		const to = (e.relatedTarget as HTMLElement | null);
		if (to?.closest('#cv-ai-compare-popover')) { return; }
		if (to?.closest('.cv-ai-changed')) { return; }
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
	window.addEventListener('cv-layout-applied', hidePopover);

	function clearBadges(): void {
		hidePopover();
		document.querySelectorAll('.cv-ai-undo-btn').forEach((n) => n.remove());
		document.querySelectorAll<HTMLElement>('.cv-ai-changed').forEach((el) => {
			el.classList.remove('cv-ai-changed');
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
		if (!canUndoFromHere || el.querySelector('.cv-ai-undo-btn')) { return; }
		if (window.getComputedStyle(el).display === 'none') { return; }
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'cv-ai-undo-btn no-print';
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
		const fields = document.querySelectorAll<HTMLElement>('[data-cv-field]');
		fields.forEach((el) => {
			const path = el.dataset.cvField ?? '';
			if (!path) { return; }
			for (const c of latestChanges) {
				if (!isFieldAffected(path, c.path)) { continue; }
				el.classList.add('cv-ai-changed');
				el.dataset.aiBefore = c.before;
				el.dataset.aiAfter  = c.after;
				el.dataset.aiState  = c.state;
				maybeAddUndoButton(el, path, c.path);
				break;
			}
		});
	}

	window.addEventListener('cv-last-changes', (e) => {
		latestChanges = (e as CustomEvent<LastChangeDetail>).detail?.changes ?? [];
		applyHighlights();
	});
	window.addEventListener('cv-layout-applied', applyHighlights);
}

function buildRecentChangesPanel(): HTMLElement {
	return h('div', {
		id:    'cv-recent-changes',
		class: 'cv-recent-changes no-print',
		hidden: '',
	},
		h('div', { class: 'cv-recent-changes__head' },
			h('span', { id: 'cv-recent-changes-title' }, 'Recent AI changes'),
			h('button', {
				id: 'cv-recent-changes-toggle',
				class: 'cv-recent-changes__toggle',
				type: 'button',
				'aria-expanded': 'true',
				title: 'Collapse recent changes',
			}, '−'),
		),
		h('div', { id: 'cv-recent-changes-list', class: 'cv-recent-changes__list' }),
	);
}

function initRecentChangesPanel(): void {
	const panel = document.getElementById('cv-recent-changes') as HTMLElement | null;
	const list  = document.getElementById('cv-recent-changes-list') as HTMLElement | null;
	const title = document.getElementById('cv-recent-changes-title') as HTMLElement | null;
	const toggle = document.getElementById('cv-recent-changes-toggle') as
		HTMLButtonElement | null;
	if (!panel || !list || !title || !toggle) { return; }
	const panelEl = panel;
	const listEl  = list;
	const titleEl = title;
	const toggleEl = toggle;
	const COLLAPSE_KEY = 'cv-recent-changes-collapsed';
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
			const row = h('div', { class: 'cv-recent-changes__item' },
				h('div', { class: 'cv-recent-changes__path' }, c.path),
				h('div', { class: 'cv-recent-changes__delta' },
					h('span', { class: 'cv-recent-changes__before', title: c.before }, `Before: ${clip(c.before)}`),
					h('span', { class: 'cv-recent-changes__after', title: c.after }, `After: ${clip(c.after)}`),
				),
			);
			const btn = h('button', {
				class: 'cv-recent-changes__undo',
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

	window.addEventListener('cv-last-changes', (e) => {
		const detail = (e as CustomEvent<LastChangeDetail>).detail;
		render(detail?.changes ?? []);
	});
}

function buildEditToolbar(): HTMLElement {
	return h('div', {
		id:     'cv-edit-toolbar',
		class:  'cv-edit-toolbar no-print',
		hidden: '',
	},
		h('span', { class: 'cv-edit-toolbar__hint' },
			'Click any text to edit  ·  Drag work items to reorder  ·  Click portrait to replace',
		),
	);
}

function initCloudSyncDrawer(remount: (data: CVData) => void): {
	onDataChange: (data: CVData) => void;
	cloudTrigger: HTMLButtonElement;
} {
	const drawer = h('div', {
		id:           'cv-cloud-drawer',
		class:        'cv-side-panel cv-cloud-drawer no-print',
		hidden:       '',
		'aria-label': 'Cloud sync',
	});
	const inner = h('div', { class: 'cv-cloud-drawer__inner cv-prefs-inner' });
	const tabAuth = h('button', {
		type:              'button',
		role:              'tab',
		id:                'cv-cloud-tab-auth',
		class:             'cv-cloud-drawer__seg cv-cloud-drawer__seg--active',
		'aria-selected':   'true',
		'aria-controls':   'cv-cloud-pane-auth',
	}, 'Account') as HTMLButtonElement;
	const tabDocs = h('button', {
		type:              'button',
		role:              'tab',
		id:                'cv-cloud-tab-docs',
		class:             'cv-cloud-drawer__seg',
		'aria-selected':   'false',
		'aria-controls':   'cv-cloud-pane-docs',
	}, 'Documents') as HTMLButtonElement;
	const tabToggle = h('div', {
		class:        'cv-cloud-drawer__seg-wrap',
		role:         'tablist',
		'aria-label': 'Cloud sections',
	}, tabAuth, tabDocs);
	const syncChip = h('span', {
		id: 'cv-cloud-sync-chip', class: 'cv-cloud-drawer__sync', hidden: '',
	});
	const tabRow = h('div', { class: 'cv-cloud-drawer__tabrow', hidden: '' }, tabToggle, syncChip);
	const paneAuth = h('div', {
		id:                'cv-cloud-pane-auth',
		class:             'cv-cloud-drawer__pane',
		role:              'tabpanel',
		'aria-labelledby': 'cv-cloud-tab-auth',
	});
	const paneDocs = h('div', {
		id:                'cv-cloud-pane-docs',
		class:             'cv-cloud-drawer__pane',
		role:              'tabpanel',
		hidden:            '',
		'aria-labelledby': 'cv-cloud-tab-docs',
	});

	inner.append(
		h('p', { class: 'cv-prefs-heading' }, 'Cloud'),
		tabRow,
		paneAuth,
		paneDocs,
	);
	drawer.append(inner);
	document.body.appendChild(drawer);

	const cloudTrigger = h('button', {
		id:               'cv-cloud-trigger',
		class:            'cv-cloud-dock-trigger cv-history-btn no-print',
		type:             'button',
		title:            'Cloud sync',
		'aria-expanded':  'false',
		'aria-controls':  'cv-cloud-drawer',
	}, '☁') as HTMLButtonElement;
	if (!CLOUD_ENABLED) {
		cloudTrigger.hidden = true;
	}

	let drawerOpen = false;

	function closeDrawer(): void {
		drawerOpen = false;
		drawer.hidden = true;
		cloudTrigger.setAttribute('aria-expanded', 'false');
		cloudTrigger.classList.remove('cv-cloud-dock-trigger--open');
	}

	function openDrawer(): void {
		drawerOpen = true;
		drawer.hidden = false;
		cloudTrigger.setAttribute('aria-expanded', 'true');
		cloudTrigger.classList.add('cv-cloud-dock-trigger--open');
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

	const docApi = initDocumentPanel(remount, {
		mount: paneDocs,
		closeDrawer,
		setSyncIndicator,
	});

	initAuthPanel({ mount: paneAuth, closeDrawer });

	let cloudAuthed = false;

	function activateTab(which: 'auth' | 'docs'): void {
		if (which === 'docs' && !cloudAuthed) { return; }
		const authOn = which === 'auth';
		tabAuth.classList.toggle('cv-cloud-drawer__seg--active', authOn);
		tabAuth.setAttribute('aria-selected', String(authOn));
		tabDocs.classList.toggle('cv-cloud-drawer__seg--active', !authOn);
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

	cloudTrigger.addEventListener('click', () => {
		if (drawerOpen) { closeDrawer(); } else { openDrawer(); }
	});

	document.addEventListener('click', (e) => {
		const t = e.target as HTMLElement | null;
		if (!t || !drawerOpen) { return; }
		if (drawer.contains(t) || cloudTrigger.contains(t)) { return; }
		closeDrawer();
	});

	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && drawerOpen) { closeDrawer(); }
	});

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
	const leftDock  = h('div', { id: 'cv-ui-dock-left', class: 'cv-ui-dock no-print' });
	const rightDock = h('div', { id: 'cv-ui-dock-right', class: 'cv-ui-dock no-print' });
	document.body.appendChild(leftDock);
	document.body.appendChild(rightDock);

	// Layout status + debug toggle
	document.body.appendChild(buildLayoutStatus());
	leftDock.appendChild(buildDebugToggle());

	// Candidate selector (content is inside #cv-shell, script wired here)
	// View mode toggle
	rightDock.appendChild(buildViewModeToggle());

	// Preferences panel + trigger
	const { panel, trigger } = buildPreferencesPanel();
	document.body.appendChild(panel);
	leftDock.appendChild(trigger);

	const docPanelApi = initCloudSyncDrawer(remount);

	// Upload/Download JSON + status
	const uploadBtn = buildUploadButton();
	const dlBtn = h('button', {
		id:           'cv-download-json',
		class:        'cv-download-json-btn cv-history-btn no-print',
		type:         'button',
		title:        'Download CV data as JSON',
	}, '↓ JSON');
	leftDock.appendChild(uploadBtn);
	leftDock.appendChild(dlBtn);
	document.body.appendChild(buildUploadStatus());

	// Edit button + history controls
	leftDock.appendChild(buildHistoryControls());
	leftDock.appendChild(buildEditButton());

	// v2.2 Review panel + overlay
	const reviewInst = initReviewPanel({
		getReview: () => (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__?.review,
		setReview: (r: CVReview) => {
			const d = (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__;
			if (d) { d.review = r; }
		},
		getData: () => (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__,
	});
	document.body.appendChild(reviewInst.panel);
	leftDock.appendChild(reviewInst.toggle);
	initReviewOverlay((path) => { reviewInst.open(path); });
	window.addEventListener('cv-layout-applied', () => {
		const d = (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__;
		if (d?.review) { updateOverlay(d.review); }
	});
	(window as Window & { __blemmyApplyReviewOps__?: typeof applyCommentOps }).__blemmyApplyReviewOps__ = applyCommentOps;
	(window as Window & { __blemmySyncReview__?: (r: CVReview) => void }).__blemmySyncReview__ = (r) => {
		reviewInst.syncReview(r);
		updateOverlay(r);
	};
	const shellEl = document.getElementById('cv-shell');
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
		const fieldHost = target.closest<HTMLElement>('[data-cv-field]');
		const fieldPath = fieldHost?.dataset.cvField?.trim();
		if (fieldPath) { return toContentPath(fieldPath); }
		const workEl = target.closest<HTMLElement>('.experience-block');
		const workIdx = workEl?.dataset.workIdx ?? workEl?.dataset.workIdx;
		if (workIdx && /^\d+$/.test(workIdx)) {
			return `work[${workIdx}]` as ContentPath;
		}
		const eduField = target
			.closest<HTMLElement>('.education-block')
			?.querySelector<HTMLElement>('[data-cv-field^="education."]')
			?.dataset.cvField;
		if (eduField) { return toContentPath(eduField).replace(/(\.\w+)+$/, '') as ContentPath; }
		return null;
	}
	shellEl?.addEventListener('click', (event) => {
		if (!document.documentElement.classList.contains('blemmy-review-mode')) { return; }
		const target = event.target as HTMLElement | null;
		if (!target) { return; }
		const path = resolveClickedPath(target);
		if (!path) { return; }
		event.preventDefault();
		reviewInst.open(path);
	});

	// Print button + modal
	const { fab, modal } = buildPrintButton();
	rightDock.appendChild(fab);
	document.body.appendChild(modal);

	// Theme toggle, chat, cloud — circular dock controls grouped together
	rightDock.appendChild(buildThemeToggle());

	const { panel: chatPanel, toggle: chatTrigger } = initChatPanel(remount);
	document.body.appendChild(chatPanel);
	rightDock.appendChild(chatTrigger);
	rightDock.appendChild(docPanelApi.cloudTrigger);
	chatPanel.appendChild(buildRecentChangesPanel());

	rehydrateStyle();
	initBeforeUnloadGuard();

	// ── Wire up event listeners ───────────────────────────────────────────────
	initDebugToggle();
	initViewModeToggle();
	initPreferencesPanel();
	initCandidateSelector();
	initPrintButton();
	initThemeToggle();
	initHistoryControls();
	initChangeHighlighter();
	initRecentChangesPanel();

	// Download JSON action
	dlBtn.addEventListener('click', () => {
		const data = (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__;
		if (!data) { return; }
		const forFile = stripPortraitForJsonExport(data);
		const blob = new Blob([JSON.stringify(forFile, null, '\t')], {
			type: 'application/json',
		});
		const url  = URL.createObjectURL(blob);
		const a    = document.createElement('a');
		a.href     = url;
		a.download = 'cv-content.json';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	});

	// Upload button — triggers re-render via remount
	initUploadButton((uploadedData) => {
		remount(uploadedData);
	});

	// Edit mode — toggle button + toolbar
	let editInstance: EditModeInstance | null = null;
	// Track whether edit mode was active before a remount
	let editWasActive = false;

	const editBtn = document.getElementById('cv-edit-btn');
	const resetDraftBtn = document.getElementById('cv-reset-draft-btn');

	function setEditActive(on: boolean): void {
		if (!editBtn) { return; }
		editBtn.setAttribute('aria-pressed', String(on));
		editBtn.textContent = on ? '✎ Editing' : '✎ Edit';
		editBtn.classList.toggle('cv-edit-btn--active', on);
	}

	function activateEdit(): void {
		const base = (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__;
		if (!base) { return; }
		const data = loadDraft() ?? base;

		editInstance = activateEditMode(
			data,
			(newData) => {
				// Visibility changes trigger a remount; we auto-reactivate afterwards
				editWasActive = true;
				(window as Window & { __CV_DATA__?: CVData }).__CV_DATA__ = newData;
				editInstance?.deactivate();
				editInstance = null;
				setEditActive(false);
				remount(newData);
				docPanelApi.onDataChange(newData);
				// Re-activation happens in the cv-layout-applied listener below
			},
			(updatedData) => {
				// Text edits — draft already saved; also queue cloud save if active.
				docPanelApi.onDataChange(updatedData);
			},
		);
		setEditActive(true);
	}

	editBtn?.addEventListener('click', () => {
		if (editInstance) {
			editInstance.deactivate();
			editInstance = null;
			editWasActive = false;
			setEditActive(false);
			return;
		}
		activateEdit();
	});

	resetDraftBtn?.addEventListener('click', () => {
		if (window.confirm(
			'Reset local draft edits and portrait to the currently loaded CV?',
		)) {
			editInstance?.clearDraft();
			editInstance?.clearPortrait();
			editWasActive = false;
			const base = (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__;
			if (base) { remount(base); }
		}
	});

	// After a remount (visibility change), auto-reactivate edit mode
	window.addEventListener('cv-layout-applied', () => {
		if (editWasActive && !editInstance) {
			editWasActive = false;
			activateEdit();
		}
	});

}

export function initSharedReviewComponents(autoOpen = false): void {
	const leftDock = h('div', {
		id: 'cv-share-review-dock',
		class: 'cv-ui-dock no-print',
	});
	document.body.appendChild(leftDock);
	const reviewInst = initReviewPanel({
		getReview: () => (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__?.review,
		setReview: (r: CVReview) => {
			const d = (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__;
			if (d) { d.review = r; }
		},
		getData: () => (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__,
	});
	document.body.appendChild(reviewInst.panel);
	leftDock.appendChild(reviewInst.toggle);
	initReviewOverlay((path) => { reviewInst.open(path); });
	window.addEventListener('cv-layout-applied', () => {
		const d = (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__;
		if (d?.review) { updateOverlay(d.review); }
	});
	const shellEl = document.getElementById('cv-shell');
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
		const fieldHost = target.closest<HTMLElement>('[data-cv-field]');
		const fieldPath = fieldHost?.dataset.cvField?.trim();
		if (fieldPath) { return toContentPath(fieldPath); }
		const workEl = target.closest<HTMLElement>('.experience-block');
		const workIdx = workEl?.dataset.workIdx ?? workEl?.dataset.workIdx;
		if (workIdx && /^\d+$/.test(workIdx)) {
			return `work[${workIdx}]` as ContentPath;
		}
		const eduField = target
			.closest<HTMLElement>('.education-block')
			?.querySelector<HTMLElement>('[data-cv-field^="education."]')
			?.dataset.cvField;
		if (eduField) {
			return toContentPath(eduField).replace(/(\.\w+)+$/, '') as ContentPath;
		}
		return null;
	}
	shellEl?.addEventListener('click', (event) => {
		if (!document.documentElement.classList.contains('blemmy-review-mode')) { return; }
		const target = event.target as HTMLElement | null;
		if (!target) { return; }
		const path = resolveClickedPath(target);
		if (!path) { return; }
		event.preventDefault();
		reviewInst.open(path);
	});
	const d = (window as Window & { __CV_DATA__?: CVData }).__CV_DATA__;
	if (d?.review) {
		reviewInst.syncReview(d.review);
		updateOverlay(d.review);
	}
	if (autoOpen) { reviewInst.open(); }
}

