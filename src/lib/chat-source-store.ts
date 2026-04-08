/**
 * Persist chat “source material” (uploaded background document) in localStorage.
 *
 * Keys: blemmy-source-text / blemmy-source-meta (legacy blemmy-source-* migrated on read).
 */

import {
	BLEMMY_SOURCE_META_KEY,
	BLEMMY_SOURCE_TEXT_KEY,
	LEGACY_CV_SOURCE_META_KEY,
	LEGACY_CV_SOURCE_TEXT_KEY,
} from '@lib/blemmy-storage-keys';

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
		localStorage.setItem(BLEMMY_SOURCE_TEXT_KEY, text);
		localStorage.setItem(BLEMMY_SOURCE_META_KEY, JSON.stringify(meta));
		localStorage.removeItem(LEGACY_CV_SOURCE_TEXT_KEY);
		localStorage.removeItem(LEGACY_CV_SOURCE_META_KEY);
	} catch {
		// Storage quota — fail silently; this session still has in-memory text
	}
}

export function loadSource(): { text: string; meta: SourceMeta } | null {
	try {
		let text = localStorage.getItem(BLEMMY_SOURCE_TEXT_KEY);
		let raw  = localStorage.getItem(BLEMMY_SOURCE_META_KEY);
		if (!text || !raw) {
			const lt = localStorage.getItem(LEGACY_CV_SOURCE_TEXT_KEY);
			const lr = localStorage.getItem(LEGACY_CV_SOURCE_META_KEY);
			if (lt && lr) {
				text = lt;
				raw  = lr;
				localStorage.setItem(BLEMMY_SOURCE_TEXT_KEY, lt);
				localStorage.setItem(BLEMMY_SOURCE_META_KEY, lr);
				localStorage.removeItem(LEGACY_CV_SOURCE_TEXT_KEY);
				localStorage.removeItem(LEGACY_CV_SOURCE_META_KEY);
			}
		}
		if (!text || !raw) { return null; }
		return { text, meta: JSON.parse(raw) as SourceMeta };
	} catch {
		return null;
	}
}

export function clearSource(): void {
	try {
		localStorage.removeItem(BLEMMY_SOURCE_TEXT_KEY);
		localStorage.removeItem(BLEMMY_SOURCE_META_KEY);
		localStorage.removeItem(LEGACY_CV_SOURCE_TEXT_KEY);
		localStorage.removeItem(LEGACY_CV_SOURCE_META_KEY);
	} catch { /* ignore */ }
}

export function hasSource(): boolean {
	try {
		return (
			localStorage.getItem(BLEMMY_SOURCE_TEXT_KEY) !== null ||
			localStorage.getItem(LEGACY_CV_SOURCE_TEXT_KEY) !== null
		);
	} catch {
		return false;
	}
}

// ─── Change listeners ─────────────────────────────────────────────────────────

export const SOURCE_CHANGED_EVENT = 'blemmy-source-changed';

export type SourceChangedDetail =
	| { action: 'saved';   meta: SourceMeta }
	| { action: 'cleared' };

export function dispatchSourceChanged(detail: SourceChangedDetail): void {
	window.dispatchEvent(
		new CustomEvent<SourceChangedDetail>(SOURCE_CHANGED_EVENT, { detail }),
	);
}
