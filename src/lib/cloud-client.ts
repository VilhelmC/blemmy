import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { CVData } from '@cv/cv';
import type { LetterData } from '@cv/letter';
import { withCapturedLayoutSnapshot } from '@lib/engine/document-layout-snapshot';
import { withRealisedLayout } from '@lib/engine/layout-realised';
import { getDocTypeSpec } from '@lib/document-type';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const CLOUD_ENABLED =
	Boolean(supabaseUrl) &&
	Boolean(supabaseKey) &&
	supabaseKey !== 'REPLACE_WITH_ANON_KEY_FROM_SUPABASE_DASHBOARD';

/** Dispatched when cloud auth user changes (same name across app). */
export const AUTH_CHANGED_EVENT = 'blemmy-auth-changed';
export type AuthChangedDetail = { user: User | null };

/**
 * Prefix for `window.open` names (GitHub, Google, …). Keep in sync with index.html.
 */
export const OAUTH_POPUP_NAME_PREFIX = 'blemmy-oauth-';

export function isOAuthCallbackPopupWindow(): boolean {
	if (typeof window === 'undefined') { return false; }
	return window.name.startsWith(OAUTH_POPUP_NAME_PREFIX);
}

/** Opener listens for this after the callback page finishes. */
export const OAUTH_POST_MESSAGE_TYPE = 'blemmy-supabase-oauth-done';

function newOAuthPopupWindowName(): string {
	const id = typeof crypto !== 'undefined' && crypto.randomUUID
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
	return `${OAUTH_POPUP_NAME_PREFIX}${id}`;
}

let client: SupabaseClient | null = null;
let passwordlessClient: SupabaseClient | null = null;

/**
 * Merge hash then search (search wins). Matches GoTrue URL parsing.
 */
function authParamsFromLocation(href: string): Record<string, string> {
	const out: Record<string, string> = {};
	const url = new URL(href);
	if (url.hash.startsWith('#')) {
		try {
			new URLSearchParams(url.hash.slice(1)).forEach((v, k) => {
				out[k] = v;
			});
		} catch {
			/* noop */
		}
	}
	url.searchParams.forEach((v, k) => {
		out[k] = v;
	});
	return out;
}

function implicitEmailCallbackDetect(
	_url: URL,
	params: Record<string, string>,
): boolean {
	if (params.code) {
		return false;
	}
	return Boolean(
		params.access_token ||
			params.error_description ||
			params.error ||
			params.error_code,
	);
}

/**
 * OTP / magic links: implicit redirect tokens in the hash (no PKCE verifier).
 * OAuth stays on {@link getClient} (PKCE).
 */
function getPasswordlessClient(): SupabaseClient {
	if (!passwordlessClient) {
		if (!CLOUD_ENABLED || !supabaseUrl || !supabaseKey) {
			throw new Error('Supabase not configured.');
		}
		const sk = supabaseAuthSessionStorageKey();
		passwordlessClient = createClient(supabaseUrl, supabaseKey, {
			auth: {
				persistSession: true,
				autoRefreshToken: true,
				flowType: 'implicit',
				storageKey: sk,
				detectSessionInUrl: implicitEmailCallbackDetect,
			},
		});
	}
	return passwordlessClient;
}

export function getClient(): SupabaseClient {
	if (!client) {
		if (!CLOUD_ENABLED || !supabaseUrl || !supabaseKey) {
			throw new Error('Supabase not configured.');
		}
		client = createClient(supabaseUrl, supabaseKey, {
			auth: {
				persistSession: true,
				autoRefreshToken: true,
				detectSessionInUrl: true,
				flowType: 'pkce',
			},
		});
	}
	return client;
}

/**
 * Run before {@link getClient} on full app boot so magic-link hash/query is
 * handled by the implicit client; avoids PKCE-only OTP links in new tabs.
 */
export async function initPasswordlessAuthFromUrl(): Promise<void> {
	if (!CLOUD_ENABLED || typeof window === 'undefined') {
		return;
	}
	const p = authParamsFromLocation(window.location.href);
	if (p.code) {
		return;
	}
	if (!implicitEmailCallbackDetect(new URL(window.location.href), p)) {
		return;
	}
	await getPasswordlessClient().auth.initialize();
}

export type CloudError = { message: string; code?: string };
export type StoredDocumentData = CVData | LetterData;

export function inferDocTypeFromData(data: StoredDocumentData): string {
	const record = data as unknown as Record<string, unknown>;
	if (
		record &&
		typeof record === 'object' &&
		'recipient' in record &&
		'closing' in record &&
		Array.isArray(record.body)
	) {
		return 'letter';
	}
	return 'cv';
}

function withLayoutForDocType(
	data: StoredDocumentData,
	docType: string,
): StoredDocumentData {
	const spec = getDocTypeSpec(docType);
	if (!spec) { return data; }
	return withRealisedLayout(
		data as unknown as Record<string, unknown>,
		spec,
	) as unknown as StoredDocumentData;
}

export type CloudDocument = {
	id: string;
	user_id: string;
	name: string;
	doc_type: string;
	created_at: string;
	updated_at: string;
	latest?: StoredDocumentData;
};
export type CloudVersion = {
	id: string;
	document_id: string;
	data: StoredDocumentData;
	label: string | null;
	created_at: string;
};
export type CloudShare = {
	id: string;
	document_id: string;
	owner_user_id: string;
	expires_at: string;
	revoked_at: string | null;
	created_at: string;
	last_accessed_at: string | null;
	access_count: number;
};
export type CloudShareCreateResult = {
	share: CloudShare;
	token: string;
};
export type CloudStorageDocUsage = {
	document_id: string;
	version_bytes: number;
	version_count: number;
};
export type CloudStorageUsage = {
	quota_bytes: number;
	used_bytes: number;
	portrait_assets_bytes: number;
	documents: CloudStorageDocUsage[];
};
export type SharedDocumentView = {
	document_id: string;
	document_name: string;
	data: CVData;
	expires_at: string;
};
export type PrivacyRequest = {
	id: string;
	user_id: string;
	request_type: 'export' | 'delete';
	status: 'requested' | 'processing' | 'completed' | 'rejected';
	notes: string | null;
	requested_at: string;
	completed_at: string | null;
};
export type PrivacyConsent = {
	id: string;
	user_id: string;
	consent_key: string;
	consent_value: boolean;
	policy_version: string;
	updated_at: string;
	created_at: string;
};
export type PrivacyConsentEvent = {
	id: string;
	user_id: string;
	consent_key: string;
	consent_value: boolean;
	policy_version: string;
	source: string;
	created_at: string;
};

type CloudResult<T> = { ok: true; data: T } | { ok: false; error: CloudError };
type AuthResult =
	| { ok: true; user: User; session: Session }
	| { ok: false; error: CloudError };

function toErr(err: unknown): CloudError {
	if (err && typeof err === 'object' && 'message' in err) {
		return { message: String((err as { message: unknown }).message ?? err) };
	}
	return { message: String(err) };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
	try {
		const { data, error } = await getClient()
			.auth
			.signInWithPassword({ email, password });
		if (error || !data.user || !data.session) {
			return { ok: false, error: toErr(error ?? 'Sign in failed') };
		}
		return { ok: true, user: data.user, session: data.session };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
	try {
		const { data, error } = await getClient().auth.signUp({ email, password });
		if (error) { return { ok: false, error: toErr(error) }; }
		if (!data.user || !data.session) {
			return {
				ok: false,
				error: { message: 'Check your email for a confirmation link.' },
			};
		}
		return { ok: true, user: data.user, session: data.session };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

const OAUTH_POPUP_FEATURES = 'width=440,height=340,scrollbars=yes,resizable=yes';
const OAUTH_WAIT_MS = 180_000;
const OAUTH_URL_PARAM_KEYS = ['code', 'state', 'error', 'error_description'] as const;

function authDebugEnabled(): boolean {
	if (import.meta.env.VITE_AUTH_DEBUG === 'true') {
		return true;
	}
	if (typeof window === 'undefined') {
		return false;
	}
	try {
		return new URLSearchParams(window.location.search).get('blemmy-auth-debug') === '1';
	} catch {
		return false;
	}
}

function authDebugLog(message: string, extra?: unknown): void {
	if (!authDebugEnabled()) {
		return;
	}
	if (extra !== undefined) {
		console.info('[blemmy-auth]', message, extra);
	} else {
		console.info('[blemmy-auth]', message);
	}
}

function summarizeOAuthStartUrl(raw: string): Record<string, unknown> {
	try {
		const u = new URL(raw);
		return {
			origin: u.origin,
			host: u.hostname,
			pathname: u.pathname,
			searchParamKeys: [...u.searchParams.keys()],
		};
	} catch {
		return { parseError: true as const };
	}
}

/** Snapshot for support: PKCE verifier visibility is the usual popup failure mode. */
function oauthCallbackSnapshotLines(
	extras?: { initErr?: string; sessErr?: string; user?: boolean },
): string[] {
	const lines: string[] = [];
	try {
		const u = new URL(window.location.href);
		lines.push(`callback origin: ${u.origin}`);
		lines.push(`path: ${u.pathname}`);
		lines.push(`query keys: ${[...u.searchParams.keys()].join(', ') || '(none)'}`);
		const code = u.searchParams.get('code');
		lines.push(`code: ${code ? `yes, length ${code.length}` : 'no'}`);
	} catch (e) {
		lines.push(`URL error: ${e instanceof Error ? e.message : String(e)}`);
	}
	if (CLOUD_ENABLED && supabaseUrl) {
		try {
			const vk = `${supabaseAuthSessionStorageKey()}-code-verifier`;
			let v: string | null = null;
			try {
				v = localStorage.getItem(vk);
			} catch { /* noop */ }
			lines.push(`verifier key ends with: -code-verifier`);
			lines.push(
				v
					? `PKCE verifier in localStorage: yes (${v.length} chars)`
					: 'PKCE verifier in localStorage: NO — exchange needs verifier from the tab that started GitHub sign-in',
			);
		} catch (e) {
			lines.push(`verifier check: ${e instanceof Error ? e.message : String(e)}`);
		}
		try {
			const sk = supabaseAuthSessionStorageKey();
			let tok: string | null = null;
			try {
				tok = localStorage.getItem(sk);
			} catch { /* noop */ }
			lines.push(`session storage (${sk}): ${tok ? 'present' : 'absent'}`);
		} catch { /* noop */ }
	}
	lines.push(`window.name: ${typeof window !== 'undefined' ? window.name : ''}`);
	lines.push(
		`opener: ${typeof window !== 'undefined' && window.opener ? 'yes' : 'no'}`,
	);
	if (extras?.initErr) {
		lines.push(`initialize() error: ${extras.initErr}`);
	}
	if (extras?.sessErr) {
		lines.push(`getSession() error: ${extras.sessErr}`);
	}
	if (extras?.user !== undefined) {
		lines.push(`session user after init: ${extras.user ? 'yes' : 'no'}`);
	}
	return lines;
}

function mergeAuthDiagnosticHints(lines: string[], errMsg?: string): void {
	const m = errMsg ?? '';
	const apiKeyBad = /invalid\s+api\s+key/i.test(m);
	const hasVerifierNo = lines.some((l) =>
		l.includes('PKCE verifier in localStorage: NO'),
	);
	if (apiKeyBad) {
		lines.push('');
		lines.push('---');
		lines.push(
			'Invalid API key: set VITE_SUPABASE_ANON_KEY to the anon (public) JWT from Supabase → Project Settings → API. No quotes or spaces. Restart the dev server after saving .env.',
		);
		lines.push(
			'VITE_SUPABASE_URL must be https://<your-project-ref>.supabase.co for that same project.',
		);
	}
	if (hasVerifierNo) {
		lines.push('');
		lines.push('---');
		lines.push(
			'PKCE verifier missing in this window: OAuth popups can split storage after the provider. Set VITE_OAUTH_USE_FULL_REDIRECT=true in .env to sign in in this tab only (recommended if this line stays NO). Restart Vite.',
		);
	}
}

function appendAuthDiagnosticsDetails(panel: HTMLElement, lines: string[]): void {
	const det = document.createElement('details');
	det.className = 'blemmy-oauth-overlay__details';
	const sum = document.createElement('summary');
	sum.textContent = 'Auth diagnostics (for debugging)';
	det.appendChild(sum);
	const pre = document.createElement('pre');
	pre.className = 'blemmy-oauth-overlay__debug';
	pre.textContent = lines.join('\n');
	det.appendChild(pre);
	panel.appendChild(det);
}

/**
 * Session blob key (not `-user` / `-code-verifier`). Matches supabase-js default.
 */
export function supabaseAuthSessionStorageKey(): string {
	if (!supabaseUrl) {
		throw new Error('Supabase URL not configured.');
	}
	const ref = new URL(supabaseUrl).hostname.split('.')[0];
	return `sb-${ref}-auth-token`;
}

function waitForOAuthStorageThenClosePopup(
	popup: Window,
	sessionStorageKey: string,
	priorSessionJson: string | null,
): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = (): void => {
			window.removeEventListener('storage', onStorage);
			window.clearInterval(pollIv);
			window.clearTimeout(timeoutId);
		};
		const finish = (fn: () => void): void => {
			if (settled) { return; }
			settled = true;
			cleanup();
			fn();
		};
		const sessionBecameReady = (json: string | null): boolean => {
			return Boolean(json) && json !== priorSessionJson;
		};
		const onStorage = (e: StorageEvent): void => {
			if (e.storageArea !== localStorage) { return; }
			if (e.key !== sessionStorageKey) { return; }
			if (!sessionBecameReady(e.newValue)) { return; }
			finish(() => {
				try { popup.close(); } catch { /* noop */ }
				resolve();
			});
		};
		window.addEventListener('storage', onStorage);
		const pollIv = window.setInterval(() => {
			if (popup.closed) {
				finish(() => {
					reject(new Error('Sign-in window closed before completing sign-in.'));
				});
				return;
			}
			try {
				const v = localStorage.getItem(sessionStorageKey);
				if (sessionBecameReady(v)) {
					finish(() => {
						try { popup.close(); } catch { /* noop */ }
						resolve();
					});
				}
			} catch { /* noop */ }
		}, 320);
		const timeoutId = window.setTimeout(() => {
			finish(() => {
				try { popup.close(); } catch { /* noop */ }
				reject(new Error('OAuth sign-in timed out.'));
			});
		}, OAUTH_WAIT_MS);
	});
}

type OAuthProviderId = 'github' | 'google';

async function signInWithOAuthProvider(
	provider: OAuthProviderId,
	scopes: string,
): Promise<{ ok: true } | { ok: false; error: CloudError }> {
	try {
		const win = typeof window !== 'undefined' ? window : undefined;
		const path = win?.location.pathname ?? '/';
		const envOrigin = (
			import.meta.env.VITE_OAUTH_REDIRECT_ORIGIN as string | undefined
		)?.trim();
		const origin = (() => {
			if (envOrigin && /^https?:\/\//i.test(envOrigin)) {
				return envOrigin.replace(/\/+$/, '');
			}
			return win?.location.origin ?? '';
		})();
		const redirectTo = `${origin}${path}`;
		const sb = getClient();
		const fullRedirect = import.meta.env.VITE_OAUTH_USE_FULL_REDIRECT === 'true';
		const oauthOpts = {
			redirectTo,
			scopes,
			skipBrowserRedirect: !fullRedirect,
		};
		if (fullRedirect) {
			const { error } = await sb.auth.signInWithOAuth({ provider, options: oauthOpts });
			if (error) {
				return { ok: false, error: toErr(error) };
			}
			return { ok: true };
		}
		const { data, error } = await sb.auth.signInWithOAuth({ provider, options: oauthOpts });
		if (error) { return { ok: false, error: toErr(error) }; }
		if (!data.url) {
			return { ok: false, error: { message: 'No OAuth URL returned.' } };
		}
		authDebugLog(`OAuth start (${provider})`, summarizeOAuthStartUrl(data.url));
		let oauthUrl: URL;
		try {
			oauthUrl = new URL(data.url);
		} catch {
			return { ok: false, error: { message: 'Invalid OAuth URL from Supabase.' } };
		}
		if (oauthUrl.origin === window.location.origin) {
			return {
				ok: false,
				error: {
					message:
						'OAuth URL points at this app, not Supabase. Check VITE_SUPABASE_URL and Auth URL in the Supabase dashboard.',
				},
			};
		}
		const sk = supabaseAuthSessionStorageKey();
		let priorSessionJson: string | null = null;
		try {
			priorSessionJson = localStorage.getItem(sk);
		} catch { /* noop */ }
		const popup = window.open(data.url, newOAuthPopupWindowName(), OAUTH_POPUP_FEATURES);
		if (!popup) {
			return {
				ok: false,
				error: {
					message: 'Popup blocked. Allow popups for this site, then try again.',
				},
			};
		}
		popup.focus();
		await waitForOAuthStorageThenClosePopup(popup, sk, priorSessionJson);
		return { ok: true };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

/** Popup by default; VITE_OAUTH_USE_FULL_REDIRECT=true uses this tab. */
export function signInWithGitHub(): Promise<
	{ ok: true } | { ok: false; error: CloudError }
> {
	return signInWithOAuthProvider('github', 'read:user user:email');
}

/** Enable Google in Supabase Auth → Providers. Popup / redirect same as GitHub. */
export function signInWithGoogle(): Promise<
	{ ok: true } | { ok: false; error: CloudError }
> {
	return signInWithOAuthProvider('google', 'openid email profile');
}

/**
 * Supabase PKCE return uses `?code=` (see GoTrue `_isPKCECallback`: code + verifier
 * in storage). A `state` query param is not required. Reject only tiny junk codes.
 */
function oauthCallbackParamsPresent(): boolean {
	const sp = new URLSearchParams(window.location.search);
	if (sp.has('error') || sp.has('error_description')) {
		return true;
	}
	const code = sp.get('code');
	return Boolean(code && code.length >= 10);
}

/** Skip mounting the full CV when the GitHub OAuth return loads in our named popup. */
export function shouldBootMinimalOAuthPopupOnly(): boolean {
	if (!CLOUD_ENABLED) {
		return false;
	}
	if (!isOAuthCallbackPopupWindow()) {
		return false;
	}
	return oauthCallbackParamsPresent();
}

function detachOauthPopupShell(): void {
	document.documentElement.classList.remove('blemmy-oauth-popup-shell');
}

function oauthSearchErrorText(): string {
	const sp = new URLSearchParams(window.location.search);
	const raw = sp.get('error_description') || sp.get('error');
	if (!raw) { return ''; }
	try {
		return decodeURIComponent(raw.replace(/\+/g, ' '));
	} catch {
		return raw;
	}
}

function stripOAuthParamsFromAddressBar(): void {
	const url = new URL(window.location.href);
	let changed = false;
	for (const k of OAUTH_URL_PARAM_KEYS) {
		if (url.searchParams.has(k)) {
			url.searchParams.delete(k);
			changed = true;
		}
	}
	if (!changed) { return; }
	const next = `${url.pathname}${url.search}${url.hash}`;
	window.history.replaceState({}, '', next);
}

function attachOAuthOverlayDismiss(overlay: HTMLElement, panel: HTMLElement): void {
	const row = document.createElement('p');
	row.className = 'blemmy-oauth-overlay__actions';
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'blemmy-oauth-overlay__btn';
	const isOAuthPopup = isOAuthCallbackPopupWindow();
	btn.textContent = isOAuthPopup ? 'Close window' : 'Continue to app';
	btn.addEventListener('click', () => {
		stripOAuthParamsFromAddressBar();
		detachOauthPopupShell();
		overlay.remove();
		if (isOAuthPopup) {
			try { window.close(); } catch { /* noop */ }
		}
	});
	row.appendChild(btn);
	panel.appendChild(row);
}

/**
 * When the OAuth redirect lands on this app (?code= / ?error=), show a visible
 * status layer (drawer auth UI is often hidden). Notifies the opener via
 * postMessage and strips callback params from the URL on success.
 */
export function bootstrapOAuthFromUrl(): void {
	if (typeof window === 'undefined') { return; }
	if (!CLOUD_ENABLED) { return; }
	if (!oauthCallbackParamsPresent()) { return; }

	const overlay = document.createElement('div');
	overlay.className = 'blemmy-oauth-overlay';
	if (isOAuthCallbackPopupWindow()) {
		overlay.classList.add('blemmy-oauth-overlay--oauth-popup');
		document.documentElement.classList.add('blemmy-oauth-popup-shell');
	}
	const panel = document.createElement('div');
	panel.className = 'blemmy-oauth-overlay__panel';
	const text = document.createElement('p');
	text.className = 'blemmy-oauth-overlay__text';
	panel.appendChild(text);
	overlay.appendChild(panel);
	document.body.appendChild(overlay);

	const setText = (s: string): void => {
		text.textContent = s;
	};

	void (async () => {
		const fromQuery = oauthSearchErrorText();
		if (fromQuery) {
			const snap = oauthCallbackSnapshotLines();
			stripOAuthParamsFromAddressBar();
			setText(fromQuery);
			appendAuthDiagnosticsDetails(panel, snap);
			authDebugLog('OAuth URL error params', fromQuery);
			attachOAuthOverlayDismiss(overlay, panel);
			return;
		}
		setText('Completing sign-in…');
		try {
			const client = getClient();
			const { error: initErr } = await client.auth.initialize();
			const { data, error: sessErr } = await client.auth.getSession();
			const user = data.session?.user ?? null;
			if (initErr) {
				const snap = oauthCallbackSnapshotLines({
					initErr: initErr.message,
					sessErr: sessErr?.message,
					user: Boolean(user),
				});
				mergeAuthDiagnosticHints(snap, initErr.message);
				stripOAuthParamsFromAddressBar();
				setText(initErr.message);
				appendAuthDiagnosticsDetails(panel, snap);
				authDebugLog('initialize() error', initErr);
				attachOAuthOverlayDismiss(overlay, panel);
				return;
			}
			if (sessErr) {
				const snap = oauthCallbackSnapshotLines({
					sessErr: sessErr.message,
					user: Boolean(user),
				});
				mergeAuthDiagnosticHints(snap, sessErr.message);
				stripOAuthParamsFromAddressBar();
				setText(sessErr.message);
				appendAuthDiagnosticsDetails(panel, snap);
				authDebugLog('getSession() error', sessErr);
				attachOAuthOverlayDismiss(overlay, panel);
				return;
			}
			if (!user) {
				const snap = oauthCallbackSnapshotLines({ user: false });
				mergeAuthDiagnosticHints(snap, '');
				stripOAuthParamsFromAddressBar();
				setText(
					'Sign-in did not complete. Check Supabase redirect URLs and GitHub app settings.',
				);
				appendAuthDiagnosticsDetails(panel, snap);
				authDebugLog('No session after OAuth callback', snap.join(' | '));
				attachOAuthOverlayDismiss(overlay, panel);
				return;
			}
			window.dispatchEvent(
				new CustomEvent<AuthChangedDetail>(AUTH_CHANGED_EVENT, { detail: { user } }),
			);
			try {
				if (window.opener) {
					window.opener.postMessage(
						{ type: OAUTH_POST_MESSAGE_TYPE, ok: true },
						window.location.origin,
					);
				}
			} catch { /* noop */ }
			stripOAuthParamsFromAddressBar();
			const isOAuthPopup = isOAuthCallbackPopupWindow();
			authDebugLog('OAuth callback success', {
				isOAuthPopup,
				userId: user.id,
			});
			if (isOAuthPopup) {
				setText('Signed in. Closing this window…');
				window.setTimeout(() => {
					detachOauthPopupShell();
					window.close();
				}, 500);
			} else {
				setText('Signed in.');
				window.setTimeout(() => {
					detachOauthPopupShell();
					overlay.remove();
				}, 900);
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			const snap = oauthCallbackSnapshotLines({ initErr: msg });
			mergeAuthDiagnosticHints(snap, msg);
			stripOAuthParamsFromAddressBar();
			setText(e instanceof Error ? e.message : String(e));
			appendAuthDiagnosticsDetails(panel, snap);
			authDebugLog('OAuth bootstrap exception', e);
			attachOAuthOverlayDismiss(overlay, panel);
		}
	})();
}

export async function signInWithMagicLink(
	email: string,
): Promise<{ ok: boolean; error?: CloudError }> {
	try {
		const origin = typeof window !== 'undefined' ? window.location.origin : '';
		const path = typeof window !== 'undefined' ? window.location.pathname : '/';
		const emailRedirectTo = `${origin}${path}`;
		const { error } = await getPasswordlessClient()
			.auth
			.signInWithOtp({
				email,
				options: {
					shouldCreateUser: true,
					emailRedirectTo,
				},
			});
		if (error) { return { ok: false, error: toErr(error) }; }
		return { ok: true };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function signOut(): Promise<void> {
	await getClient().auth.signOut();
}

export async function getCurrentUser(): Promise<User | null> {
	if (!CLOUD_ENABLED) { return null; }
	const sb = getClient();
	const { data: sess } = await sb.auth.getSession();
	if (sess.session?.user) { return sess.session.user; }
	const { data } = await sb.auth.getUser();
	return data.user ?? null;
}

async function sha256HexOfUtf8String(s: string): Promise<string> {
	const buf = new TextEncoder().encode(s);
	const hash = await crypto.subtle.digest('SHA-256', buf);
	const bytes = new Uint8Array(hash);
	let hex = '';
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i]!.toString(16).padStart(2, '0');
	}
	return hex;
}

/**
 * Stores portrait bytes once per user+hash; returns data with
 * `basics.portraitSha256` and without `portraitDataUrl` for JSONB rows.
 */
export async function stripPortablePortraitForCloud(
	data: StoredDocumentData,
): Promise<StoredDocumentData> {
	const out = JSON.parse(JSON.stringify(data)) as StoredDocumentData;
	if (!('basics' in out) || !out.basics || typeof out.basics !== 'object') {
		return out;
	}
	const basics = out.basics as Record<string, unknown>;
	const rawUrl = basics.portraitDataUrl;
	const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
	if (!url || !url.startsWith('data:image/')) {
		return out;
	}
	const user = await getCurrentUser();
	if (!user) {
		return out;
	}
	const sha256 = await sha256HexOfUtf8String(url);
	const byteLength = new Blob([url]).size;
	const sb = getClient();
	const { error } = await sb.from('cv_portrait_assets').upsert(
		{
			user_id:     user.id,
			sha256,
			image_data:  url,
			byte_length: byteLength,
		},
		{ onConflict: 'user_id,sha256' },
	);
	if (error) {
		throw new Error(error.message);
	}
	delete basics.portraitDataUrl;
	basics.portraitSha256 = sha256;
	return out;
}

/** Fetches deduped portrait for authenticated owner views. */
export async function hydratePortablePortrait(
	data: StoredDocumentData,
): Promise<StoredDocumentData> {
	const out = JSON.parse(JSON.stringify(data)) as StoredDocumentData;
	if (!('basics' in out) || !out.basics || typeof out.basics !== 'object') {
		return out;
	}
	const basics = out.basics as Record<string, unknown>;
	const rawSha = basics.portraitSha256;
	const hash = typeof rawSha === 'string'
		? rawSha.trim().toLowerCase()
		: '';
	const existingUrl = basics.portraitDataUrl;
	if (!hash || (typeof existingUrl === 'string' && existingUrl.length > 0)) {
		return out;
	}
	if (!/^[a-f0-9]{64}$/.test(hash)) {
		return out;
	}
	const sb = getClient();
	const { data: row, error } = await sb
		.from('cv_portrait_assets')
		.select('image_data')
		.eq('sha256', hash)
		.maybeSingle();
	if (error || !row?.image_data) {
		return out;
	}
	basics.portraitDataUrl = row.image_data;
	return out;
}

export function onAuthStateChange(cb: (user: User | null) => void): () => void {
	if (!CLOUD_ENABLED) { return () => { /* noop */ }; }
	const { data } = getClient().auth.onAuthStateChange((_e, session) => {
		cb(session?.user ?? null);
	});
	return () => data.subscription.unsubscribe();
}

export async function listDocuments(): Promise<CloudResult<CloudDocument[]>> {
	try {
		const sb = getClient();
		const { data: docs, error: docsErr } = await sb
			.from('documents')
			.select('*')
			.order('updated_at', { ascending: false });
		if (docsErr) { return { ok: false, error: toErr(docsErr) }; }
		if (!docs || docs.length === 0) { return { ok: true, data: [] }; }
		const ids = docs.map((d: { id: string }) => d.id);
		const { data: versions, error: versErr } = await sb
			.from('document_versions')
			.select('document_id,data')
			.in('document_id', ids)
			.order('created_at', { ascending: false });
		if (versErr) { return { ok: false, error: toErr(versErr) }; }
		const latestByDoc = new Map<string, StoredDocumentData>();
		for (const v of (versions ?? [])) {
			if (!latestByDoc.has(v.document_id)) {
				latestByDoc.set(v.document_id, v.data as CVData);
			}
		}
		const withLatest = await Promise.all(
			(docs as CloudDocument[]).map(async (d) => {
				const raw = latestByDoc.get(d.id);
				const latest = raw ? await hydratePortablePortrait(raw) : undefined;
				return { ...d, latest };
			}),
		);
		return { ok: true, data: withLatest };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function createDocument(
	name: string,
	data: StoredDocumentData,
	docType?: string,
): Promise<CloudResult<CloudDocument>> {
	try {
		const resolvedDocType = docType ?? inferDocTypeFromData(data);
		const dataWithLayout = withLayoutForDocType(data, resolvedDocType);
		const forSave = await stripPortablePortraitForCloud(dataWithLayout);
		const sb = getClient();
		const user = await getCurrentUser();
		if (!user) {
			return { ok: false, error: { message: 'Sign in required to create documents.' } };
		}
		const { data: doc, error: docErr } = await sb
			.from('documents')
			.insert({ name, doc_type: resolvedDocType, user_id: user.id })
			.select()
			.single();
		if (docErr) { return { ok: false, error: toErr(docErr) }; }
		const { error: verErr } = await sb
			.from('document_versions')
			.insert({
				document_id: doc.id,
				data: forSave,
				label: 'Initial save',
			});
		if (verErr) { return { ok: false, error: toErr(verErr) }; }
		const latestHydrated = await hydratePortablePortrait(forSave);
		return {
			ok: true,
			data: {
				...(doc as CloudDocument),
				latest: latestHydrated,
			},
		};
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function saveVersion(
	documentId: string,
	data: StoredDocumentData,
	docType?: string,
	label?: string,
): Promise<CloudResult<CloudVersion>> {
	try {
		const resolvedDocType = docType ?? inferDocTypeFromData(data);
		const dataWithLayout = withLayoutForDocType(data, resolvedDocType);
		const forSave = await stripPortablePortraitForCloud(dataWithLayout);
		const sb = getClient();
		const { data: row, error } = await sb
			.from('document_versions')
			.insert({
				document_id: documentId,
				data: forSave,
				label: label ?? null,
			})
			.select()
			.single();
		if (error) { return { ok: false, error: toErr(error) }; }
		const bump = await sb
			.from('documents')
			.update({ updated_at: new Date().toISOString() })
			.eq('id', documentId);
		if (bump.error) { return { ok: false, error: toErr(bump.error) }; }
		const rawRow = row as CloudVersion;
		const hydratedData = await hydratePortablePortrait(rawRow.data as StoredDocumentData);
		return {
			ok: true,
			data: { ...rawRow, data: hydratedData } as CloudVersion,
		};
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function listVersions(
	documentId: string,
): Promise<CloudResult<CloudVersion[]>> {
	try {
		const { data, error } = await getClient()
			.from('document_versions')
			.select('id,document_id,label,created_at,data')
			.eq('document_id', documentId)
			.order('created_at', { ascending: false });
		if (error) { return { ok: false, error: toErr(error) }; }
		const rows = (data ?? []) as CloudVersion[];
		const hydrated = await Promise.all(
			rows.map(async (v) => ({
				...v,
				data: await hydratePortablePortrait(v.data as StoredDocumentData),
			})),
		);
		return { ok: true, data: hydrated as CloudVersion[] };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function loadVersion(versionId: string): Promise<CloudResult<StoredDocumentData>> {
	try {
		const { data, error } = await getClient()
			.from('document_versions')
			.select('data')
			.eq('id', versionId)
			.single();
		if (error) { return { ok: false, error: toErr(error) }; }
		const raw = (data as { data: StoredDocumentData }).data;
		return { ok: true, data: await hydratePortablePortrait(raw) };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function renameDocument(
	documentId: string,
	name: string,
): Promise<CloudResult<void>> {
	try {
		const { error } = await getClient()
			.from('documents')
			.update({ name })
			.eq('id', documentId);
		if (error) { return { ok: false, error: toErr(error) }; }
		return { ok: true, data: undefined };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function deleteDocument(documentId: string): Promise<CloudResult<void>> {
	try {
		const { error } = await getClient()
			.from('documents')
			.delete()
			.eq('id', documentId);
		if (error) { return { ok: false, error: toErr(error) }; }
		return { ok: true, data: undefined };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function createShare(
	documentId: string,
	expiresAt: string,
): Promise<CloudResult<CloudShareCreateResult>> {
	try {
		const { data, error } = await getClient().rpc('create_document_share', {
			p_document_id: documentId,
			p_expires_at: expiresAt,
		});
		if (error) { return { ok: false, error: toErr(error) }; }
		const rowRaw = data as {
			share_id: string;
			document_id: string;
			owner_user_id: string;
			expires_at: string;
			revoked_at: string | null;
			created_at: string;
			last_accessed_at: string | null;
			access_count: number | string;
			token: string;
		} | Array<{
			share_id: string;
			document_id: string;
			owner_user_id: string;
			expires_at: string;
			revoked_at: string | null;
			created_at: string;
			last_accessed_at: string | null;
			access_count: number | string;
			token: string;
		}> | null;
		const row = Array.isArray(rowRaw) ? rowRaw[0] ?? null : rowRaw;
		if (!row?.token || !row.share_id) {
			return { ok: false, error: { message: 'Invalid share response.' } };
		}
		return {
			ok: true,
			data: {
				token: row.token,
				share: {
					id: row.share_id,
					document_id: row.document_id,
					owner_user_id: row.owner_user_id,
					expires_at: row.expires_at,
					revoked_at: row.revoked_at,
					created_at: row.created_at,
					last_accessed_at: row.last_accessed_at,
					access_count: Number(row.access_count ?? 0),
				},
			},
		};
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function listShares(
	documentId: string,
): Promise<CloudResult<CloudShare[]>> {
	try {
		const { data, error } = await getClient()
			.from('document_shares')
			.select(
				'id,document_id,owner_user_id,expires_at,revoked_at,created_at,last_accessed_at,access_count',
			)
			.eq('document_id', documentId)
			.order('created_at', { ascending: false });
		if (error) { return { ok: false, error: toErr(error) }; }
		return { ok: true, data: (data ?? []) as CloudShare[] };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function getCloudStorageUsage(): Promise<CloudResult<CloudStorageUsage>> {
	try {
		const { data, error } = await getClient().rpc('get_cloud_storage_usage');
		if (error) {
			return { ok: false, error: toErr(error) };
		}
		const raw = (Array.isArray(data) ? data[0] : data) as
			| Partial<CloudStorageUsage>
			| null;
		return {
			ok: true,
			data: {
				quota_bytes: Number(raw?.quota_bytes ?? 0),
				used_bytes: Number(raw?.used_bytes ?? 0),
				portrait_assets_bytes: Number(raw?.portrait_assets_bytes ?? 0),
				documents: Array.isArray(raw?.documents)
					? raw.documents.map((d) => ({
						document_id: String((d as CloudStorageDocUsage).document_id ?? ''),
						version_bytes: Number((d as CloudStorageDocUsage).version_bytes ?? 0),
						version_count: Number((d as CloudStorageDocUsage).version_count ?? 0),
					}))
					: [],
			},
		};
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function revokeShare(shareId: string): Promise<CloudResult<void>> {
	try {
		const { error } = await getClient()
			.from('document_shares')
			.update({ revoked_at: new Date().toISOString() })
			.eq('id', shareId);
		if (error) { return { ok: false, error: toErr(error) }; }
		return { ok: true, data: undefined };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function resolveShareToken(
	token: string,
): Promise<CloudResult<SharedDocumentView>> {
	try {
		const { data, error } = await getClient().rpc('resolve_document_share', {
			p_token: token,
		});
		if (error) {
			return { ok: false, error: normalizeShareResolveError(toErr(error)) };
		}
		const rowRaw = data as {
			document_id: string;
			document_name: string;
			expires_at: string;
			data: CVData;
		} | Array<{
			document_id: string;
			document_name: string;
			expires_at: string;
			data: CVData;
		}> | null;
		const row = Array.isArray(rowRaw) ? rowRaw[0] ?? null : rowRaw;
		if (!row?.document_id || !row?.data) {
			return { ok: false, error: { message: 'Shared CV not found.' } };
		}
		return {
			ok: true,
			data: {
				document_id: row.document_id,
				document_name: row.document_name,
				expires_at: row.expires_at,
				data: row.data,
			},
		};
	} catch (err) {
		return { ok: false, error: normalizeShareResolveError(toErr(err)) };
	}
}

export function normalizeShareResolveError(error: CloudError): CloudError {
	const message = error.message.toLowerCase();
	if (message.includes('expired')) {
		return { message: 'This share link has expired.' };
	}
	if (message.includes('revoked')) {
		return { message: 'This share link has been revoked.' };
	}
	if (message.includes('invalid') || message.includes('not found')) {
		return { message: 'This share link is invalid.' };
	}
	return { message: 'This share link is unavailable right now.' };
}

export async function requestDataExport(): Promise<CloudResult<PrivacyRequest>> {
	try {
		const user = await getCurrentUser();
		if (!user) {
			return { ok: false, error: { message: 'Sign in required.' } };
		}
		const { data, error } = await getClient()
			.from('privacy_requests')
			.insert({
				user_id: user.id,
				request_type: 'export',
				status: 'requested',
			})
			.select()
			.single();
		if (error) { return { ok: false, error: toErr(error) }; }
		return { ok: true, data: data as PrivacyRequest };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function downloadDataExport(): Promise<CloudResult<string>> {
	try {
		const user = await getCurrentUser();
		if (!user) {
			return { ok: false, error: { message: 'Sign in required.' } };
		}
		const { data, error } = await getClient().rpc('export_user_data', {
			p_user_id: user.id,
		});
		if (error) { return { ok: false, error: toErr(error) }; }
		return { ok: true, data: JSON.stringify(data, null, 2) };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function requestAccountDeletion(
	mode: 'soft' | 'hard' = 'soft',
): Promise<CloudResult<unknown>> {
	try {
		const user = await getCurrentUser();
		if (!user) {
			return { ok: false, error: { message: 'Sign in required.' } };
		}
		const req = await getClient()
			.from('privacy_requests')
			.insert({
				user_id: user.id,
				request_type: 'delete',
				status: 'processing',
				notes: `requested mode=${mode}`,
			});
		if (req.error) { return { ok: false, error: toErr(req.error) }; }
		const { data, error } = await getClient().rpc('delete_user_data', {
			p_user_id: user.id,
			p_mode: mode,
		});
		if (error) { return { ok: false, error: toErr(error) }; }
		return { ok: true, data };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function listPrivacyRequests(): Promise<CloudResult<PrivacyRequest[]>> {
	try {
		const user = await getCurrentUser();
		if (!user) {
			return { ok: false, error: { message: 'Sign in required.' } };
		}
		const { data, error } = await getClient()
			.from('privacy_requests')
			.select('*')
			.eq('user_id', user.id)
			.order('requested_at', { ascending: false });
		if (error) { return { ok: false, error: toErr(error) }; }
		return { ok: true, data: (data ?? []) as PrivacyRequest[] };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function getConsentState(
	consentKey: string,
): Promise<CloudResult<PrivacyConsent | null>> {
	try {
		const user = await getCurrentUser();
		if (!user) {
			return { ok: false, error: { message: 'Sign in required.' } };
		}
		const { data, error } = await getClient()
			.from('user_privacy_consents')
			.select('*')
			.eq('user_id', user.id)
			.eq('consent_key', consentKey)
			.maybeSingle();
		if (error) { return { ok: false, error: toErr(error) }; }
		return { ok: true, data: (data as PrivacyConsent | null) ?? null };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function saveConsentState(
	consentKey: string,
	consentValue: boolean,
	policyVersion: string,
): Promise<CloudResult<PrivacyConsent>> {
	try {
		const user = await getCurrentUser();
		if (!user) {
			return { ok: false, error: { message: 'Sign in required.' } };
		}
		const { data, error } = await getClient()
			.from('user_privacy_consents')
			.upsert({
				user_id: user.id,
				consent_key: consentKey,
				consent_value: consentValue,
				policy_version: policyVersion,
				updated_at: new Date().toISOString(),
			}, { onConflict: 'user_id,consent_key' })
			.select()
			.single();
		if (error) { return { ok: false, error: toErr(error) }; }
		return { ok: true, data: data as PrivacyConsent };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

export async function recordConsentEvent(
	consentKey: string,
	consentValue: boolean,
	policyVersion: string,
	source: string,
): Promise<CloudResult<PrivacyConsentEvent>> {
	try {
		const user = await getCurrentUser();
		if (!user) {
			return { ok: false, error: { message: 'Sign in required.' } };
		}
		const { data, error } = await getClient().rpc('log_privacy_consent_event', {
			p_consent_key: consentKey,
			p_consent_value: consentValue,
			p_policy_version: policyVersion,
			p_source: source,
		});
		if (error) { return { ok: false, error: toErr(error) }; }
		return { ok: true, data: data as PrivacyConsentEvent };
	} catch (err) {
		return { ok: false, error: toErr(err) };
	}
}

const ACTIVE_DOC_KEY = 'blemmy-cloud-active-doc';
export function saveActiveDocumentId(id: string): void {
	try { localStorage.setItem(ACTIVE_DOC_KEY, id); } catch { /* noop */ }
}
export function loadActiveDocumentId(): string | null {
	try { return localStorage.getItem(ACTIVE_DOC_KEY); } catch { return null; }
}
export function clearActiveDocumentId(): void {
	try { localStorage.removeItem(ACTIVE_DOC_KEY); } catch { /* noop */ }
}

