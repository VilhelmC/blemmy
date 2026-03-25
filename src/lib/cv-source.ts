/**
 * cv-source.ts
 *
 * Persists uploaded source material (the background document a user uploads
 * to generate or enrich their CV) in localStorage.
 *
 * The source is stored separately from the CV JSON so it survives:
 *   - CV edits and re-uploads
 *   - JSON downloads and re-imports
 *   - Page refreshes
 *
 * It is cleared only when the user explicitly removes it.
 *
 * The source text is included in the chat system prompt in edit mode so the
 * assistant can make suggestions based on information not yet on the CV.
 */

const STORAGE_KEY       = 'cv-source-text';
const STORAGE_META_KEY  = 'cv-source-meta';

export type SourceMeta = {
	/** Original filename */
	filename: string;
	/** File format / extension */
	format:   string;
	/** Character count of extracted text */
	charCount: number;
	/** ISO timestamp when the source was saved */
	savedAt:  string;
};

// ─── Persistence ──────────────────────────────────────────────────────────────

export function saveSource(text: string, meta: SourceMeta): void {
	try {
		localStorage.setItem(STORAGE_KEY,      text);
		localStorage.setItem(STORAGE_META_KEY, JSON.stringify(meta));
	} catch {
		// localStorage quota — source text can be large; fail silently
		// The text will still be used for this session via the in-memory path
	}
}

export function loadSource(): { text: string; meta: SourceMeta } | null {
	try {
		const text = localStorage.getItem(STORAGE_KEY);
		const raw  = localStorage.getItem(STORAGE_META_KEY);
		if (!text || !raw) { return null; }
		return { text, meta: JSON.parse(raw) as SourceMeta };
	} catch {
		return null;
	}
}

export function clearSource(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
		localStorage.removeItem(STORAGE_META_KEY);
	} catch { /* ignore */ }
}

export function hasSource(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) !== null;
	} catch {
		return false;
	}
}

// ─── Change listeners ─────────────────────────────────────────────────────────

export const SOURCE_CHANGED_EVENT = 'cv-source-changed';

export type SourceChangedDetail =
	| { action: 'saved';   meta: SourceMeta }
	| { action: 'cleared' };

export function dispatchSourceChanged(detail: SourceChangedDetail): void {
	window.dispatchEvent(
		new CustomEvent<SourceChangedDetail>(SOURCE_CHANGED_EVENT, { detail }),
	);
}
