import { describe, expect, it } from 'vitest';
import { resolveAppModeFromLocation } from '@lib/app-mode';

describe('app-mode resolver', () => {
	it('resolves normal mode', () => {
		const resolved = resolveAppModeFromLocation({
			pathname: '/',
			search: '',
		});
		expect(resolved.mode).toBe('normal');
		expect(resolved.isEmbedLike).toBe(false);
	});

	it('resolves share readonly mode from path', () => {
		const resolved = resolveAppModeFromLocation({
			pathname: '/share/abc123',
			search: '',
		});
		expect(resolved.mode).toBe('shareReadonly');
		expect(resolved.shareToken).toBe('abc123');
	});

	it('resolves published embed mode from path', () => {
		const resolved = resolveAppModeFromLocation({
			pathname: '/embed/public-1',
			search: '',
		});
		expect(resolved.mode).toBe('publishedEmbed');
		expect(resolved.embedToken).toBe('public-1');
		expect(resolved.isEmbedLike).toBe(true);
	});

	it('resolves portfolio embed mode from query', () => {
		const resolved = resolveAppModeFromLocation({
			pathname: '/',
			search: '?cv-portfolio=1',
		});
		expect(resolved.mode).toBe('portfolioEmbed');
		expect(resolved.isEmbedLike).toBe(true);
	});

	it('resolves pdf embed mode from query', () => {
		const resolved = resolveAppModeFromLocation({
			pathname: '/',
			search: '?cv-embed=1',
		});
		expect(resolved.mode).toBe('pdfEmbed');
		expect(resolved.isEmbedLike).toBe(true);
	});
});
