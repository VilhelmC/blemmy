import { newLetterFromBasics, validateLetterData } from '@lib/composer-data-loader';
import {
	getActiveDocumentData,
	getActiveDocumentSnapshot,
	remountActiveDocument,
	validateDocumentByType,
} from '@lib/active-document-runtime';
import { inferDocTypeFromData } from '@lib/cloud-client';
import { isLikelyCvData } from '@lib/profile-data-loader';
import { canonicalEmbedPath, canonicalSharePath } from '@lib/share-link-url';
import {
	CLOUD_ENABLED,
	createShare,
	createDocument,
	deleteDocument,
	getCloudStorageUsage,
	listDocuments,
	listShares,
	listVersions,
	loadVersion,
	renameDocument,
	revokeShare,
	type CloudDocument,
	type CloudStorageUsage,
	type CloudShare,
	type StoredDocumentData,
	type CloudVersion,
} from '@lib/cloud-client';
import { AUTH_CHANGED_EVENT, type AuthChangedDetail } from '@renderer/auth-panel';
import {
	closeDocument,
	flushSave,
	getSyncState,
	onSyncStateChange,
	openDocument,
	scheduleSave,
} from '@lib/document-sync';

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

export function initDocumentPanel(opts: DocumentPanelOptions): {
	onDataChange: (data: StoredDocumentData) => void;
	refreshDocs: () => Promise<void>;
} {
	const { mount, closeDrawer, setSyncIndicator } = opts;
	const SHARE_EXPIRY_PREF_KEY = 'blemmy-share-expiry-days';
	const EMBED_PUBLISH_PREF_KEY = 'blemmy-embed-publish-doc-map';
	if (!CLOUD_ENABLED) {
		mount.appendChild(
			h('p', { class: 'blemmy-cloud-drawer__muted' }, 'Cloud docs disabled (.env not configured).'),
		);
		return { onDataChange: () => { /* noop */ }, refreshDocs: async () => { /* noop */ } };
	}
	const list = h('div', { id: 'blemmy-doc-list' });
	const status = h('p', { id: 'blemmy-doc-status', class: 'blemmy-doc-status', hidden: '' });
	const quotaWrap = h('div', { id: 'blemmy-doc-quota', class: 'blemmy-doc-quota', hidden: '' });
	const quotaText = h('p', { class: 'blemmy-doc-quota__text' });
	const quotaBar = h('div', { class: 'blemmy-doc-quota__bar' },
		h('span', { class: 'blemmy-doc-quota__fill', style: 'width:0%' }),
	);
	quotaWrap.append(quotaText, quotaBar);
	const newBtn = h(
		'button',
		{
			type: 'button',
			class: 'blemmy-doc-btn',
			title: 'Create a new cloud document from current CV',
			'aria-label': 'Create new cloud document',
		},
		'+ New',
	);
	const saveBtn = h(
		'button',
		{
			type: 'button',
			class: 'blemmy-doc-btn',
			title: 'Save current CV to the active cloud document now',
			'aria-label': 'Save current cloud document now',
		},
		'Save now',
	);
	mount.append(status, newBtn, saveBtn, quotaWrap, list);
	let docs: CloudDocument[] = [];
	let usageByDoc = new Map<string, number>();
	let authed = false;
	function setStatus(text: string, isErr = false): void {
		status.textContent = text;
		status.hidden = !text;
		status.className = 'blemmy-doc-status' + (isErr ? ' blemmy-doc-status--error' : '');
	}
	function rel(iso: string): string {
		const d = (Date.now() - new Date(iso).getTime()) / 1000;
		if (d < 60) { return 'now'; }
		if (d < 3600) { return `${Math.floor(d / 60)}m`; }
		if (d < 86400) { return `${Math.floor(d / 3600)}h`; }
		return `${Math.floor(d / 86400)}d`;
	}
	function fmtBytes(bytes: number): string {
		if (bytes <= 0) { return '0 B'; }
		if (bytes < 1024) { return `${bytes} B`; }
		if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
		return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
	}
	function renderQuota(usage: CloudStorageUsage | null): void {
		if (!usage || usage.quota_bytes <= 0) {
			quotaWrap.hidden = true;
			return;
		}
		const pctRaw = (usage.used_bytes / usage.quota_bytes) * 100;
		const pct = Math.max(0, Math.min(100, pctRaw));
		quotaText.textContent =
			`Storage ${pct.toFixed(1)}% (${fmtBytes(usage.used_bytes)} / ` +
			`${fmtBytes(usage.quota_bytes)})`;
		const fill = quotaBar.querySelector('.blemmy-doc-quota__fill') as HTMLElement | null;
		if (fill) {
			fill.style.width = `${pct}%`;
		}
		quotaWrap.hidden = false;
	}
	async function openDoc(doc: CloudDocument): Promise<void> {
		if (!doc.latest) { setStatus('No versions for document', true); return; }
		try {
			const docType = doc.doc_type || inferDocTypeFromData(doc.latest);
			const data = validateDocumentByType(docType, doc.latest);
			openDocument(doc);
			remountActiveDocument(data, docType);
			closeDrawer?.();
		} catch (err) {
			setStatus(err instanceof Error ? err.message : 'Invalid document', true);
		}
	}
	function renderDocs(): void {
		list.innerHTML = '';
		if (docs.length === 0) {
			list.appendChild(h('p', {}, 'No documents yet.'));
			return;
		}
		for (const doc of docs) {
			const row = h('div', { class: 'blemmy-doc-row' });
			const openBtn = h(
				'button',
				{
					type: 'button',
					class: 'blemmy-doc-row__name',
					title: `Open "${doc.name}"`,
					'aria-label': `Open document ${doc.name}`,
				},
				doc.name,
			);
			if (doc.doc_type && doc.doc_type !== 'cv') {
				openBtn.appendChild(
					h('span', { class: 'blemmy-doc-row__meta' }, ` (${doc.doc_type})`),
				);
			}
			openBtn.addEventListener('click', () => { void openDoc(doc); });
			const renameBtn = h(
				'button',
				{
					type: 'button',
					class: 'blemmy-doc-row__action',
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
					class: 'blemmy-doc-row__action',
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
					class: 'blemmy-doc-row__action',
					title: `Open latest version from "${doc.name}" history`,
					'aria-label': `Open latest version from history for document ${doc.name}`,
				},
				'⏱',
			);
			const shareBtn = h(
				'button',
				{
					type: 'button',
					class: 'blemmy-doc-row__action',
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
					const docType = doc.doc_type || inferDocTypeFromData(loaded.data);
					const data = validateDocumentByType(docType, loaded.data);
					remountActiveDocument(data, docType);
					openDocument(doc);
					closeDrawer?.();
				} catch {
					setStatus('Version is invalid', true);
				}
			});
			row.append(
				openBtn,
				h(
					'span',
					{ class: 'blemmy-doc-row__meta' },
					`${rel(doc.updated_at)} · ${fmtBytes(usageByDoc.get(doc.id) ?? 0)}`,
				),
				shareBtn,
				historyBtn,
				renameBtn,
				delBtn,
			);
			list.appendChild(row);
		}
	}

	function buildShareUrl(token: string, reviewMode = false): string {
		const origin = window.location.origin;
		const url = new URL(canonicalSharePath(token, import.meta.env.BASE_URL ?? '/'), origin);
		if (reviewMode) {
			url.searchParams.set('blemmy-review', '1');
		}
		return url.toString();
	}

	function buildEmbedUrl(token: string): string {
		const origin = window.location.origin;
		return new URL(
			canonicalEmbedPath(token, import.meta.env.BASE_URL ?? '/'),
			origin,
		).toString();
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

	function loadEmbedDocMap(): Record<string, boolean> {
		try {
			const raw = localStorage.getItem(EMBED_PUBLISH_PREF_KEY);
			if (!raw) { return {}; }
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			const out: Record<string, boolean> = {};
			for (const [k, v] of Object.entries(parsed)) {
				if (typeof v === 'boolean') { out[k] = v; }
			}
			return out;
		} catch {
			return {};
		}
	}

	function isEmbedPublished(documentId: string): boolean {
		return loadEmbedDocMap()[documentId] === true;
	}

	function saveEmbedPublished(documentId: string, enabled: boolean): void {
		const map = loadEmbedDocMap();
		map[documentId] = enabled;
		try {
			localStorage.setItem(EMBED_PUBLISH_PREF_KEY, JSON.stringify(map));
		} catch {
			/* noop */
		}
	}

	async function openShareDialog(doc: CloudDocument): Promise<void> {
		const tokenByShareId = new Map<string, string>();
		const overlay = h('div', { class: 'blemmy-share-modal' });
		const panel = h('div', {
			class: 'blemmy-share-modal__panel',
			role: 'dialog',
			'aria-modal': 'true',
			'aria-label': `Share links for ${doc.name}`,
		});
		const title = h('h3', { class: 'blemmy-share-modal__title' }, `Share: ${doc.name}`);
		const statusEl = h('p', { class: 'blemmy-share-modal__status', hidden: '' });
		const expirySelect = h(
			'select',
			{ class: 'blemmy-share-modal__select' },
			h('option', { value: '1' }, '1 day'),
			h('option', { value: '7' }, '7 days'),
			h('option', { value: '30' }, '30 days'),
		) as HTMLSelectElement;
		expirySelect.value = loadShareExpiryPref();
		expirySelect.addEventListener('change', () => {
			saveShareExpiryPref(expirySelect.value);
		});
		const createBtn = h('button', { class: 'blemmy-doc-btn', type: 'button' }, 'Create link');
		const createEmbedBtn = h('button', { class: 'blemmy-doc-btn', type: 'button' }, 'Create embed link');
		const reviewModeWrap = h('label', { class: 'blemmy-share-modal__review-opt' },
			h('input', { type: 'checkbox' }),
			' Enable review mode',
		);
		const publishEmbedWrap = h('label', { class: 'blemmy-share-modal__review-opt' },
			h('input', { type: 'checkbox' }),
			' Publish for embed',
		);
		const publishEmbedCb = publishEmbedWrap.querySelector('input') as HTMLInputElement;
		publishEmbedCb.checked = isEmbedPublished(doc.id);
		publishEmbedCb.addEventListener('change', () => {
			saveEmbedPublished(doc.id, publishEmbedCb.checked);
		});
		const reviewModeCb = reviewModeWrap.querySelector('input') as HTMLInputElement;
		const closeBtn = h('button', { class: 'blemmy-doc-btn', type: 'button' }, 'Close');
		const listWrap = h('div', { class: 'blemmy-share-modal__list' });

		function setDialogStatus(message: string, isErr = false): void {
			statusEl.textContent = message;
			statusEl.hidden = !message;
			statusEl.className = 'blemmy-share-modal__status' + (
				isErr ? ' blemmy-share-modal__status--error' : ''
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
				const row = h('div', { class: 'blemmy-share-modal__row' });
				const expiryRel = relativeExpiry(share.expires_at);
				const disabled = Boolean(share.revoked_at) || expiryRel === 'expired';
				const meta = h(
					'div',
					{ class: 'blemmy-share-modal__meta' },
					`Expires ${formatShareDate(share.expires_at)} (${expiryRel}) · Views ${share.access_count}`,
				);
				const statusText = share.revoked_at
					? 'Revoked'
					: expiryRel === 'expired'
						? 'Expired'
						: 'Active';
				const state = h('span', { class: 'blemmy-share-modal__badge' }, statusText);
				const canCopy = tokenByShareId.has(share.id) && !disabled;
				const copyBtn = canCopy
					? h(
						'button',
						{ class: 'blemmy-doc-row__action', type: 'button' },
						'Copy',
					)
					: h(
						'span',
						{ class: 'blemmy-share-modal__copy-unavailable' },
						'Copy unavailable',
					);
				const copyReviewBtn = canCopy
					? h(
						'button',
						{ class: 'blemmy-doc-row__action', type: 'button' },
						'Copy+Review',
					)
					: h(
						'span',
						{ class: 'blemmy-share-modal__copy-unavailable' },
						'',
					);
				const copyEmbedBtn = canCopy && publishEmbedCb.checked
					? h(
						'button',
						{ class: 'blemmy-doc-row__action', type: 'button' },
						'Copy embed',
					)
					: h(
						'span',
						{ class: 'blemmy-share-modal__copy-unavailable' },
						'',
					);
				const revokeBtn = h(
					'button',
					{ class: 'blemmy-doc-row__action', type: 'button' },
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
				if (canCopy && copyReviewBtn instanceof HTMLButtonElement) {
					copyReviewBtn.addEventListener('click', async () => {
						const token = tokenByShareId.get(share.id);
						if (!token) { return; }
						const copied = await copyText(buildShareUrl(token, true));
						setDialogStatus(
							copied ? 'Share+review link copied to clipboard.' : 'Failed to copy share+review link.',
							!copied,
						);
					});
				}
				if (canCopy && publishEmbedCb.checked && copyEmbedBtn instanceof HTMLButtonElement) {
					copyEmbedBtn.addEventListener('click', async () => {
						const tokenForEmbed = tokenByShareId.get(share.id);
						if (!tokenForEmbed) { return; }
						const copied = await copyText(buildEmbedUrl(tokenForEmbed));
						setDialogStatus(
							copied ? 'Embed link copied to clipboard.' : 'Failed to copy embed link.',
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
				row.append(meta, state, copyBtn, copyReviewBtn, copyEmbedBtn, revokeBtn);
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
			const shareUrl = buildShareUrl(created.data.token, reviewModeCb.checked);
			tokenByShareId.set(created.data.share.id, created.data.token);
			const copied = await copyText(shareUrl);
			setDialogStatus(
				copied ? 'Share link copied to clipboard.' : `Share URL: ${shareUrl}`,
			);
			setStatus('Share link created.');
			await renderShares();
		});

		async function createEmbedLink(): Promise<void> {
			if (!publishEmbedCb.checked) {
				setDialogStatus('Enable "Publish for embed" first.', true);
				return;
			}
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
			tokenByShareId.set(created.data.share.id, created.data.token);
			const embedUrl = buildEmbedUrl(created.data.token);
			const copied = await copyText(embedUrl);
			setDialogStatus(
				copied ? 'Embed link copied to clipboard.' : `Embed URL: ${embedUrl}`,
			);
			setStatus('Embed link created.');
			await renderShares();
		}

		createEmbedBtn.addEventListener('click', () => {
			void createEmbedLink();
		});

		const rotateEmbedBtn = h('button', { class: 'blemmy-doc-btn', type: 'button' }, 'Rotate embed link');
		rotateEmbedBtn.addEventListener('click', async () => {
			if (!publishEmbedCb.checked) {
				setDialogStatus('Enable "Publish for embed" first.', true);
				return;
			}
			const sharesRes = await listShares(doc.id);
			if (!sharesRes.ok) {
				setDialogStatus(sharesRes.error.message, true);
				return;
			}
			const activeShares = sharesRes.data.filter((s) => !s.revoked_at);
			for (const share of activeShares) {
				const revoked = await revokeShare(share.id);
				if (!revoked.ok) {
					setDialogStatus(revoked.error.message, true);
					return;
				}
			}
			await createEmbedLink();
		});

		closeBtn.addEventListener('click', () => { overlay.remove(); });
		overlay.addEventListener('click', (event) => {
			if (event.target === overlay) {
				overlay.remove();
			}
		});

		const actions = h('div', { class: 'blemmy-share-modal__actions' },
			createBtn,
			createEmbedBtn,
			rotateEmbedBtn,
			closeBtn,
		);
		panel.append(
			title,
			statusEl,
			expirySelect,
			reviewModeWrap,
			publishEmbedWrap,
			actions,
			listWrap,
		);
		overlay.appendChild(panel);
		document.body.appendChild(overlay);
		await renderShares();
	}
	async function refreshDocs(): Promise<void> {
		if (!authed) {
			list.innerHTML = '';
			quotaWrap.hidden = true;
			list.appendChild(
				h('p', { class: 'blemmy-cloud-drawer__muted' }, 'Sign in via the Account tab to list documents.'),
			);
			return;
		}
		const res = await listDocuments();
		if (!res.ok) { setStatus(res.error.message, true); return; }
		const usageRes = await getCloudStorageUsage();
		if (usageRes.ok) {
			usageByDoc = new Map(
				usageRes.data.documents.map((d) => [d.document_id, d.version_bytes]),
			);
			renderQuota(usageRes.data);
		} else {
			usageByDoc = new Map();
			renderQuota(null);
		}
		docs = res.data;
		renderDocs();
	}
	async function openCreateDocumentDialog(): Promise<{
		docType: 'cv' | 'letter';
		name: string;
	} | null> {
		return new Promise((resolve) => {
			const overlay = h('div', { class: 'blemmy-share-modal' });
			const panel = h('div', {
				class: 'blemmy-share-modal__panel',
				role: 'dialog',
				'aria-modal': 'true',
				'aria-label': 'Create new document',
			});
			const title = h('h3', { class: 'blemmy-share-modal__title' }, 'Create new document');
			const statusEl = h('p', {
				class: 'blemmy-share-modal__status',
				hidden: '',
			});
			const typeLabel = h('label', {}, 'Document type');
			const typeSelect = h('select', {
				class: 'blemmy-share-modal__select',
			}) as HTMLSelectElement;
			typeSelect.append(
				h('option', { value: 'cv' }, 'CV'),
				h('option', { value: 'letter' }, 'Cover letter'),
			);
			const nameLabel = h('label', {}, 'Document name');
			const nameInput = h('input', {
				class: 'blemmy-share-modal__select',
				type: 'text',
				value: 'Untitled CV',
				placeholder: 'Enter a document name',
			}) as HTMLInputElement;
			function setStatus(msg: string, isErr = false): void {
				statusEl.textContent = msg;
				statusEl.hidden = !msg;
				statusEl.className = isErr
					? 'blemmy-share-modal__status blemmy-share-modal__status--error'
					: 'blemmy-share-modal__status';
			}
			typeSelect.addEventListener('change', () => {
				const nextType = typeSelect.value === 'letter' ? 'letter' : 'cv';
				if (!nameInput.value.trim() || nameInput.value === 'Untitled CV' || nameInput.value === 'Untitled Letter') {
					nameInput.value = nextType === 'letter' ? 'Untitled Letter' : 'Untitled CV';
				}
			});
			const createBtn = h('button', {
				type: 'button',
				class: 'blemmy-doc-btn',
			}, 'Create');
			const cancelBtn = h('button', {
				type: 'button',
				class: 'blemmy-doc-btn',
			}, 'Cancel');
			function closeWith(result: { docType: 'cv' | 'letter'; name: string } | null): void {
				overlay.remove();
				resolve(result);
			}
			createBtn.addEventListener('click', () => {
				const docType = typeSelect.value === 'letter' ? 'letter' : 'cv';
				const name = nameInput.value.trim();
				if (!name) {
					setStatus('Document name is required.', true);
					return;
				}
				closeWith({ docType, name });
			});
			cancelBtn.addEventListener('click', () => { closeWith(null); });
			overlay.addEventListener('click', (event) => {
				if (event.target === overlay) { closeWith(null); }
			});
			panel.append(
				title,
				statusEl,
				typeLabel,
				typeSelect,
				nameLabel,
				nameInput,
				h('div', { class: 'blemmy-share-modal__actions' }, createBtn, cancelBtn),
			);
			overlay.appendChild(panel);
			document.body.appendChild(overlay);
			nameInput.focus();
			nameInput.select();
		});
	}
	newBtn.addEventListener('click', async () => {
		const created = await openCreateDocumentDialog();
		if (!created) { return; }
		const { docType, name } = created;
		let payload: StoredDocumentData;
		if (docType === 'letter') {
			const active = getActiveDocumentData();
			const cv = isLikelyCvData(active) ? active : null;
			const seed = cv
				? newLetterFromBasics(
					cv.basics.name,
					cv.basics.label ?? '',
					cv.basics.email ?? '',
					cv.basics.phone ?? '',
					cv.basics.location ?? '',
				)
				: newLetterFromBasics('', '', '', '', '');
			payload = validateLetterData(seed);
		} else {
			const data = getActiveDocumentData();
			if (!isLikelyCvData(data)) {
				setStatus('No profile document loaded', true);
				return;
			}
			payload = data;
		}
		const res = await createDocument(name, payload, docType);
		if (!res.ok) { setStatus(res.error.message, true); return; }
		docs.unshift(res.data);
		openDocument(res.data);
		remountActiveDocument(payload, docType);
		closeDrawer?.();
		renderDocs();
		setStatus(`Created "${name}"`);
	});
	saveBtn.addEventListener('click', async () => {
		const snap = getActiveDocumentSnapshot();
		if (snap.data && getSyncState().documentId) {
			scheduleSave(snap.data, snap.docType);
		}
		await flushSave();
	});
	window.addEventListener(AUTH_CHANGED_EVENT, (e) => {
		const { user } = (e as CustomEvent<AuthChangedDetail>).detail;
		authed = Boolean(user);
		if (!user) {
			closeDocument();
			setSyncIndicator?.('', '');
			quotaWrap.hidden = true;
			list.innerHTML = '';
			list.appendChild(
				h('p', { class: 'blemmy-cloud-drawer__muted' }, 'Sign in via the Account tab to list documents.'),
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


