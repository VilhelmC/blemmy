/**
 * Whether assistant-returned document JSON is applied immediately or staged
 * for per-field review (see docs/phase-3-change-review-plan.md).
 */

export type AssistantApplyMode = 'auto' | 'review';

const STORAGE_KEY = 'blemmy-assistant-apply-mode';

export const ASSISTANT_APPLY_MODE_CHANGED_EVENT = 'blemmy-assistant-apply-mode-changed';

export type AssistantApplyModeChangedDetail = { mode: AssistantApplyMode };

const DEFAULT_MODE: AssistantApplyMode = 'auto';

function isMode(v: unknown): v is AssistantApplyMode {
	return v === 'auto' || v === 'review';
}

export function loadAssistantApplyMode(): AssistantApplyMode {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (isMode(raw)) {
			return raw;
		}
	} catch { /* ignore */ }
	return DEFAULT_MODE;
}

export function saveAssistantApplyMode(mode: AssistantApplyMode): void {
	try {
		localStorage.setItem(STORAGE_KEY, mode);
	} catch { /* ignore */ }
	window.dispatchEvent(
		new CustomEvent<AssistantApplyModeChangedDetail>(
			ASSISTANT_APPLY_MODE_CHANGED_EVENT,
			{ detail: { mode } },
		),
	);
}
