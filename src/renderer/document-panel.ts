import type { CVData } from '@cv/cv';
import { validateCvData } from '@lib/cv-loader';
import {
	CLOUD_ENABLED,
	createShare,
	createDocument,
	deleteDocument,
	listDocuments,
	listShares,
	listVersions,
	loadVersion,
	renameDocument,
	revokeShare,
	type CloudDocument,
	type CloudShare,
	type CloudVersion,
} from '@lib/cv-cloud';
import { AUTH_CHANGED_EVENT, type AuthChangedDetail } from '@renderer/auth-panel';
import {
	closeDocument,
	flushSave,
	getSyncState,
	onSyncStateChange,
	openDocument,
	scheduleSave,
} from '@lib/cv-sync';

function h(
	tag: string,
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

export type DocumentPanelOptions = {
	mount: HTMLElement;
	closeDrawer?: () => void;
	setSyncIndicator?: (shortLabel: string, title: string) => void;
};

export function initDocumentPanel(
	remount: (data: CVData) => void,
	opts: DocumentPanelOptions,
): {
	onDataChange: (data: CVData) => void;
	refreshDocs: () => Promise<void>;
} {
	const { mount, closeDrawer, setSyncIndicator } = opts;
	const SHARE_EXPIRY_PREF_KEY = 'cv-share-expiry-days';
	if (!CLOUD_ENABLED) {
		mount.appendChild(
			h('p', { class: 'cv-cloud-drawer__muted' }, 'Cloud docs disabled (.env not configured).'),
		);
		return { onDataChange: () => { /* noop */ }, refreshDocs: async () => { /* noop */ } };
	}
	const list = h('div', { id: 'cv-doc-list' });
	const status = h('p', { id: 'cv-doc-status', class: 'cv-doc-status', hidden: '' });
	const newBtn = h(
		'button',
		{
			type: 'button',
			class: 'cv-doc-btn',
			title: 'Create a new cloud document from current CV',
			'aria-label': 'Create new cloud document',
		},
		'+ New',
	);
	const saveBtn = h(
		'button',
		{
			type: 'button',
			class: 'cv-doc-btn',
			title: 'Save current CV to the active cloud document now',
			'aria-label': 'Save current cloud document now',
		},
		'Save now',
	);
	mount.append(status, newBtn, saveBtn, list);
	let docs: CloudDocument[] = [];
	let authed = false;
	function setStatus(text: string, isErr = false): void {
		status.textContent = text;
		status.hidden = !text;
		status.className = 'cv-doc-status' + (isErr ? ' cv-doc-status--error' : '');
	}
	function rel(iso: string): string {
		const d = (Date.now() - new Date(iso).getTime()) / 1000;
		if (d < 60) { return 'now'; }
		if (d < 3600) { return `${Math.floor(d / 60)}m`; }
		if (d < 86400) { return `${Math.floor(d / 3600)}h`; }
		return `${Math.floor(d / 86400)}d`;
	}
	async function openDoc(doc: CloudDocument): Promise<void> {
		if (!doc.latest) { setStatus('No versions for document', true); return; }
		try {
			const cv = validateCvData(doc.latest);
			openDocument(doc);
			remount(cv);
			closeDrawer?.();
		} catch (err) {
			setStatus(err instanceof Error ? err.message : 'Invalid CV', true);
		}
	}
	function renderDocs(): void {
		list.innerHTML = '';
		if (docs.length === 0) {
			list.appendChild(h('p', {}, 'No documents yet.'));
			return;
		}
		for (const doc of docs) {
			const row = h('div', { class: 'cv-doc-row' });
			const openBtn = h(
				'button',
				{
					type: 'button',
					class: 'cv-doc-row__name',
					title: `Open "${doc.name}"`,
					'aria-label': `Open document ${doc.name}`,
				},
				doc.name,
			);
			openBtn.addEventListener('click', () => { void openDoc(doc); });
			const renameBtn = h(
				'button',
				{
					type: 'button',
					class: 'cv-doc-row__action',
					title: `Rename "${doc.name}"`,
					'aria-label': `Rename document ${doc.name}`,
				},
				'✎',
			);
			renameBtn.addEventListener('click', async () => {
				const next = prompt('Rename document', doc.name)?.trim();
				if (!next || next === doc.name) { return; }
				const r = await renameDocument(doc.id, next);
				if (!r.ok) { setStatus(r.error.message, true); return; }
				doc.name = next;
				renderDocs();
			});
			const delBtn = h(
				'button',
				{
					type: 'button',
					class: 'cv-doc-row__action',
					title: `Delete "${doc.name}"`,
					'aria-label': `Delete document ${doc.name}`,
				},
				'×',
			);
			delBtn.addEventListener('click', async () => {
				if (!confirm(`Delete "${doc.name}"?`)) { return; }
				const r = await deleteDocument(doc.id);
				if (!r.ok) { setStatus(r.error.message, true); return; }
				docs = docs.filter((d) => d.id !== doc.id);
				renderDocs();
			});
			const historyBtn = h(
				'button',
				{
					type: 'button',
					class: 'cv-doc-row__action',
					title: `Open latest version from "${doc.name}" history`,
					'aria-label': `Open latest version from history for document ${doc.name}`,
				},
				'⏱',
			);
			const shareBtn = h(
				'button',
				{
					type: 'button',
					class: 'cv-doc-row__action',
					title: `Manage share links for "${doc.name}"`,
					'aria-label': `Manage share links for document ${doc.name}`,
				},
				'↗',
			);
			shareBtn.addEventListener('click', () => { void openShareDialog(doc); });
			historyBtn.addEventListener('click', async () => {
				const r = await listVersions(doc.id);
				if (!r.ok) { setStatus(r.error.message, true); return; }
				const first = (r.data as CloudVersion[])[0];
				if (!first) { setStatus('No versions found.'); return; }
				const loaded = await loadVersion(first.id);
				if (!loaded.ok) { setStatus(loaded.error.message, true); return; }
				try {
					const cv = validateCvData(loaded.data);
					remount(cv);
					openDocument(doc);
					closeDrawer?.();
				} catch {
					setStatus('Version is invalid', true);
				}
			});
			row.append(
				openBtn,
				h('span', { class: 'cv-doc-row__meta' }, rel(doc.updated_at)),
				shareBtn,
				historyBtn,
				renameBtn,
				delBtn,
			);
			list.appendChild(row);
		}
	}

	function buildShareUrl(token: string): string {
		const origin = window.location.origin;
		const base = import.meta.env.BASE_URL ?? '/';
		const root = base.endsWith('/') ? base.slice(0, -1) : base;
		return `${origin}${root}/share/${encodeURIComponent(token)}`;
	}

	function formatShareDate(iso: string): string {
		return new Date(iso).toLocaleString();
	}

	function relativeExpiry(iso: string): string {
		const ms = new Date(iso).getTime() - Date.now();
		if (ms <= 0) { return 'expired'; }
		const hours = ms / 3_600_000;
		if (hours < 1) { return 'expires in <1h'; }
		if (hours < 24) { return `expires in ${Math.floor(hours)}h`; }
		const days = Math.ceil(hours / 24);
		return `expires in ${days}d`;
	}

	async function copyText(text: string): Promise<boolean> {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			return false;
		}
	}

	function loadShareExpiryPref(): string {
		try {
			const v = localStorage.getItem(SHARE_EXPIRY_PREF_KEY);
			return v && ['1', '7', '30'].includes(v) ? v : '7';
		} catch {
			return '7';
		}
	}

	function saveShareExpiryPref(days: string): void {
		try {
			localStorage.setItem(SHARE_EXPIRY_PREF_KEY, days);
		} catch {
			/* noop */
		}
	}

	async function openShareDialog(doc: CloudDocument): Promise<void> {
		const tokenByShareId = new Map<string, string>();
		const overlay = h('div', { class: 'cv-share-modal' });
		const panel = h('div', {
			class: 'cv-share-modal__panel',
			role: 'dialog',
			'aria-modal': 'true',
			'aria-label': `Share links for ${doc.name}`,
		});
		const title = h('h3', { class: 'cv-share-modal__title' }, `Share: ${doc.name}`);
		const statusEl = h('p', { class: 'cv-share-modal__status', hidden: '' });
		const expirySelect = h(
			'select',
			{ class: 'cv-share-modal__select' },
			h('option', { value: '1' }, '1 day'),
			h('option', { value: '7' }, '7 days'),
			h('option', { value: '30' }, '30 days'),
		) as HTMLSelectElement;
		expirySelect.value = loadShareExpiryPref();
		expirySelect.addEventListener('change', () => {
			saveShareExpiryPref(expirySelect.value);
		});
		const createBtn = h('button', { class: 'cv-doc-btn', type: 'button' }, 'Create link');
		const closeBtn = h('button', { class: 'cv-doc-btn', type: 'button' }, 'Close');
		const listWrap = h('div', { class: 'cv-share-modal__list' });

		function setDialogStatus(message: string, isErr = false): void {
			statusEl.textContent = message;
			statusEl.hidden = !message;
			statusEl.className = 'cv-share-modal__status' + (
				isErr ? ' cv-share-modal__status--error' : ''
			);
		}

		async function renderShares(): Promise<void> {
			const res = await listShares(doc.id);
			if (!res.ok) {
				setDialogStatus(res.error.message, true);
				return;
			}
			listWrap.innerHTML = '';
			if (res.data.length === 0) {
				listWrap.appendChild(h('p', {}, 'No share links yet.'));
				return;
			}
			const sortedShares = [...res.data].sort((a, b) => {
				const aActive = !a.revoked_at;
				const bActive = !b.revoked_at;
				if (aActive !== bActive) {
					return aActive ? -1 : 1;
				}
				return new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime();
			});
			for (const share of sortedShares) {
				const row = h('div', { class: 'cv-share-modal__row' });
				const expiryRel = relativeExpiry(share.expires_at);
				const disabled = Boolean(share.revoked_at) || expiryRel === 'expired';
				const meta = h(
					'div',
					{ class: 'cv-share-modal__meta' },
					`Expires ${formatShareDate(share.expires_at)} (${expiryRel}) · Views ${share.access_count}`,
				);
				const statusText = share.revoked_at
					? 'Revoked'
					: expiryRel === 'expired'
						? 'Expired'
						: 'Active';
				const state = h('span', { class: 'cv-share-modal__badge' }, statusText);
				const canCopy = tokenByShareId.has(share.id) && !disabled;
				const copyBtn = canCopy
					? h(
						'button',
						{ class: 'cv-doc-row__action', type: 'button' },
						'Copy',
					)
					: h(
						'span',
						{ class: 'cv-share-modal__copy-unavailable' },
						'Copy unavailable',
					);
				const revokeBtn = h(
					'button',
					{ class: 'cv-doc-row__action', type: 'button' },
					'Revoke',
				);
				revokeBtn.toggleAttribute('disabled', Boolean(share.revoked_at));
				if (canCopy && copyBtn instanceof HTMLButtonElement) {
					copyBtn.addEventListener('click', async () => {
						const token = tokenByShareId.get(share.id);
						if (!token) { return; }
						const copied = await copyText(buildShareUrl(token));
						setDialogStatus(
							copied ? 'Share link copied to clipboard.' : 'Failed to copy share link.',
							!copied,
						);
					});
				}
				revokeBtn.addEventListener('click', async () => {
					const revoked = await revokeShare(share.id);
					if (!revoked.ok) {
						setDialogStatus(revoked.error.message, true);
						return;
					}
					setDialogStatus('Share link revoked.');
					await renderShares();
				});
				row.append(meta, state, copyBtn, revokeBtn);
				listWrap.appendChild(row);
			}
		}

		createBtn.addEventListener('click', async () => {
			const days = Number(expirySelect.value);
			if (!Number.isFinite(days) || days <= 0 || days > 365) {
				setDialogStatus('Expiry must be between 1 and 365 days.', true);
				return;
			}
			const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
			saveShareExpiryPref(expirySelect.value);
			const created = await createShare(doc.id, expiresAt);
			if (!created.ok) {
				setDialogStatus(created.error.message, true);
				return;
			}
			const shareUrl = buildShareUrl(created.data.token);
			tokenByShareId.set(created.data.share.id, created.data.token);
			const copied = await copyText(shareUrl);
			setDialogStatus(
				copied ? 'Share link copied to clipboard.' : `Share URL: ${shareUrl}`,
			);
			setStatus('Share link created.');
			await renderShares();
		});

		closeBtn.addEventListener('click', () => { overlay.remove(); });
		overlay.addEventListener('click', (event) => {
			if (event.target === overlay) {
				overlay.remove();
			}
		});

		const actions = h('div', { class: 'cv-share-modal__actions' }, createBtn, closeBtn);
		panel.append(title, statusEl, expirySelect, actions, listWrap);
		overlay.appendChild(panel);
		document.body.appendChild(overlay);
		await renderShares();
	}
	async function refreshDocs(): Promise<void> {
		if (!authed) {
			list.innerHTML = '';
			list.appendChild(
				h('p', { class: 'cv-cloud-drawer__muted' }, 'Sign in via the Account tab to list documents.'),
			);
			return;
		}
		const res = await listDocuments();
		if (!res.ok) { setStatus(res.error.message, true); return; }
		docs = res.data;
		renderDocs();
	}
	newBtn.addEventListener('click', async () => {
		const name = prompt('Document name', 'Untitled CV')?.trim();
		if (!name) { return; }
		const data = window.__CV_DATA__;
		if (!data) { setStatus('No CV loaded', true); return; }
		const res = await createDocument(name, data);
		if (!res.ok) { setStatus(res.error.message, true); return; }
		docs.unshift(res.data);
		openDocument(res.data);
		renderDocs();
		setStatus(`Created "${name}"`);
	});
	saveBtn.addEventListener('click', async () => {
		await flushSave();
	});
	window.addEventListener(AUTH_CHANGED_EVENT, (e) => {
		const { user } = (e as CustomEvent<AuthChangedDetail>).detail;
		authed = Boolean(user);
		if (!user) {
			closeDocument();
			setSyncIndicator?.('', '');
			list.innerHTML = '';
			list.appendChild(
				h('p', { class: 'cv-cloud-drawer__muted' }, 'Sign in via the Account tab to list documents.'),
			);
			return;
		}
		void refreshDocs();
	});
	onSyncStateChange((s) => {
		if (!authed) {
			setSyncIndicator?.('', '');
			return;
		}
		const short = s.status === 'clean'
			? 'Saved'
			: s.status === 'saving'
				? 'Saving…'
				: s.status === 'dirty'
					? 'Unsaved'
					: s.status === 'error'
						? 'Error'
						: '';
		const title = getSyncState().errorMsg ?? getSyncState().status;
		setSyncIndicator?.(short, title);
	});
	return {
		onDataChange: (data) => scheduleSave(data),
		refreshDocs,
	};
}

declare global {
	interface Window { __CV_DATA__?: CVData; }
}

