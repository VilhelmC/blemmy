import { describe, expect, it } from 'vitest';
import { validateCvData, CvValidationError } from '@lib/profile-data-loader';

const base = {
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
	education: [],
	work: [],
	languages: [],
	personal: { interests: '' },
};

describe('validateCvData skills (dynamic categories)', () => {
	it('preserves arbitrary category keys and values from JSON', () => {
		const cv = validateCvData({
			...base,
			skills: {
				technical: ['C'],
				design_visual: ['B'],
				strategic: ['A'],
			},
		});
		expect(cv.skills.technical).toEqual(['C']);
		expect(cv.skills.design_visual).toEqual(['B']);
		expect(cv.skills.strategic).toEqual(['A']);
	});

	it('defaults missing skills to an empty object', () => {
		const raw = { ...base } as Record<string, unknown>;
		delete raw.skills;
		const cv = validateCvData(raw);
		expect(cv.skills).toEqual({});
	});

	it('rejects invalid category keys', () => {
		expect(() =>
			validateCvData({
				...base,
				skills: { '9bad': [] },
			}),
		).toThrow(CvValidationError);
	});

	it('rejects non-string array values', () => {
		expect(() =>
			validateCvData({
				...base,
				skills: { ok: [1, 2] },
			} as unknown),
		).toThrow(CvValidationError);
	});
});
