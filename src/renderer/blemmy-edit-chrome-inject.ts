/**
 * Edit-mode chrome injected from DOM attributes (no document-type branching).
 */

import type { CVVisibility } from '@cv/cv';
import {
	isIndexHidden,
	mergeHiddenBuckets,
	toggleHiddenListIndex,
} from '@lib/blemmy-hidden-indices';
import { DOCKED_SIDE_PANEL_CLASS } from '@renderer/docked-side-panels';

const ARRAY_PATH_ATTR  = 'data-blemmy-array-path';
const ARRAY_INDEX_ATTR = 'data-blemmy-array-index';
const ORDER_PATH_ATTR  = 'data-blemmy-order-path';
const ORDER_ID_ATTR    = 'data-blemmy-order-id';
const DRAG_GROUP_ATTR  = 'data-blemmy-drag-group';
const DRAG_IDX_ATTR    = 'data-blemmy-drag-idx';

function moveArrayItem<T>(arr: T[], from: number, to: number): void {
	if (from < 0 || to < 0 || from >= arr.length || to >= arr.length || from === to) {
		return;
	}
	const [item] = arr.splice(from, 1);
	arr.splice(to, 0, item);
}

function pathTokens(path: string): string[] {
	return path.split('.').filter(Boolean);
}

function getAtPath(obj: unknown, path: string): unknown {
	let cur: unknown = obj;
	for (const tok of pathTokens(path)) {
		if (cur == null || typeof cur !== 'object') {
			return undefined;
		}
		if (Array.isArray(cur)) {
			const idx = Number(tok);
			if (!Number.isInteger(idx)) {
				return undefined;
			}
			cur = cur[idx];
		} else {
			cur = (cur as Record<string, unknown>)[tok];
		}
	}
	return cur;
}

function getArrayAtSlashPath(root: unknown, slashPath: string): unknown[] | null {
	const segments = slashPath.split('/').filter(Boolean);
	if (segments.length === 0) {
		return null;
	}
	let cur: unknown = root;
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i] as string;
		if (cur == null || typeof cur !== 'object') {
			return null;
		}
		if (Array.isArray(cur)) {
			const idx = Number(seg);
			if (!Number.isInteger(idx)) {
				return null;
			}
			cur = cur[idx];
		} else {
			cur = (cur as Record<string, unknown>)[seg];
		}
	}
	return Array.isArray(cur) ? cur : null;
}

function ensureRelativePosition(el: HTMLElement): void {
	if (getComputedStyle(el).position === 'static') {
		el.style.position = 'relative';
	}
}

function makeMoveButton(label: string, glyph: string, onClick: () => void): HTMLButtonElement {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'blemmy-move-btn no-print';
	btn.title = label;
	btn.setAttribute('aria-label', label);
	btn.textContent = glyph;
	btn.setAttribute('contenteditable', 'false');
	btn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		onClick();
	});
	return btn;
}

function makeHideEyeButton(label: string, onHide: () => void): HTMLButtonElement {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'blemmy-vis-toggle blemmy-vis-toggle--inrow no-print';
	btn.title = label;
	btn.setAttribute('aria-label', label);
	btn.textContent = '\u{1F441}'; // eye
	btn.setAttribute('contenteditable', 'false');
	btn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		onHide();
	});
	return btn;
}

function injectPair(
	host: HTMLElement,
	baseClass: string,
	config: {
		canMoveUp: boolean;
		canMoveDown: boolean;
		onMoveUp: () => void;
		onMoveDown: () => void;
		hide?: { label: string; onHide: () => void };
	},
	injected: HTMLElement[],
): void {
	ensureRelativePosition(host);
	const wrap = document.createElement('div');
	wrap.className = `blemmy-move-controls no-print ${baseClass}`;
	wrap.setAttribute('contenteditable', 'false');
	if (config.hide) {
		wrap.appendChild(makeHideEyeButton(config.hide.label, config.hide.onHide));
	}
	const up = makeMoveButton('Move up', '\u2191', config.onMoveUp);
	const down = makeMoveButton('Move down', '\u2193', config.onMoveDown);
	if (!config.canMoveUp) {
		up.disabled = true;
	}
	if (!config.canMoveDown) {
		down.disabled = true;
	}
	wrap.append(up, down);
	host.appendChild(wrap);
	injected.push(wrap);
}

function visibilityFor(data: unknown): CVVisibility | undefined {
	const v = (data as Record<string, unknown>).visibility;
	return v as CVVisibility | undefined;
}

/**
 * Move / hide controls for [data-blemmy-array-path][data-blemmy-array-index].
 */
export function injectListItemChrome(
	data: unknown,
	onChange: (data: unknown) => void,
	remount: (data: unknown) => void,
): () => void {
	const injected: HTMLElement[] = [];
	const vis = visibilityFor(data);

	document.querySelectorAll<HTMLElement>(`[${ARRAY_PATH_ATTR}][${ARRAY_INDEX_ATTR}]`).forEach((host) => {
		const pathKey = host.getAttribute(ARRAY_PATH_ATTR);
		const idxRaw  = host.getAttribute(ARRAY_INDEX_ATTR);
		if (!pathKey || idxRaw == null) {
			return;
		}
		const idx = parseInt(idxRaw, 10);
		if (!Number.isInteger(idx) || idx < 0) {
			return;
		}
		const arr = getArrayAtSlashPath(data, pathKey);
		if (!arr) {
			return;
		}
		if (isIndexHidden(vis, pathKey, idx)) {
			return;
		}

		const isInline = host.tagName.toLowerCase() === 'li'
			|| host.classList.contains('skill-tag');
		const baseClass = isInline
			? 'blemmy-move-controls--inline'
			: 'blemmy-move-controls--work';

		injectPair(host, baseClass, {
			hide: {
				label: 'Hide this item',
				onHide: () => {
					toggleHiddenListIndex(data, pathKey, idx);
					onChange(data);
					remount(data);
				},
			},
			canMoveUp: idx > 0,
			canMoveDown: idx < arr.length - 1,
			onMoveUp: () => {
				moveArrayItem(arr, idx, idx - 1);
				onChange(data);
				remount(data);
			},
			onMoveDown: () => {
				moveArrayItem(arr, idx, idx + 1);
				onChange(data);
				remount(data);
			},
		}, injected);
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

/**
 * Reorder string arrays addressed by dot path (e.g. visibility.sidebarOrder).
 */
export function injectOrderListChrome(
	data: unknown,
	onChange: (data: unknown) => void,
	remount: (data: unknown) => void,
): () => void {
	const injected: HTMLElement[] = [];

	const byPath = new Map<string, HTMLElement[]>();
	document.querySelectorAll<HTMLElement>(`[${ORDER_PATH_ATTR}][${ORDER_ID_ATTR}]`).forEach((host) => {
		const path = host.getAttribute(ORDER_PATH_ATTR);
		const id   = host.getAttribute(ORDER_ID_ATTR);
		if (!path || !id) {
			return;
		}
		const list = byPath.get(path) ?? [];
		list.push(host);
		byPath.set(path, list);
	});

	for (const [path, hosts] of byPath) {
		const visible = hosts.filter(
			(h) => h.isConnected && getComputedStyle(h).display !== 'none',
		);
		for (let vi = 0; vi < visible.length; vi++) {
			const host = visible[vi];
			const orderId = host.getAttribute(ORDER_ID_ATTR);
			if (!orderId) {
				continue;
			}
			const list = getAtPath(data, path);
			if (!Array.isArray(list) || !list.every((x) => typeof x === 'string')) {
				continue;
			}
			const strList = list as string[];
			const absPos  = strList.indexOf(orderId);
			if (absPos < 0) {
				continue;
			}
			const sectionId = host.dataset.blemmySection;
			const allowSectionHide = Boolean(
				path.includes('sidebarOrder') && sectionId,
			);
			injectPair(host, 'blemmy-move-controls--section', {
				hide: allowSectionHide
					? {
						label: `Hide ${sectionId} section`,
						onHide: () => {
							const visObj = (data as Record<string, unknown>).visibility
								?? ((data as Record<string, unknown>).visibility = {});
							const v = visObj as Record<string, unknown>;
							const hs = (v.hiddenSections ?? []) as string[];
							if (!hs.includes(sectionId!)) {
								v.hiddenSections = [...hs, sectionId!];
							}
							onChange(data);
							remount(data);
						},
					}
					: undefined,
				canMoveUp: vi > 0,
				canMoveDown: vi < visible.length - 1,
				onMoveUp: () => {
					const other = visible[vi - 1].getAttribute(ORDER_ID_ATTR);
					if (!other) {
						return;
					}
					const otherPos = strList.indexOf(other);
					if (otherPos < 0) {
						return;
					}
					moveArrayItem(strList, absPos, otherPos);
					onChange(data);
					remount(data);
				},
				onMoveDown: () => {
					const other = visible[vi + 1].getAttribute(ORDER_ID_ATTR);
					if (!other) {
						return;
					}
					const otherPos = strList.indexOf(other);
					if (otherPos < 0) {
						return;
					}
					moveArrayItem(strList, absPos, otherPos);
					onChange(data);
					remount(data);
				},
			}, injected);
		}
	}

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

function hiddenPathLabel(data: unknown, pathKey: string, index: number): string {
	const o = data as Record<string, unknown>;
	if (pathKey === 'work' && Array.isArray(o.work)) {
		const w = (o.work as Record<string, unknown>[])[index];
		if (w) {
			return `${w.company ?? 'Work'} — ${w.position ?? ''}`.trim();
		}
	}
	if (pathKey === 'education' && Array.isArray(o.education)) {
		const e = (o.education as Record<string, unknown>[])[index];
		if (e) {
			return `${e.institution ?? 'Education'} — ${e.degree ?? ''}`.trim();
		}
	}
	if (pathKey === 'languages' && Array.isArray(o.languages)) {
		const lang = (o.languages as Record<string, unknown>[])[index];
		if (lang) {
			return `${lang.language ?? ''} (${lang.fluency ?? ''})`;
		}
	}
	if (pathKey.startsWith('skills/')) {
		const cat = decodeURIComponent(pathKey.slice('skills/'.length));
		const skills = o.skills as Record<string, unknown[]> | undefined;
		const label = skills?.[cat]?.[index];
		if (label) {
			return `${cat}: ${label}`;
		}
	}
	const m = pathKey.match(/^work\/(\d+)\/highlights$/);
	if (m && Array.isArray(o.work)) {
		const wi = Number(m[1]);
		const w = (o.work as Record<string, unknown>[])[wi];
		const h = (w?.highlights as string[] | undefined)?.[index];
		if (h) {
			const short = h.length > 72 ? `${h.slice(0, 72)}\u2026` : h;
			return `${w?.company ?? 'Work'} bullet: ${short}`;
		}
	}
	const em = pathKey.match(/^education\/(\d+)\/highlights$/);
	if (em && Array.isArray(o.education)) {
		const ei = Number(em[1]);
		const ed = (o.education as Record<string, unknown>[])[ei];
		const h = (ed?.highlights as string[] | undefined)?.[index];
		if (h) {
			const short = h.length > 72 ? `${h.slice(0, 72)}\u2026` : h;
			return `${ed?.institution ?? 'Edu'} bullet: ${short}`;
		}
	}
	return `${pathKey} #${index}`;
}

/**
 * Side panel listing hidden sections + hiddenIndices entries (structural labels).
 */
export function injectHiddenItemsPanel(
	data: unknown,
	onChange: (data: unknown) => void,
	remount: (data: unknown) => void,
): () => void {
	const existing = document.getElementById('blemmy-edit-panel');
	existing?.remove();

	const raw = data as Record<string, unknown>;
	const vis = raw.visibility as Record<string, unknown> | undefined;
	const merged = mergeHiddenBuckets(vis as CVVisibility);
	const hiddenSections = (vis?.hiddenSections ?? []) as string[];

	const panel = document.createElement('div');
	panel.id = 'blemmy-edit-panel';
	panel.className =
		`blemmy-edit-panel blemmy-side-panel ${DOCKED_SIDE_PANEL_CLASS} no-print`;

	const header = document.createElement('div');
	header.className = 'blemmy-edit-panel__header';
	const title = document.createElement('span');
	title.className = 'blemmy-edit-panel__title';
	title.textContent = 'Hidden content';
	const hint = document.createElement('span');
	hint.className = 'blemmy-edit-panel__hint';
	hint.textContent = 'Click \u21A9 to restore';
	header.append(title, hint);
	panel.appendChild(header);

	const list = document.createElement('div');
	list.className = 'blemmy-edit-panel__list';

	for (const [pathKey, indices] of Object.entries(merged)) {
		for (const idx of [...indices].sort((a, b) => a - b)) {
			const tile = document.createElement('div');
			tile.className = 'blemmy-edit-panel__tile';
			tile.appendChild(Object.assign(document.createElement('span'), {
				className: 'blemmy-edit-panel__tile-badge',
				textContent: 'Item',
			}));
			tile.appendChild(Object.assign(document.createElement('span'), {
				className: 'blemmy-edit-panel__tile-label',
				textContent: hiddenPathLabel(data, pathKey, idx),
			}));
			const restore = document.createElement('button');
			restore.type = 'button';
			restore.className = 'blemmy-edit-panel__restore';
			restore.textContent = '\u21A9';
			restore.title = 'Restore';
			restore.addEventListener('click', () => {
				toggleHiddenListIndex(data, pathKey, idx);
				onChange(data);
				remount(data);
			});
			tile.appendChild(restore);
			list.appendChild(tile);
		}
	}

	for (const id of hiddenSections) {
		const tile = document.createElement('div');
		tile.className = 'blemmy-edit-panel__tile';
		tile.appendChild(Object.assign(document.createElement('span'), {
			className: 'blemmy-edit-panel__tile-badge',
			textContent: 'Section',
		}));
		tile.appendChild(Object.assign(document.createElement('span'), {
			className: 'blemmy-edit-panel__tile-label',
			textContent: id,
		}));
		const restore = document.createElement('button');
		restore.type = 'button';
		restore.className = 'blemmy-edit-panel__restore';
		restore.textContent = '\u21A9';
		restore.addEventListener('click', () => {
			if (!raw.visibility || typeof raw.visibility !== 'object') {
				return;
			}
			const v = raw.visibility as Record<string, unknown>;
			const hs = (v.hiddenSections ?? []) as string[];
			v.hiddenSections = hs.filter((x) => x !== id);
			if ((v.hiddenSections as unknown[]).length === 0) {
				delete v.hiddenSections;
			}
			onChange(data);
			remount(data);
		});
		tile.appendChild(restore);
		list.appendChild(tile);
	}

	if (!list.firstChild) {
		const p = document.createElement('p');
		p.className = 'blemmy-edit-panel__empty';
		p.textContent =
			'All content visible. Use the eye in each control row to hide items.';
		list.appendChild(p);
	}

	panel.appendChild(list);
	document.body.appendChild(panel);

	return () => {
		panel.remove();
	};
}

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

function dragBlockKey(block: HTMLElement, group: string): string {
	const idx = block.dataset.blemmyDragIdx ?? '';
	if (group === 'work') {
		const company = block.querySelector<HTMLElement>('[data-blemmy-field$=".company"]')
			?.innerText.trim() ?? '';
		return `${group}|${company}|${idx}`;
	}
	if (group === 'education') {
		const inst = block.querySelector<HTMLElement>('[data-blemmy-field$=".institution"]')
			?.innerText.trim() ?? '';
		return `${group}|${inst}|${idx}`;
	}
	return `${group}|${idx}`;
}

function captureDragRects(shell: HTMLElement, group: string): Map<string, DOMRect> {
	const rects = new Map<string, DOMRect>();
	shell.querySelectorAll<HTMLElement>(`[${DRAG_GROUP_ATTR}="${group}"][${DRAG_IDX_ATTR}]`)
		.forEach((block) => {
			rects.set(dragBlockKey(block, group), block.getBoundingClientRect());
		});
	return rects;
}

function animateDragReorder(shell: HTMLElement, group: string, before: Map<string, DOMRect>): void {
	requestAnimationFrame(() => {
		shell.querySelectorAll<HTMLElement>(`[${DRAG_GROUP_ATTR}="${group}"][${DRAG_IDX_ATTR}]`)
			.forEach((block) => {
				const key  = dragBlockKey(block, group);
				const prev = before.get(key);
				if (!prev) {
					return;
				}
				const next = block.getBoundingClientRect();
				const dx = prev.left - next.left;
				const dy = prev.top - next.top;
				if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
					return;
				}
				block.animate(
					[
						{ transform: `translate(${dx}px, ${dy}px)`, opacity: 0.96 },
						{ transform: 'translate(0, 0)', opacity: 1 },
					],
					{
						duration: 180,
						easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
					},
				);
			});
	});
}

function getDragableArray(data: unknown, group: string): unknown[] | null {
	const cur = getAtPath(data, group);
	return Array.isArray(cur) ? cur : null;
}

function enableHandleDragReorderOneGroup(
	shell: HTMLElement,
	data: unknown,
	group: string,
	onChange: (data: unknown) => void,
	remount: (data: unknown) => void,
): () => void {
	let dragIdx: number | null = null;

	const marker = document.createElement('div');
	marker.id = `blemmy-drag-insert-marker-${group}`;
	marker.className = 'blemmy-work-insert-marker';
	marker.hidden = true;
	marker.setAttribute('aria-hidden', 'true');
	document.body.appendChild(marker);

	function hideInsertMarker(): void {
		marker.hidden = true;
	}

	function showInsertMarker(block: HTMLElement, before: boolean): void {
		const rect = block.getBoundingClientRect();
		const top = before ? rect.top : rect.bottom;
		marker.style.left   = `${Math.round(rect.left)}px`;
		marker.style.width  = `${Math.round(rect.width)}px`;
		marker.style.top    = `${Math.round(top)}px`;
		marker.hidden = false;
	}

	function getBlock(target: EventTarget | null): HTMLElement | null {
		if (!(target instanceof HTMLElement)) {
			return null;
		}
		return target.closest<HTMLElement>(
			`[${DRAG_GROUP_ATTR}="${group}"][${DRAG_IDX_ATTR}]`,
		);
	}

	function blockUnderPointer(e: DragEvent): HTMLElement | null {
		const raw = document.elementFromPoint(e.clientX, e.clientY);
		const fromPt = getBlock(raw);
		if (fromPt) {
			return fromPt;
		}
		return getBlock(e.target);
	}

	function handleDragStart(e: DragEvent): void {
		const block = getBlock(e.target);
		if (!block) {
			return;
		}
		dragIdx = parseInt(block.dataset.blemmyDragIdx ?? '-1', 10);
		block.classList.add('blemmy-drag-source');
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(dragIdx));
		}
	}

	function handleDragOver(e: DragEvent): void {
		e.preventDefault();
		if (dragIdx === null) {
			return;
		}
		const block = blockUnderPointer(e);
		if (!block) {
			hideInsertMarker();
			return;
		}
		const overIdx = parseInt(block.dataset.blemmyDragIdx ?? '-1', 10);
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
		if (rel && shell.contains(rel)) {
			return;
		}
		hideInsertMarker();
	}

	function handleDrop(e: DragEvent): void {
		e.preventDefault();
		hideInsertMarker();
		if (dragIdx === null) {
			return;
		}
		const block = blockUnderPointer(e);
		if (!block) {
			return;
		}
		const overIdx = parseInt(block.dataset.blemmyDragIdx ?? '-1', 10);
		if (overIdx < 0 || overIdx === dragIdx) {
			return;
		}
		const rect = block.getBoundingClientRect();
		const midY = rect.top + rect.height / 2;
		const before = e.clientY < midY;
		const insertAt = workReorderInsertAt(dragIdx, overIdx, before);
		const beforeRects = captureDragRects(shell, group);
		const arr = getDragableArray(data, group);
		if (!arr) {
			return;
		}
		const [moved] = arr.splice(dragIdx, 1);
		arr.splice(insertAt, 0, moved);
		onChange(data);
		remount(data);
		animateDragReorder(shell, group, beforeRects);
	}

	function handleDragEnd(e: DragEvent): void {
		const block = getBlock(e.target);
		block?.classList.remove('blemmy-drag-source');
		hideInsertMarker();
		dragIdx = null;
		shell.querySelectorAll<HTMLElement>(
			`[${DRAG_GROUP_ATTR}="${group}"][${DRAG_IDX_ATTR}]`,
		).forEach((el) => {
			el.draggable = false;
		});
		void e;
	}

	function activateDraggable(): void {
		shell.querySelectorAll<HTMLElement>(
			`[${DRAG_GROUP_ATTR}="${group}"][${DRAG_IDX_ATTR}]`,
		).forEach((el) => {
			el.draggable = false;
			if (el.querySelector('.blemmy-drag-handle')) {
				return;
			}
			const handle = document.createElement('button');
			handle.type = 'button';
			handle.className = 'blemmy-drag-handle no-print';
			handle.setAttribute('aria-label', 'Drag to reorder');
			handle.title = 'Drag to reorder';
			handle.textContent = '\u22EE\u22EE';
			el.appendChild(handle);
		});
	}
	activateDraggable();

	function handleMouseDown(e: MouseEvent): void {
		const block = getBlock(e.target);
		if (!block) {
			return;
		}
		const onHandle = (e.target as HTMLElement | null)?.closest('.blemmy-drag-handle');
		block.draggable = Boolean(onHandle);
	}

	function handleMouseUp(): void {
		shell.querySelectorAll<HTMLElement>(
			`[${DRAG_GROUP_ATTR}="${group}"][${DRAG_IDX_ATTR}]`,
		).forEach((el) => {
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

	const obs = new MutationObserver(() => { activateDraggable(); });
	obs.observe(shell, { subtree: true, childList: true });

	return () => {
		shell.querySelectorAll<HTMLElement>(
			`[${DRAG_GROUP_ATTR}="${group}"][${DRAG_IDX_ATTR}]`,
		).forEach((el) => {
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
		shell.querySelectorAll('.blemmy-drag-handle').forEach((el) => {
			el.remove();
		});
	};
}

/**
 * One handle-based drag interaction per distinct data-blemmy-drag-group value.
 */
export function enableHandleDragReorderForAllGroups(
	shell: HTMLElement,
	data: unknown,
	onChange: (data: unknown) => void,
	remount: (data: unknown) => void,
): () => void {
	const groups = new Set<string>();
	shell.querySelectorAll<HTMLElement>(`[${DRAG_GROUP_ATTR}]`).forEach((el) => {
		const g = el.getAttribute(DRAG_GROUP_ATTR);
		if (g) {
			groups.add(g);
		}
	});
	const cleanups: (() => void)[] = [];
	for (const group of groups) {
		cleanups.push(
			enableHandleDragReorderOneGroup(shell, data, group, onChange, remount),
		);
	}
	return () => {
		for (const fn of cleanups) {
			fn();
		}
	};
}
