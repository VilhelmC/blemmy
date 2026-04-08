/**
 * blemmy-chat.ts
 *
 * Provider-agnostic LLM API client for the CV chatbot panel.
 * Supports Anthropic (claude-*) and Google Gemini (gemini-*).
 * Keys are stored in localStorage — no backend required.
 *
 * Usage:
 *   const cfg = loadChatConfig();
 *   for await (const chunk of streamCompletion(cfg, messages, systemPrompt)) {
 *     append(chunk);
 *   }
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChatProvider = 'anthropic' | 'gemini';

export type ChatConfig = {
	provider:  ChatProvider;
	apiKey:    string;
	/** Model identifier. Defaults to provider-appropriate default if absent. */
	model?:    string;
};

export type ChatMessage = {
	role:    'user' | 'assistant';
	content: string;
};

export type ChatError = {
	type:    'auth' | 'rate_limit' | 'network' | 'parse' | 'unknown';
	message: string;
	status?: number;
};

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_MODELS: Record<ChatProvider, string> = {
	anthropic: 'claude-sonnet-4-5',
	gemini:    'gemini-2.5-flash-lite',
};

export const PROVIDER_LABELS: Record<ChatProvider, string> = {
	anthropic: 'Anthropic (Claude)',
	gemini:    'Google (Gemini)',
};

type GeminiModelEntry = {
	name?: string;
	supportedGenerationMethods?: string[];
};

type GeminiApiVersion = 'v1beta' | 'v1';

function modelId(name: string): string {
	return name.startsWith('models/') ? name.slice(7) : name;
}

function parseGeminiVersion(id: string): [number, number] {
	const m = id.match(/gemini-(\d+)(?:\.(\d+))?/);
	if (!m) { return [0, 0]; }
	const major = Number(m[1] ?? '0') || 0;
	const minor = Number(m[2] ?? '0') || 0;
	return [major, minor];
}

function geminiTierScore(id: string): number {
	if (id.includes('flash-lite') || id.includes('lite')) { return 4; }
	if (id.includes('flash')) { return 3; }
	if (id.includes('pro')) { return 1; }
	return 0;
}

function isValidGeminiGenerationModel(m: GeminiModelEntry): boolean {
	const name = m.name ?? '';
	if (!name.includes('gemini-')) { return false; }
	if (name.includes('embedding') || name.includes('aqa')) { return false; }
	const methods = m.supportedGenerationMethods ?? [];
	return (
		methods.includes('generateContent') ||
		methods.includes('streamGenerateContent')
	);
}

/** Returns newest Gemini model id available for this key. */
export async function resolveBestGeminiModel(
	apiKey: string,
): Promise<string | null> {
	const k = normalizeApiKey(apiKey);
	if (!isPlausibleApiKey(k, 'gemini')) { return null; }
	const versions: GeminiApiVersion[] = ['v1beta', 'v1'];
	const list: GeminiModelEntry[] = [];
	for (const v of versions) {
		try {
			const url = `https://generativelanguage.googleapis.com/${v}/models?key=${encodeURIComponent(k)}`;
			const resp = await fetch(url);
			if (!resp.ok) { continue; }
			const data = await resp.json() as { models?: GeminiModelEntry[] };
			for (const m of (data.models ?? [])) {
				if (isValidGeminiGenerationModel(m)) {
					list.push(m);
				}
			}
		} catch { /* ignore */ }
	}
	if (list.length === 0) { return null; }

	list.sort((a, b) => {
		const aId = modelId(a.name ?? '');
		const bId = modelId(b.name ?? '');
		const aIsCustom = aId.includes('customtools') ? 1 : 0;
		const bIsCustom = bId.includes('customtools') ? 1 : 0;
		if (aIsCustom !== bIsCustom) { return aIsCustom - bIsCustom; }
		const aIsPro = aId.includes('pro') ? 1 : 0;
		const bIsPro = bId.includes('pro') ? 1 : 0;
		if (aIsPro !== bIsPro) { return aIsPro - bIsPro; }
		// Prefer flash-lite / flash before comparing major version (free tier).
		const tier = geminiTierScore(bId) - geminiTierScore(aId);
		if (tier !== 0) { return tier; }
		const [aMaj, aMin] = parseGeminiVersion(aId);
		const [bMaj, bMin] = parseGeminiVersion(bId);
		if (aMaj !== bMaj) { return bMaj - aMaj; }
		if (aMin !== bMin) { return bMin - aMin; }
		return bId.localeCompare(aId);
	});

	return modelId(list[0]?.name ?? '');
}

// ─── API key hygiene (blocks autofill garbage + accidental UI pastes) ──────────

/** Collapse whitespace; strip zero-width chars from sloppy copy/paste. */
export function normalizeApiKey(raw: string): string {
	return raw
		.trim()
		.replace(/[\u200B-\u200D\uFEFF]/g, '')
		.replace(/\s+/g, '');
}

/**
 * Rejects obvious non-keys (success toasts, sentences, multi-line notes).
 * Does not contact the network.
 */
export function isPlausibleApiKey(key: string, provider: ChatProvider): boolean {
	const k = normalizeApiKey(key);
	if (k.length < 24 || k.length > 200) { return false; }
	if (/✓/.test(key) || /[\r\n]/.test(key)) { return false; }
	if (/connected to google|start chatting|invalid api key|not valid/i.test(k)) {
		return false;
	}
	if (provider === 'gemini') {
		if (!k.startsWith('AIza')) { return false; }
		const rest = k.slice(4);
		return rest.length >= 28 && /^[0-9A-Za-z_-]+$/.test(rest);
	}
	if (provider === 'anthropic') {
		if (!k.startsWith('sk-ant-')) { return false; }
		const rest = k.slice(7);
		return rest.length >= 16 && /^[0-9A-Za-z_-]+$/.test(rest);
	}
	return false;
}

/** Normalize + validate; returns null if the payload must not be saved or used. */
export function normalizeChatConfig(cfg: ChatConfig): ChatConfig | null {
	const apiKey = normalizeApiKey(cfg.apiKey);
	if (!isPlausibleApiKey(apiKey, cfg.provider)) { return null; }
	return { ...cfg, apiKey };
}

// ─── Key detection ────────────────────────────────────────────────────────────

/**
 * Infers the provider from an API key's prefix.
 * Returns null if the key format is not recognised.
 */
export function detectProvider(key: string): ChatProvider | null {
	const k = normalizeApiKey(key);
	if (k.startsWith('sk-ant-'))  { return 'anthropic'; }
	if (k.startsWith('AIza'))     { return 'gemini'; }
	return null;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'blemmy-chat-config';
const LEGACY_STORAGE_KEY = 'cv-chat-config';

export type SaveChatConfigResult = {
	ok:      boolean;
	local:   boolean;
	session: boolean;
};

/** Writes to localStorage and sessionStorage independently (best-effort both). */
export function saveChatConfig(cfg: ChatConfig): SaveChatConfigResult {
	const cleaned = normalizeChatConfig(cfg);
	if (!cleaned) {
		return { ok: false, local: false, session: false };
	}
	const payload = JSON.stringify(cleaned);
	let local   = false;
	let session = false;
	try {
		localStorage.setItem(STORAGE_KEY, payload);
		localStorage.removeItem(LEGACY_STORAGE_KEY);
		local = true;
	} catch { /* quota / blocked */ }
	try {
		sessionStorage.setItem(STORAGE_KEY, payload);
		sessionStorage.removeItem(LEGACY_STORAGE_KEY);
		session = true;
	} catch { /* blocked / private mode */ }
	return { ok: local || session, local, session };
}

export type LoadChatConfigMeta = {
	config: ChatConfig | null;
	/** Where a valid config was read from; null if absent or invalid. */
	source: 'local' | 'session' | null;
};

function parseStoredChat(raw: string | null): ChatConfig | null {
	if (!raw) { return null; }
	try {
		const obj = JSON.parse(raw) as Partial<ChatConfig>;
		if (!obj.provider || !obj.apiKey) { return null; }
		return {
			provider: obj.provider,
			apiKey:   obj.apiKey,
			model:    obj.model,
		};
	} catch { return null; }
}

export function loadChatConfigMeta(): LoadChatConfigMeta {
	try {
		const localPrimary = parseStoredChat(localStorage.getItem(STORAGE_KEY));
		const localLegacy = localPrimary
			? null
			: parseStoredChat(localStorage.getItem(LEGACY_STORAGE_KEY));
		const local = localPrimary ?? localLegacy;
		if (local) {
			const okL = normalizeChatConfig(local);
			if (okL) {
				// One-time migration from legacy key name.
				if (!localPrimary) {
					try {
						localStorage.setItem(STORAGE_KEY, JSON.stringify(okL));
						localStorage.removeItem(LEGACY_STORAGE_KEY);
					} catch { /* ignore */ }
				}
				return { config: okL, source: 'local' };
			}
			try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
			try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* ignore */ }
		}
	} catch { /* ignore */ }
	try {
		const sessPrimary = parseStoredChat(sessionStorage.getItem(STORAGE_KEY));
		const sessLegacy = sessPrimary
			? null
			: parseStoredChat(sessionStorage.getItem(LEGACY_STORAGE_KEY));
		const sess = sessPrimary ?? sessLegacy;
		if (sess) {
			const okS = normalizeChatConfig(sess);
			if (okS) {
				if (!sessPrimary) {
					try {
						sessionStorage.setItem(STORAGE_KEY, JSON.stringify(okS));
						sessionStorage.removeItem(LEGACY_STORAGE_KEY);
					} catch { /* ignore */ }
				}
				return { config: okS, source: 'session' };
			}
			try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
			try { sessionStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* ignore */ }
		}
	} catch { return { config: null, source: null }; }
	return { config: null, source: null };
}

export function loadChatConfig(): ChatConfig | null {
	return loadChatConfigMeta().config;
}

/** Last four chars of key for UI (never show full key). */
export function maskApiKeyHint(apiKey: string): string {
	const k = normalizeApiKey(apiKey);
	if (k.length < 4) { return '…' + k; }
	return '…' + k.slice(-4);
}

export function clearChatConfig(): void {
	try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
	try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ─── Error classification ──────────────────────────────────────────────────────

/** JSON error bodies from Gemini / Anthropic (and in-stream Gemini JSON lines). */
export function extractApiErrorDetail(body: string): string | null {
	const trimmed = body?.trim();
	if (!trimmed) { return null; }
	try {
		const obj = JSON.parse(trimmed) as Record<string, unknown>;
		const err = obj?.error as Record<string, unknown> | undefined;
		if (err && typeof err.message === 'string' && err.message.trim()) {
			return err.message.trim();
		}
		if (typeof obj.message === 'string' && obj.message.trim()) {
			return obj.message.trim();
		}
	} catch { /* ignore */ }
	return null;
}

function classifyError(status: number, body: string): ChatError {
	const detail = extractApiErrorDetail(body);
	const fallbackAuth =
		'Invalid API key or the Generative Language API is not enabled for this key. '
		+ 'Check Google AI Studio.';
	const fallback429 =
		'Google returned HTTP 429 (resource exhausted or quota). '
		+ 'Free tier limits are often per-minute/day — '
		+ 'open AI Studio → Usage, or wait a few minutes.';

	if (status === 401 || status === 403) {
		return {
			type:    'auth',
			message: detail ?? fallbackAuth,
			status,
		};
	}
	if (status === 429) {
		return {
			type:    'rate_limit',
			message: detail ?? fallback429,
			status,
		};
	}
	if (status >= 500) {
		return {
			type:    'network',
			message: detail ?? `Provider error (${status}). Try again shortly.`,
			status,
		};
	}
	if (detail) {
		return { type: 'unknown', message: detail, status };
	}
	return { type: 'unknown', message: `HTTP ${status}`, status };
}

function isChatError(e: unknown): e is ChatError {
	return (
		typeof e === 'object' &&
		e !== null &&
		'type' in e &&
		'message' in e &&
		typeof (e as ChatError).message === 'string'
	);
}

function looksLikeGeminiModelNotFound(status: number, body: string): boolean {
	if (status !== 404) { return false; }
	const detail = (extractApiErrorDetail(body) ?? body).toLowerCase();
	return (
		detail.includes('is not found for api version') ||
		detail.includes('not supported for generatecontent') ||
		detail.includes('not supported for streamgeneratecontent')
	);
}

// ─── Anthropic streaming ──────────────────────────────────────────────────────

async function* streamAnthropic(
	cfg:          ChatConfig,
	messages:     ChatMessage[],
	systemPrompt: string,
): AsyncGenerator<string, void, unknown> {
	const model = cfg.model ?? DEFAULT_MODELS.anthropic;

	const resp = await fetch('https://api.anthropic.com/v1/messages', {
		method:  'POST',
		headers: {
			'Content-Type':      'application/json',
			'x-api-key':         cfg.apiKey,
			'anthropic-version': '2023-06-01',
			'anthropic-beta':    'max-tokens-3-5-sonnet-2024-07-15',
		},
		body: JSON.stringify({
			model,
			max_tokens: 4096,
			stream:     true,
			system:     systemPrompt,
			messages:   messages.map((m) => ({ role: m.role, content: m.content })),
		}),
	});

	if (!resp.ok) {
		const body = await resp.text();
		throw classifyError(resp.status, body);
	}

	const reader = resp.body?.getReader();
	if (!reader) { throw { type: 'network', message: 'No response body' } as ChatError; }

	const decoder = new TextDecoder();
	let buf = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) { break; }
		buf += decoder.decode(value, { stream: true });

		const lines = buf.split('\n');
		buf = lines.pop() ?? '';

		for (const line of lines) {
			if (!line.startsWith('data: ')) { continue; }
			const data = line.slice(6).trim();
			if (data === '[DONE]') { return; }
			try {
				const evt = JSON.parse(data);
				if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
					yield evt.delta.text as string;
				}
			} catch { /* skip malformed line */ }
		}
	}
}

// ─── Gemini streaming ─────────────────────────────────────────────────────────

async function* streamGemini(
	cfg:          ChatConfig,
	messages:     ChatMessage[],
	systemPrompt: string,
): AsyncGenerator<string, void, unknown> {
	// Gemini separates system instruction from conversation turns
	const contents = messages.map((m) => ({
		role:  m.role === 'assistant' ? 'model' : 'user',
		parts: [{ text: m.content }],
	}));
	// Single model only. We may retry API VERSION for the same model id.
	const model   = cfg.model ?? DEFAULT_MODELS.gemini;
	const versions: GeminiApiVersion[] = ['v1beta', 'v1'];
	let resp: Response | null = null;
	let lastStatus = 0;
	let lastBody   = '';
	for (const v of versions) {
		const baseUrl = `https://generativelanguage.googleapis.com/${v}/models/${model}:streamGenerateContent`;
		const url     = `${baseUrl}?key=${encodeURIComponent(cfg.apiKey)}&alt=sse`;
		resp = await fetch(url, {
			method:  'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				systemInstruction: { parts: [{ text: systemPrompt }] },
				contents,
				generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
			}),
		});
		if (resp.ok) { break; }
		lastStatus = resp.status;
		lastBody   = await resp.text();
		// Only retry if this looks like API version/model-method mismatch.
		if (!looksLikeGeminiModelNotFound(lastStatus, lastBody)) {
			throw classifyError(lastStatus, lastBody);
		}
	}
	if (!resp || !resp.ok) {
		throw classifyError(lastStatus || 404, lastBody || 'Gemini model not found.');
	}

	const reader = resp.body?.getReader();
	if (!reader) { throw { type: 'network', message: 'No response body' } as ChatError; }

	const decoder = new TextDecoder();
	let buf = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) { break; }
		buf += decoder.decode(value, { stream: true });

		const lines = buf.split('\n');
		buf = lines.pop() ?? '';

		for (const line of lines) {
			if (!line.startsWith('data: ')) { continue; }
			const data = line.slice(6).trim();
			if (!data) { continue; }
			try {
				const evt = JSON.parse(data) as {
					error?:       { code?: number; message?: string };
					candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
				};
				if (evt.error) {
					const code =
						typeof evt.error.code === 'number' && !Number.isNaN(evt.error.code)
							? evt.error.code
							: 503;
					throw classifyError(code, JSON.stringify(evt));
				}
				const part = evt.candidates?.[0]?.content?.parts?.[0]?.text;
				if (typeof part === 'string') { yield part; }
			} catch (err: unknown) {
				if (isChatError(err)) { throw err; }
			}
		}
	}
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Streams a chat completion from the configured provider.
 * Yields text chunks as they arrive from the API.
 * Throws a ChatError on API failure.
 */
export async function* streamCompletion(
	cfg:          ChatConfig,
	messages:     ChatMessage[],
	systemPrompt: string,
): AsyncGenerator<string, void, unknown> {
	const usable = normalizeChatConfig(cfg);
	if (!usable) {
		throw {
			type:    'auth',
			message:
				'The saved API key looks wrong (e.g. autofill pasted app text). ' +
				'Use Change key and paste only the key.',
		} as ChatError;
	}
	cfg.apiKey = usable.apiKey;
	if (cfg.provider === 'anthropic') {
		yield* streamAnthropic(cfg, messages, systemPrompt);
	} else {
		yield* streamGemini(cfg, messages, systemPrompt);
	}
}

// ─── JSON extraction ──────────────────────────────────────────────────────────

/**
 * Extracts the first fenced ```json block from a model response.
 * Returns null if no valid JSON block is found.
 * Used to detect when the model is returning a modified CV.
 */
export function extractJsonBlock(text: string): string | null {
	const match = text.match(/```json\s*([\s\S]*?)```/);
	if (!match) { return null; }
	return match[1].trim();
}

/**
 * Extracts the first fenced ```style block from a model response.
 * Returns the raw JSON string inside the block, or null if not found.
 * Used to detect when the model is returning a DocumentStyle patch.
 *
 * The style block is a JSON object with Partial<DocumentStyle> fields.
 * Example model output:
 *   ```style
 *   { "sidebarColor": "#2C3E50", "headingFont": "playfair-display" }
 *   ```
 */
export function extractStyleBlock(text: string): string | null {
	const match = text.match(/```style\s*([\s\S]*?)```/);
	if (!match) { return null; }
	return match[1].trim();
}

/**
 * Extracts the first fenced ```review block from a model response.
 * Returns the raw JSON string (a CommentOperation[]) or null.
 */
export function extractReviewBlock(text: string): string | null {
	const match = text.match(/```review\s*([\s\S]*?)```/);
	if (!match) { return null; }
	return match[1].trim();
}