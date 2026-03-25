/**
 * main.ts — application entry point
 */

import '@styles/global.css';
import '@styles/print.css';
import '@styles/cv-print-surface.css';
import '@styles/cv-print-parity.css';

import {
	bootstrapOAuthFromUrl,
	initPasswordlessAuthFromUrl,
	resolveShareToken,
	shouldBootMinimalOAuthPopupOnly,
} from '@lib/cv-cloud';
import { loadCvData, onCvDataChanged } from '@lib/cv-loader';
import { toggleFilter, extractAllTags } from '@lib/cv-filter';
import { hashCvForAudit, initLayoutAuditUi, layoutAuditLog } from '@lib/layout-audit';
import { canonicalSharePath, shareTokenFromLocationParts } from '@lib/share-link-url';
import { applyLayoutSnapshotToDom } from '@lib/cv-layout-snapshot';
import { syncFilterBar }                from '@renderer/cv-renderer';
import type { CVData }                  from '@cv/cv';

import { renderCV }           from '@renderer/cv-renderer';
import { initUIComponents }   from '@renderer/ui-components';
import { initCvLayoutEngine } from '@lib/cv-layout-engine';

declare global {
	interface Window {
		__CV_DATA__?: CVData;
		cvUndo?: () => void;
		cvRedo?: () => void;
		cvCanUndo?: () => boolean;
		cvCanRedo?: () => boolean;
		cvRevertField?: (path: string) => void;
	}
}

/** Live preview iframe: skip docks/modals so layout matches A4 only. */
function isCvPdfEmbed(): boolean {
	try {
		return new URLSearchParams(location.search).get('cv-embed') === '1';
	} catch {
		return false;
	}
}

function copyText(text: string): Promise<boolean> {
	return navigator.clipboard.writeText(text)
		.then(() => true)
		.catch(() => false);
}

function getShareTokenFromUrl(): string | null {
	try {
		return shareTokenFromLocationParts(
			location.pathname,
			location.search,
			import.meta.env.BASE_URL ?? '/',
		);
	} catch {
		return null;
	}
}

function isShareReadonlyMode(): boolean {
	return document.documentElement.classList.contains('cv-share-readonly');
}

function setupSharedReadonlyScale(): void {
	const baseW = Math.round((210 / 25.4) * 96);
	const apply = (): void => {
		const vv = window.visualViewport;
		const viewW = vv?.width ?? window.innerWidth;
		const availableW = Math.max(Math.floor(viewW) - 12, 280);
		const scale = Math.min(availableW / baseW, 1);
		const scaledWidth = Math.max(Math.floor(baseW * scale), 280);
		document.documentElement.style.setProperty(
			'--cv-share-scale',
			String(scale),
		);
		document.documentElement.style.setProperty(
			'--cv-share-width',
			`${scaledWidth}px`,
		);
	};
	apply();
	window.addEventListener('resize', apply);
	window.visualViewport?.addEventListener('resize', apply);
}

function mountSharedStage(banner: HTMLElement): void {
	const shell = document.getElementById('cv-shell');
	if (!(shell instanceof HTMLElement) || !shell.parentElement) {
		document.body.appendChild(banner);
		return;
	}
	const stage = document.createElement('div');
	stage.className = 'cv-share-stage';
	shell.parentElement.insertBefore(stage, shell);
	stage.append(banner, shell);
}

function activateShell(shell: HTMLElement): void {
	const pdf    = new URLSearchParams(location.search).get('cv-pdf') === '1';
	const stored = localStorage.getItem('cv-view-mode');
	if (pdf || stored === 'print') {
		shell.classList.add('cv-print-preview');
	}
}

function finishBootUi(): void {
	const html = document.documentElement;
	html.classList.remove('cv-booting');
	const splash = document.getElementById('cv-boot-splash');
	if (splash) { splash.setAttribute('hidden', ''); }
}

function mountShareError(message: string): void {
	document.documentElement.classList.add('cv-share-readonly');
	const priorRoot = document.getElementById('cv-root');
	if (priorRoot) {
		priorRoot.remove();
	}
	const panel = document.createElement('main');
	panel.className = 'cv-share-error';
	const title = document.createElement('h1');
	title.className = 'cv-share-error__title';
	title.textContent = 'Share link unavailable';
	const body = document.createElement('p');
	body.className = 'cv-share-error__body';
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
	repo.className = 'cv-about-modal__repo';
	repo.append(
		document.createTextNode('Repository: '),
		Object.assign(document.createElement('a'), {
			className: 'cv-about-modal__repo-link',
			href: 'https://github.com/vilhelm',
			target: '_blank',
			rel: 'noopener noreferrer',
			textContent: 'github.com/vilhelm',
		}),
	);
	const diagram = document.createElement('figure');
	diagram.className = 'cv-about-arch';
	const caption = document.createElement('figcaption');
	caption.className = 'cv-about-arch__caption';
	caption.textContent = 'Architecture overview';
	const flow = document.createElement('ol');
	flow.className = 'cv-about-arch__flow';
	function flowItem(title: string, text: string): HTMLElement {
		const li = document.createElement('li');
		li.className = 'cv-about-arch__item';
		const t = document.createElement('strong');
		t.className = 'cv-about-arch__item-title';
		t.textContent = title;
		const d = document.createElement('span');
		d.className = 'cv-about-arch__item-text';
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
	overlay.id = 'cv-about-modal';
	overlay.className = 'cv-about-modal no-print';
	overlay.setAttribute('hidden', '');
	const panel = document.createElement('section');
	panel.className = 'cv-about-modal__panel';
	panel.setAttribute('role', 'dialog');
	panel.setAttribute('aria-modal', 'true');
	panel.setAttribute('aria-labelledby', 'cv-about-title');
	const title = document.createElement('h2');
	title.id = 'cv-about-title';
	title.className = 'cv-about-modal__title';
	title.textContent = 'About this app';
	const closeBtn = document.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = 'cv-about-modal__close';
	closeBtn.textContent = 'Close';
	const body = document.createElement('div');
	body.className = 'cv-about-modal__body';
	body.append(...aboutBodyNodes());
	panel.append(title, body, closeBtn);
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
		footer.className = 'cv-share-footer no-print';
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'cv-share-footer__about';
		btn.textContent = 'About app';
		btn.addEventListener('click', open);
		footer.appendChild(btn);
		document.body.appendChild(footer);
		return;
	}

	const mainBtn = document.createElement('button');
	mainBtn.type = 'button';
	mainBtn.className = 'cv-about-corner-btn cv-history-btn no-print';
	mainBtn.setAttribute('aria-label', 'About this project');
	mainBtn.textContent = 'About';
	mainBtn.addEventListener('click', open);
	document.body.appendChild(mainBtn);
}

let engineCleanup: (() => void) | null = null;
const historyPast: CVData[] = [];
const historyFuture: CVData[] = [];
const HISTORY_LIMIT = 50;
const SESSION_STATE_KEY = 'cv-app-session-state';
type LeafChange = {
	path: string;
	beforeValue: unknown;
	afterValue: unknown;
	before: string;
	after: string;
	state: 'applied' | 'reverted';
};
let lastLeafChanges: LeafChange[] = [];

function cloneCvData(data: CVData): CVData {
	return JSON.parse(JSON.stringify(data)) as CVData;
}

function isLikelyCvData(raw: unknown): raw is CVData {
	if (!raw || typeof raw !== 'object') { return false; }
	const o = raw as Record<string, unknown>;
	return Boolean(
		o.meta && o.basics && o.education && o.work &&
		o.skills && o.languages && o.personal,
	);
}

function isLeafChange(raw: unknown): raw is LeafChange {
	if (!raw || typeof raw !== 'object') { return false; }
	const o = raw as Record<string, unknown>;
	return (
		typeof o.path === 'string' &&
		typeof o.before === 'string' &&
		typeof o.after === 'string' &&
		(o.state === 'applied' || o.state === 'reverted') &&
		'beforeValue' in o &&
		'afterValue' in o
	);
}

function persistSessionState(): void {
	const cv = window.__CV_DATA__;
	if (!cv) { return; }
	layoutAuditLog('persist-session', {
		cvHash: hashCvForAudit(cv),
		changes: lastLeafChanges.length,
		past: historyPast.length,
		future: historyFuture.length,
	});
	try {
		localStorage.setItem(SESSION_STATE_KEY, JSON.stringify({
			savedAt: Date.now(),
			cv,
			lastLeafChanges,
			historyPast,
			historyFuture,
		}));
	} catch { /* ignore storage issues */ }
}

function loadSessionState(): {
	cv: CVData | null;
	changes: LeafChange[];
	past: CVData[];
	future: CVData[];
} {
	try {
		const raw = localStorage.getItem(SESSION_STATE_KEY);
		if (!raw) {
			return { cv: null, changes: [], past: [], future: [] };
		}
		const parsed = JSON.parse(raw) as {
			cv?: unknown;
			lastLeafChanges?: unknown;
			historyPast?: unknown;
			historyFuture?: unknown;
		};
		const cv = isLikelyCvData(parsed?.cv) ? (parsed.cv as CVData) : null;
		const changes = Array.isArray(parsed.lastLeafChanges)
			? parsed.lastLeafChanges.filter(isLeafChange)
			: [];
		const past = Array.isArray(parsed.historyPast)
			? parsed.historyPast.filter(isLikelyCvData) as CVData[]
			: [];
		const future = Array.isArray(parsed.historyFuture)
			? parsed.historyFuture.filter(isLikelyCvData) as CVData[]
			: [];
		layoutAuditLog('load-session', {
			cvHash: hashCvForAudit(cv),
			changes: changes.length,
			past: past.length,
			future: future.length,
		});
		return { cv, changes, past, future };
	} catch {
		return { cv: null, changes: [], past: [], future: [] };
	}
}

function dispatchHistoryChanged(): void {
	window.dispatchEvent(new CustomEvent('cv-history-changed', {
		detail: { canUndo: historyPast.length > 0, canRedo: historyFuture.length > 0 },
	}));
}

function toLeafText(v: unknown): string {
	if (v == null) { return ''; }
	if (typeof v === 'string') { return v; }
	if (typeof v === 'number' || typeof v === 'boolean') { return String(v); }
	return JSON.stringify(v);
}

function collectLeafChanges(
	before: unknown,
	after: unknown,
	basePath = '',
): LeafChange[] {
	if (before === after) { return []; }
	const beforeIsObj = before != null && typeof before === 'object';
	const afterIsObj = after != null && typeof after === 'object';
	if (!beforeIsObj || !afterIsObj) {
		if (!basePath) { return []; }
		return [{
			path: basePath,
			beforeValue: before,
			afterValue: after,
			before: toLeafText(before),
			after: toLeafText(after),
			state: 'applied',
		}];
	}
	const beforeIsArr = Array.isArray(before);
	const afterIsArr = Array.isArray(after);
	if (beforeIsArr || afterIsArr) {
		if (!(beforeIsArr && afterIsArr)) {
			if (!basePath) { return []; }
			return [{
				path: basePath,
				beforeValue: before,
				afterValue: after,
				before: toLeafText(before),
				after: toLeafText(after),
				state: 'applied',
			}];
		}
		const a = before as unknown[];
		const b = after as unknown[];
		const maxLen = Math.max(a.length, b.length);
		const out: LeafChange[] = [];
		for (let i = 0; i < maxLen; i++) {
			const p = basePath ? `${basePath}.${i}` : String(i);
			out.push(...collectLeafChanges(a[i], b[i], p));
		}
		return out;
	}
	if (before == null || after == null) {
		if (!basePath) { return []; }
		return [{
			path: basePath,
			beforeValue: before,
			afterValue: after,
			before: toLeafText(before),
			after: toLeafText(after),
			state: 'applied',
		}];
	}
	const a = before as Record<string, unknown>;
	const b = after as Record<string, unknown>;
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	const out: LeafChange[] = [];
	for (const k of keys) {
		const p = basePath ? `${basePath}.${k}` : k;
		out.push(...collectLeafChanges(a[k], b[k], p));
	}
	return out;
}

function dispatchLastChanges(): void {
	window.dispatchEvent(new CustomEvent('cv-last-changes', {
		detail: {
			changes: lastLeafChanges.map((c) => ({
				path: c.path,
				before: c.before,
				after: c.after,
				state: c.state,
			})),
		},
	}));
}

function pathTokens(path: string): string[] {
	return path.split('.').filter(Boolean);
}

function isIndexToken(t: string): boolean {
	return /^\d+$/.test(t);
}

function deepEqualUnknown(a: unknown, b: unknown): boolean {
	if (a === b) { return true; }
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return false;
	}
}

function getAtPath(obj: Record<string, unknown>, path: string): unknown {
	const toks = pathTokens(path);
	if (toks.length === 0) { return undefined; }
	let cur: unknown = obj;
	for (const t of toks) {
		if (cur == null || typeof cur !== 'object') { return undefined; }
		if (Array.isArray(cur) && isIndexToken(t)) {
			const idx = Number(t);
			if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) { return undefined; }
			cur = cur[idx];
			continue;
		}
		const rec = cur as Record<string, unknown>;
		if (!(t in rec)) { return undefined; }
		cur = rec[t];
	}
	return cur;
}

function sanitizeLoadedChanges(cv: CVData, changes: LeafChange[]): LeafChange[] {
	const root = cv as unknown as Record<string, unknown>;
	return changes.filter((c) => {
		if (deepEqualUnknown(c.beforeValue, c.afterValue)) { return false; }
		const currentValue = getAtPath(root, c.path);
		const expected = c.state === 'applied' ? c.afterValue : c.beforeValue;
		return deepEqualUnknown(currentValue, expected);
	});
}

function setAtPath(obj: Record<string, unknown>, path: string, value: unknown): boolean {
	const toks = pathTokens(path);
	if (toks.length === 0) { return false; }
	let cur: unknown = obj;
	for (let i = 0; i < toks.length - 1; i++) {
		const t = toks[i] as string;
		if (cur == null || typeof cur !== 'object') { return false; }
		if (Array.isArray(cur) && isIndexToken(t)) {
			const idx = Number(t);
			if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) { return false; }
			cur = cur[idx];
		} else {
			const rec = cur as Record<string, unknown>;
			if (!(t in rec)) { return false; }
			cur = rec[t];
		}
	}
	const leaf = toks[toks.length - 1] as string;
	if (cur == null || typeof cur !== 'object') { return false; }
	if (Array.isArray(cur) && isIndexToken(leaf)) {
		const idx = Number(leaf);
		if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) { return false; }
		cur[idx] = value;
	} else {
		(cur as Record<string, unknown>)[leaf] = value;
	}
	return true;
}

function mount(cv: CVData): void {
	layoutAuditLog('mount', { cvHash: hashCvForAudit(cv) });
	const existingRoot = document.getElementById('cv-root');
	if (existingRoot) { existingRoot.remove(); }
	const legacyShell = document.getElementById('cv-shell');
	if (legacyShell) { legacyShell.remove(); }
	if (engineCleanup) { engineCleanup(); engineCleanup = null; }

	window.__CV_DATA__ = cv;

	const root = renderCV(cv);
	document.body.insertBefore(root, document.body.firstChild);
	const shell = document.getElementById('cv-shell');
	if (!shell) { throw new Error('[main] #cv-shell not found after render'); }
	activateShell(shell);

	// Wire filter bar chip clicks
	initFilterBar(cv);

	const hasSharedSnapshot = Boolean(cv.layoutSnapshot);
	engineCleanup = (isShareReadonlyMode() && hasSharedSnapshot)
		? null
		: initCvLayoutEngine() ?? null;
	if (isShareReadonlyMode() && cv.layoutSnapshot) {
		applyLayoutSnapshotToDom(cv.layoutSnapshot);
		window.dispatchEvent(new Event('cv-layout-applied'));
	}
	persistSessionState();
}

function applyData(cv: CVData, recordHistory = true): void {
	const next = cloneCvData(cv);
	const current = window.__CV_DATA__;
	layoutAuditLog('apply-data:start', {
		recordHistory,
		beforeHash: hashCvForAudit(current),
		afterHash: hashCvForAudit(next),
	});
	if (recordHistory && window.__CV_DATA__) {
		historyPast.push(cloneCvData(window.__CV_DATA__));
		if (historyPast.length > HISTORY_LIMIT) {
			historyPast.shift();
		}
		historyFuture.length = 0;
	}
	const computed = recordHistory && current
		? collectLeafChanges(current, next)
		: [];
	// Preserve pending AI change markers across no-op remount style updates
	// (e.g. edit-mode reorder/visibility actions that remount UI scaffolding).
	if (computed.length > 0 || lastLeafChanges.length === 0) {
		lastLeafChanges = computed;
	}
	mount(next);
	layoutAuditLog('apply-data:done', {
		recordHistory,
		leafChanges: lastLeafChanges.length,
		canUndo: historyPast.length > 0,
		canRedo: historyFuture.length > 0,
	});
	dispatchHistoryChanged();
	dispatchLastChanges();
	persistSessionState();
}

function undoCvChange(): void {
	const prev = historyPast.pop();
	if (!prev) { return; }
	if (window.__CV_DATA__) {
		historyFuture.push(cloneCvData(window.__CV_DATA__));
		if (historyFuture.length > HISTORY_LIMIT) {
			historyFuture.shift();
		}
	}
	mount(cloneCvData(prev));
	lastLeafChanges = [];
	dispatchHistoryChanged();
	dispatchLastChanges();
	persistSessionState();
}

function redoCvChange(): void {
	const next = historyFuture.pop();
	if (!next) { return; }
	if (window.__CV_DATA__) {
		historyPast.push(cloneCvData(window.__CV_DATA__));
		if (historyPast.length > HISTORY_LIMIT) {
			historyPast.shift();
		}
	}
	mount(cloneCvData(next));
	lastLeafChanges = [];
	dispatchHistoryChanged();
	dispatchLastChanges();
	persistSessionState();
}

function revertFieldChange(path: string): void {
	const current = window.__CV_DATA__;
	if (!current) { return; }
	const pending = [...lastLeafChanges];
	const idx = pending.findIndex((c) => c.path === path);
	if (idx < 0) { return; }
	const change = pending[idx] as LeafChange;
	if (!change) { return; }
	const next = cloneCvData(current) as unknown as Record<string, unknown>;
	const nextValue = change.state === 'applied'
		? change.beforeValue
		: change.afterValue;
	if (!setAtPath(next, path, nextValue)) { return; }
	applyData(next as unknown as CVData, true);
	change.state = change.state === 'applied' ? 'reverted' : 'applied';
	pending[idx] = change;
	lastLeafChanges = pending;
	dispatchLastChanges();
	persistSessionState();
}

/**
 * Wires filter chip click handlers onto the rendered filter bar.
 * Called after every mount since the bar is re-rendered with the shell.
 */
function initFilterBar(cv: CVData): void {
	const bar = document.getElementById('cv-filter-bar');
	if (!bar) { return; }

	bar.addEventListener('click', (e) => {
		const target = e.target as HTMLElement;

		// Chip click
		const chip = target.closest<HTMLElement>('[data-tag]');
		if (chip) {
			const tag          = chip.dataset.tag ?? '';
			const current      = window.__CV_DATA__;
			if (!current) { return; }
			const newFilters   = toggleFilter(tag, current.activeFilters ?? []);
			const updatedData  = { ...current, activeFilters: newFilters };
			window.__CV_DATA__ = updatedData;
			syncFilterBar(updatedData);
			applyData(updatedData, false);
			return;
		}

		// Clear button
		if (target.closest('#cv-filter-clear')) {
			const current = window.__CV_DATA__;
			if (!current) { return; }
			const updatedData = { ...current, activeFilters: [] };
			window.__CV_DATA__ = updatedData;
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
	const shareToken = getShareTokenFromUrl();
	const pathShareToken = shareTokenFromLocationParts(
		location.pathname,
		'',
		import.meta.env.BASE_URL ?? '/',
	);
	const sharedMode = Boolean(shareToken);
	if (sharedMode) {
		document.documentElement.classList.add('cv-share-readonly');
		setupSharedReadonlyScale();
	} else {
		document.documentElement.classList.remove('cv-share-readonly');
		document.documentElement.classList.remove('cv-share-host');
	}
	if (!sharedMode) {
		await initPasswordlessAuthFromUrl();
	}
	const loaded = loadSessionState();
	const usingSessionCv = loaded.cv != null;
	if (usingSessionCv && loaded.past.length > 0) {
		historyPast.push(...loaded.past.map((x) => cloneCvData(x)));
	}
	if (usingSessionCv && loaded.future.length > 0) {
		historyFuture.push(...loaded.future.map((x) => cloneCvData(x)));
	}
	let initialData = usingSessionCv ? loaded.cv as CVData : loadCvData();
	if (shareToken) {
		if (!pathShareToken) {
			const targetPath = canonicalSharePath(
				shareToken,
				import.meta.env.BASE_URL ?? '/',
			);
			window.history.replaceState({}, '', targetPath);
		}
		const shared = await resolveShareToken(shareToken);
		if (!shared.ok) {
			mountShareError(shared.error.message);
			return;
		}
		initialData = shared.data.data;
	}
	if (usingSessionCv && loaded.changes.length > 0) {
		lastLeafChanges = sanitizeLoadedChanges(
			initialData,
			loaded.changes.map((c) => ({ ...c })),
		);
	}
	mount(initialData);
	const bootTimeout = window.setTimeout(() => { finishBootUi(); }, 2200);
	window.addEventListener('cv-layout-applied', () => {
		window.clearTimeout(bootTimeout);
		finishBootUi();
	}, { once: true });
	initLayoutAuditUi();
	if (!isCvPdfEmbed() && !sharedMode) {
		window.cvUndo = undoCvChange;
		window.cvRedo = redoCvChange;
		window.cvCanUndo = () => historyPast.length > 0;
		window.cvCanRedo = () => historyFuture.length > 0;
		window.cvRevertField = revertFieldChange;
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
		banner.className = 'cv-share-banner no-print';
		const label = document.createElement('span');
		label.textContent = 'Shared CV view - read only';
		const copyBtn = document.createElement('button');
		copyBtn.type = 'button';
		copyBtn.className = 'cv-share-banner__btn';
		copyBtn.textContent = 'Copy link';
		copyBtn.addEventListener('click', () => {
			void copyText(window.location.href).then((ok) => {
				copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
				window.setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1200);
			});
		});
		banner.append(label, copyBtn);
		mountSharedStage(banner);
	}
	mountAboutUi(sharedMode);
	onCvDataChanged((newData) => { applyData(newData, true); });
}

void boot().catch((err: unknown) => {
	console.error('[cv] boot failed', err);
});
