/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { applyDocumentStyle } from '@lib/document-style';

describe('customFontCssUrl allowlist', () => {
	it('accepts fonts.googleapis.com', () => {
		const url =
			'https://fonts.googleapis.com/css2?family=Merriweather:wght@400&display=swap';
		const root = document.createElement('div');
		expect(() =>
			applyDocumentStyle(
				{ customFontCssUrl: url },
				{ tokenRoot: root },
			),
		).not.toThrow();
		const link = document.getElementById('blemmy-custom-font-css');
		expect(link).toBeTruthy();
		expect((link as HTMLLinkElement).href).toBe(url);
		link?.remove();
	});

	it('accepts fonts.bunny.net', () => {
		const url =
			'https://fonts.bunny.net/css?family=merriweather:400&display=swap';
		const root = document.createElement('div');
		expect(() =>
			applyDocumentStyle(
				{ customFontCssUrl: url },
				{ tokenRoot: root },
			),
		).not.toThrow();
		document.getElementById('blemmy-custom-font-css')?.remove();
	});

	it('rejects unknown font hosts', () => {
		const root = document.createElement('div');
		expect(() =>
			applyDocumentStyle(
				{
					customFontCssUrl:
						'https://evil.example.com/font.css',
				},
				{ tokenRoot: root },
			),
		).toThrow(/fonts\.googleapis\.com or fonts\.bunny\.net/);
	});
});
