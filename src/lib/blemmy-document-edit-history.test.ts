import { describe, it, expect, beforeEach } from 'vitest';
import {
	clearDocumentEditHistory,
	cloneDocumentData,
	documentHistoryFuture,
	documentHistoryPast,
	recordDocumentApplyHistory,
	undoDocumentEditHistory,
	redoDocumentEditHistory,
	sanitizeLoadedDocumentChanges,
	setDocumentDataAtPath,
	type LeafChange,
} from './blemmy-document-edit-history';

beforeEach(() => {
	clearDocumentEditHistory();
});

describe('blemmy-document-edit-history', () => {
	it('clones by value', () => {
		const src = { meta: { n: 1 }, basics: { name: 'x' } };
		const c = cloneDocumentData(src);
		expect(c).toEqual(src);
		c.basics.name = 'y';
		expect(src.basics.name).toBe('x');
	});

	it('does not push past when there is no prior current', () => {
		const doc = { basics: { name: 'only' } };
		recordDocumentApplyHistory(undefined, doc, true);
		expect(documentHistoryPast.length).toBe(0);
	});

	it('record then undo restores prior snapshot', () => {
		const a = { basics: { name: 'A' }, extra: 1 };
		const b = { basics: { name: 'B' }, extra: 1 };
		recordDocumentApplyHistory(a, b, true);
		expect(documentHistoryPast.length).toBe(1);
		expect(undoDocumentEditHistory(b)).toEqual(a);
		expect(documentHistoryPast.length).toBe(0);
	});

	it('redo reapplies after undo', () => {
		const a = { basics: { name: 'A' } };
		const b = { basics: { name: 'B' } };
		recordDocumentApplyHistory(a, b, true);
		undoDocumentEditHistory(b);
		expect(redoDocumentEditHistory(a)).toEqual(b);
		expect(documentHistoryFuture.length).toBe(0);
	});

	it('clears redo stack on new branch', () => {
		recordDocumentApplyHistory({ v: 1 }, { v: 2 }, true);
		undoDocumentEditHistory({ v: 2 });
		expect(documentHistoryFuture.length).toBe(1);
		recordDocumentApplyHistory({ v: 2 }, { v: 3 }, true);
		expect(documentHistoryFuture.length).toBe(0);
	});

	it('setDocumentDataAtPath updates nested keys', () => {
		const root: Record<string, unknown> = {
			a: { b: { c: 1 } },
		};
		expect(setDocumentDataAtPath(root, 'a.b.c', 9)).toBe(true);
		expect((root.a as Record<string, unknown>).b).toEqual({ c: 9 });
	});

	it('sanitizeLoadedDocumentChanges drops stale markers', () => {
		const doc = { basics: { name: 'live' } };
		const changes: LeafChange[] = [{
			path: 'basics.name',
			beforeValue: 'old',
			afterValue: 'wrong',
			before: 'old',
			after: 'wrong',
			state: 'applied',
		}];
		expect(sanitizeLoadedDocumentChanges(doc, changes)).toHaveLength(0);
	});

	it('sanitizeLoadedDocumentChanges keeps matching markers', () => {
		const doc = { basics: { name: 'match' } };
		const changes: LeafChange[] = [{
			path: 'basics.name',
			beforeValue: 'before',
			afterValue: 'match',
			before: 'before',
			after: 'match',
			state: 'applied',
		}];
		expect(sanitizeLoadedDocumentChanges(doc, changes)).toHaveLength(1);
	});
});
