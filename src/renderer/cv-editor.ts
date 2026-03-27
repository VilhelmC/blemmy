/**
 * cv-editor.ts
 *
 * Edit mode for the CV. Activated and deactivated via toggleEditMode().
 *
 * When active:
 *   - All [data-cv-field] elements become contenteditable
 *   - Clicking the portrait opens a file picker to replace the image
 *   - Work items become draggable to reorder within their page
 *   - Changes are saved to localStorage on every edit (debounced 400ms)
 *   - A "Download JSON" action exports the current working data
 *
 * Data model:
 *   workingData   — a deep clone of the active CVData, mutated by edits.
 *                   Persisted to localStorage under 'cv-edit-draft'.
 *   Portrait       — basics.portraitDataUrl (JPEG data URL); cloud + share.
 *
 * Engine interaction:
 *   After text edits settle (debounced), the layout engine reschedules
 *   itself via a synthetic window resize event — no special integration needed.
 *   After work-item reorder, we call the provided remount() callback which
 *   does a full re-render with the new work order.
 *
 * Highlight parsing:
 *   The "Lead: Body" format is preserved. When editing a highlight li, the
 *   serialiser reconstructs "Lead: Body" from the bold <strong> and the
 *   following text node.
 */

import type {
	CVData,
	CVSectionId,
	CVSidebarSectionId,
	CVSkillsCategoryId,
} from '@cv/cv';
import { stripPortraitForJsonExport } from '@lib/cv-json-export';
import { hashCvForAudit, layoutAuditLog } from '@lib/layout-audit';
import {
	clearPortraitLocalCache,
	processPortraitFile,
	savePortraitLocalCache,
} from '@lib/cv-portrait';
import { clearLegacyPortraitStorage } from '@lib/cv-loader';
import { DOCKED_SIDE_PANEL_CLASS } from '@renderer/docked-side-panels';

// ─── Constants ────────────────────────────────────────────────────────────────

const EDIT_DRAFT_KEY   = 'cv-edit-draft';
const EDIT_ACTIVE_ATTR = 'data-cv-editing';

// ─── Deep clone ───────────────────────────────────────────────────────────────

function deepClone<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj));
}

// ─── Draft persistence ────────────────────────────────────────────────────────

export function saveDraft(data: CVData): void {
	try {
		localStorage.setItem(EDIT_DRAFT_KEY, JSON.stringify(data));
	} catch { /* quota or private mode */ }
}

export function loadDraft(): CVData | null {
	try {
		const raw = localStorage.getItem(EDIT_DRAFT_KEY);
		return raw ? JSON.parse(raw) as CVData : null;
	} catch {
		return null;
	}
}

export function clearDraft(): void {
	try { localStorage.removeItem(EDIT_DRAFT_KEY); } catch { /* ignore */ }
}

// ─── Highlight serialisation ──────────────────────────────────────────────────

/**
 * Reads a highlight <li> element back to its source string.
 * Reconstructs "Lead: Body" if the li has a <strong> child.
 */
function serialiseHighlightLi(li: HTMLElement): string {
	const strong = li.querySelector('strong.highlight-lead');
	if (strong) {
		// Lead is the strong text minus the trailing ':'
		const lead = strong.textContent?.replace(/:$/, '').trim() ?? '';
		// Body is everything after the strong element
		let body = '';
		let node = strong.nextSibling;
		while (node) {
			body += node.textContent ?? '';
			node  = node.nextSibling;
		}
		return `${lead}: ${body.trim()}`;
	}
	return li.textContent?.trim() ?? '';
}

// ─── Field → data path parsing ────────────────────────────────────────────────

/**
 * Parses a data-cv-field string and writes the new text value into the
 * working data object. Handles all field types.
 *
 * Returns true if the field was recognised and the data was updated.
 */
function applyFieldEdit(
	field: string,
	text:  string,
	li:    HTMLElement | null,
	data:  CVData,
): boolean {
	// basics.name / basics.summary / basics.email / basics.phone /
	// basics.location / basics.nationality / personal.interests
	if (field === 'basics.name')        { data.basics.name        = text; return true; }
	if (field === 'basics.summary')     { data.basics.summary     = text; return true; }
	if (field === 'basics.email')       { data.basics.email       = text; return true; }
	if (field === 'basics.phone')       { data.basics.phone       = text; return true; }
	if (field === 'basics.location')    { data.basics.location    = text; return true; }
	if (field === 'basics.nationality') { data.basics.nationality = text; return true; }
	if (field === 'personal.interests') { data.personal.interests = text; return true; }

	// basics.label.N — label parts (joined back with ' · ')
	const labelMatch = field.match(/^basics\.label\.(\d+)$/);
	if (labelMatch) {
		const parts    = data.basics.label.split('·').map((s) => s.trim());
		const idx      = parseInt(labelMatch[1], 10);
		parts[idx]     = text;
		data.basics.label = parts.join(' · ');
		return true;
	}

	// work.N.company / position / summary / dates
	const workFieldMatch = field.match(/^work\.(\d+)\.(company|position|summary|dates)$/);
	if (workFieldMatch) {
		const wi   = parseInt(workFieldMatch[1], 10);
		const prop = workFieldMatch[2];
		if (!data.work[wi]) { return false; }
		if (prop === 'company')  { data.work[wi].company  = text; return true; }
		if (prop === 'position') { data.work[wi].position = text; return true; }
		if (prop === 'summary')  { data.work[wi].summary  = text; return true; }
		if (prop === 'dates') {
			// Format: "YYYY\u2009–\u2009YYYY" or "YYYY\u2009–\u2009Present"
			const parts = text.split('–').map((s) => s.trim().replace(/\u2009/g, ''));
			data.work[wi].startDate = parts[0] ?? data.work[wi].startDate;
			data.work[wi].endDate   = parts[1] ?? data.work[wi].endDate;
			return true;
		}
	}

	// work.N.highlights.M — use the li element for accurate serialisation
	const workHlMatch = field.match(/^work\.(\d+)\.highlights\.(\d+)$/);
	if (workHlMatch) {
		const wi = parseInt(workHlMatch[1], 10);
		const hi = parseInt(workHlMatch[2], 10);
		if (!data.work[wi]) { return false; }
		const value = li ? serialiseHighlightLi(li) : text;
		data.work[wi].highlights[hi] = value;
		return true;
	}

	// education.N.degree / institution / area / dates / score
	const eduMatch = field.match(/^education\.(\d+)\.(degree|institution|area|dates|score)$/);
	if (eduMatch) {
		const ei   = parseInt(eduMatch[1], 10);
		const prop = eduMatch[2];
		if (!data.education[ei]) { return false; }
		if (prop === 'degree')      { data.education[ei].degree      = text; return true; }
		if (prop === 'institution') { data.education[ei].institution = text; return true; }
		if (prop === 'area')        { data.education[ei].area        = text; return true; }
		if (prop === 'score')       { data.education[ei].score       = text; return true; }
		if (prop === 'dates') {
			const parts = text.split('–').map((s) => s.trim().replace(/\u2009/g, ''));
			data.education[ei].startDate = parts[0] ?? data.education[ei].startDate;
			data.education[ei].endDate   = parts[1] ?? data.education[ei].endDate;
			return true;
		}
	}

	// skills.programming.N / skills.design_bim.N / skills.strategic.N
	const skillMatch = field.match(/^skills\.(programming|design_bim|strategic)\.(\d+)$/);
	if (skillMatch) {
		const cat = skillMatch[1] as 'programming' | 'design_bim' | 'strategic';
		const si  = parseInt(skillMatch[2], 10);
		data.skills[cat][si] = text;
		return true;
	}

	// languages.N.language / languages.N.fluency
	const langMatch = field.match(/^languages\.(\d+)\.(language|fluency)$/);
	if (langMatch) {
		const li2  = parseInt(langMatch[1], 10);
		const prop = langMatch[2];
		if (!data.languages[li2]) { return false; }
		if (prop === 'language') { data.languages[li2].language = text; return true; }
		if (prop === 'fluency')  {
			data.languages[li2].fluency = text as CVData['languages'][0]['fluency'];
			return true;
		}
	}

	return false;
}

// ─── JSON export ──────────────────────────────────────────────────────────────

export function exportAsJson(data: CVData): void {
	const forFile = stripPortraitForJsonExport(data);
	const blob = new Blob([JSON.stringify(forFile, null, '\t')], {
		type: 'application/json',
	});
	const url   = URL.createObjectURL(blob);
	const a     = document.createElement('a');
	a.href      = url;
	a.download  = 'cv-content.json';
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

// ─── Drag-to-reorder work items ───────────────────────────────────────────────

/** Index to splice moved item into after removing dragIdx. */
function workReorderInsertAt(
	dragIdx: number,
	overIdx: number,
	insertBefore: boolean,
): number {
	if (insertBefore) {
		return dragIdx < overIdx ? overIdx - 1 : overIdx;
	}
	return dragIdx <= overIdx ? overIdx : overIdx + 1;
}

function workBlockKey(block: HTMLElement): string {
	const company = block
		.querySelector<HTMLElement>('[data-cv-field$=".company"]')
		?.innerText
		.trim() ?? '';
	const period = block
		.querySelector<HTMLElement>('[data-cv-field$=".period"]')
		?.innerText
		.trim() ?? '';
	const fallback = block.dataset.workIdx ?? '';
	return `${company}|${period}|${fallback}`;
}

function captureWorkRects(shell: HTMLElement): Map<string, DOMRect> {
	const rects = new Map<string, DOMRect>();
	const blocks = shell.querySelectorAll<HTMLElement>('[data-work-idx]');
	blocks.forEach((block) => {
		rects.set(workBlockKey(block), block.getBoundingClientRect());
	});
	return rects;
}

function animateWorkReorder(shell: HTMLElement, beforeRects: Map<string, DOMRect>): void {
	requestAnimationFrame(() => {
		const blocks = shell.querySelectorAll<HTMLElement>('[data-work-idx]');
		blocks.forEach((block) => {
			const key = workBlockKey(block);
			const prev = beforeRects.get(key);
			if (!prev) { return; }
			const next = block.getBoundingClientRect();
			const dx = prev.left - next.left;
			const dy = prev.top - next.top;
			if (Math.abs(dx) < 1 && Math.abs(dy) < 1) { return; }
			block.animate(
				[
					{
						transform: `translate(${dx}px, ${dy}px)`,
						opacity: 0.96,
					},
					{
						transform: 'translate(0, 0)',
						opacity: 1,
					},
				],
				{
					duration: 180,
					easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
				},
			);
		});
	});
}

function enableWorkItemDrag(
	shell:   HTMLElement,
	data:    CVData,
	remount: (data: CVData) => void,
): () => void {
	let dragIdx: number | null = null;

	const marker = document.createElement('div');
	marker.id = 'cv-work-insert-marker';
	marker.className = 'cv-work-insert-marker';
	marker.hidden = true;
	marker.setAttribute('aria-hidden', 'true');
	document.body.appendChild(marker);

	function hideInsertMarker(): void {
		marker.hidden = true;
	}

	function showInsertMarker(block: HTMLElement, before: boolean): void {
		const rect = block.getBoundingClientRect();
		const top = before ? rect.top : rect.bottom;
		marker.style.left = `${Math.round(rect.left)}px`;
		marker.style.width = `${Math.round(rect.width)}px`;
		marker.style.top = `${Math.round(top)}px`;
		marker.hidden = false;
	}

	function getBlock(target: EventTarget | null): HTMLElement | null {
		if (!(target instanceof HTMLElement)) { return null; }
		return target.closest<HTMLElement>('[data-work-idx]');
	}

	function blockUnderPointer(e: DragEvent): HTMLElement | null {
		const raw = document.elementFromPoint(e.clientX, e.clientY);
		const fromPt = getBlock(raw);
		if (fromPt) { return fromPt; }
		return getBlock(e.target);
	}

	function handleDragStart(e: DragEvent): void {
		const block = getBlock(e.target);
		if (!block) { return; }
		dragIdx = parseInt(block.dataset.workIdx ?? '-1', 10);
		block.classList.add('cv-drag-source');
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(dragIdx));
		}
	}

	function handleDragOver(e: DragEvent): void {
		e.preventDefault();
		if (dragIdx === null) { return; }

		const block = blockUnderPointer(e);
		if (!block) {
			hideInsertMarker();
			return;
		}
		const overIdx = parseInt(block.dataset.workIdx ?? '-1', 10);
		if (overIdx < 0 || overIdx === dragIdx) {
			hideInsertMarker();
			return;
		}

		const rect = block.getBoundingClientRect();
		const midY = rect.top + rect.height / 2;
		const before = e.clientY < midY;
		showInsertMarker(block, before);
	}

	function handleDragLeave(e: DragEvent): void {
		const rel = e.relatedTarget as Node | null;
		if (rel && shell.contains(rel)) { return; }
		hideInsertMarker();
	}

	function handleDrop(e: DragEvent): void {
		e.preventDefault();
		hideInsertMarker();
		if (dragIdx === null) { return; }

		const block = blockUnderPointer(e);
		if (!block) { return; }
		const overIdx = parseInt(block.dataset.workIdx ?? '-1', 10);
		if (overIdx < 0 || overIdx === dragIdx) { return; }

		const rect = block.getBoundingClientRect();
		const midY = rect.top + rect.height / 2;
		const before = e.clientY < midY;

		const insertAt = workReorderInsertAt(dragIdx, overIdx, before);
		const beforeRects = captureWorkRects(shell);
		const newWork = [...data.work];
		const [moved] = newWork.splice(dragIdx, 1);
		newWork.splice(insertAt, 0, moved);
		const newData = { ...data, work: newWork };
		saveDraft(newData);
		remount(newData);
		animateWorkReorder(shell, beforeRects);
	}

	function handleDragEnd(e: DragEvent): void {
		const block = getBlock(e.target);
		block?.classList.remove('cv-drag-source');
		hideInsertMarker();
		dragIdx = null;
		shell.querySelectorAll<HTMLElement>('[data-work-idx]').forEach((el) => {
			el.draggable = false;
		});
	}

	// Work blocks are non-draggable by default to preserve native text caret
	// behavior inside nested contenteditable fields. A dedicated drag handle
	// enables drag only for the current gesture.
	function activateDraggable(): void {
		shell.querySelectorAll<HTMLElement>('[data-work-idx]').forEach((el) => {
			el.draggable = false;
			if (el.querySelector('.cv-drag-handle')) { return; }
			const handle = document.createElement('button');
			handle.type = 'button';
			handle.className = 'cv-drag-handle no-print';
			handle.setAttribute('aria-label', 'Drag to reorder');
			handle.title = 'Drag to reorder';
			handle.textContent = '⋮⋮';
			el.appendChild(handle);
		});
	}
	activateDraggable();

	function handleMouseDown(e: MouseEvent): void {
		const block = getBlock(e.target);
		if (!block) { return; }
		const onHandle = (e.target as HTMLElement | null)?.closest('.cv-drag-handle');
		block.draggable = !!onHandle;
	}

	function handleMouseUp(): void {
		shell.querySelectorAll<HTMLElement>('[data-work-idx]').forEach((el) => {
			el.draggable = false;
		});
	}

	shell.addEventListener('dragstart', handleDragStart);
	shell.addEventListener('dragover',  handleDragOver);
	shell.addEventListener('dragleave', handleDragLeave);
	shell.addEventListener('drop',      handleDrop);
	shell.addEventListener('dragend',   handleDragEnd);
	shell.addEventListener('mousedown', handleMouseDown, true);
	window.addEventListener('mouseup',  handleMouseUp);

	// Re-activate after engine DOM mutations (observer on work pool)
	const obs = new MutationObserver(() => activateDraggable());
	obs.observe(shell, { subtree: true, childList: true });

	return () => {
		shell.querySelectorAll<HTMLElement>('[data-work-idx]').forEach((el) => {
			el.draggable = false;
		});
		shell.removeEventListener('dragstart', handleDragStart);
		shell.removeEventListener('dragover',  handleDragOver);
		shell.removeEventListener('dragleave', handleDragLeave);
		shell.removeEventListener('drop',      handleDrop);
		shell.removeEventListener('dragend',   handleDragEnd);
		shell.removeEventListener('mousedown', handleMouseDown, true);
		window.removeEventListener('mouseup',  handleMouseUp);
		obs.disconnect();
		marker.remove();
		shell.querySelectorAll('.cv-drag-handle').forEach((el) => el.remove());
	};
}

// ─── Portrait replacement ─────────────────────────────────────────────────────

function enablePortraitReplacement(
	data:     CVData,
	onChange: (d: CVData) => void,
	remount:  (d: CVData) => void,
): () => void {
	const imgEl = document.getElementById('cv-portrait-img') as HTMLImageElement | null;
	if (!imgEl) { return () => { /* noop */ }; }
	const img = imgEl;

	const input = document.createElement('input');
	input.type = 'file';
	input.accept = 'image/*';
	input.style.display = 'none';
	document.body.appendChild(input);

	function handleClick(): void {
		input.click();
	}

	function handleChange(): void {
		const file = input.files?.[0];
		input.value = '';
		if (!file) { return; }
		void processPortraitFile(file)
			.then((dataUrl) => {
				data.basics.portraitDataUrl = dataUrl;
				delete data.basics.portraitSha256;
				void savePortraitLocalCache(dataUrl);
				onChange(data);
				remount(data);
			})
			.catch((err: unknown) => {
				const msg = err instanceof Error ? err.message : String(err);
				window.alert(msg);
			});
	}

	img.style.cursor = 'pointer';
	img.title = 'Click to replace portrait';
	img.addEventListener('click', handleClick);
	input.addEventListener('change', handleChange);

	return () => {
		img.style.cursor = '';
		img.title = '';
		img.removeEventListener('click', handleClick);
		input.removeEventListener('change', handleChange);
		document.body.removeChild(input);
	};
}

// ─── Contenteditable activation ───────────────────────────────────────────────

function enableContentEditable(
	shell:   HTMLElement,
	data:    CVData,
	onEdit:  (updatedData: CVData) => void,
): () => void {
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleEngineRerun(): void {
		// Trigger the layout engine's resize listener to recompute heights
		if (saveTimer) { clearTimeout(saveTimer); }
		saveTimer = setTimeout(() => {
			window.dispatchEvent(new Event('resize'));
		}, 500);
	}

	const fields = shell.querySelectorAll<HTMLElement>('[data-cv-field]');

	function handleInput(e: Event): void {
		const el    = e.currentTarget as HTMLElement;
		const field = el.dataset.cvField;
		if (!field || field === 'portrait') { return; }

		// For highlight lis, pass the element itself for structured serialisation
		const isHighlight = field.includes('.highlights.');
		const text        = isHighlight ? '' : (el.textContent?.trim() ?? '');
		applyFieldEdit(field, text, isHighlight ? el : null, data);

		onEdit(data);
		scheduleEngineRerun();
	}

	function handleKeyDown(e: KeyboardEvent): void {
		// Prevent Enter from inserting <div> or <br> in contenteditable
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
		}
	}

	for (const el of Array.from(fields)) {
		if (el.dataset.cvField === 'portrait') { continue; }
		el.contentEditable = 'true';
		el.setAttribute('spellcheck', 'false');
		el.addEventListener('input',   handleInput);
		el.addEventListener('keydown', handleKeyDown);
	}

	return () => {
		for (const el of Array.from(fields)) {
			el.contentEditable = 'false';
			el.removeAttribute('spellcheck');
			el.removeEventListener('input',   handleInput);
			el.removeEventListener('keydown', handleKeyDown);
		}
		if (saveTimer) { clearTimeout(saveTimer); }
	};
}

// ─── Visibility helpers ───────────────────────────────────────────────────────

function ensureVisibility(data: CVData): Required<CVData>['visibility'] & {
	hiddenWork: number[];
	hiddenEducation: number[];
	hiddenSections: CVSectionId[];
	sidebarOrder: CVSidebarSectionId[];
	skillsOrder: CVSkillsCategoryId[];
} {
	if (!data.visibility) { data.visibility = {}; }
	if (!data.visibility.hiddenWork)      { data.visibility.hiddenWork      = []; }
	if (!data.visibility.hiddenEducation) { data.visibility.hiddenEducation = []; }
	if (!data.visibility.hiddenSections)  { data.visibility.hiddenSections  = []; }
	if (!data.visibility.sidebarOrder) {
		data.visibility.sidebarOrder = ['skills', 'languages', 'interests'];
	}
	if (!data.visibility.skillsOrder) {
		data.visibility.skillsOrder = ['programming', 'design_bim', 'strategic'];
	}
	return data.visibility as Required<typeof data.visibility>;
}

function cleanupVisibility(data: CVData): void {
	const v = data.visibility;
	if (!v) { return; }
	const hiddenWork = v.hiddenWork ?? [];
	const hiddenEducation = v.hiddenEducation ?? [];
	const hiddenSections = v.hiddenSections ?? [];
	const hasManualHides =
		hiddenWork.length > 0 ||
		hiddenEducation.length > 0 ||
		hiddenSections.length > 0;
	const sidebar = v.sidebarOrder ?? [];
	const skills = v.skillsOrder ?? [];
	const isDefaultSidebar =
		sidebar.length === 3 &&
		sidebar[0] === 'skills' &&
		sidebar[1] === 'languages' &&
		sidebar[2] === 'interests';
	const isDefaultSkills =
		skills.length === 3 &&
		skills[0] === 'programming' &&
		skills[1] === 'design_bim' &&
		skills[2] === 'strategic';
	if (!hasManualHides && isDefaultSidebar && isDefaultSkills) {
		delete data.visibility;
	}
}

function hideWork(data: CVData, idx: number): void {
	const v = ensureVisibility(data);
	if (!v.hiddenWork.includes(idx)) { v.hiddenWork.push(idx); }
}
function showWork(data: CVData, idx: number): void {
	const v = ensureVisibility(data);
	v.hiddenWork = v.hiddenWork.filter((i) => i !== idx);
	cleanupVisibility(data);
}
function hideSection(data: CVData, id: CVSectionId): void {
	const v = ensureVisibility(data);
	if (!v.hiddenSections.includes(id)) { v.hiddenSections.push(id); }
}
function showSection(data: CVData, id: CVSectionId): void {
	const v = ensureVisibility(data);
	v.hiddenSections = v.hiddenSections.filter((s) => s !== id);
	cleanupVisibility(data);
}

// ─── Side panel ───────────────────────────────────────────────────────────────

import { extractAllTags } from '@lib/cv-filter';

function h(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string | null | undefined)[]): HTMLElement {
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

// ─── Tag editing ──────────────────────────────────────────────────────────────

/**
 * Injects tag editing UI onto every work and education item in edit mode.
 * Each item gets a row of chips below its content: existing tags (clickable
 * to remove) and an "+ tag" input that offers autocomplete from existing tags.
 * Returns a cleanup function.
 */
function injectTagEditors(
	data:    CVData,
	onEdit:  (updatedData: CVData) => void,
): () => void {
	const injected: HTMLElement[] = [];
	const allTags = extractAllTags(data);

	function renderTagRow(
		currentTags: string[],
		onAddTag:    (tag: string) => void,
		onRemoveTag: (tag: string) => void,
	): HTMLElement {
		const row = document.createElement('div');
		row.className = 'cv-tag-row no-print';

		function rebuildChips(): void {
			// Clear existing chips (keep the input at the end)
			const input = row.querySelector('.cv-tag-input-wrap');
			row.innerHTML = '';

			for (const tag of currentTags) {
				const chip = document.createElement('span');
				chip.className   = 'cv-tag-chip cv-tag-chip--edit';
				chip.textContent = tag;

				const removeBtn = document.createElement('button');
				removeBtn.type      = 'button';
				removeBtn.className = 'cv-tag-chip__remove';
				removeBtn.textContent = '×';
				removeBtn.setAttribute('aria-label', `Remove tag ${tag}`);
				removeBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					onRemoveTag(tag);
				});
				chip.appendChild(removeBtn);
				row.appendChild(chip);
			}

			if (input) { row.appendChild(input); }
		}

		// Build add-tag input
		const inputWrap    = document.createElement('div');
		inputWrap.className = 'cv-tag-input-wrap';

		const input        = document.createElement('input');
		input.type         = 'text';
		input.className    = 'cv-tag-input';
		input.placeholder  = '+ tag';
		input.setAttribute('list', 'cv-tag-datalist');
		input.setAttribute('autocomplete', 'off');
		input.setAttribute('spellcheck', 'false');
		input.setAttribute('aria-label', 'Add a tag');

		// Build datalist with existing tags for autocomplete
		let datalist = document.getElementById('cv-tag-datalist');
		if (!datalist) {
			datalist = document.createElement('datalist');
			datalist.id = 'cv-tag-datalist';
			document.body.appendChild(datalist);
		}
		datalist.innerHTML = '';
		for (const t of allTags) {
			const opt = document.createElement('option');
			opt.value = t;
			datalist.appendChild(opt);
		}

		function commitInput(): void {
			const val = input.value.trim().toLowerCase();
			if (val && !currentTags.includes(val)) {
				input.value = '';
				onAddTag(val);
			} else {
				input.value = '';
			}
		}

		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); commitInput(); }
			if (e.key === 'Escape') { input.value = ''; input.blur(); }
		});
		input.addEventListener('change', () => commitInput()); // datalist selection

		inputWrap.appendChild(input);
		row.appendChild(inputWrap);

		rebuildChips();
		return row;
	}

	// ── Work items ───────────────────────────────────────────────────────────

	document.querySelectorAll<HTMLElement>('[data-work-idx]').forEach((el) => {
		const idx  = parseInt(el.dataset.workIdx ?? '-1', 10);
		const item = data.work[idx];
		if (!item) { return; }

		const row = renderTagRow(
			item.tags ?? [],
			(tag) => {
				if (!item.tags) { item.tags = []; }
				item.tags.push(tag);
				onEdit(data);
				// Refresh the chip row
				const existingRow = el.querySelector('.cv-tag-row');
				if (existingRow) {
					const newRow = renderTagRow(
						item.tags,
						row.parentElement ? () => {} : () => {}, // rebuilt on next call
						() => {},
					);
					existingRow.replaceWith(newRow);
				}
			},
			(tag) => {
				item.tags = (item.tags ?? []).filter((t) => t !== tag);
				onEdit(data);
			},
		);
		el.appendChild(row);
		injected.push(row);
	});

	// ── Education items ──────────────────────────────────────────────────────

	document.querySelectorAll<HTMLElement>('.education-block').forEach((el) => {
		// Find the index from the data-cv-field of a child
		const fieldEl = el.querySelector<HTMLElement>('[data-cv-field^="education."]');
		if (!fieldEl) { return; }
		const match = fieldEl.dataset.cvField?.match(/^education\.(\d+)\./);
		if (!match) { return; }
		const idx  = parseInt(match[1], 10);
		const item = data.education[idx];
		if (!item) { return; }

		const row = renderTagRow(
			item.tags ?? [],
			(tag) => {
				if (!item.tags) { item.tags = []; }
				item.tags.push(tag);
				onEdit(data);
			},
			(tag) => {
				item.tags = (item.tags ?? []).filter((t) => t !== tag);
				onEdit(data);
			},
		);
		el.appendChild(row);
		injected.push(row);
	});

	return () => {
		for (const row of injected) { row.remove(); }
		injected.length = 0;
		document.getElementById('cv-tag-datalist')?.remove();
	};
}

type VisibilityToggleAction =
	| { type: 'hide-work';     idx: number }
	| { type: 'show-work';     idx: number }
	| { type: 'hide-section';  id: CVSectionId }
	| { type: 'show-section';  id: CVSectionId };

/**
 * Builds the hidden-items side panel.
 * Renders tiles for every currently-hidden item; clicking "Restore" calls onAction.
 */
function buildSidePanel(
	data:     CVData,
	onAction: (action: VisibilityToggleAction) => void,
): HTMLElement {
	const vis         = data.visibility ?? {};
	const hiddenWork  = vis.hiddenWork      ?? [];
	const hiddenSects = vis.hiddenSections  ?? [];

	const panel = h('div', {
		id: 'cv-edit-panel',
		class: `cv-edit-panel cv-side-panel ${DOCKED_SIDE_PANEL_CLASS} no-print`,
	});

	// Header
	panel.appendChild(h('div', { class: 'cv-edit-panel__header' },
		h('span', { class: 'cv-edit-panel__title' }, 'Hidden content'),
		h('span', { class: 'cv-edit-panel__hint' }, 'Click ↩ to restore'),
	));

	const list = h('div', { class: 'cv-edit-panel__list' });

	// Hidden work items
	for (const idx of hiddenWork) {
		const entry = data.work[idx];
		if (!entry) { continue; }
		const tile = h('div', { class: 'cv-edit-panel__tile', 'data-panel-type': 'work' },
			h('span', { class: 'cv-edit-panel__tile-badge' }, 'Work'),
			h('span', { class: 'cv-edit-panel__tile-label' }, entry.company),
			h('span', { class: 'cv-edit-panel__tile-sub' }, entry.position),
		);
		const restoreBtn = h('button', {
			class: 'cv-edit-panel__restore',
			type:  'button',
			title: 'Restore to CV',
		}, '↩');
		restoreBtn.addEventListener('click', () => onAction({ type: 'show-work', idx }));
		tile.appendChild(restoreBtn);
		list.appendChild(tile);
	}

	// Hidden sections
	const sectionLabels: Record<CVSectionId, string> = {
		skills:    'Technical Skills',
		languages: 'Languages',
		interests: 'Interests',
		profile:   'Profile',
	};
	for (const id of hiddenSects) {
		const tile = h('div', { class: 'cv-edit-panel__tile', 'data-panel-type': 'section' },
			h('span', { class: 'cv-edit-panel__tile-badge' }, 'Section'),
			h('span', { class: 'cv-edit-panel__tile-label' }, sectionLabels[id] ?? id),
		);
		const restoreBtn = h('button', {
			class: 'cv-edit-panel__restore',
			type:  'button',
			title: 'Restore to CV',
		}, '↩');
		restoreBtn.addEventListener('click', () => onAction({ type: 'show-section', id }));
		tile.appendChild(restoreBtn);
		list.appendChild(tile);
	}

	if (list.children.length === 0) {
		list.appendChild(h('p', { class: 'cv-edit-panel__empty' },
			'All content visible. Click 👁 on any section or work item to hide it.',
		));
	}

	panel.appendChild(list);
	return panel;
}

// ─── Visibility toggle buttons (injected onto CV elements in edit mode) ───────

/**
 * Injects small eye-icon toggle buttons onto every hideable element in the CV.
 * These are absolutely-positioned over the element and have .no-print.
 * Returns a cleanup function that removes all injected buttons.
 */
function injectVisibilityToggles(
	data:     CVData,
	onAction: (action: VisibilityToggleAction) => void,
): () => void {
	const injected: HTMLElement[] = [];
	const vis         = data.visibility ?? {};
	const hiddenWork  = vis.hiddenWork  ?? [];

	function makeToggleBtn(
		label:   string,
		onClick: () => void,
	): HTMLElement {
		const btn   = document.createElement('button');
		btn.type    = 'button';
		btn.className = 'cv-vis-toggle no-print';
		btn.title   = label;
		btn.setAttribute('aria-label', label);
		btn.textContent = '👁';
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			onClick();
		});
		return btn;
	}

	function injectOnto(
		el:     HTMLElement,
		btn:    HTMLElement,
	): void {
		// Elements need position:relative so the absolute button lands correctly.
		// We only add it if not already set.
		const pos = getComputedStyle(el).position;
		if (pos === 'static') { el.style.position = 'relative'; }
		el.appendChild(btn);
		injected.push(btn);
	}

	// Work items — toggle per item
	document.querySelectorAll<HTMLElement>('[data-work-idx]').forEach((el) => {
		const idx = parseInt(el.dataset.workIdx ?? '-1', 10);
		if (idx < 0 || hiddenWork.includes(idx)) { return; }
		const btn = makeToggleBtn('Hide this work item', () => {
			onAction({ type: 'hide-work', idx });
		});
		injectOnto(el, btn);
	});

	// Named sections — one toggle per section div
	const sectionMap: Record<string, CVSectionId> = {
		'cv-rebalance-skills':    'skills',
		'cv-rebalance-languages': 'languages',
		'cv-rebalance-interests': 'interests',
		'cv-rebalance-profile':   'profile',
	};
	for (const [domId, sectionId] of Object.entries(sectionMap)) {
		const el = document.getElementById(domId);
		if (!el) { continue; }
		const hiddenSects = data.visibility?.hiddenSections ?? [];
		if (hiddenSects.includes(sectionId)) { continue; }
		const btn = makeToggleBtn(`Hide ${sectionId} section`, () => {
			onAction({ type: 'hide-section', id: sectionId });
		});
		injectOnto(el, btn);
	}

	return () => {
		for (const btn of injected) {
			// Restore position:relative if we added it
			const parent = btn.parentElement;
			if (parent?.style.position === 'relative') {
				parent.style.removeProperty('position');
			}
			btn.remove();
		}
		injected.length = 0;
	};
}

// ─── Reorder controls (up/down) ───────────────────────────────────────────────

function moveArrayItem<T>(arr: T[], from: number, to: number): void {
	if (from < 0 || to < 0 || from >= arr.length || to >= arr.length || from === to) {
		return;
	}
	const [item] = arr.splice(from, 1);
	arr.splice(to, 0, item);
}

function makeMoveButton(
	label: string,
	glyph: string,
	onClick: () => void,
): HTMLButtonElement {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'cv-move-btn no-print';
	btn.title = label;
	btn.setAttribute('aria-label', label);
	btn.textContent = glyph;
	btn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		onClick();
	});
	return btn;
}

function ensureRelativePosition(el: HTMLElement): void {
	if (getComputedStyle(el).position === 'static') {
		el.style.position = 'relative';
	}
}

function injectReorderControls(
	data: CVData,
	onMutate: () => void,
): () => void {
	const injected: HTMLElement[] = [];

	function injectPair(
		host: HTMLElement,
		baseClass: string,
		config: {
			canMoveUp: boolean;
			canMoveDown: boolean;
			onMoveUp: () => void;
			onMoveDown: () => void;
		},
	): void {
		ensureRelativePosition(host);
		const wrap = document.createElement('div');
		wrap.className = `cv-move-controls no-print ${baseClass}`;
		const up = makeMoveButton('Move up', '↑', config.onMoveUp);
		const down = makeMoveButton('Move down', '↓', config.onMoveDown);
		if (!config.canMoveUp) { up.disabled = true; }
		if (!config.canMoveDown) { down.disabled = true; }
		wrap.append(up, down);
		host.appendChild(wrap);
		injected.push(wrap);
	}

	document.querySelectorAll<HTMLElement>('[data-work-idx]').forEach((el) => {
		const idx = parseInt(el.dataset.workIdx ?? '-1', 10);
		if (idx < 0) { return; }
		injectPair(
			el,
			'cv-move-controls--work',
			{
				canMoveUp: idx > 0,
				canMoveDown: idx < data.work.length - 1,
				onMoveUp: () => { moveArrayItem(data.work, idx, idx - 1); onMutate(); },
				onMoveDown: () => { moveArrayItem(data.work, idx, idx + 1); onMutate(); },
			},
		);
	});

	document.querySelectorAll<HTMLElement>('li[data-cv-field]').forEach((el) => {
		const field = el.dataset.cvField ?? '';
		const m = field.match(/^work\.(\d+)\.highlights\.(\d+)$/);
		if (!m) { return; }
		const workIdx = parseInt(m[1], 10);
		const hiIdx = parseInt(m[2], 10);
		const highlights = data.work[workIdx]?.highlights;
		if (!highlights) { return; }
		injectPair(
			el,
			'cv-move-controls--inline',
			{
				canMoveUp: hiIdx > 0,
				canMoveDown: hiIdx < highlights.length - 1,
				onMoveUp: () => { moveArrayItem(highlights, hiIdx, hiIdx - 1); onMutate(); },
				onMoveDown: () => { moveArrayItem(highlights, hiIdx, hiIdx + 1); onMutate(); },
			},
		);
	});

	document.querySelectorAll<HTMLElement>('.skill-tag[data-cv-field]').forEach((el) => {
		const field = el.dataset.cvField ?? '';
		const m = field.match(/^skills\.(programming|design_bim|strategic)\.(\d+)$/);
		if (!m) { return; }
		const cat = m[1] as keyof CVData['skills'];
		const idx = parseInt(m[2], 10);
		const arr = data.skills[cat];
		injectPair(
			el,
			'cv-move-controls--inline',
			{
				canMoveUp: idx > 0,
				canMoveDown: idx < arr.length - 1,
				onMoveUp: () => { moveArrayItem(arr, idx, idx - 1); onMutate(); },
				onMoveDown: () => { moveArrayItem(arr, idx, idx + 1); onMutate(); },
			},
		);
	});

	const sidebarOrder = ensureVisibility(data).sidebarOrder;
	const sidebarOrderMap: CVSidebarSectionId[] = ['skills', 'languages', 'interests'];
	const visibleSidebar = sidebarOrder.filter((id) => {
		const section = document.querySelector<HTMLElement>(`[data-section-id="${id}"]`);
		return !!section && getComputedStyle(section).display !== 'none';
	});
	document.querySelectorAll<HTMLElement>('[data-section-id]').forEach((el) => {
		const id = el.dataset.sectionId as CVSidebarSectionId | undefined;
		if (!id || !sidebarOrderMap.includes(id)) { return; }
		const visiblePos = visibleSidebar.indexOf(id);
		const absolutePos = sidebarOrder.indexOf(id);
		if (absolutePos < 0 || visiblePos < 0) { return; }
		injectPair(
			el,
			'cv-move-controls--section',
			{
				canMoveUp: visiblePos > 0,
				canMoveDown: visiblePos < visibleSidebar.length - 1,
				onMoveUp: () => {
					const otherId = visibleSidebar[visiblePos - 1];
					const otherPos = sidebarOrder.indexOf(otherId);
					moveArrayItem(sidebarOrder, absolutePos, otherPos);
					onMutate();
				},
				onMoveDown: () => {
					const otherId = visibleSidebar[visiblePos + 1];
					const otherPos = sidebarOrder.indexOf(otherId);
					moveArrayItem(sidebarOrder, absolutePos, otherPos);
					onMutate();
				},
			},
		);
	});

	const skillsOrder = ensureVisibility(data).skillsOrder;
	const visibleSkillCats = skillsOrder.filter((id) =>
		Array.isArray(data.skills[id]) && data.skills[id].length > 0,
	);
	document.querySelectorAll<HTMLElement>('.skill-category[data-skill-category]').forEach((el) => {
		const id = el.dataset.skillCategory as CVSkillsCategoryId | undefined;
		if (!id) { return; }
		const pos = visibleSkillCats.indexOf(id);
		const absPos = skillsOrder.indexOf(id);
		if (pos < 0 || absPos < 0) { return; }
		injectPair(
			el,
			'cv-move-controls--section',
			{
				canMoveUp: pos > 0,
				canMoveDown: pos < visibleSkillCats.length - 1,
				onMoveUp: () => {
					const otherId = visibleSkillCats[pos - 1];
					const otherPos = skillsOrder.indexOf(otherId);
					moveArrayItem(skillsOrder, absPos, otherPos);
					onMutate();
				},
				onMoveDown: () => {
					const otherId = visibleSkillCats[pos + 1];
					const otherPos = skillsOrder.indexOf(otherId);
					moveArrayItem(skillsOrder, absPos, otherPos);
					onMutate();
				},
			},
		);
	});

	return () => {
		for (const el of injected) {
			const parent = el.parentElement;
			if (parent?.style.position === 'relative') {
				parent.style.removeProperty('position');
			}
			el.remove();
		}
		injected.length = 0;
	};
}

// ─── Main edit mode API ───────────────────────────────────────────────────────

export type EditModeInstance = {
	deactivate: () => void;
	exportJson: () => void;
	clearDraft: () => void;
	clearPortrait: () => void;
};

/**
 * Activates edit mode on the current CV shell.
 *
 * @param initialData  The CVData the CV was rendered with.
 * @param remount      Triggers a full re-render + engine run with new data.
 * @param onDataChange Called whenever data is modified.
 */
export function activateEditMode(
	initialData:  CVData,
	remount:      (data: CVData) => void,
	onDataChange: (data: CVData) => void,
): EditModeInstance {
	const shellEl = document.getElementById('cv-shell');
	if (!shellEl) { throw new Error('[cv-editor] #cv-shell not found'); }
	const shell = shellEl;

	// Working copy — mutated by edits
	const workingData = deepClone(initialData);

	shell.setAttribute(EDIT_ACTIVE_ATTR, 'true');
	document.documentElement.classList.add('cv-edit-mode');

	function handleDataChange(data: CVData): void {
		saveDraft(data);
		onDataChange(data);
	}

	// ── Side panel ────────────────────────────────────────────────────────────

	let currentPanel: HTMLElement | null = null;
	let cleanupToggles: (() => void) | null = null;
	let cleanupMoves: (() => void) | null = null;

	function refreshPanel(): void {
		// Remove old panel and toggles
		currentPanel?.remove();
		cleanupToggles?.();
		cleanupMoves?.();

		function handleAction(action: VisibilityToggleAction): void {
			layoutAuditLog('edit-action', {
				action: action.type,
				idx: 'idx' in action ? action.idx : null,
				id: 'id' in action ? action.id : null,
				beforeHash: hashCvForAudit(workingData),
			});
			switch (action.type) {
				case 'hide-work':    hideWork(workingData, action.idx);    break;
				case 'show-work':    showWork(workingData, action.idx);    break;
				case 'hide-section': hideSection(workingData, action.id);  break;
				case 'show-section': showSection(workingData, action.id);  break;
			}
			handleDataChange(workingData);
			// Remount re-renders the CV with updated visibility
			remount(workingData);
			layoutAuditLog('edit-action:remount', {
				action: action.type,
				afterHash: hashCvForAudit(workingData),
			});
			// Panel and toggles will be refreshed on the next activateEditMode call
			// (since remount replaces the shell). The editor button in ui-components
			// re-activates edit mode after remount, which calls refreshPanel() again.
		}

		currentPanel   = buildSidePanel(workingData, handleAction);
		cleanupToggles = injectVisibilityToggles(workingData, handleAction);
		cleanupMoves = injectReorderControls(workingData, () => {
			layoutAuditLog('edit-reorder', {
				beforeHash: hashCvForAudit(workingData),
			});
			handleDataChange(workingData);
			remount(workingData);
			layoutAuditLog('edit-reorder:remount', {
				afterHash: hashCvForAudit(workingData),
			});
		});
		document.body.appendChild(currentPanel);
	}

	refreshPanel();

	// ── Contenteditable + drag ────────────────────────────────────────────────

	const cleanupCE      = enableContentEditable(shell, workingData, handleDataChange);
	const cleanupTags    = injectTagEditors(workingData, handleDataChange);
	const cleanupDrag    = enableWorkItemDrag(shell, workingData, (newData) => {
		Object.assign(workingData, newData);
		handleDataChange(workingData);
		remount(workingData);
	});
	const cleanupPortrait = enablePortraitReplacement(
		workingData,
		handleDataChange,
		remount,
	);

	// ── Deactivate ────────────────────────────────────────────────────────────

	function deactivate(): void {
		cleanupCE();
		cleanupTags();
		cleanupDrag();
		cleanupPortrait();
		cleanupToggles?.();
		cleanupMoves?.();
		currentPanel?.remove();
		shell.removeAttribute(EDIT_ACTIVE_ATTR);
		document.documentElement.classList.remove('cv-edit-mode');
	}

	return {
		deactivate,
		exportJson:    () => exportAsJson(workingData),
		clearDraft:    () => { clearDraft(); },
		clearPortrait: () => {
			delete workingData.basics.portraitDataUrl;
			delete workingData.basics.portraitSha256;
			clearLegacyPortraitStorage();
			void clearPortraitLocalCache();
			handleDataChange(workingData);
			remount(workingData);
		},
	};
}

