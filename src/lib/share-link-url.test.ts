import { describe, expect, it } from 'vitest';
import {
	canonicalSharePath,
	shareTokenFromLocationParts,
	shareTokenFromPathname,
} from '@lib/share-link-url';

describe('share-link-url helpers', () => {
	it('extracts token from share pathname', () => {
		expect(shareTokenFromPathname('/share/abc123')).toBe('abc123');
	});

	it('extracts token from share pathname with base url', () => {
		expect(
			shareTokenFromPathname('/cv/share/abc123', '/cv/'),
		).toBe('abc123');
	});

	it('extracts token from legacy query fallback', () => {
		expect(
			shareTokenFromLocationParts('/', '?cv-share=legacy-token'),
		).toBe('legacy-token');
		expect(
			shareTokenFromLocationParts('/', '?share=legacy-token'),
		).toBe('legacy-token');
	});

	it('prefers pathname token over query token', () => {
		expect(
			shareTokenFromLocationParts('/share/path-token', '?cv-share=query-token'),
		).toBe('path-token');
	});

	it('builds canonical share path with base', () => {
		expect(canonicalSharePath('abc123')).toBe('/share/abc123');
		expect(canonicalSharePath('abc123', '/cv/')).toBe('/cv/share/abc123');
	});
});
