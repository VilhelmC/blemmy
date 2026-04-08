import { describe, expect, it } from 'vitest';
import { validateCvData } from '@lib/profile-data-loader';
import { computeLeafDiffBetweenDocuments } from '@lib/blemmy-document-edit-history';
import { buildDocumentFromLeafSelection, countAcceptedChanges } from '@lib/assistant-pending-merge';

describe('buildDocumentFromLeafSelection', () => {
	it('applies accepted leaf values and leaves rejected paths from base', () => {
		const base = validateCvData({
			meta: { lastUpdated: 'a', version: '1', language: 'en' },
			basics: { name: 'Old', label: 'L', email: '', phone: '', location: '', nationality: '', born: '', summary: 'S' },
			education: [],
			work: [],
			skills: {},
			languages: [],
			personal: { interests: '' },
		});
		const next = validateCvData({
			...base,
			basics: { ...base.basics, name: 'New', label: 'L2' },
		});
		const diff = computeLeafDiffBetweenDocuments(base, next);
		const rejected = new Set<string>(['basics.name']);
		const merged = buildDocumentFromLeafSelection('cv', base, diff, rejected);
		expect(merged.basics.name).toBe('Old');
		expect(merged.basics.label).toBe('L2');
	});

	it('countAcceptedChanges excludes rejected paths', () => {
		const diff = [
			{
				path: 'a',
				beforeValue: 1,
				afterValue: 2,
				before: '1',
				after: '2',
				state: 'applied' as const,
			},
			{
				path: 'b',
				beforeValue: 1,
				afterValue: 3,
				before: '1',
				after: '3',
				state: 'applied' as const,
			},
		];
		expect(countAcceptedChanges(diff, new Set(['a']))).toBe(1);
	});
});
