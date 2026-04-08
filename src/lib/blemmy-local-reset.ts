/**
 * Clears browser persistence so the next `loadCvData()` / `loadLetterData()`
 * read returns bundled JSON.
 */

import {
	BLEMMY_APP_SESSION_STATE_KEY,
	LEGACY_CV_APP_SESSION_STATE_KEY,
} from '@lib/blemmy-storage-keys';
import {
	clearLegacyPortraitStorage,
	clearUploadedCvData,
} from '@lib/profile-data-loader';
import {
	dispatchSourceChanged,
	clearSource,
} from '@lib/chat-source-store';
import { clearLetterData } from '@lib/composer-data-loader';
import { clearDraft } from '@renderer/profile-editor';

/** UI teardown before {@link resetBundledDocumentCaches} + in-app remount. */
export const BLEMMY_RESET_BUNDLED_UI_EVENT = 'blemmy-reset-bundled-defaults';

export function prepareBundledDefaultsResetUi(): void {
	window.dispatchEvent(new Event(BLEMMY_RESET_BUNDLED_UI_EVENT));
}

/**
 * Best-effort wipe of document-related caches. Does not remount the document.
 * Does not clear blemmy-portrait-cache — reuse after reset to bundled JSON.
 */
export function resetBundledDocumentCaches(): void {
	clearDraft();
	clearLetterData();
	clearSource();
	dispatchSourceChanged({ action: 'cleared' });
	clearLegacyPortraitStorage();
	try {
		localStorage.removeItem(BLEMMY_APP_SESSION_STATE_KEY);
		localStorage.removeItem(LEGACY_CV_APP_SESSION_STATE_KEY);
	} catch {
		/* ignore */
	}
	clearUploadedCvData({ notify: false });
}
