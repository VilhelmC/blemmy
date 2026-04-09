/**
 * generic-editor.ts
 *
 * Edit mode for any Blemmy document type.
 *
 * Makes no assumptions about document structure. Everything is driven by:
 *   1. DOM attributes on rendered elements
 *   2. The shape of the content data
 *   3. The DocumentTypeSpec (for structural variants)
 *
 * DOM attribute protocol:
 *   data-blemmy-field="path.to.value"   — editable text or image field
 *   data-blemmy-drag-group="groupName"  — items in this group are draggable
 *   data-blemmy-drag-idx="N"            — index of this item in its group
 *   data-blemmy-section="sectionId"     — section that can be shown/hidden
 *
 * Image fields: any <img data-blemmy-field="..."> is automatically detected
 * as an image upload target when edit mode activates.
 *
 * Tag filtering: any items in the data with a `tags` string[] field
 * automatically produce a tag editor, regardless of document type.
 *
 * Layout preferences: universal — density, fill, page preference, affinity.
 * These apply to every document the engine processes.
 */

import type { DocumentTypeSpec } from '@cv/document-type-spec';
import {
	stripBlemmyEditChrome,
	stripTrailingBlemmyEditGlyphs,
} from '@lib/blemmy-edit-chrome';
import { hashCvForAudit, layoutAuditLog } from '@lib/engine/layout-audit';
import {
	processPortraitFile,
	savePortraitLocalCache,
	clearPortraitLocalCache,
} from '@lib/profile-portrait';
import { DOCKED_SIDE_PANEL_CLASS } from '@renderer/docked-side-panels';
import {
	enableHandleDragReorderForAllGroups,
	injectHiddenItemsPanel,
	injectListItemChrome,
	injectOrderListChrome,
} from '@renderer/blemmy-edit-chrome-inject';

// ─── Constants ────────────────────────────────────────────────────────────────

const EDIT_ACTIVE_ATTR  = 'data-blemmy-editing';
const FIELD_ATTR        = 'data-blemmy-field';
const DRAG_GROUP_ATTR   = 'data-blemmy-drag-group';
const DRAG_IDX_ATTR     = 'data-blemmy-drag-idx';
const SECTION_ATTR      = 'data-blemmy-section';
const ORDER_PATH_ATTR   = 'data-blemmy-order-path';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EditModeInstance = {
	deactivate:    () => void;
	exportJson:    () => void;
	clearDraft:    () => void;
	clearImage:    (fieldPath: string) => void;
};

export type EditorOptions = {
	spec:          DocumentTypeSpec;
	/** The shell element wrapping the document DOM. */
	shellId:       string;
	/** Draft storage key — unique per document type. */
	draftKey:      string;
	/** Called on every data mutation (debounced for text). */
	onDataChange:  (data: unknown) => void;
	/** Full remount — called after reorder, visibility change, image update. */
	remount:       (data: unknown) => void;
};

// ─── Deep clone ───────────────────────────────────────────────────────────────

function deepClone<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj)) as T;
}

// ─── Draft persistence ────────────────────────────────────────────────────────

export function saveDraft(key: string, data: unknown): void {
	try { localStorage.setItem(key, JSON.stringify(data)); }
	catch { /* quota or private mode */ }
}

export function loadDraft<T>(key: string): T | null {
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) as T : null;
	} catch { return null; }
}

export function clearDraftByKey(key: string): void {
	try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// ─── Generic path get/set ─────────────────────────────────────────────────────

function pathTokens(path: string): string[] {
	return path.split('.').filter(Boolean);
}

function getAtPath(obj: unknown, path: string): unknown {
	let cur = obj;
	for (const tok of pathTokens(path)) {
		if (cur == null || typeof cur !== 'object') { return undefined; }
		if (Array.isArray(cur)) {
			const idx = Number(tok);
			if (!Number.isInteger(idx)) { return undefined; }
			cur = (cur as unknown[])[idx];
		} else {
			cur = (cur as Record<string, unknown>)[tok];
		}
	}
	return cur;
}

function setAtPath(obj: unknown, path: string, value: unknown): boolean {
	const toks = pathTokens(path);
	if (toks.length === 0) { return false; }
	let cur: unknown = obj;
	for (let i = 0; i < toks.length - 1; i++) {
		const tok = toks[i] as string;
		if (cur == null || typeof cur !== 'object') { return false; }
		if (Array.isArray(cur)) {
			const idx = Number(tok);
			if (!Number.isInteger(idx)) { return false; }
			cur = (cur as unknown[])[idx];
		} else {
			cur = (cur as Record<string, unknown>)[tok];
		}
	}
	const leaf = toks[toks.length - 1] as string;
	if (cur == null || typeof cur !== 'object') { return false; }
	if (Array.isArray(cur)) {
		const idx = Number(leaf);
		if (!Number.isInteger(idx)) { return false; }
		(cur as unknown[])[idx] = value;
	} else {
		(cur as Record<string, unknown>)[leaf] = value;
	}
	return true;
}

// ─── Highlight serialisation ─────────────────────────────────────────────────

/**
 * Reads a highlight <li> element back to its "Lead: Body" source string.
 * Works for any highlight list regardless of document type.
 */
function serialiseHighlightLi(li: HTMLElement): string {
	const clone = li.cloneNode(true) as HTMLElement;
	stripBlemmyEditChrome(clone);
	const strong = clone.querySelector('strong.highlight-lead');
	if (strong) {
		const lead = strong.textContent?.replace(/:$/, '').trim() ?? '';
		let body = '';
		let node = strong.nextSibling;
		while (node) {
			body += node.textContent ?? '';
			node = node.nextSibling;
		}
		return stripTrailingBlemmyEditGlyphs(`${lead}: ${body.trim()}`);
	}
	return stripTrailingBlemmyEditGlyphs(clone.textContent?.trim() ?? '');
}

// ─── Date field serialisation ─────────────────────────────────────────────────

/**
 * Splits a "YYYY – YYYY" display date into [startDate, endDate].
 * The thinspace (U+2009) around the em dash is stripped.
 */
function parseDateRange(text: string): [string, string] | null {
	const parts = text.split('–').map((s) => s.trim().replace(/\u2009/g, ''));
	if (parts.length === 2 && parts[0] && parts[1]) {
		return [parts[0], parts[1]];
	}
	return null;
}

// ─── Field value serialisation ───────────────────────────────────────────────

/**
 * Reads the current value of a [data-blemmy-field] element back to a
 * plain string suitable for writing to the data object.
 *
 * Special cases:
 *   - highlight <li>: reconstructs "Lead: Body" from the strong child
 *   - <img>: handled separately via image upload, not contenteditable
 */
function serialiseFieldEl(el: HTMLElement): string {
	const tag = el.tagName.toLowerCase();
	if (tag === 'li') { return serialiseHighlightLi(el); }
	const clone = el.cloneNode(true) as HTMLElement;
	stripBlemmyEditChrome(clone);
	return stripTrailingBlemmyEditGlyphs(clone.textContent?.trim() ?? '');
}

// ─── Generic field writer ─────────────────────────────────────────────────────

/**
 * Writes a text edit back to the data object at the path given by
 * data-blemmy-field. Handles date ranges by splitting the field path:
 * if the path ends with ".dates", it looks for ".startDate" / ".endDate"
 * siblings and writes both.
 *
 * Returns true if the data was updated.
 */
function applyFieldEdit(
	fieldPath: string,
	el:        HTMLElement,
	data:      unknown,
): boolean {
	// Date range fields: "work.0.dates" → write startDate + endDate separately
	const dateMatch = fieldPath.match(/^(.+)\.(dates)$/);
	if (dateMatch) {
		const parentPath = dateMatch[1];
		const parsed = parseDateRange(serialiseFieldEl(el));
		if (!parsed) { return false; }
		const [start, end] = parsed;
		setAtPath(data, `${parentPath}.startDate`, start);
		setAtPath(data, `${parentPath}.endDate`,   end);
		return true;
	}

	// Label parts: "basics.label.0" → split/join on ' · '
	const labelMatch = fieldPath.match(/^(.+\.label)\.(\d+)$/);
	if (labelMatch) {
		const parentPath = labelMatch[1];
		const idx        = parseInt(labelMatch[2], 10);
		const current    = getAtPath(data, parentPath);
		if (typeof current === 'string') {
			const parts  = current.split('·').map((s) => s.trim());
			parts[idx]   = serialiseFieldEl(el);
			setAtPath(data, parentPath, parts.join(' · '));
			return true;
		}
	}

	// Plain field — just write the text value
	const text = serialiseFieldEl(el);
	return setAtPath(data, fieldPath, text);
}

// ─── Contenteditable activation ──────────────────────────────────────────────

function enableContentEditable(
	shell:    HTMLElement,
	data:     unknown,
	onEdit:   (data: unknown) => void,
): () => void {
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleEngineRerun(): void {
		if (saveTimer) { clearTimeout(saveTimer); }
		saveTimer = setTimeout(() => {
			window.dispatchEvent(new Event('resize'));
		}, 500);
	}

	// Select all text fields — exclude <img> (image fields handled separately)
	const fields = Array.from(
		shell.querySelectorAll<HTMLElement>(`[${FIELD_ATTR}]`)
	).filter((el) => el.tagName.toLowerCase() !== 'img');

	function handleInput(e: Event): void {
		const el        = e.currentTarget as HTMLElement;
		const fieldPath = el.getAttribute(FIELD_ATTR);
		if (!fieldPath) { return; }
		applyFieldEdit(fieldPath, el, data);
		onEdit(data);
		scheduleEngineRerun();
	}

	function handleKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); }
	}

	for (const el of fields) {
		el.contentEditable = 'true';
		el.setAttribute('spellcheck', 'false');
		el.addEventListener('input',   handleInput);
		el.addEventListener('keydown', handleKeyDown);
	}

	return () => {
		for (const el of fields) {
			el.contentEditable = 'false';
			el.removeAttribute('spellcheck');
			el.removeEventListener('input',   handleInput);
			el.removeEventListener('keydown', handleKeyDown);
		}
		if (saveTimer) { clearTimeout(saveTimer); }
	};
}

// ─── Image field upload ───────────────────────────────────────────────────────

/**
 * Finds all <img data-blemmy-field="..."> elements in the shell and
 * wires a file input to each one. Clicking the image opens a picker.
 * On upload, the data URL is written to the field path, and the
 * cache is updated if the path ends with "portraitDataUrl".
 */
function enableImageUploads(
	shell:    HTMLElement,
	data:     unknown,
	onChange: (data: unknown) => void,
	remount:  (data: unknown) => void,
): () => void {
	const imgs = Array.from(
		shell.querySelectorAll<HTMLImageElement>(`img[${FIELD_ATTR}]`)
	);
	if (imgs.length === 0) { return () => { /* noop */ }; }

	const cleanups: Array<() => void> = [];

	for (const img of imgs) {
		const fieldPath = img.getAttribute(FIELD_ATTR);
		if (!fieldPath) { continue; }
		const pathForImg = fieldPath;

		const input = document.createElement('input');
		input.type   = 'file';
		input.accept = 'image/*';
		input.style.display = 'none';
		document.body.appendChild(input);

		function handleClick(): void { input.click(); }

		function handleChange(): void {
			const file = input.files?.[0];
			input.value = '';
			if (!file) { return; }
			void processPortraitFile(file)
				.then((dataUrl: string) => {
					setAtPath(data, pathForImg, dataUrl);
					// Clear SHA if portrait is replaced (blemmy-specific convention,
					// harmless on other document types)
					const shaPath = pathForImg.replace('portraitDataUrl', 'portraitSha256');
					if (shaPath !== pathForImg) {
						const parent = pathTokens(pathForImg).slice(0, -1).join('.');
						const parentObj = getAtPath(data, parent) as Record<string, unknown> | undefined;
						if (parentObj) { delete parentObj.portraitSha256; }
					}
					void savePortraitLocalCache(dataUrl);
					onChange(data);
					remount(data);
				})
				.catch((err: unknown) => {
					window.alert(err instanceof Error ? err.message : String(err));
				});
		}

		img.style.cursor = 'pointer';
		img.title = 'Click to replace image';
		img.addEventListener('click', handleClick);
		input.addEventListener('change', handleChange);

		cleanups.push(() => {
			img.style.cursor = '';
			img.title = '';
			img.removeEventListener('click', handleClick);
			input.removeEventListener('change', handleChange);
			document.body.removeChild(input);
		});
	}

	return () => { for (const fn of cleanups) { fn(); } };
}

// ─── Tag editing ──────────────────────────────────────────────────────────────

/**
 * Walks the data object looking for any array items that have a `tags`
 * string[] field. For each such item, injects a tag-editor row after the
 * corresponding DOM element (identified by data-blemmy-drag-idx on the
 * same parent path, or by the closest [data-blemmy-field^="path"] ancestor).
 *
 * This is document-type agnostic: it works for CVData.work, CVData.education,
 * LetterData items, or any future type that puts tags[] on its items.
 */
function injectTagEditors(
	data:    unknown,
	onEdit:  (data: unknown) => void,
): () => void {
	const injected: HTMLElement[] = [];

	/** Collect { path, tags } for every tagged item in the data tree. */
	function collectTaggedPaths(
		obj:     unknown,
		prefix:  string,
		results: Array<{ path: string; tags: string[] }>,
	): void {
		if (Array.isArray(obj)) {
			obj.forEach((item, i) => collectTaggedPaths(item, `${prefix}.${i}`, results));
		} else if (obj && typeof obj === 'object') {
			const rec = obj as Record<string, unknown>;
			if (Array.isArray(rec.tags) && rec.tags.every((t) => typeof t === 'string')) {
				results.push({ path: prefix, tags: rec.tags as string[] });
			}
			for (const [k, v] of Object.entries(rec)) {
				if (k !== 'tags') { collectTaggedPaths(v, prefix ? `${prefix}.${k}` : k, results); }
			}
		}
	}

	const tagged: Array<{ path: string; tags: string[] }> = [];
	collectTaggedPaths(data, '', tagged);
	if (tagged.length === 0) { return () => { /* noop */ }; }

	// Collect all existing tags for autocomplete
	const allTags = Array.from(new Set(tagged.flatMap((t) => t.tags))).sort();

	// Build/update datalist for autocomplete
	let datalist = document.getElementById('blemmy-tag-datalist');
	if (!datalist) {
		datalist = document.createElement('datalist');
		datalist.id = 'blemmy-tag-datalist';
		document.body.appendChild(datalist);
		injected.push(datalist as HTMLElement);
	}
	datalist.innerHTML = allTags.map((t) => `<option value="${t}"></option>`).join('');

	for (const { path, tags: currentTags } of tagged) {
		// Find the DOM element for this path
		// Try data-blemmy-drag-idx first, then any field descendant
		const parts    = path.split('.').filter(Boolean);
		const groupPath = parts.slice(0, -1).join('.');
		const idx       = parts[parts.length - 1];

		let targetEl: HTMLElement | null =
			document.querySelector<HTMLElement>(
				`[${DRAG_GROUP_ATTR}="${groupPath}"][${DRAG_IDX_ATTR}="${idx}"]`
			) ??
			document.querySelector<HTMLElement>(
				`[${FIELD_ATTR}^="${path}."]`
			)?.closest<HTMLElement>('[class]') ?? null;

		if (!targetEl) { continue; }

		const tagList = [...currentTags]; // mutable local copy

		function rebuildChips(row: HTMLElement, inputWrap: HTMLElement): void {
			// Remove existing chips, keep input
			const children = Array.from(row.childNodes);
			for (const child of children) {
				if (child !== inputWrap) { row.removeChild(child); }
			}
			for (const tag of tagList) {
				const chip       = document.createElement('span');
				chip.className   = 'blemmy-tag-chip blemmy-tag-chip--edit';
				chip.textContent = tag;
				const removeBtn  = document.createElement('button');
				removeBtn.type      = 'button';
				removeBtn.className = 'blemmy-tag-chip__remove';
				removeBtn.textContent = '×';
				removeBtn.setAttribute('aria-label', `Remove tag ${tag}`);
				removeBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					const ti = tagList.indexOf(tag);
					if (ti !== -1) { tagList.splice(ti, 1); }
					setAtPath(data, `${path}.tags`, [...tagList]);
					onEdit(data);
					rebuildChips(row, inputWrap);
				});
				chip.appendChild(removeBtn);
				row.insertBefore(chip, inputWrap);
			}
		}

		const row       = document.createElement('div');
		row.className   = 'blemmy-tag-row no-print';
		const inputWrap = document.createElement('div');
		inputWrap.className = 'blemmy-tag-input-wrap';
		const input     = document.createElement('input');
		input.type         = 'text';
		input.className    = 'blemmy-tag-input';
		input.placeholder  = '+ tag';
		input.setAttribute('list', 'blemmy-tag-datalist');
		input.setAttribute('autocomplete', 'off');
		input.setAttribute('spellcheck', 'false');
		input.setAttribute('aria-label', 'Add tag');

		function commitInput(): void {
			const val = input.value.trim().toLowerCase();
			if (val && !tagList.includes(val)) {
				input.value = '';
				tagList.push(val);
				setAtPath(data, `${path}.tags`, [...tagList]);
				onEdit(data);
				rebuildChips(row, inputWrap);
			} else {
				input.value = '';
			}
		}

		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter')  { e.preventDefault(); commitInput(); }
			if (e.key === 'Escape') { input.value = ''; input.blur(); }
		});
		input.addEventListener('change', () => commitInput());
		inputWrap.appendChild(input);
		row.appendChild(inputWrap);
		rebuildChips(row, inputWrap);
		targetEl.appendChild(row);
		injected.push(row);
	}

	return () => {
		for (const el of injected) { el.remove(); }
	};
}

// ─── Section visibility toggle buttons ───────────────────────────────────────

/**
 * Injects show/hide buttons onto each [data-blemmy-section] element.
 * Visibility is stored in data.visibility.hiddenSections (generic).
 * For indexed items (data-blemmy-drag-idx), stores in hiddenItems[groupPath].
 */
function injectSectionToggles(
	data:     unknown,
	onChange: (data: unknown) => void,
	remount:  (data: unknown) => void,
): () => void {
	const injected: HTMLElement[] = [];

	document.querySelectorAll<HTMLElement>(`[${SECTION_ATTR}]`).forEach((sectionEl) => {
		if (sectionEl.hasAttribute(ORDER_PATH_ATTR)) {
			return;
		}
		const sectionId = sectionEl.getAttribute(SECTION_ATTR);
		if (!sectionId) { return; }

		// Check current hidden state
		const hiddenSections = (
			(data as Record<string, unknown>)?.visibility as Record<string, unknown>
		)?.hiddenSections as string[] | undefined ?? [];
		const isHidden = hiddenSections.includes(sectionId);

		const btn = document.createElement('button');
		btn.type      = 'button';
		btn.className = `blemmy-section-toggle no-print ${isHidden ? 'blemmy-section-toggle--hidden' : ''}`;
		btn.textContent = isHidden ? '＋ Show' : '− Hide';
		btn.setAttribute('aria-label', `${isHidden ? 'Show' : 'Hide'} ${sectionId}`);
		btn.setAttribute('title', `${isHidden ? 'Show' : 'Hide'} ${sectionId}`);

		btn.addEventListener('click', () => {
			const rec = data as Record<string, unknown>;
			if (!rec.visibility || typeof rec.visibility !== 'object') {
				rec.visibility = {};
			}
			const vis = rec.visibility as Record<string, unknown>;
			if (!Array.isArray(vis.hiddenSections)) { vis.hiddenSections = []; }
			const hs = vis.hiddenSections as string[];
			const idx = hs.indexOf(sectionId);
			if (idx === -1) { hs.push(sectionId); }
			else            { hs.splice(idx, 1); }
			onChange(data);
			remount(data);
		});

		sectionEl.appendChild(btn);
		injected.push(btn);
	});

	return () => { for (const el of injected) { el.remove(); } };
}

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

// ─── JSON export ──────────────────────────────────────────────────────────────

export function exportAsJson(data: unknown, filename = 'document.json'): void {
	// Strip portraitDataUrl from export (large blob, not needed in JSON file)
	const forExport = deepClone(data) as Record<string, unknown>;
	const basics = forExport.basics as Record<string, unknown> | undefined;
	if (basics) {
		delete basics.portraitDataUrl;
		delete basics.portraitSha256;
	}
	const json = JSON.stringify(forExport, null, '\t');
	const blob = new Blob([json], { type: 'application/json' });
	const url  = URL.createObjectURL(blob);
	const a    = document.createElement('a');
	a.href     = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * Activates generic edit mode on the shell identified by opts.shellId.
 *
 * All behaviour is driven by DOM attributes and data shape — no document-type
 * knowledge required. Pass any DocumentTypeSpec and any data object.
 */
export function activateEditMode(
	initialData: unknown,
	opts:        EditorOptions,
): EditModeInstance {
	const shellEl = document.getElementById(opts.shellId);
	if (!shellEl) {
		throw new Error(`[generic-editor] shell #${opts.shellId} not found`);
	}
	const shell = shellEl;

	// Working copy — mutated by edits
	const workingData = deepClone(initialData);

	shell.setAttribute(EDIT_ACTIVE_ATTR, 'true');
	document.documentElement.classList.add('blemmy-edit-mode');

	function handleDataChange(data: unknown): void {
		saveDraft(opts.draftKey, data);
		opts.onDataChange(data);
	}

	function handleRemount(data: unknown): void {
		opts.remount(data);
	}

	// ── Section toggles (injects buttons onto [data-blemmy-section] els) ─────
	const cleanupSections = injectSectionToggles(
		workingData,
		handleDataChange,
		handleRemount,
	);

	const cleanupListChrome = injectListItemChrome(
		workingData,
		handleDataChange,
		handleRemount,
	);
	const cleanupOrderChrome = injectOrderListChrome(
		workingData,
		handleDataChange,
		handleRemount,
	);
	const cleanupHiddenPanel = injectHiddenItemsPanel(
		workingData,
		handleDataChange,
		handleRemount,
	);

	// ── Contenteditable ───────────────────────────────────────────────────────
	const cleanupCE = enableContentEditable(shell, workingData, handleDataChange);

	// ── Image uploads ─────────────────────────────────────────────────────────
	const cleanupImages = enableImageUploads(
		shell,
		workingData,
		handleDataChange,
		handleRemount,
	);

	// ── Drag reorder (handle-based; one interaction per drag-group) ──────────
	const cleanupDrag = enableHandleDragReorderForAllGroups(
		shell,
		workingData,
		handleDataChange,
		handleRemount,
	);

	// ── Tag editors ───────────────────────────────────────────────────────────
	const cleanupTags = injectTagEditors(workingData, handleDataChange);

	// ── Deactivate ────────────────────────────────────────────────────────────
	function deactivate(): void {
		cleanupCE();
		cleanupImages();
		cleanupDrag();
		cleanupTags();
		cleanupListChrome();
		cleanupOrderChrome();
		cleanupHiddenPanel();
		cleanupSections();
		shell.removeAttribute(EDIT_ACTIVE_ATTR);
		document.documentElement.classList.remove('blemmy-edit-mode');
	}

	return {
		deactivate,
		exportJson: () => {
			const docType = opts.spec.docType;
			exportAsJson(workingData, `${docType}-${Date.now()}.json`);
		},
		clearDraft: () => { clearDraftByKey(opts.draftKey); },
		clearImage: (fieldPath: string) => {
			setAtPath(workingData, fieldPath, null);
			// Also clear portraitSha256 if this is a portrait field
			if (fieldPath.endsWith('portraitDataUrl')) {
				const parent = pathTokens(fieldPath).slice(0, -1).join('.');
				const parentObj = getAtPath(workingData, parent) as Record<string, unknown> | undefined;
				if (parentObj) { delete parentObj.portraitSha256; }
			}
			void clearPortraitLocalCache();
			handleDataChange(workingData);
			handleRemount(workingData);
		},
	};
}
