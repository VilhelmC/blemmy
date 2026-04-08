import { describe, expect, it } from 'vitest';
import {
	canonicalEmbedPath,
	canonicalSharePath,
	embedTokenFromLocationParts,
	embedTokenFromPathname,
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
			shareTokenFromLocationParts('/', '?blemmy-share=legacy-token'),
		).toBe('legacy-token');
		expect(
			shareTokenFromLocationParts('/', '?share=legacy-token'),
		).toBe('legacy-token');
	});

	it('prefers pathname token over query token', () => {
		expect(
			shareTokenFromLocationParts('/share/path-token', '?blemmy-share=query-token'),
		).toBe('path-token');
	});

	it('builds canonical share path with base', () => {
		expect(canonicalSharePath('abc123')).toBe('/share/abc123');
		expect(canonicalSharePath('abc123', '/cv/')).toBe('/cv/share/abc123');
	});

	it('extracts embed token from embed pathname', () => {
		expect(embedTokenFromPathname('/embed/public-id')).toBe('public-id');
		expect(embedTokenFromPathname('/cv/embed/public-id', '/cv/')).toBe('public-id');
	});

	it('extracts embed token from query fallback', () => {
		expect(
			embedTokenFromLocationParts('/', '?blemmy-embed-share=abc'),
		).toBe('abc');
		expect(
			embedTokenFromLocationParts('/', '?embed=abc'),
		).toBe('abc');
	});

	it('builds canonical embed path with base', () => {
		expect(canonicalEmbedPath('abc123')).toBe('/embed/abc123');
		expect(canonicalEmbedPath('abc123', '/cv/')).toBe('/cv/embed/abc123');
	});
});
