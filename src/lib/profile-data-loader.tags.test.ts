import { describe, expect, it } from 'vitest';
import { extractAllTags } from '@lib/tag-filter';
import { validateCvData } from '@lib/profile-data-loader';

/** Minimal CV shape so validateCvData runs; focus is tag preservation. */
const minimalRoot = {
	meta: {
		lastUpdated: '2026-01-01',
		version: '1',
		language: 'en',
	},
	basics: {
		name: 'N',
		label: 'L',
		email: '',
		phone: '',
		location: '',
		nationality: '',
		born: '',
		summary: '',
	},
	skills: {},
	languages: [],
	personal: { interests: '' },
};

describe('validateCvData preserves tags', () => {
	it('keeps work and education tags for filter chips', () => {
		const raw = {
			...minimalRoot,
			education: [
				{
					institution: 'U',
					area: 'A',
					degree: 'D',
					startDate: '2020',
					endDate: '2021',
					highlights: [],
					tags: ['Academic', 'finance'],
				},
			],
			work: [
				{
					company: 'C',
					position: 'P',
					startDate: '2021',
					endDate: '2022',
					highlights: [],
					tags: ['research'],
				},
			],
		};
		const cv = validateCvData(raw);
		expect(cv.work[0]?.tags).toEqual(['research']);
		expect(cv.education[0]?.tags).toEqual(['Academic', 'finance']);
		expect(extractAllTags(cv).length).toBeGreaterThan(0);
	});
});
