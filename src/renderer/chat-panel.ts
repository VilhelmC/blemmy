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
 * Document JSON from the model either applies immediately or stages for review
 * (see layout prefs → Assistant) then remounts via __blemmyRemountDocument__.
 * The panel fires 'blemmy-chat-open' / 'blemmy-chat-close' events on window so
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
} from '@lib/assistant-chat';
import { applyDocumentStyle, type DocumentStyle } from '@lib/document-style';
import type { CommentOperation, CVReview } from '@cv/review-types';
import { applyCommentOps } from '@lib/review-dom';

import {
	buildRoutedSystemPrompt,
	buildGenerateSystemPrompt,
	buildGenerateUserMessage,
	buildStarterSuggestionsForDoc,
	buildOnboardingStarters,
	isDefaultCvData,
	readLayoutState,
	type ActiveDocType,
	type ActiveDocData,
} from '@lib/assistant-prompts';
import {
	routeChatContext,
	type RoutedContext,
} from '@lib/chat-context-router';

import { readFileToText, ACCEPTED_FILE_TYPES } from '@lib/upload-file-reader';
import {
	saveSource,
	loadSource,
	clearSource,
	dispatchSourceChanged,
	SOURCE_CHANGED_EVENT,
	type SourceMeta,
	type SourceChangedDetail,
} from '@lib/chat-source-store';
import { isLikelyCvData } from '@lib/profile-data-loader';
import {
	getActiveDocumentData,
	getActiveDocumentType,
	validateDocumentByType,
	BLEMMY_ACTIVE_DOCUMENT_CHANGED,
} from '@lib/active-document-runtime';
import { getDocTypeSpec } from '@lib/document-type';
import type { CVData } from '@cv/cv';
import type { StoredDocumentData } from '@lib/cloud-client';
import { resolvePathToElement, type ContentPath } from '@lib/review-dom';
import { loadAssistantApplyMode } from '@lib/assistant-apply-preferences';
import {
	buildDocumentFromLeafSelection,
	countAcceptedChanges,
} from '@lib/assistant-pending-merge';
import {
	cloneDocumentData,
	computeLeafDiffBetweenDocuments,
	recordDocumentApplyHistory,
	type LeafChange,
} from '@lib/blemmy-document-edit-history';
import { DOCK_CONTROLS } from '@renderer/dock-controls';
import { initDockedPopover } from '@renderer/docked-popover';
import {
	DOCKED_SIDE_PANEL_CLASS,
	dispatchDockedPanelClose,
	dispatchDockedPanelOpen,
} from '@renderer/docked-side-panels';

// ─── Panel events ─────────────────────────────────────────────────────────────

export const CHAT_OPEN_EVENT  = 'blemmy-chat-open';
export const CHAT_CLOSE_EVENT = 'blemmy-chat-close';
export const DOC_TYPE_CHANGED_EVENT = BLEMMY_ACTIVE_DOCUMENT_CHANGED;

const PENDING_ASSISTANT_LEAF_LIMIT = 120;

type PendingAssistantApplyState = {
	docType: string;
	baseSnapshot: StoredDocumentData;
	proposedSnapshot: StoredDocumentData;
	leafChanges: LeafChange[];
	truncated: boolean;
};

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
	wrapper.className = 'blemmy-chat-md';

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
				pre.classList.add('blemmy-chat-json-block');
				const applyLabel = loadAssistantApplyMode() === 'review'
					? '↓ Review changes'
					: '↓ Apply changes';
				const applyBtn = h('button', {
					class:         'blemmy-chat-apply-btn',
					type:          'button',
					'data-pending-json': inner,
				}, applyLabel);
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
	panel:        HTMLElement;
	messages:     HTMLElement;
	pendingApply: HTMLElement;
	scopeBar:     HTMLElement;
	inputWrap:    HTMLElement;
	input:        HTMLTextAreaElement;
	sendBtn:      HTMLButtonElement;
	uploadBtn:    HTMLButtonElement;
	uploadInput:  HTMLInputElement;
	setupScreen:  HTMLElement;
};

function buildPanel(): PanelElements {
	// Setup screen — shown when no API key is configured
	const providerSelect = document.createElement('select');
	providerSelect.id        = 'blemmy-chat-provider';
	providerSelect.className = 'blemmy-chat-setup__select';
	for (const [value, label] of Object.entries(PROVIDER_LABELS)) {
		const opt       = document.createElement('option');
		opt.value       = value;
		opt.textContent = label;
		providerSelect.appendChild(opt);
	}

	const keyInput        = document.createElement('input');
	keyInput.type         = 'text';
	keyInput.id           = 'blemmy-chat-key';
	keyInput.className    = 'blemmy-chat-setup__input';
	keyInput.placeholder  = 'Paste your API key…';
	keyInput.setAttribute('autocomplete',     'new-password');
	keyInput.setAttribute('autocapitalize',   'off');
	keyInput.setAttribute('spellcheck',       'false');
	keyInput.setAttribute('data-lpignore',    'true');
	keyInput.setAttribute('data-1p-ignore',  'true');
	keyInput.setAttribute('data-form-type',   'other');

	const saveBtn = h('button', { type: 'button', id: 'blemmy-chat-save-key', class: 'blemmy-chat-setup__btn' },
		'Connect',
	);

	const modelSelect = document.createElement('select');
	modelSelect.id        = 'blemmy-chat-model';
	modelSelect.className = 'blemmy-chat-setup__select';
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

	const modelRow = h('div', { id: 'blemmy-chat-model-row' },
		h('label', { class: 'blemmy-chat-setup__label', for: 'blemmy-chat-model' }, 'Model'),
		modelSelect,
	);

	const setupHint = h('p', {
		id:              'blemmy-chat-setup-hint',
		class:           'blemmy-chat-setup__hint',
		'aria-live':     'polite',
		'aria-atomic':   'true',
	});

	const setupNote = h('p', { class: 'blemmy-chat-setup__note' },
		'Your key is stored only in your browser. ',
		h('a', { href: 'https://console.anthropic.com', target: '_blank', rel: 'noopener', class: 'blemmy-chat-setup__link' }, 'Get an Anthropic key'),
		' or ',
		h('a', { href: 'https://aistudio.google.com', target: '_blank', rel: 'noopener', class: 'blemmy-chat-setup__link' }, 'Get a Gemini key (free tier)'),
		'.',
	);

	const setupScreen = h('div', { id: 'blemmy-chat-setup', class: 'blemmy-chat-setup' },
		h('p', { class: 'blemmy-chat-setup__title' }, 'Connect your AI provider'),
		h('p', { class: 'blemmy-chat-setup__sub' }, 'Bring your own key — nothing is sent to any server except the provider you choose.'),
		h('label', { class: 'blemmy-chat-setup__label', for: 'blemmy-chat-provider' }, 'Provider'),
		providerSelect,
		h('label', { class: 'blemmy-chat-setup__label', for: 'blemmy-chat-key' }, 'API Key'),
		keyInput,
		modelRow,
		setupHint,
		saveBtn,
		setupNote,
	);

	// Messages container
	const messages = h('div', { id: 'blemmy-chat-messages', class: 'blemmy-chat-messages',
		role: 'log', 'aria-live': 'polite' });

	const pendingApply = h('div', {
		id: 'blemmy-chat-pending-apply',
		class: 'blemmy-chat-pending-apply',
		hidden: '',
	});

	// Starters (shown before first message)
	const starters = h('div', { id: 'blemmy-chat-starters', class: 'blemmy-chat-starters' });

	// Input area
	const textarea = document.createElement('textarea');
	textarea.id          = 'blemmy-chat-input';
	textarea.className   = 'blemmy-chat-input';
	textarea.placeholder = 'Ask about this document…';
	textarea.rows        = 2;

	const sendBtn = h('button', {
		type:         'button',
		id:           'blemmy-chat-send',
		class:        'blemmy-chat-send',
		'aria-label': 'Send message',
	}, '↑') as HTMLButtonElement;

	// File upload button + hidden input
	const uploadInput        = document.createElement('input');
	uploadInput.type         = 'file';
	uploadInput.id           = 'blemmy-chat-upload-input';
	uploadInput.accept       = ACCEPTED_FILE_TYPES;
	uploadInput.style.display = 'none';

	const uploadBtn = h('button', {
		type:         'button',
		id:           'blemmy-chat-upload-btn',
		class:        'blemmy-chat-upload-btn',
		'aria-label': 'Upload source document',
		title:        'Upload a document (.txt, .md, .docx, .pdf)',
	}, '📎') as HTMLButtonElement;
	const scopeBar = h('div', {
		id: 'blemmy-chat-scope-bar',
		class: 'blemmy-chat-scope-bar',
		hidden: '',
	});

	const inputWrap = h('div', { class: 'blemmy-chat-input-wrap' },
		uploadInput, uploadBtn, textarea, sendBtn,
	);

	// Change key link
	const changeKey = h('button', {
		type:  'button',
		id:    'blemmy-chat-change-key',
		class: 'blemmy-chat-change-key',
	}, 'Change key');
	const copyChat = h('button', {
		type:  'button',
		id:    'blemmy-chat-copy',
		class: 'blemmy-chat-copy',
	}, 'Copy chat');

	const connectionStatus = h('div', {
		id:      'blemmy-chat-connection-status',
		class:   'blemmy-chat-connection-status',
		hidden:  '',
		role:    'status',
	});

	// Panel header
	const headerTitle = h('span', {
		id: 'blemmy-chat-header-title',
		class: 'blemmy-chat-header__title',
	}, 'Assistant');
	const header = h('div', { class: 'blemmy-chat-header' },
		h('div', { class: 'blemmy-chat-header__lead' },
			headerTitle,
			connectionStatus,
		),
		h('div', { class: 'blemmy-chat-header__actions' },
			h('span', { id: 'blemmy-chat-source-badge', class: 'blemmy-chat-source-badge', hidden: '' }),
			copyChat,
			changeKey,
			h('button', {
				type:         'button',
				id:           'blemmy-chat-close',
				class:        'blemmy-chat-close',
				'aria-label': 'Close chat',
			}, '×'),
		),
	);

	const panel = h('div', {
		id:    'blemmy-chat-panel',
		class: `blemmy-chat-panel blemmy-side-panel ${DOCKED_SIDE_PANEL_CLASS} no-print`,
		role:  'complementary',
		'aria-label': 'Document assistant',
		hidden: '',
	},
		header,
		setupScreen,
		starters,
		messages,
		pendingApply,
		scopeBar,
		inputWrap,
	);

	return {
		panel,
		messages,
		pendingApply,
		scopeBar,
		inputWrap,
		input:       textarea as HTMLTextAreaElement,
		sendBtn:     sendBtn as HTMLButtonElement,
		uploadBtn:   uploadBtn as HTMLButtonElement,
		uploadInput: uploadInput as HTMLInputElement,
		setupScreen,
	};
}

// ─── Panel controller ─────────────────────────────────────────────────────────

export function initChatPanel(): { panel: HTMLElement; toggle: HTMLElement } {
	const els           = buildPanel();
	const providerEl    = els.panel.querySelector('#blemmy-chat-provider') as HTMLSelectElement | null;
	const keyField      = els.panel.querySelector('#blemmy-chat-key') as HTMLInputElement | null;
	const modelEl       = els.panel.querySelector('#blemmy-chat-model') as HTMLSelectElement | null;
	const modelRowEl    = els.panel.querySelector('#blemmy-chat-model-row') as HTMLElement | null;
	const saveKeyBtn    = els.panel.querySelector('#blemmy-chat-save-key') as HTMLButtonElement | null;
	const changeKeyBtn  = els.panel.querySelector('#blemmy-chat-change-key') as HTMLButtonElement | null;
	const setupHintEl   = els.panel.querySelector('#blemmy-chat-setup-hint') as HTMLElement | null;
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

	let selectedPaths = new Set<string>();

	let pendingAssistantApply: PendingAssistantApplyState | null = null;
	const pendingRejectedPaths = new Set<string>();

	function activeDocType(): ActiveDocType {
		return getActiveDocumentType();
	}

	function activeDocLabel(): string {
		const spec = getDocTypeSpec(activeDocType());
		return spec?.label?.trim() || 'Document';
	}

	function syncDocTypeCopy(): void {
		const label = activeDocLabel();
		els.input.placeholder = `Ask about this ${label.toLowerCase()}…`;
		const titleEl = els.panel.querySelector('#blemmy-chat-header-title');
		if (titleEl) {
			titleEl.textContent = `${label} Assistant`;
		}
	}

	function activeDocData(): ActiveDocData | null {
		const d = getActiveDocumentData();
		return (d ?? null) as ActiveDocData | null;
	}
	syncDocTypeCopy();
	window.addEventListener(DOC_TYPE_CHANGED_EVENT, () => { syncDocTypeCopy(); });

	function activeReviewPaths(): string[] {
		const raw = getActiveDocumentData();
		const cv = isLikelyCvData(raw) ? raw : null;
		if (!cv?.review?.comments?.length) { return []; }
		return cv.review.comments
			.filter((comment) => comment.status === 'open' || comment.status === 'flagged')
			.map((comment) => comment.path);
	}

	function clearScopedHighlight(): void {
		document
			.querySelectorAll<HTMLElement>('.blemmy-chat-scope-selected')
			.forEach((el) => el.classList.remove('blemmy-chat-scope-selected'));
	}

	function resolveLetterPathElement(path: string): HTMLElement | null {
		const direct = document.querySelector<HTMLElement>(
			`[data-blemmy-field="${CSS.escape(path)}"]`,
		);
		if (direct) { return direct; }
		if (path.startsWith('body[')) {
			const idx = Number(path.match(/^body\[(\d+)\]/)?.[1] ?? '-1');
			if (idx >= 0) {
				return document.querySelector<HTMLElement>(
					`[data-blemmy-field="body.${idx}.text"]`,
				);
			}
		}
		return null;
	}

	function resolvePathElement(path: string): HTMLElement | null {
		if (activeDocType() === 'letter') {
			return resolveLetterPathElement(path);
		}
		return resolvePathToElement(path as ContentPath);
	}

	function bestSelectableTarget(node: HTMLElement): HTMLElement {
		return node.closest<HTMLElement>(
			'[data-blemmy-field], .experience-block, .education-item',
		) ?? node;
	}

	function resolvePathFromTarget(target: HTMLElement): string | null {
		const fieldPath = target.closest<HTMLElement>('[data-blemmy-field]')
			?.getAttribute('data-blemmy-field');
		if (fieldPath) {
			return fieldPath.startsWith('body.')
				? fieldPath.replace(/^body\.(\d+)\.text$/, 'body[$1].text')
				: fieldPath;
		}
		const workNode = target.closest<HTMLElement>('.experience-block');
		if (workNode) {
			const all = Array.from(document.querySelectorAll<HTMLElement>('.experience-block'));
			const idx = all.indexOf(workNode);
			if (idx >= 0) { return `work[${idx}]`; }
		}
		const eduNode = target.closest<HTMLElement>('.education-item');
		if (eduNode) {
			const all = Array.from(document.querySelectorAll<HTMLElement>('.education-item'));
			const idx = all.indexOf(eduNode);
			if (idx >= 0) { return `education[${idx}]`; }
		}
		return null;
	}

	function renderScopeBar(): void {
		const bar = els.scopeBar;
		bar.innerHTML = '';
		const paths = Array.from(selectedPaths);
		if (paths.length === 0) {
			bar.hidden = true;
			clearScopedHighlight();
			return;
		}
		bar.hidden = false;
		bar.appendChild(h('span', { class: 'blemmy-chat-scope-label' }, 'Scoped to'));
		for (const path of paths) {
			const chip = h('button', {
				type: 'button',
				class: 'blemmy-chat-scope-chip',
				'data-scope-path': path,
				title: `Remove ${path}`,
			}, path);
			chip.addEventListener('click', () => {
				selectedPaths.delete(path);
				renderScopeBar();
			});
			bar.appendChild(chip);
		}
		const clearBtn = h('button', {
			type: 'button',
			class: 'blemmy-chat-scope-clear',
		}, 'Clear');
		clearBtn.addEventListener('click', () => {
			selectedPaths = new Set<string>();
			renderScopeBar();
		});
		bar.appendChild(clearBtn);

		clearScopedHighlight();
		for (const path of paths) {
			const el = resolvePathElement(path);
			if (!el) { continue; }
			bestSelectableTarget(el).classList.add('blemmy-chat-scope-selected');
		}
	}

	// ── Setup / teardown ────────────────────────────────────────────────────

	function showSetup(show: boolean): void {
		els.setupScreen.hidden = !show;
		els.inputWrap.hidden   = show;
		els.scopeBar.hidden    = selectedPaths.size === 0;
		const starters = document.getElementById('blemmy-chat-starters');
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
		const bubbles = els.messages.querySelectorAll<HTMLElement>('.blemmy-chat-bubble--system');
		const last = bubbles.length > 0
			? bubbles[bubbles.length - 1]?.innerText.trim()
			: '';
		if (last === status) { return; }
		appendMessage('system', status);
	}

	function refreshSourceBadge(): void {
		const badge = document.getElementById('blemmy-chat-source-badge') as HTMLElement | null;
		if (!badge) { return; }
		if (sourceMeta) {
			badge.textContent = '';
			badge.hidden      = false;

			// Short filename label
			const nameSpan       = document.createElement('span');
			nameSpan.textContent = `📄 ${sourceMeta.filename}`;
			nameSpan.className   = 'blemmy-chat-source-badge__name';

			// Clear button
			const clearBtn       = document.createElement('button');
			clearBtn.type        = 'button';
			clearBtn.className   = 'blemmy-chat-source-badge__clear';
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
		const startersEl = document.getElementById('blemmy-chat-starters');
		if (!startersEl) { return; }
		startersEl.innerHTML = '';

		const docType = activeDocType();
		const docData = activeDocData();
		if (!docData || history.length > 0) {
			startersEl.hidden = true;
			return;
		}

		const layout      = readLayoutState();
		const onboarding  = docType === 'cv'
			? isDefaultCvData(docData as CVData)
			: false;
		const suggestions = onboarding
			? buildOnboardingStarters()
			: buildStarterSuggestionsForDoc(
				docType,
				docData,
				layout,
				sourceText !== null,
			);

		startersEl.hidden = false;
		startersEl.appendChild(
			h('p', { class: 'blemmy-chat-starters__label' },
				onboarding ? 'Create your CV' : 'Suggestions',
			),
		);

		for (const suggestion of suggestions) {
			// The upload starter is a special case — trigger file picker
			const isUploadSuggestion = suggestion.startsWith('Upload');

			const btn = h('button', {
				type:  'button',
				class: 'blemmy-chat-starter-btn' + (isUploadSuggestion ? ' blemmy-chat-starter-btn--upload' : ''),
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
		const startersEl = document.getElementById('blemmy-chat-starters');
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
				finalise(
					loadAssistantApplyMode() === 'review'
						? 'Proposed CV JSON — review fields below, then click Apply included.'
						: 'Prepared CV JSON and applied it automatically.',
					false,
				);
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
		bubble.className = `blemmy-chat-bubble blemmy-chat-bubble--${role}`;

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
		bubble.className = 'blemmy-chat-bubble blemmy-chat-bubble--assistant blemmy-chat-bubble--streaming';
		const cursor    = document.createElement('span');
		cursor.className = 'blemmy-chat-cursor';
		bubble.appendChild(cursor);
		els.messages.appendChild(bubble);

		let accumulated = '';

		function appendChunk(text: string): void {
			accumulated += text;
			// Replace the cursor-only content with the growing markdown
			bubble.innerHTML = '';
			bubble.appendChild(renderMarkdown(accumulated));
			const c2 = document.createElement('span');
			c2.className = 'blemmy-chat-cursor';
			bubble.appendChild(c2);
			els.messages.scrollTop = els.messages.scrollHeight;
		}

		function finalise(full: string, showApplyButton = true): void {
			bubble.classList.remove('blemmy-chat-bubble--streaming');
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
		if (skills && typeof skills === 'object' && !Array.isArray(skills)) {
			const s = skills as Record<string, unknown>;
			for (const k of Object.keys(s)) {
				s[k] = toTextList(s[k]);
			}
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

	function parseAssistantJsonPayload(raw: string): {
		docType: string;
		validated: StoredDocumentData;
		current: unknown;
	} {
		const parsed = JSON.parse(raw) as unknown;
		const docType = activeDocType();
		const current = getActiveDocumentData();
		const isRecord = (v: unknown): v is Record<string, unknown> =>
			Boolean(v) && typeof v === 'object' && !Array.isArray(v);
		const mergePatch = (base: unknown, patch: unknown): unknown => {
			if (Array.isArray(patch)) {
				return patch;
			}
			if (!isRecord(base) || !isRecord(patch)) {
				return patch;
			}
			const out: Record<string, unknown> = { ...base };
			for (const [k, v] of Object.entries(patch)) {
				out[k] = mergePatch((base as Record<string, unknown>)[k], v);
			}
			return out;
		};
		const merged = current ? mergePatch(current, parsed) : parsed;
		const fixed = docType === 'cv' ? coerceCvPayload(merged) : merged;
		let validated = validateDocumentByType(docType, fixed) as StoredDocumentData;
		if (docType === 'cv' && isLikelyCvData(validated)) {
			const newData = validated as CVData;
			const prev = isLikelyCvData(current) ? current : null;
			const keepUrl = prev?.basics.portraitDataUrl;
			if (keepUrl && !newData.basics.portraitDataUrl) {
				newData.basics = { ...newData.basics, portraitDataUrl: keepUrl };
			}
			const keepSha = prev?.basics.portraitSha256;
			if (keepSha && !newData.basics.portraitSha256) {
				newData.basics = { ...newData.basics, portraitSha256: keepSha };
			}
			validated = newData;
		}
		return { docType, validated, current };
	}

	function renderPendingAssistantApplyPanel(): void {
		const host = els.pendingApply;
		host.innerHTML = '';
		if (!pendingAssistantApply) {
			host.hidden = true;
			return;
		}
		host.hidden = false;
		const p = pendingAssistantApply;

		const title = h(
			'p',
			{ class: 'blemmy-chat-pending-apply__title' },
			'Proposed document changes',
		);
		const meta = h('p', { class: 'blemmy-chat-pending-apply__meta' }, '');
		function syncMeta(): void {
			const nAcc = countAcceptedChanges(p.leafChanges, pendingRejectedPaths);
			meta.textContent = p.truncated
				? `Showing first ${p.leafChanges.length} fields (limit). ${nAcc} included.`
				: `${p.leafChanges.length} field(s); ${nAcc} included.`;
		}
		syncMeta();

		const actions = h('div', { class: 'blemmy-chat-pending-apply__actions' });
		const btnAll = h(
			'button',
			{ type: 'button', class: 'blemmy-chat-pending-apply__btn' },
			'Include all',
		) as HTMLButtonElement;
		const btnNone = h(
			'button',
			{ type: 'button', class: 'blemmy-chat-pending-apply__btn' },
			'Exclude all',
		) as HTMLButtonElement;
		const btnApply = h(
			'button',
			{
				type: 'button',
				class: 'blemmy-chat-pending-apply__btn blemmy-chat-pending-apply__btn--primary',
			},
			'Apply included',
		) as HTMLButtonElement;
		const btnDiscard = h(
			'button',
			{ type: 'button', class: 'blemmy-chat-pending-apply__btn' },
			'Discard',
		) as HTMLButtonElement;

		btnAll.addEventListener('click', () => {
			pendingRejectedPaths.clear();
			renderPendingAssistantApplyPanel();
		});
		btnNone.addEventListener('click', () => {
			pendingRejectedPaths.clear();
			for (const c of p.leafChanges) {
				pendingRejectedPaths.add(c.path);
			}
			renderPendingAssistantApplyPanel();
		});
		btnDiscard.addEventListener('click', () => {
			pendingAssistantApply = null;
			pendingRejectedPaths.clear();
			renderPendingAssistantApplyPanel();
			appendMessage('system', 'Discarded proposed changes.');
		});
		btnApply.addEventListener('click', () => {
			try {
				const n = countAcceptedChanges(p.leafChanges, pendingRejectedPaths);
				if (n === 0) {
					appendMessage('system', 'No changes selected to apply.');
					return;
				}
				const merged = buildDocumentFromLeafSelection(
					p.docType,
					p.baseSnapshot,
					p.leafChanges,
					pendingRejectedPaths,
				);
				const cur = getActiveDocumentData();
				recordDocumentApplyHistory(
					cur as StoredDocumentData | undefined,
					merged,
					true,
				);
				window.__blemmyRemountDocument__?.(merged, p.docType);
				pendingAssistantApply = null;
				pendingRejectedPaths.clear();
				renderPendingAssistantApplyPanel();
				appendMessage('system', `✓ Applied ${n} change(s).`);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				appendMessage('system', `✗ Could not apply: ${msg}`);
			}
		});

		actions.append(btnAll, btnNone, btnApply, btnDiscard);

		const groups = new Map<string, LeafChange[]>();
		for (const c of p.leafChanges) {
			const g = c.path.split('.')[0] ?? 'other';
			const list = groups.get(g) ?? [];
			list.push(c);
			groups.set(g, list);
		}
		const groupKeys = [...groups.keys()].sort();
		const listEl = h('div', { class: 'blemmy-chat-pending-apply__groups' });
		for (const gk of groupKeys) {
			const changes = groups.get(gk) ?? [];
			const sec = h('section', { class: 'blemmy-chat-pending-apply__group' });
			sec.appendChild(
				h('h4', { class: 'blemmy-chat-pending-apply__group-title' }, gk),
			);
			const ul = h('ul', { class: 'blemmy-chat-pending-apply__list' });
			for (const c of changes) {
				const row = h('li', { class: 'blemmy-chat-pending-apply__row' });
				const included = !pendingRejectedPaths.has(c.path);
				const label = h('label', { class: 'blemmy-chat-pending-apply__row-label' });
				const cbAttrs: Record<string, string> = {
					type: 'checkbox',
					'data-path': c.path,
				};
				if (included) {
					cbAttrs.checked = 'checked';
				}
				const cb = h('input', cbAttrs) as HTMLInputElement;
				const span = h(
					'span',
					{ class: 'blemmy-chat-pending-apply__path' },
					c.path,
				);
				const preRow = h('div', { class: 'blemmy-chat-pending-apply__diff' });
				preRow.append(
					h('span', { class: 'blemmy-chat-pending-apply__before' }, c.before),
					h('span', { class: 'blemmy-chat-pending-apply__arrow' }, ' → '),
					h('span', { class: 'blemmy-chat-pending-apply__after' }, c.after),
				);
				label.append(cb, span);
				row.append(label, preRow);
				ul.appendChild(row);
				cb.addEventListener('change', () => {
					if (cb.checked) {
						pendingRejectedPaths.delete(c.path);
					} else {
						pendingRejectedPaths.add(c.path);
					}
					syncMeta();
				});
			}
			sec.appendChild(ul);
			listEl.appendChild(sec);
		}

		host.append(title, meta, actions, listEl);
	}

	function clearPendingAssistantApplyOnDocSwitch(): void {
		if (!pendingAssistantApply) {
			return;
		}
		pendingAssistantApply = null;
		pendingRejectedPaths.clear();
		renderPendingAssistantApplyPanel();
	}

	function stageAssistantJson(raw: string, fromGenerated = false): void {
		try {
			const { docType, validated, current } = parseAssistantJsonPayload(raw);
			if (current == null) {
				applyJsonImmediate(raw, fromGenerated);
				return;
			}
			const baseSnap = cloneDocumentData(current as StoredDocumentData);
			let leafChanges = computeLeafDiffBetweenDocuments(baseSnap, validated);
			let truncated = false;
			if (leafChanges.length > PENDING_ASSISTANT_LEAF_LIMIT) {
				truncated = true;
				leafChanges = leafChanges.slice(0, PENDING_ASSISTANT_LEAF_LIMIT);
			}
			if (leafChanges.length === 0) {
				appendMessage(
					'system',
					'No field-level differences — nothing to review.',
				);
				return;
			}
			pendingRejectedPaths.clear();
			pendingAssistantApply = {
				docType,
				baseSnapshot: baseSnap,
				proposedSnapshot: validated,
				leafChanges,
				truncated,
			};
			renderPendingAssistantApplyPanel();
			appendMessage(
				'system',
				fromGenerated
					? 'Proposed document is ready for review — adjust inclusions below, then Apply included.'
					: 'Proposed changes are ready for review.',
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			appendMessage('system', `✗ Could not stage changes: ${msg}`);
		}
	}

	function applyJsonImmediate(raw: string, isGenerated = false): void {
		try {
			const { docType, validated, current } = parseAssistantJsonPayload(raw);
			recordDocumentApplyHistory(
				current as StoredDocumentData | undefined,
				validated,
				true,
			);
			window.__blemmyRemountDocument__?.(validated, docType);
			appendMessage(
				'system',
				isGenerated
					? '✓ Document created. Review it and use edit mode to make adjustments. Download it as JSON to save.'
					: '✓ Document updated successfully.',
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			appendMessage('system', `✗ Could not apply changes: ${msg}`);
		}
	}

	function applyJson(raw: string, isGenerated = false): void {
		if (loadAssistantApplyMode() === 'review') {
			stageAssistantJson(raw, isGenerated);
		} else {
			applyJsonImmediate(raw, isGenerated);
		}
	}

	function applyReviewOps(raw: string): void {
		try {
			const ops = JSON.parse(raw) as CommentOperation[];
			const rawDoc = getActiveDocumentData();
			const cv = isLikelyCvData(rawDoc) ? rawDoc : null;
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
		const startersEl = document.getElementById('blemmy-chat-starters');
		if (startersEl) { startersEl.hidden = true; }

		els.input.value = '';
		els.input.style.height = '';
		history.push({ role: 'user', content: text });
		appendMessage('user', text);

		isStreaming = true;
		els.sendBtn.disabled = true;

		const docType = activeDocType();
		const docData = activeDocData();
		const layout = readLayoutState();
		const liveForReview = getActiveDocumentData();
		const onboarding = docType === 'cv'
			? (docData ? isDefaultCvData(docData as CVData) : true)
			: false;
		const route: RoutedContext = routeChatContext({
			message: text,
			onboarding,
			hasSourceText: sourceText !== null,
			selectedPaths: Array.from(selectedPaths),
			reviewPaths: activeReviewPaths(),
		});
		const looksLikeGen = onboarding && (
			text.length > 200 ||
			/\b(I|my|worked|studied|graduated|years?)\b/i.test(text)
		);
		const sysPr = looksLikeGen
			? buildGenerateSystemPrompt()
			: (docData
				? buildRoutedSystemPrompt({
					docType,
					docData,
					layout,
					sourceText: route.includeSource ? sourceText ?? undefined : undefined,
					review: isLikelyCvData(liveForReview)
						? liveForReview.review
						: undefined,
					contextMode: route.contextMode,
					scopedPaths: route.scopedPaths,
					includeReview: route.includeReview,
				})
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
			const expectsJson = route.expectedBlock === 'json';
			const expectsStyle = route.expectedBlock === 'style';
			const expectsReview = route.expectedBlock === 'review';
			const modeMismatch =
				(expectsJson && !jsonRaw) ||
				(expectsStyle && !styleRaw2) ||
				(expectsReview && !reviewRaw);
			const autoApply = Boolean(jsonRaw && wantsApply && !expectsStyle && !expectsReview);
			if (autoApply) {
				finalise(
					loadAssistantApplyMode() === 'review'
						? 'Proposed document changes — review them in the panel below before applying.'
						: 'Applied the proposed document changes automatically.',
					false,
				);
			} else {
				finalise(fullText, true);
			}
			history.push({ role: 'assistant', content: fullText });

			// Auto-apply if the response contains exactly one JSON block
			// and the user's message contained an apply-intent keyword
			if (jsonRaw && wantsApply && !expectsStyle && !expectsReview) {
				applyJson(jsonRaw);
			}
			if (styleRaw2 && !expectsJson) { applyStylePatch(styleRaw2); }
			if (reviewRaw && !expectsJson && !expectsStyle) { applyReviewOps(reviewRaw); }
			if (modeMismatch) {
				appendMessage('system',
					'⚠ Response did not match expected format for this request. Ask again or specify "return json/style/review".');
			}

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

	document.addEventListener('click', (event) => {
		if (els.panel.hidden) { return; }
		const target = event.target as HTMLElement | null;
		if (!target) { return; }
		if (target.closest('#blemmy-chat-panel')) { return; }
		if (target.closest('.blemmy-mobile-utility-bar')) { return; }
		const path = resolvePathFromTarget(target);
		if (!path) { return; }
		selectedPaths.has(path)
			? selectedPaths.delete(path)
			: selectedPaths.add(path);
		renderScopeBar();
	});

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

	const copyChatBtn = els.panel.querySelector('#blemmy-chat-copy') as HTMLButtonElement | null;
	copyChatBtn?.addEventListener('click', async () => {
		const lines: string[] = [];
		const bubbles = els.messages.querySelectorAll<HTMLElement>('.blemmy-chat-bubble');
		for (const bubble of bubbles) {
			const text = bubble.innerText.trim();
			if (!text) { continue; }
			if (bubble.classList.contains('blemmy-chat-bubble--user')) {
				lines.push(`User: ${text}`);
				continue;
			}
			if (bubble.classList.contains('blemmy-chat-bubble--assistant')) {
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
	const closeBtn = els.panel.querySelector('#blemmy-chat-close') as HTMLButtonElement | null;
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
		renderScopeBar();
		appendConnectionStatusMessage();
		dispatchDockedPanelOpen('blemmy-chat-panel');
		window.dispatchEvent(new Event(CHAT_OPEN_EVENT));
		if (!cfg) {
			keyField?.focus();
		} else {
			els.input.focus();
		}
	}

	function closePanel(): void {
		els.panel.hidden = true;
		clearScopedHighlight();
		dispatchDockedPanelClose('blemmy-chat-panel');
		window.dispatchEvent(new Event(CHAT_CLOSE_EVENT));
	}

	// ── Toggle button ─────────────────────────────────────────────────────────

	const trigger = h('button', {
		id:           DOCK_CONTROLS.chat.id,
		class:        'blemmy-chat-trigger blemmy-dock-btn no-print',
		type:         'button',
		'aria-label': DOCK_CONTROLS.chat.ariaLabel,
		'aria-expanded': 'false',
		'aria-controls': 'blemmy-chat-panel',
		title:        DOCK_CONTROLS.chat.title,
		'data-icon':  DOCK_CONTROLS.chat.icon,
	}, DOCK_CONTROLS.chat.label);
	popover = initDockedPopover({
		panel: els.panel,
		trigger,
		openClass: 'blemmy-chat-trigger--open',
		group: 'right-docked-panels',
		marginPx: 12,
		outsideCloseGuard: (target: Node) => {
			if (!(target instanceof HTMLElement)) { return false; }
			return Boolean(
				target.closest(
					'[data-blemmy-field], [data-blemmy-field], .experience-block, .education-item',
				),
			);
		},
		onOpen: openPanel,
		onClose: closePanel,
	});
	popover.refreshViewportFit();

	// Refresh starters when CV changes (filter toggle, edit, upload)
	window.addEventListener('blemmy-layout-applied', () => {
		renderScopeBar();
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

	window.addEventListener(BLEMMY_ACTIVE_DOCUMENT_CHANGED, () => {
		clearPendingAssistantApplyOnDocSwitch();
	});

	// Initial state
	refreshSetupState();

	return { panel: els.panel, toggle: trigger };
}
