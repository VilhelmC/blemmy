import type { CVData } from '@cv/cv';

type AuditPayload = Record<string, unknown>;
type AuditEntry = {
	ts: number;
	event: string;
	payload: AuditPayload;
};

const MAX_ENTRIES = 300;
const entries: AuditEntry[] = [];
let badgeReady = false;

function canUseStorage(): boolean {
	try {
		return typeof window !== 'undefined' && !!window.localStorage;
	} catch {
		return false;
	}
}

function isEnabledByQuery(): boolean {
	try {
		const p = new URLSearchParams(window.location.search);
		return p.get('debug-layout') === '1';
	} catch {
		return false;
	}
}

function isEnabledByStorage(): boolean {
	if (!canUseStorage()) { return false; }
	try {
		return localStorage.getItem('cv-debug-layout') === '1';
	} catch {
		return false;
	}
}

export function isLayoutAuditEnabled(): boolean {
	return isEnabledByQuery() || isEnabledByStorage();
}

export function initLayoutAuditUi(): void {
	if (!isLayoutAuditEnabled()) { return; }
	ensureDebugBadge();
}

export function hashAuditState(value: unknown): string {
	const src = JSON.stringify(value ?? null);
	let h = 2166136261;
	for (let i = 0; i < src.length; i++) {
		h ^= src.charCodeAt(i);
		h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

export function layoutAuditLog(event: string, payload: AuditPayload = {}): void {
	if (!isLayoutAuditEnabled()) { return; }
	entries.push({ ts: Date.now(), event, payload });
	if (entries.length > MAX_ENTRIES) {
		entries.splice(0, entries.length - MAX_ENTRIES);
	}
	ensureDebugBadge();
	console.info('[layout-audit]', event, payload);
}

function cvForAuditHash(cv: CVData): unknown {
	const url = cv.basics.portraitDataUrl;
	const sha = cv.basics.portraitSha256;
	if (!url && !sha) {
		return cv;
	}
	return {
		...cv,
		basics: {
			...cv.basics,
			...(url ? { portraitDataUrl: `[${url.length} chars]` } : {}),
			...(sha ? { portraitSha256: '[sha256]' } : {}),
		},
	};
}

export function hashCvForAudit(cv: CVData | null | undefined): string {
	if (!cv) { return 'none'; }
	return hashAuditState(cvForAuditHash(cv));
}

function ensureDebugBadge(): void {
	if (badgeReady || typeof document === 'undefined') { return; }
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.id = 'cv-layout-debug-badge';
	btn.className = 'cv-layout-debug-badge no-print';
	btn.textContent = 'Copy layout debug';
	btn.title = 'Copy layout audit trace to clipboard';
	btn.addEventListener('click', async () => {
		const card = document.getElementById('cv-card');
		const snapshot = {
			generatedAt: new Date().toISOString(),
			url: typeof location !== 'undefined' ? location.href : '',
			card: {
				pages: card?.dataset.cvPages ?? '',
				disposition: card?.dataset.cvDisposition ?? '',
				winnerId: card?.dataset.cvWinnerId ?? '',
				pagePreference: card?.dataset.cvPagePreference ?? '',
				workItemsCount: card?.dataset.cvWorkItemsCount ?? '',
				candidatesTotal: card?.dataset.cvCandidatesTotal ?? '',
				scoredTotal: card?.dataset.cvScoredTotal ?? '',
			},
			entries,
		};
		const text = JSON.stringify(snapshot, null, 2);
		try {
			await navigator.clipboard.writeText(text);
			btn.textContent = 'Copied';
			setTimeout(() => { btn.textContent = 'Copy layout debug'; }, 1200);
		} catch {
			btn.textContent = 'Copy failed';
			setTimeout(() => { btn.textContent = 'Copy layout debug'; }, 1400);
		}
	});
	document.body.appendChild(btn);
	badgeReady = true;
}

