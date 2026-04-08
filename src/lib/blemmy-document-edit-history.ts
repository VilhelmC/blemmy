/**
 * Document-agnostic edit history: JSON snapshots, structural leaf diffs, and
 * path helpers for revert. Works for any doctype whose payload is a JSON object.
 */

import type { StoredDocumentData } from '@lib/cloud-client';

const HISTORY_LIMIT = 50;

export type LeafChange = {
	path: string;
	beforeValue: unknown;
	afterValue: unknown;
	before: string;
	after: string;
	state: 'applied' | 'reverted';
};

export const documentHistoryPast: StoredDocumentData[] = [];
export const documentHistoryFuture: StoredDocumentData[] = [];

let lastLeafChanges: LeafChange[] = [];

export function getLastLeafChanges(): LeafChange[] {
	return lastLeafChanges;
}

export function setLastLeafChanges(next: LeafChange[]): void {
	lastLeafChanges = next;
}

export function cloneDocumentData<T>(data: T): T {
	return JSON.parse(JSON.stringify(data)) as T;
}

export function isLeafChange(raw: unknown): raw is LeafChange {
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

export function clearDocumentEditHistory(): void {
	documentHistoryPast.length = 0;
	documentHistoryFuture.length = 0;
	lastLeafChanges = [];
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

/** Leaf-level diff between two JSON documents (same rules as history). */
export function computeLeafDiffBetweenDocuments(
	before: unknown,
	after: unknown,
): LeafChange[] {
	if (before === after) {
		return [];
	}
	return collectLeafChanges(before, after, '');
}

export function recordDocumentApplyHistory(
	current: StoredDocumentData | undefined,
	next: StoredDocumentData,
	recordHistory: boolean,
): void {
	if (recordHistory && current) {
		documentHistoryPast.push(cloneDocumentData(current));
		if (documentHistoryPast.length > HISTORY_LIMIT) {
			documentHistoryPast.shift();
		}
		documentHistoryFuture.length = 0;
	}
	const computed = recordHistory && current
		? collectLeafChanges(current, next)
		: [];
	if (computed.length > 0 || lastLeafChanges.length === 0) {
		lastLeafChanges = computed;
	}
}

export function undoDocumentEditHistory(
	current: StoredDocumentData | undefined,
): StoredDocumentData | null {
	const prev = documentHistoryPast.pop();
	if (!prev) { return null; }
	if (current) {
		documentHistoryFuture.push(cloneDocumentData(current));
		if (documentHistoryFuture.length > HISTORY_LIMIT) {
			documentHistoryFuture.shift();
		}
	}
	lastLeafChanges = [];
	return cloneDocumentData(prev);
}

export function redoDocumentEditHistory(
	current: StoredDocumentData | undefined,
): StoredDocumentData | null {
	const next = documentHistoryFuture.pop();
	if (!next) { return null; }
	if (current) {
		documentHistoryPast.push(cloneDocumentData(current));
		if (documentHistoryPast.length > HISTORY_LIMIT) {
			documentHistoryPast.shift();
		}
	}
	lastLeafChanges = [];
	return cloneDocumentData(next);
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
		if (cur == null || typeof cur !== 'object') {
			return undefined;
		}
		if (Array.isArray(cur) && isIndexToken(t)) {
			const idx = Number(t);
			if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
				return undefined;
			}
			cur = cur[idx];
			continue;
		}
		const rec = cur as Record<string, unknown>;
		if (!(t in rec)) { return undefined; }
		cur = rec[t];
	}
	return cur;
}

export function sanitizeLoadedDocumentChanges(
	doc: StoredDocumentData,
	changes: LeafChange[],
): LeafChange[] {
	const root = doc as unknown as Record<string, unknown>;
	return changes.filter((c) => {
		if (deepEqualUnknown(c.beforeValue, c.afterValue)) { return false; }
		const currentValue = getAtPath(root, c.path);
		const expected = c.state === 'applied' ? c.afterValue : c.beforeValue;
		return deepEqualUnknown(currentValue, expected);
	});
}

export function setDocumentDataAtPath(
	obj: Record<string, unknown>,
	path: string,
	value: unknown,
): boolean {
	const toks = pathTokens(path);
	if (toks.length === 0) { return false; }
	let cur: unknown = obj;
	for (let i = 0; i < toks.length - 1; i++) {
		const t = toks[i] as string;
		if (cur == null || typeof cur !== 'object') { return false; }
		if (Array.isArray(cur) && isIndexToken(t)) {
			const idx = Number(t);
			if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
				return false;
			}
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
		if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
			return false;
		}
		cur[idx] = value;
	} else {
		(cur as Record<string, unknown>)[leaf] = value;
	}
	return true;
}
