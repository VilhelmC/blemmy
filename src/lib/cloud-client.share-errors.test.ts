import { describe, expect, it } from 'vitest';
import { normalizeShareResolveError } from '@lib/cloud-client';

describe('normalizeShareResolveError', () => {
	it('maps expired errors', () => {
		const result = normalizeShareResolveError({
			message: 'share expired',
		});
		expect(result.message).toBe('This share link has expired.');
	});

	it('maps revoked errors', () => {
		const result = normalizeShareResolveError({
			message: 'share revoked',
		});
		expect(result.message).toBe('This share link has been revoked.');
	});

	it('maps invalid and not found errors', () => {
		const invalid = normalizeShareResolveError({
			message: 'invalid share token',
		});
		expect(invalid.message).toBe('This share link is invalid.');

		const notFound = normalizeShareResolveError({
			message: 'shared cv not found',
		});
		expect(notFound.message).toBe('This share link is invalid.');
	});

	it('maps unknown errors to unavailable fallback', () => {
		const result = normalizeShareResolveError({
			message: 'unexpected error',
		});
		expect(result.message).toBe(
			'This share link is unavailable right now.',
		);
	});
});
