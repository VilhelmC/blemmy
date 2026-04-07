import { describe, expect, it } from 'vitest';

import { stripTrailingBlemmyEditGlyphs } from './blemmy-edit-chrome';

describe('stripTrailingBlemmyEditGlyphs', () => {
	it('removes leaked visibility + move glyphs after highlight text', () => {
		const raw =
			'Archive Research: Conducted extensive archival research ' +
			'and data gathering to support evidence-based architectural ' +
			'studies.👁↑↓';
		expect(stripTrailingBlemmyEditGlyphs(raw)).toBe(
			'Archive Research: Conducted extensive archival research ' +
				'and data gathering to support evidence-based architectural ' +
				'studies.',
		);
	});

	it('leaves interior arrows untouched', () => {
		expect(stripTrailingBlemmyEditGlyphs('A → B growth')).toBe('A → B growth');
	});

	it('strips spaced glyph runs', () => {
		expect(stripTrailingBlemmyEditGlyphs('Body 👁 ↑ ↓')).toBe('Body');
	});
});
