import {
	CLOUD_ENABLED,
	loadActiveDocumentId,
	saveActiveDocumentId,
	saveVersion,
	type CloudDocument,
	type StoredDocumentData,
} from '@lib/cloud-client';

export type SyncStatus = 'idle' | 'clean' | 'dirty' | 'saving' | 'error' | 'offline';
export type SyncState = {
	status: SyncStatus;
	documentId: string | null;
	documentName: string | null;
	documentType: string | null;
	lastSaved: Date | null;
	errorMsg: string | null;
};

let state: SyncState = {
	status: CLOUD_ENABLED ? 'idle' : 'offline',
	documentId: loadActiveDocumentId(),
	documentName: null,
	documentType: null,
	lastSaved: null,
	errorMsg: null,
};
const listeners = new Set<(s: SyncState) => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingData: StoredDocumentData | null = null;
let pendingDocType: string | null = null;
const AUTOSAVE_DELAY_MS = 5000;

function setState(patch: Partial<SyncState>): void {
	state = { ...state, ...patch };
	for (const fn of listeners) { fn(state); }
}

export function getSyncState(): SyncState { return state; }

export function onSyncStateChange(fn: (s: SyncState) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function scheduleSave(
	data: StoredDocumentData,
	docType?: string,
): void {
	if (!CLOUD_ENABLED || !state.documentId) { return; }
	pendingData = data;
	pendingDocType = docType ?? state.documentType ?? 'document';
	setState({ status: 'dirty' });
	if (saveTimer) { clearTimeout(saveTimer); }
	saveTimer = setTimeout(() => { void flushSave(); }, AUTOSAVE_DELAY_MS);
}

export async function flushSave(): Promise<void> {
	if (!pendingData || !state.documentId) { return; }
	if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
	const data = pendingData;
	const docType = pendingDocType ?? state.documentType ?? 'document';
	pendingData = null;
	pendingDocType = null;
	setState({ status: 'saving' });
	const res = await saveVersion(state.documentId, data, docType);
	if (res.ok) {
		setState({ status: 'clean', lastSaved: new Date(), errorMsg: null });
		return;
	}
	setState({ status: 'error', errorMsg: res.error.message });
}

export function openDocument(doc: CloudDocument): void {
	pendingData = null;
	pendingDocType = null;
	if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
	saveActiveDocumentId(doc.id);
	setState({
		status: 'clean',
		documentId: doc.id,
		documentName: doc.name,
		documentType: doc.doc_type || 'document',
		lastSaved: new Date(doc.updated_at),
		errorMsg: null,
	});
}

export function closeDocument(): void {
	if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
	pendingData = null;
	pendingDocType = null;
	setState({
		status: 'idle',
		documentId: null,
		documentName: null,
		documentType: null,
		lastSaved: null,
		errorMsg: null,
	});
}

export function initBeforeUnloadGuard(): void {
	window.addEventListener('beforeunload', () => {
		void flushSave();
	});
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			void flushSave();
		}
	});
}

