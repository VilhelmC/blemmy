import { describe, expect, it } from 'vitest';
import { validateCvData, CvValidationError } from '@lib/cv-loader';

const tinyJpeg =
	'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
	'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIy' +
	'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAA' +
	'AAAAAAAAAAAAAAA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAABy//EABQQAQAAAAAAAAAAA' +
	'AAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAA' +
	'AAAAAA/9oACAECAQE/AX//xAAUEAQAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAA' +
	'AAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Qf//E' +
	'ABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Qf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8Qf' +
	'//Z';

const minimal = {
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
	skills: {},
	languages: [],
	personal: { interests: '' },
};

describe('validateCvData portraitDataUrl', () => {
	it('accepts optional JPEG data URL', () => {
		const cv = validateCvData({
			...minimal,
			basics: { ...minimal.basics, portraitDataUrl: tinyJpeg },
		});
		expect(cv.basics.portraitDataUrl).toBe(tinyJpeg);
	});

	it('rejects non-image data URLs', () => {
		expect(() =>
			validateCvData({
				...minimal,
				basics: {
					...minimal.basics,
					portraitDataUrl: 'data:text/plain;base64,QUJD',
				},
			}),
		).toThrow(CvValidationError);
	});

	it('accepts optional portraitSha256', () => {
		const sha =
			'0'.repeat(63) + '1';
		const cv = validateCvData({
			...minimal,
			basics: { ...minimal.basics, portraitSha256: sha },
		});
		expect(cv.basics.portraitSha256).toBe(sha);
	});
});
