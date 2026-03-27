/**
 * chat-panel.ts
 *
 * Builds and manages the CV chatbot side panel.
 *
 * States:
 *   setup     — no API key configured; shows provider picker and key input
 *   idle      — ready; shows starter suggestions and input
 *   streaming — model is responding; shows live text
 *   applying  — parsed JSON from model is being validated and mounted
 *   error     — API or validation error; shows message with retry option
 *
 * The panel calls remount(newData) when the model returns a valid JSON block.
 * The panel fires 'cv-chat-open' / 'cv-chat-close' events on window so
 * the rest of the UI can adjust layout (e.g. shift the shell leftward).
 */

import {
	streamCompletion,
	extractJsonBlock,
	extractStyleBlock,
	extractReviewBlock,
	loadChatConfigMeta,
	saveChatConfig,
	clearChatConfig,
	maskApiKeyHint,
	detectProvider,
	normalizeApiKey,
	normalizeChatConfig,
	isPlausibleApiKey,
	DEFAULT_MODELS,
	PROVIDER_LABELS,
	resolveBestGeminiModel,
	type ChatProvider,
	type ChatConfig,
	type ChatMessage,
	type ChatError,
} from '@lib/cv-chat';
import { applyDocumentStyle, type DocumentStyle } from '@lib/document-style';
import type { CommentOperation, CVReview } from '@cv/cv-review';
import { applyCommentOps } from '@lib/cv-review';

import {
	buildSystemPrompt,
	buildGenerateSystemPrompt,
	buildGenerateUserMessage,
	buildStarterSuggestions,
	buildOnboardingStarters,
	isDefaultCvData,
	readLayoutState,
} from '@lib/cv-chat-prompts';

import { readFileToText, ACCEPTED_FILE_TYPES } from '@lib/cv-file-reader';
import {
	saveSource,
	loadSource,
	clearSource,
	dispatchSourceChanged,
	SOURCE_CHANGED_EVENT,
	type SourceMeta,
	type SourceChangedDetail,
} from '@lib/cv-source';
import { validateCvData } from '@lib/cv-loader';
import type { CVData } from '@cv/cv';
import { DOCK_CONTROLS } from '@renderer/dock-controls';
import { initDockedPopover } from '@renderer/docked-popover';
import {
	DOCKED_SIDE_PANEL_CLASS,
	dispatchDockedPanelClose,
	dispatchDockedPanelOpen,
} from '@renderer/docked-side-panels';

// ─── Panel events ─────────────────────────────────────────────────────────────

export const CHAT_OPEN_EVENT  = 'cv-chat-open';
export const CHAT_CLOSE_EVENT = 'cv-chat-close';

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function h(
	tag:   string,
	attrs: Record<string, string> = {},
	...children: (Node | string | null | undefined)[]
): HTMLElement {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		el.setAttribute(k === 'className' ? 'class' : k, v);
	}
	for (const child of children) {
		if (child == null) { continue; }
		el.append(typeof child === 'string' ? document.createTextNode(child) : child);
	}
	return el;
}

// ─── Markdown-lite renderer ───────────────────────────────────────────────────

/**
 * Very light markdown → HTML: bold (**text**), inline code (`code`),
 * fenced code blocks, and line breaks. No dependencies.
 */
function renderMarkdown(text: string, showApplyButton = true): HTMLElement {
	const wrapper = document.createElement('div');
	wrapper.className = 'cv-chat-md';

	// Split off fenced code blocks first
	const parts = text.split(/(```[\s\S]*?```)/g);

	for (const part of parts) {
		if (part.startsWith('```')) {
			const inner = part.replace(/^```\w*\n?/, '').replace(/```$/, '');
			const lang  = part.match(/^```(\w+)/)?.[1] ?? '';
			const pre   = document.createElement('pre');
			const code  = document.createElement('code');
			if (lang) { code.className = `language-${lang}`; }
			code.textContent = inner;
			pre.appendChild(code);

			// Add "Apply changes" button for JSON blocks
			if (lang === 'json' && showApplyButton) {
				pre.classList.add('cv-chat-json-block');
				const applyBtn = h('button', {
					class:         'cv-chat-apply-btn',
					type:          'button',
					'data-pending-json': inner,
				}, '↓ Apply changes');
				pre.appendChild(applyBtn);
			}

			wrapper.appendChild(pre);
			continue;
		}

		// Process inline formatting line by line
		const lines = part.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line.trim()) {
				if (i > 0) { wrapper.appendChild(document.createElement('br')); }
				continue;
			}

			const p = document.createElement('p');

			// Bold **text** and inline code `text`
			const processed = line
				.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
				.replace(/`([^`]+)`/g, '<code>$1</code>');

			p.innerHTML = processed;
			wrapper.appendChild(p);
		}
	}

	return wrapper;
}

// ─── Panel builder ────────────────────────────────────────────────────────────

type PanelElements = {
	panel:       HTMLElement;
	messages:    HTMLElement;
	inputWrap:   HTMLElement;
	input:       HTMLTextAreaElement;
	sendBtn:     HTMLButtonElement;
	uploadBtn:   HTMLButtonElement;
	uploadInput: HTMLInputElement;
	setupScreen: HTMLElement;
};

function buildPanel(): PanelElements {
	// Setup screen — shown when no API key is configured
	const providerSelect = document.createElement('select');
	providerSelect.id        = 'cv-chat-provider';
	providerSelect.className = 'cv-chat-setup__select';
	for (const [value, label] of Object.entries(PROVIDER_LABELS)) {
		const opt       = document.createElement('option');
		opt.value       = value;
		opt.textContent = label;
		providerSelect.appendChild(opt);
	}

	const keyInput        = document.createElement('input');
	keyInput.type         = 'text';
	keyInput.id           = 'cv-chat-key';
	keyInput.className    = 'cv-chat-setup__input';
	keyInput.placeholder  = 'Paste your API key…';
	keyInput.setAttribute('autocomplete',     'new-password');
	keyInput.setAttribute('autocapitalize',   'off');
	keyInput.setAttribute('spellcheck',       'false');
	keyInput.setAttribute('data-lpignore',    'true');
	keyInput.setAttribute('data-1p-ignore',  'true');
	keyInput.setAttribute('data-form-type',   'other');

	const saveBtn = h('button', { type: 'button', id: 'cv-chat-save-key', class: 'cv-chat-setup__btn' },
		'Connect',
	);

	const modelSelect = document.createElement('select');
	modelSelect.id        = 'cv-chat-model';
	modelSelect.className = 'cv-chat-setup__select';
	[
		{ v: 'auto', l: 'Auto (prefer free models)' },
		{ v: 'gemini-3-flash', l: 'Gemini 3 Flash' },
		{ v: 'gemini-2.5-flash-lite', l: 'Gemini 2.5 Flash-Lite' },
	].forEach((m) => {
		const opt       = document.createElement('option');
		opt.value       = m.v;
		opt.textContent = m.l;
		modelSelect.appendChild(opt);
	});

	const modelRow = h('div', { id: 'cv-chat-model-row' },
		h('label', { class: 'cv-chat-setup__label', for: 'cv-chat-model' }, 'Model'),
		modelSelect,
	);

	const setupHint = h('p', {
		id:              'cv-chat-setup-hint',
		class:           'cv-chat-setup__hint',
		'aria-live':     'polite',
		'aria-atomic':   'true',
	});

	const setupNote = h('p', { class: 'cv-chat-setup__note' },
		'Your key is stored only in your browser. ',
		h('a', { href: 'https://console.anthropic.com', target: '_blank', rel: 'noopener', class: 'cv-chat-setup__link' }, 'Get an Anthropic key'),
		' or ',
		h('a', { href: 'https://aistudio.google.com', target: '_blank', rel: 'noopener', class: 'cv-chat-setup__link' }, 'Get a Gemini key (free tier)'),
		'.',
	);

	const setupScreen = h('div', { id: 'cv-chat-setup', class: 'cv-chat-setup' },
		h('p', { class: 'cv-chat-setup__title' }, 'Connect your AI provider'),
		h('p', { class: 'cv-chat-setup__sub' }, 'Bring your own key — nothing is sent to any server except the provider you choose.'),
		h('label', { class: 'cv-chat-setup__label', for: 'cv-chat-provider' }, 'Provider'),
		providerSelect,
		h('label', { class: 'cv-chat-setup__label', for: 'cv-chat-key' }, 'API Key'),
		keyInput,
		modelRow,
		setupHint,
		saveBtn,
		setupNote,
	);

	// Messages container
	const messages = h('div', { id: 'cv-chat-messages', class: 'cv-chat-messages',
		role: 'log', 'aria-live': 'polite' });

	// Starters (shown before first message)
	const starters = h('div', { id: 'cv-chat-starters', class: 'cv-chat-starters' });

	// Input area
	const textarea = document.createElement('textarea');
	textarea.id          = 'cv-chat-input';
	textarea.className   = 'cv-chat-input';
	textarea.placeholder = 'Ask about your CV…';
	textarea.rows        = 2;

	const sendBtn = h('button', {
		type:         'button',
		id:           'cv-chat-send',
		class:        'cv-chat-send',
		'aria-label': 'Send message',
	}, '↑') as HTMLButtonElement;

	// File upload button + hidden input
	const uploadInput        = document.createElement('input');
	uploadInput.type         = 'file';
	uploadInput.id           = 'cv-chat-upload-input';
	uploadInput.accept       = ACCEPTED_FILE_TYPES;
	uploadInput.style.display = 'none';

	const uploadBtn = h('button', {
		type:         'button',
		id:           'cv-chat-upload-btn',
		class:        'cv-chat-upload-btn',
		'aria-label': 'Upload document to create CV',
		title:        'Upload a document (.txt, .md, .docx, .pdf)',
	}, '📎') as HTMLButtonElement;

	const inputWrap = h('div', { class: 'cv-chat-input-wrap' },
		uploadInput, uploadBtn, textarea, sendBtn,
	);

	// Change key link
	const changeKey = h('button', {
		type:  'button',
		id:    'cv-chat-change-key',
		class: 'cv-chat-change-key',
	}, 'Change key');
	const copyChat = h('button', {
		type:  'button',
		id:    'cv-chat-copy',
		class: 'cv-chat-copy',
	}, 'Copy chat');

	const connectionStatus = h('div', {
		id:      'cv-chat-connection-status',
		class:   'cv-chat-connection-status',
		hidden:  '',
		role:    'status',
	});

	// Panel header
	const header = h('div', { class: 'cv-chat-header' },
		h('div', { class: 'cv-chat-header__lead' },
			h('span', { class: 'cv-chat-header__title' }, 'CV Assistant'),
			connectionStatus,
		),
		h('div', { class: 'cv-chat-header__actions' },
			h('span', { id: 'cv-chat-source-badge', class: 'cv-chat-source-badge', hidden: '' }),
			copyChat,
			changeKey,
			h('button', {
				type:         'button',
				id:           'cv-chat-close',
				class:        'cv-chat-close',
				'aria-label': 'Close chat',
			}, '×'),
		),
	);

	const panel = h('div', {
		id:    'cv-chat-panel',
		class: `cv-chat-panel cv-side-panel ${DOCKED_SIDE_PANEL_CLASS} no-print`,
		role:  'complementary',
		'aria-label': 'CV Assistant',
		hidden: '',
	},
		header,
		setupScreen,
		starters,
		messages,
		inputWrap,
	);

	return {
		panel,
		messages,
		inputWrap,
		input:       textarea as HTMLTextAreaElement,
		sendBtn:     sendBtn as HTMLButtonElement,
		uploadBtn:   uploadBtn as HTMLButtonElement,
		uploadInput: uploadInput as HTMLInputElement,
		setupScreen,
	};
}

// ─── Panel controller ─────────────────────────────────────────────────────────

export function initChatPanel(
	remount: (data: CVData) => void,
): { panel: HTMLElement; toggle: HTMLElement } {
	const els           = buildPanel();
	const providerEl    = els.panel.querySelector('#cv-chat-provider') as HTMLSelectElement | null;
	const keyField      = els.panel.querySelector('#cv-chat-key') as HTMLInputElement | null;
	const modelEl       = els.panel.querySelector('#cv-chat-model') as HTMLSelectElement | null;
	const modelRowEl    = els.panel.querySelector('#cv-chat-model-row') as HTMLElement | null;
	const saveKeyBtn    = els.panel.querySelector('#cv-chat-save-key') as HTMLButtonElement | null;
	const changeKeyBtn  = els.panel.querySelector('#cv-chat-change-key') as HTMLButtonElement | null;
	const setupHintEl   = els.panel.querySelector('#cv-chat-setup-hint') as HTMLElement | null;
	let history:        ChatMessage[] = [];
	const initialLoad   = loadChatConfigMeta();
	let cfg:            ChatConfig | null = initialLoad.config;
	/** Where the active cfg was read from, or last successful save target. */
	let cfgStorageSource: 'local' | 'session' | null = initialLoad.source;
	let isStreaming     = false;

	// Source material — loaded from localStorage, updated when user uploads a document
	let sourceText:    string | null = null;
	let sourceMeta:    SourceMeta | null = null;

	const saved = loadSource();
	if (saved) {
		sourceText = saved.text;
		sourceMeta = saved.meta;
	}

	// ── Setup / teardown ────────────────────────────────────────────────────

	function showSetup(show: boolean): void {
		els.setupScreen.hidden = !show;
		els.inputWrap.hidden   = show;
		const starters = document.getElementById('cv-chat-starters');
		if (starters) { starters.hidden = show; }
	}

	function refreshSetupState(): void {
		showSetup(!cfg);
		if (changeKeyBtn) { changeKeyBtn.hidden = !cfg; }
		if (cfg) {
			if (providerEl) { providerEl.value = cfg.provider; }
			if (modelEl && cfg.model) { modelEl.value = cfg.model; }
		}
		const showModel = providerEl?.value === 'gemini';
		if (modelRowEl) { modelRowEl.hidden = !showModel; }
	}

	function appendConnectionStatusMessage(): void {
		if (!cfg) { return; }
		const provider = PROVIDER_LABELS[cfg.provider];
		const modelId  = cfg.model ?? DEFAULT_MODELS[cfg.provider];
		const keyHint  = maskApiKeyHint(cfg.apiKey);
		let storageText = 'in memory only';
		if (cfgStorageSource === 'local') {
			storageText = 'saved in this browser';
		} else if (cfgStorageSource === 'session') {
			storageText = 'saved for this tab session';
		}
		const status = `Connected to ${provider} (${modelId}, ${keyHint}, ${storageText}).`;
		const bubbles = els.messages.querySelectorAll<HTMLElement>('.cv-chat-bubble--system');
		const last = bubbles.length > 0
			? bubbles[bubbles.length - 1]?.innerText.trim()
			: '';
		if (last === status) { return; }
		appendMessage('system', status);
	}

	function refreshSourceBadge(): void {
		const badge = document.getElementById('cv-chat-source-badge') as HTMLElement | null;
		if (!badge) { return; }
		if (sourceMeta) {
			badge.textContent = '';
			badge.hidden      = false;

			// Short filename label
			const nameSpan       = document.createElement('span');
			nameSpan.textContent = `📄 ${sourceMeta.filename}`;
			nameSpan.className   = 'cv-chat-source-badge__name';

			// Clear button
			const clearBtn       = document.createElement('button');
			clearBtn.type        = 'button';
			clearBtn.className   = 'cv-chat-source-badge__clear';
			clearBtn.textContent = '×';
			clearBtn.title       = 'Remove source material';
			clearBtn.setAttribute('aria-label', 'Remove source material');
			clearBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				clearSource();
				sourceText = null;
				sourceMeta = null;
				dispatchSourceChanged({ action: 'cleared' });
				refreshSourceBadge();
				renderStarters();
			});

			badge.appendChild(nameSpan);
			badge.appendChild(clearBtn);
		} else {
			badge.hidden      = true;
			badge.textContent = '';
		}
	}

	// ── Starter suggestions ─────────────────────────────────────────────────

	function renderStarters(): void {
		const startersEl = document.getElementById('cv-chat-starters');
		if (!startersEl) { return; }
		startersEl.innerHTML = '';

		const cv = window.__CV_DATA__;
		if (!cv || history.length > 0) {
			startersEl.hidden = true;
			return;
		}

		const layout      = readLayoutState();
		const onboarding  = isDefaultCvData(cv);
		const suggestions = onboarding
			? buildOnboardingStarters()
			: buildStarterSuggestions(cv, layout, sourceText !== null);

		startersEl.hidden = false;
		startersEl.appendChild(
			h('p', { class: 'cv-chat-starters__label' },
				onboarding ? 'Create your CV' : 'Suggestions',
			),
		);

		for (const suggestion of suggestions) {
			// The upload starter is a special case — trigger file picker
			const isUploadSuggestion = suggestion.startsWith('Upload');

			const btn = h('button', {
				type:  'button',
				class: 'cv-chat-starter-btn' + (isUploadSuggestion ? ' cv-chat-starter-btn--upload' : ''),
			}, (isUploadSuggestion ? '📎 ' : '') + suggestion);

			btn.addEventListener('click', () => {
				if (isUploadSuggestion) {
					els.uploadInput.click();
				} else {
					els.input.value = suggestion;
					els.input.focus();
					sendMessage();
				}
			});
			startersEl.appendChild(btn);
		}
	}

	// ── Generate CV from uploaded document ──────────────────────────────────

	async function generateFromDocument(file: File): Promise<void> {
		if (isStreaming || !cfg) { return; }

		// Hide starters
		const startersEl = document.getElementById('cv-chat-starters');
		if (startersEl) { startersEl.hidden = true; }

		appendMessage('system', `📎 Reading "${file.name}"…`);

		const result = await readFileToText(file);

		if (!result.ok) {
			appendMessage('system', `✗ ${result.error}`);
			return;
		}

		const charCount = result.text.length;
		appendMessage('system',
			`✓ Extracted ${charCount.toLocaleString()} characters from "${file.name}". Generating CV…`,
		);

		// Persist source material so the chatbot can reference it in edit mode
		const meta: SourceMeta = {
			filename:  file.name,
			format:    result.format,
			charCount: result.text.length,
			savedAt:   new Date().toISOString(),
		};
		saveSource(result.text, meta);
		sourceText = result.text;
		sourceMeta = meta;
		dispatchSourceChanged({ action: 'saved', meta });
		refreshSourceBadge();

		// Build the generate-from-scratch conversation
		const userMsg = buildGenerateUserMessage(result.text, file.name);
		history = []; // fresh conversation for generation
		history.push({ role: 'user', content: userMsg });

		isStreaming           = true;
		els.sendBtn.disabled  = true;
		els.uploadBtn.disabled = true;

		const sysPr = buildGenerateSystemPrompt();
		const { appendChunk, finalise } = appendStreamingBubble();
		let fullText = '';

		try {
			for await (const chunk of streamCompletion(cfg, history, sysPr)) {
				fullText += chunk;
				appendChunk(chunk);
			}
			const jsonRaw   = extractJsonBlock(fullText);
			const styleRaw  = extractStyleBlock(fullText);
			const autoApply = Boolean(jsonRaw);
			if (autoApply) {
				finalise('Prepared CV JSON and applied it automatically.', false);
			} else {
				finalise(fullText, true);
			}
			history.push({ role: 'assistant', content: fullText });

			// Auto-apply the generated JSON
			if (jsonRaw) {
				applyJson(jsonRaw, true /* isGenerated */);
			} else {
				appendMessage('system', '⚠ No JSON found in response. Try asking me to try again.');
			}
			if (styleRaw) { applyStylePatch(styleRaw); }
			const reviewRaw2 = extractReviewBlock(fullText);
			if (reviewRaw2) { applyReviewOps(reviewRaw2); }
		} catch (err) {
			const chatErr = err as ChatError;
			appendMessage('system', `✗ ${chatErr?.message ?? 'Generation failed.'}`);
			if (chatErr?.type === 'auth') {
				setTimeout(() => {
					cfg              = null;
					cfgStorageSource = null;
					refreshSetupState();
				}, 1500);
			}
		} finally {
			isStreaming            = false;
			els.sendBtn.disabled   = false;
			els.uploadBtn.disabled = false;
		}
	}

	// ── Message rendering ───────────────────────────────────────────────────

	function appendMessage(
		role:    'user' | 'assistant' | 'system',
		content: string,
	): HTMLElement {
		const bubble = document.createElement('div');
		bubble.className = `cv-chat-bubble cv-chat-bubble--${role}`;

		if (role === 'assistant') {
			bubble.appendChild(renderMarkdown(content));
		} else {
			bubble.textContent = content;
		}

		els.messages.appendChild(bubble);
		els.messages.scrollTop = els.messages.scrollHeight;

		return bubble;
	}

	function appendStreamingBubble(): {
		el: HTMLElement;
		appendChunk: (t: string) => void;
		finalise: (full: string, showApplyButton?: boolean) => void;
	} {
		const bubble    = document.createElement('div');
		bubble.className = 'cv-chat-bubble cv-chat-bubble--assistant cv-chat-bubble--streaming';
		const cursor    = document.createElement('span');
		cursor.className = 'cv-chat-cursor';
		bubble.appendChild(cursor);
		els.messages.appendChild(bubble);

		let accumulated = '';

		function appendChunk(text: string): void {
			accumulated += text;
			// Replace the cursor-only content with the growing markdown
			bubble.innerHTML = '';
			bubble.appendChild(renderMarkdown(accumulated));
			const c2 = document.createElement('span');
			c2.className = 'cv-chat-cursor';
			bubble.appendChild(c2);
			els.messages.scrollTop = els.messages.scrollHeight;
		}

		function finalise(full: string, showApplyButton = true): void {
			bubble.classList.remove('cv-chat-bubble--streaming');
			bubble.innerHTML = '';
			bubble.appendChild(renderMarkdown(full, showApplyButton));
			// Wire apply buttons in the final rendered content
			wireApplyButtons(bubble);
			els.messages.scrollTop = els.messages.scrollHeight;
		}

		return { el: bubble, appendChunk, finalise };
	}

	// ── Apply changes from JSON block ───────────────────────────────────────

	function coerceCvPayload(parsed: unknown): unknown {
		if (!parsed || typeof parsed !== 'object') { return parsed; }
		const root = parsed as Record<string, unknown>;

		function toText(v: unknown): string {
			if (typeof v === 'string') { return v.trim(); }
			if (typeof v === 'number' || typeof v === 'boolean') {
				return String(v);
			}
			return '';
		}

		function toTextList(v: unknown): string[] {
			if (Array.isArray(v)) {
				return v.map(toText).filter(Boolean);
			}
			const raw = toText(v);
			if (!raw) { return []; }
			return raw
				.split(/\r?\n|,\s*/)
				.map((s) => s.trim())
				.filter(Boolean);
		}

		function normalizeDateText(v: unknown): string {
			const t = toText(v);
			if (!t) { return ''; }
			if (/^present$/i.test(t) || /^current$/i.test(t)) {
				return 'Present';
			}
			return t;
		}

		const basics = root.basics;
		if (!basics || typeof basics !== 'object') { return root; }
		const b = basics as Record<string, unknown>;

		// Numeric/date-ish fields from LLM output should remain strings.
		b.name        = toText(b.name);
		b.label       = toText(b.label);
		b.email       = toText(b.email);
		b.phone       = toText(b.phone);
		b.nationality = toText(b.nationality);
		b.born        = normalizeDateText(b.born);
		b.summary     = toText(b.summary);

		const loc = b.location;
		if (typeof loc === 'string') {
			b.location = toText(loc);
		} else if (loc && typeof loc === 'object') {
			const l = loc as Record<string, unknown>;
			const parts = [
				toText(l.city),
				toText(l.region),
				toText(l.countryCode),
			].filter(Boolean);
			if (parts.length > 0) {
				b.location = parts.join(', ');
			}
		}

		// Sometimes model returns arrays as singleton objects.
		if (!Array.isArray(root.education) && root.education != null) {
			root.education = [root.education];
		}
		if (!Array.isArray(root.work) && root.work != null) {
			root.work = [root.work];
		}
		if (!Array.isArray(root.languages) && root.languages != null) {
			root.languages = [root.languages];
		}

		const edu = Array.isArray(root.education) ? root.education : [];
		for (const item of edu) {
			if (!item || typeof item !== 'object') { continue; }
			const e = item as Record<string, unknown>;
			e.institution = toText(e.institution);
			e.area        = toText(e.area);
			e.degree      = toText(e.degree);
			e.startDate   = normalizeDateText(e.startDate);
			e.endDate     = normalizeDateText(e.endDate);
			e.score       = e.score == null ? undefined : toText(e.score);
			e.highlights  = toTextList(e.highlights);
			e.tags        = toTextList(e.tags);
		}

		const work = Array.isArray(root.work) ? root.work : [];
		for (const item of work) {
			if (!item || typeof item !== 'object') { continue; }
			const w = item as Record<string, unknown>;
			w.company    = toText(w.company);
			w.position   = toText(w.position);
			w.startDate  = normalizeDateText(w.startDate);
			w.endDate    = normalizeDateText(w.endDate);
			w.summary    = w.summary == null ? undefined : toText(w.summary);
			w.highlights = toTextList(w.highlights);
			w.tags       = toTextList(w.tags);
		}

		const skills = root.skills;
		if (skills && typeof skills === 'object') {
			const s = skills as Record<string, unknown>;
			s.programming = toTextList(s.programming);
			s.design_bim  = toTextList(s.design_bim);
			s.strategic   = toTextList(s.strategic);
		}

		const langs = Array.isArray(root.languages) ? root.languages : [];
		for (const item of langs) {
			if (!item || typeof item !== 'object') { continue; }
			const lg = item as Record<string, unknown>;
			lg.language = toText(lg.language);
			lg.fluency  = toText(lg.fluency);
		}

		const personal = root.personal;
		if (personal && typeof personal === 'object') {
			const p = personal as Record<string, unknown>;
			if (Array.isArray(p.interests)) {
				p.interests = toTextList(p.interests).join(', ');
			} else {
				p.interests = toText(p.interests);
			}
		}

		const visibility = root.visibility;
		if (visibility && typeof visibility === 'object') {
			const v = visibility as Record<string, unknown>;
			const workIds = Array.isArray(v.hiddenWork) ? v.hiddenWork : [];
			const eduIds = Array.isArray(v.hiddenEducation)
				? v.hiddenEducation
				: [];
			v.hiddenWork = workIds
				.map((n) => Number(n))
				.filter((n) => Number.isInteger(n) && n >= 0);
			v.hiddenEducation = eduIds
				.map((n) => Number(n))
				.filter((n) => Number.isInteger(n) && n >= 0);
			v.hiddenSections = toTextList(v.hiddenSections);
		}

		if (root.activeFilters != null) {
			root.activeFilters = toTextList(root.activeFilters);
		}
		return root;
	}

	function applyJson(raw: string, isGenerated = false): void {
		try {
			const parsed  = JSON.parse(raw);
			const fixed   = coerceCvPayload(parsed);
			const newData = validateCvData(fixed);
			const prev = window.__CV_DATA__;
			const keepUrl = prev?.basics.portraitDataUrl;
			if (keepUrl && !newData.basics.portraitDataUrl) {
				newData.basics = {
					...newData.basics,
					portraitDataUrl: keepUrl,
				};
			}
			const keepSha = prev?.basics.portraitSha256;
			if (keepSha && !newData.basics.portraitSha256) {
				newData.basics = {
					...newData.basics,
					portraitSha256: keepSha,
				};
			}
			remount(newData);
			appendMessage('system',
				isGenerated
					? '✓ CV created! Review it and use edit mode to make adjustments. Download it as JSON to save.'
					: '✓ CV updated successfully.',
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			appendMessage('system', `✗ Could not apply changes: ${msg}`);
		}
	}

	function applyReviewOps(raw: string): void {
		try {
			const ops = JSON.parse(raw) as CommentOperation[];
			const cv  = window.__CV_DATA__;
			if (!cv) { return; }
			if (!cv.review) { cv.review = { version: 1, comments: [], active: true }; }
			applyCommentOps(cv.review, ops);
			const syncFn = (window as Window & {
				__blemmySyncReview__?: (r: CVReview) => void;
			}).__blemmySyncReview__;
			if (syncFn && cv.review) { syncFn(cv.review); }
			appendMessage('system', '\u2713 Review updated.');
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			appendMessage('system', `\u2717 Could not apply review ops: ${msg}`);
		}
	}

	function applyStylePatch(raw: string): void {
		try {
			const patch = JSON.parse(raw) as Partial<DocumentStyle>;
			const applied = applyDocumentStyle(patch);
			const syncFn = (window as Window & {
				__blemmySyncStyleUI__?: (style: DocumentStyle) => void;
			}).__blemmySyncStyleUI__;
			if (syncFn) { syncFn(applied); }
			appendMessage('system', '✓ Style updated.');
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			appendMessage('system', `✗ Could not apply style: ${msg}`);
		}
	}

	function wireApplyButtons(container: HTMLElement): void {
		container.querySelectorAll<HTMLButtonElement>('[data-pending-json]').forEach((btn) => {
			btn.addEventListener('click', () => {
				const raw = btn.dataset.pendingJson ?? '';
				applyJson(raw);
			});
		});
	}

	// ── Send message ─────────────────────────────────────────────────────────

	async function sendMessage(): Promise<void> {
		const text = els.input.value.trim();
		if (!text || isStreaming || !cfg) { return; }

		// Hide starters once conversation starts
		const startersEl = document.getElementById('cv-chat-starters');
		if (startersEl) { startersEl.hidden = true; }

		els.input.value = '';
		els.input.style.height = '';
		history.push({ role: 'user', content: text });
		appendMessage('user', text);

		isStreaming = true;
		els.sendBtn.disabled = true;

		const cv     = window.__CV_DATA__;
		const layout = readLayoutState();
		const onboarding   = cv ? isDefaultCvData(cv) : true;
		const looksLikeGen = onboarding && (
			text.length > 200 ||
			/\b(I|my|worked|studied|graduated|years?)\b/i.test(text)
		);
		const sysPr = looksLikeGen
			? buildGenerateSystemPrompt()
			: (cv
				? buildSystemPrompt(cv, layout, sourceText ?? undefined, cv?.review)
				: buildGenerateSystemPrompt());

		const { appendChunk, finalise } = appendStreamingBubble();
		let   fullText = '';

		try {
			for await (const chunk of streamCompletion(cfg, history, sysPr)) {
				fullText += chunk;
				appendChunk(chunk);
			}
			const jsonRaw    = extractJsonBlock(fullText);
			const styleRaw2  = extractStyleBlock(fullText);
			const reviewRaw   = extractReviewBlock(fullText);
			const applyWords = ['apply', 'update', 'change', 'rewrite', 'modify', 'use this'];
			const wantsApply = applyWords.some((w) => text.toLowerCase().includes(w));
			const autoApply  = Boolean(jsonRaw && wantsApply);
			if (autoApply) {
				finalise('Applied the proposed CV changes automatically.', false);
			} else {
				finalise(fullText, true);
			}
			history.push({ role: 'assistant', content: fullText });

			// Auto-apply if the response contains exactly one JSON block
			// and the user's message contained an apply-intent keyword
			if (jsonRaw && wantsApply) {
				applyJson(jsonRaw);
			}
			if (styleRaw2) { applyStylePatch(styleRaw2); }
			if (reviewRaw) { applyReviewOps(reviewRaw); }

		} catch (err) {
			const chatErr = err as ChatError;
			const msg = chatErr?.message ?? 'An error occurred. Check your API key and try again.';
			appendMessage('system', `✗ ${msg}`);
			if (chatErr?.type === 'auth') {
				setTimeout(() => {
					cfg              = null;
					cfgStorageSource = null;
					refreshSetupState();
				}, 1500);
			}
		} finally {
			isStreaming = false;
			els.sendBtn.disabled = false;
			els.input.focus();
		}
	}

	// ── Wire events ──────────────────────────────────────────────────────────

	els.input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	});

	// Auto-grow textarea
	els.input.addEventListener('input', () => {
		els.input.style.height = 'auto';
		els.input.style.height = Math.min(els.input.scrollHeight, 120) + 'px';
	});

	els.sendBtn.addEventListener('click', () => { sendMessage(); });

	// File upload
	els.uploadBtn.addEventListener('click', () => { els.uploadInput.click(); });
	els.uploadInput.addEventListener('change', () => {
		const file = els.uploadInput.files?.[0];
		if (!file) { return; }
		els.uploadInput.value = ''; // reset so same file can be re-uploaded
		if (!cfg) {
			// Show setup if no key configured yet
			appendMessage('system', 'Please connect an AI provider first, then upload your document.');
			return;
		}
		void generateFromDocument(file);
	});

	function inferProvider(key: string, select: HTMLSelectElement): ChatProvider {
		const d = detectProvider(key);
		if (d) { return d; }
		const v = select.value;
		if (v === 'anthropic' || v === 'gemini') { return v; }
		return 'anthropic';
	}

	function syncSetupKeyHint(): void {
		if (!keyField || !setupHintEl || !providerEl) { return; }
		const key = normalizeApiKey(keyField.value);
		if (!key) {
			setupHintEl.textContent = '';
			return;
		}
		const d = detectProvider(key);
		if (d && providerEl.value !== d) {
			providerEl.value = d;
		}
		if (d) {
			setupHintEl.textContent =
				`Using ${PROVIDER_LABELS[d]}. Click Connect to save.`;
		} else {
			setupHintEl.textContent =
				'Click Connect to save.';
		}
	}

	keyField?.addEventListener('input', syncSetupKeyHint);
	providerEl?.addEventListener('change', () => {
		const showModel = providerEl.value === 'gemini';
		if (modelRowEl) { modelRowEl.hidden = !showModel; }
	});
	keyField?.addEventListener('paste', () => {
		queueMicrotask(syncSetupKeyHint);
	});

	// Setup: save key
	saveKeyBtn?.addEventListener('click', async () => {
		if (!keyField || !providerEl) { return; }
		if (saveKeyBtn) { saveKeyBtn.disabled = true; }

		try {
			const keyRaw   = normalizeApiKey(keyField.value);
			const provider = inferProvider(keyRaw, providerEl);

			if (!keyRaw) {
				keyField.placeholder = 'Please enter a key…';
				if (setupHintEl) {
					setupHintEl.textContent = 'Paste your key, then click Connect.';
				}
				return;
			}

			if (!isPlausibleApiKey(keyRaw, provider)) {
				if (setupHintEl) {
					setupHintEl.textContent =
						'That does not look like a real key for this provider ' +
						'(check for autofill or accidental paste).';
				}
				return;
			}

			let model = DEFAULT_MODELS[provider];
			const chosenModel = modelEl?.value ?? 'auto';
			if (provider === 'gemini' && chosenModel !== 'auto') {
				model = chosenModel;
			} else if (provider === 'gemini') {
				if (setupHintEl) {
					setupHintEl.textContent = 'Checking Gemini models for this key…';
				}
				const resolved = await resolveBestGeminiModel(keyRaw);
				if (resolved) { model = resolved; }
			}

			const nextCfg = normalizeChatConfig({ provider, apiKey: keyRaw, model });
			if (!nextCfg) {
				if (setupHintEl) {
					setupHintEl.textContent = 'Key format looks invalid.';
				}
				return;
			}
			cfg           = nextCfg;
			const saved   = saveChatConfig(cfg);
			if (saved.local) {
				cfgStorageSource = 'local';
			} else if (saved.session) {
				cfgStorageSource = 'session';
			}
			keyField.value = '';
			if (setupHintEl) { setupHintEl.textContent = ''; }
			// Force collapse immediately after successful connect.
			els.setupScreen.hidden = true;
			els.inputWrap.hidden   = false;
			refreshSetupState();
			renderStarters();
			appendMessage('system',
				`Connected to ${PROVIDER_LABELS[provider]} (${model}). You can start chatting.`);
			if (!saved.ok) {
				appendMessage('system',
					'Key works this session, but could not be written to browser storage.');
			} else if (saved.local && saved.session) {
				appendMessage('system',
					'Key stored in localStorage and sessionStorage (reload-safe).');
			} else if (saved.local) {
				appendMessage('system', 'Key stored in this browser (localStorage).');
			} else {
				appendMessage('system',
					'Key stored for this tab only (localStorage blocked or full).');
			}
		} catch {
			if (setupHintEl) {
				setupHintEl.textContent = 'Could not validate model list right now.';
			}
		} finally {
			if (saveKeyBtn) { saveKeyBtn.disabled = false; }
		}
	});

	// Allow Enter in key input to save
	keyField?.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') { saveKeyBtn?.click(); }
	});

	// Change key
	changeKeyBtn?.addEventListener('click', () => {
		clearChatConfig();
		cfg              = null;
		cfgStorageSource = null;
		if (setupHintEl) { setupHintEl.textContent = ''; }
		refreshSetupState();
	});

	const copyChatBtn = els.panel.querySelector('#cv-chat-copy') as HTMLButtonElement | null;
	copyChatBtn?.addEventListener('click', async () => {
		const lines: string[] = [];
		const bubbles = els.messages.querySelectorAll<HTMLElement>('.cv-chat-bubble');
		for (const bubble of bubbles) {
			const text = bubble.innerText.trim();
			if (!text) { continue; }
			if (bubble.classList.contains('cv-chat-bubble--user')) {
				lines.push(`User: ${text}`);
				continue;
			}
			if (bubble.classList.contains('cv-chat-bubble--assistant')) {
				lines.push(`Assistant: ${text}`);
				continue;
			}
			lines.push(`System: ${text}`);
		}
		if (lines.length === 0) {
			appendMessage('system', 'No chat messages to copy yet.');
			return;
		}
		try {
			await navigator.clipboard.writeText(lines.join('\n\n'));
			appendMessage('system', 'Chat copied to clipboard.');
		} catch {
			appendMessage('system', 'Clipboard copy failed. Browser denied access.');
		}
	});

	let popover: ReturnType<typeof initDockedPopover> | null = null;

	// Close button
	const closeBtn = els.panel.querySelector('#cv-chat-close') as HTMLButtonElement | null;
	closeBtn?.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		popover?.close();
	});

	// ── Open / close ──────────────────────────────────────────────────────────

	function openPanel(): void {
		els.panel.hidden = false;
		refreshSetupState();
		refreshSourceBadge();
		renderStarters();
		appendConnectionStatusMessage();
		dispatchDockedPanelOpen('cv-chat-panel');
		window.dispatchEvent(new Event(CHAT_OPEN_EVENT));
		if (!cfg) {
			keyField?.focus();
		} else {
			els.input.focus();
		}
	}

	function closePanel(): void {
		els.panel.hidden = true;
		dispatchDockedPanelClose('cv-chat-panel');
		window.dispatchEvent(new Event(CHAT_CLOSE_EVENT));
	}

	// ── Toggle button ─────────────────────────────────────────────────────────

	const trigger = h('button', {
		id:           DOCK_CONTROLS.chat.id,
		class:        'cv-chat-trigger cv-dock-btn no-print',
		type:         'button',
		'aria-label': DOCK_CONTROLS.chat.ariaLabel,
		'aria-expanded': 'false',
		'aria-controls': 'cv-chat-panel',
		title:        DOCK_CONTROLS.chat.title,
		'data-icon':  DOCK_CONTROLS.chat.icon,
	}, DOCK_CONTROLS.chat.label);
	popover = initDockedPopover({
		panel: els.panel,
		trigger,
		openClass: 'cv-chat-trigger--open',
		group: 'right-docked-panels',
		marginPx: 12,
		onOpen: openPanel,
		onClose: closePanel,
	});
	popover.refreshViewportFit();

	// Refresh starters when CV changes (filter toggle, edit, upload)
	window.addEventListener('cv-layout-applied', () => {
		if (!els.panel.hidden && history.length === 0) { renderStarters(); }
	});

	// Sync source badge if source is cleared from outside the panel
	window.addEventListener(SOURCE_CHANGED_EVENT, (e) => {
		const detail = (e as CustomEvent<SourceChangedDetail>).detail;
		if (detail.action === 'cleared') {
			sourceText = null;
			sourceMeta = null;
		} else if (detail.action === 'saved') {
			// Re-load from storage in case it was saved from another context
			const s = loadSource();
			if (s) { sourceText = s.text; sourceMeta = s.meta; }
		}
		refreshSourceBadge();
		if (!els.panel.hidden && history.length === 0) { renderStarters(); }
	});

	// Initial state
	refreshSetupState();

	return { panel: els.panel, toggle: trigger };
}
