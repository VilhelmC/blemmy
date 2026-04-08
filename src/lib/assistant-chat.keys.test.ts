import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
	DEFAULT_MODELS,
	extractApiErrorDetail,
	isPlausibleApiKey,
	normalizeApiKey,
	normalizeChatConfig,
	resolveBestGeminiModel,
} from '@lib/assistant-chat';

describe('extractApiErrorDetail', () => {
	it('reads Gemini-style nested error.message', () => {
		const body = JSON.stringify({
			error: {
				code:    429,
				message: 'Resource exhausted (quota for model X)',
				status:  'RESOURCE_EXHAUSTED',
			},
		});
		expect(extractApiErrorDetail(body)).toBe(
			'Resource exhausted (quota for model X)',
		);
	});
});

describe('normalizeApiKey', () => {
	it('strips zero-width and whitespace', () => {
		expect(normalizeApiKey(' \u200BAIza0123456789012345678901234567890\n')).toBe(
			'AIza0123456789012345678901234567890',
		);
	});
});

describe('isPlausibleApiKey', () => {
	const geminiLike = 'AIza' + '0'.repeat(35);

	it('accepts typical Gemini prefix and length', () => {
		expect(isPlausibleApiKey(geminiLike, 'gemini')).toBe(true);
	});

	it('rejects UI / toast garbage', () => {
		expect(isPlausibleApiKey(
			'✓ Connected to Google (Gemini) (m). You can start chatting.',
			'gemini',
		)).toBe(false);
	});

	it('rejects Anthropic-shaped keys for gemini', () => {
		expect(isPlausibleApiKey('sk-ant-api03-xxxxxxxxxxxxxxxx', 'gemini')).toBe(false);
	});

	it('accepts anthropic prefix', () => {
		const k = 'sk-ant-api03-' + 'a'.repeat(40);
		expect(isPlausibleApiKey(k, 'anthropic')).toBe(true);
	});
});

describe('normalizeChatConfig', () => {
	it('returns null when apiKey is garbage', () => {
		expect(normalizeChatConfig({
			provider: 'gemini',
			apiKey:   '✓ Connected to Google (Gemini). chatting.',
		})).toBe(null);
	});

	it('normalizes embedded whitespace', () => {
		const geminiLike = 'AIza' + 'x'.repeat(35);
		const c = normalizeChatConfig({
			provider: 'gemini',
			apiKey:   `  ${geminiLike}  `,
			model:    'gemini-2.0-flash',
		});
		expect(c?.apiKey).toBe(geminiLike);
	});
});

describe('resolveBestGeminiModel', () => {
	const geminiLike = 'AIza' + '0'.repeat(35);

	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('does not call the network with a bogus key', async () => {
		const fetchMock = fetch as ReturnType<typeof vi.fn>;
		expect(await resolveBestGeminiModel('not-a-key')).toBe(null);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('picks free-tier friendly id from ListModels', async () => {
		const fetchMock = fetch as ReturnType<typeof vi.fn>;
		fetchMock
			.mockResolvedValueOnce({
				ok: false,
			})
			.mockResolvedValueOnce({
			ok:   true,
			json: async () => ({
				models: [
					{
						name:                     'models/gemini-3.1-pro-preview',
						supportedGenerationMethods: ['generateContent'],
					},
					{
						name:                     'models/gemini-3-flash',
						supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
					},
					{
						name:                     'models/gemini-2.5-flash-lite',
						supportedGenerationMethods: ['streamGenerateContent'],
					},
				],
			}),
		});

		const id = await resolveBestGeminiModel(geminiLike);
		expect(id).toBe('gemini-2.5-flash-lite');
		const firstUrl  = fetchMock.mock.calls[0]?.[0] as string;
		const secondUrl = fetchMock.mock.calls[1]?.[0] as string;
		expect(firstUrl).toContain('/v1beta/models?key=');
		expect(secondUrl).toContain('/v1/models?key=');
		expect(secondUrl).toContain(`key=${encodeURIComponent(geminiLike)}`);
	});
});

describe('DEFAULT_MODELS', () => {
	it('uses flash-lite as Gemini default', () => {
		expect(DEFAULT_MODELS.gemini).toBe('gemini-2.5-flash-lite');
	});
});
