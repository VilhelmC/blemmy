import type { User } from '@supabase/supabase-js';
import {
	AUTH_CHANGED_EVENT,
	CLOUD_ENABLED,
	downloadDataExport,
	getClient,
	getConsentState,
	listPrivacyRequests,
	OAUTH_POST_MESSAGE_TYPE,
	onAuthStateChange,
	recordConsentEvent,
	requestAccountDeletion,
	requestDataExport,
	saveConsentState,
	signIn,
	signInWithGitHub,
	signInWithGoogle,
	signInWithMagicLink,
	signOut,
	signUp,
	supabaseAuthSessionStorageKey,
	type AuthChangedDetail,
} from '@lib/cv-cloud';

export { AUTH_CHANGED_EVENT, type AuthChangedDetail };

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

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgPath(svg: SVGSVGElement, d: string, fill: string): void {
	const p = document.createElementNS(SVG_NS, 'path');
	p.setAttribute('d', d);
	p.setAttribute('fill', fill);
	svg.appendChild(p);
}

/** GitHub mark (monochrome; follows https://github.com/logos). */
function buildGithubOAuthIcon(): SVGSVGElement {
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('class', 'cv-auth-oauth-icon');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	const d =
		'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 ' +
		'0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.416-4.042-1.416-.546-1.387-1.333-1.756-1.333-1.756' +
		'-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997' +
		'.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221' +
		'-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005' +
		'2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235' +
		'1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694' +
		'.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12';
	svgPath(svg, d, 'currentColor');
	return svg;
}

/** Google "G" (brand colors; trademark Google LLC). */
function buildGoogleOAuthIcon(): SVGSVGElement {
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('class', 'cv-auth-oauth-icon');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	const parts: Array<{ d: string; fill: string }> = [
		{
			d:
				'M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 ' +
				'3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z',
			fill: '#4285F4',
		},
		{
			d:
				'M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 ' +
				'0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z',
			fill: '#34A853',
		},
		{
			d:
				'M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 ' +
				'10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z',
			fill: '#FBBC05',
		},
		{
			d:
				'M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 ' +
				'3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z',
			fill: '#EA4335',
		},
	];
	for (const { d: pathD, fill } of parts) {
		svgPath(svg, pathD, fill);
	}
	return svg;
}

function buildOAuthProviderButton(
	id: string,
	label: string,
	icon: SVGSVGElement,
): HTMLButtonElement {
	const btn = h('button', {
		id,
		class: 'cv-auth-btn cv-auth-btn--oauth',
		type: 'button',
	}) as HTMLButtonElement;
	btn.append(icon, h('span', { class: 'cv-auth-oauth-label' }, label));
	return btn;
}

function dispatchAuthChanged(user: User | null): void {
	window.dispatchEvent(
		new CustomEvent<AuthChangedDetail>(AUTH_CHANGED_EVENT, { detail: { user } }),
	);
}

function displayNameForUser(user: User): string {
	const meta = user.user_metadata as Record<string, unknown> | undefined;
	const fromMeta = (k: string) => {
		const v = meta?.[k];
		return typeof v === 'string' && v.trim() ? v.trim() : '';
	};
	return (
		user.email?.trim()
		|| fromMeta('email')
		|| fromMeta('full_name')
		|| fromMeta('name')
		|| fromMeta('user_name')
		|| fromMeta('preferred_username')
		|| user.phone?.trim()
		|| 'Signed in'
	);
}

export type AuthPanelOptions = {
	mount: HTMLElement;
	closeDrawer?: () => void;
};

/** Shared GDPR-style copy for sign-in and signed-in cloud consent. */
function buildGdprPolicyTextSpan(): HTMLSpanElement {
	return h(
		'span',
		{},
		'I agree to the ',
		h(
			'a',
			{
				href:   'https://gdpr.eu/what-is-gdpr/',
				target: '_blank',
				rel:    'noopener noreferrer',
			},
			'privacy policy',
		),
		' and data processing terms.',
	) as HTMLSpanElement;
}

export function initAuthPanel(opts: AuthPanelOptions): void {
	const { mount, closeDrawer } = opts;
	if (!CLOUD_ENABLED) {
		mount.appendChild(
			h('p', { class: 'cv-cloud-drawer__muted' }, 'Cloud disabled (.env not configured).'),
		);
		return;
	}
	const introHint = h(
		'p',
		{ class: 'cv-cloud-drawer__muted cv-auth-intro' },
		'GitHub and Google open in a small window. Magic links usually open in a new tab ' +
			'because of your email app; this page updates automatically when sign-in finishes.',
	);
	const email = h('input', {
		id: 'cv-auth-email',
		class: 'cv-auth-input',
		type: 'email',
		autocomplete: 'email',
		placeholder: 'Email address (required for magic link and password sign-in)',
	});
	const pass = h('input', {
		id: 'cv-auth-password',
		class: 'cv-auth-input',
		type: 'password',
		autocomplete: 'current-password',
		placeholder: 'Password — only if you use sign in or sign up, not for magic link',
	});
	const fieldHint = h(
		'p',
		{ class: 'cv-cloud-drawer__muted cv-auth-field-hint' },
		'Enter your email first. Use the password field only with Sign in or Sign up. ' +
			'Magic link emails a sign-in link to that address.',
	);
	const authPolicyLabel = h('label', { class: 'cv-auth-policy' });
	const authPolicyInput = h('input', {
		id: 'cv-auth-policy-accept',
		type: 'checkbox',
	}) as HTMLInputElement;
	const authPolicyText = h(
		'span',
		{},
		'I agree to the ',
		h(
			'a',
			{
				href: 'https://gdpr.eu/what-is-gdpr/',
				target: '_blank',
				rel: 'noopener noreferrer',
			},
			'privacy policy',
		),
		' and data processing terms.',
	);
	authPolicyLabel.append(authPolicyInput, authPolicyText);
	const msg = h('p', {
		id: 'cv-auth-msg',
		class: 'cv-auth-msg',
		hidden: '',
		'aria-live': 'polite',
		role: 'status',
	});
	const submit = h('button', { id: 'cv-auth-submit', class: 'cv-auth-btn', type: 'button' }, 'Sign in');
	const toggle = h('button', { id: 'cv-auth-toggle', class: 'cv-auth-btn', type: 'button' }, 'Switch to sign up');
	const magic = h('button', { id: 'cv-auth-magic', class: 'cv-auth-btn', type: 'button' }, 'Send magic link');
	const emailPassBlock = h('div', {
		id: 'cv-auth-email-pass',
		class: 'cv-auth-email-pass',
		hidden: '',
	});
	const expandBtn = h(
		'button',
		{
			type: 'button',
			class: 'cv-auth-btn cv-auth-expand',
			'aria-expanded': 'false',
			'aria-controls': 'cv-auth-email-pass',
		},
		'Sign in, sign up, or magic link',
	);
	const github = buildOAuthProviderButton(
		'cv-auth-github',
		'Continue with GitHub',
		buildGithubOAuthIcon(),
	);
	const google = buildOAuthProviderButton(
		'cv-auth-google',
		'Continue with Google',
		buildGoogleOAuthIcon(),
	);
	const out = h('button', { id: 'cv-auth-signout', class: 'cv-auth-btn', type: 'button', hidden: '' }, 'Sign out');
	const privacy = h('div', { id: 'cv-auth-privacy', class: 'cv-auth-privacy', hidden: '' });
	const privacyTitle = h('p', { class: 'cv-auth-privacy__title' }, 'Privacy');
	const privacyStatus = h('p', { class: 'cv-auth-privacy__status', hidden: '' });
	const consentLabel = h('label', {
		class: 'cv-auth-policy cv-auth-privacy__consent',
	});
	const consentInput = h('input', { type: 'checkbox' }) as HTMLInputElement;
	const noticeLink = h('a', {
		href:   'https://github.com/vilhelm',
		target: '_blank',
		rel:    'noopener noreferrer',
	}, 'cloud processing notice (v1)');
	consentLabel.append(
		consentInput,
		buildGdprPolicyTextSpan(),
		document.createTextNode(' See also '),
		noticeLink,
		document.createTextNode('.'),
	);
	const exportBtn = h('button', { class: 'cv-auth-btn', type: 'button' }, 'Export my data');
	const exportReqBtn = h('button', { class: 'cv-auth-btn', type: 'button' }, 'Request export record');
	const deleteBtn = h('button', { class: 'cv-auth-btn', type: 'button' }, 'Delete my cloud data');
	const requestList = h('div', { class: 'cv-auth-privacy__requests' });
	privacy.append(
		privacyTitle,
		privacyStatus,
		consentLabel,
		exportBtn,
		exportReqBtn,
		deleteBtn,
		requestList,
	);
	let lastKnownUserId: string | null = null;
	let mode: 'signin' | 'signup' = 'signin';
	const POLICY_KEY = 'cloud_privacy_notice';
	const POLICY_VERSION = 'v1';
	let pendingConsentSource:
		| 'password_signup'
		| 'oauth_google'
		| 'oauth_github'
		| 'magic_link'
		| null = null;
	function setMsg(text: string): void {
		msg.textContent = text;
		msg.hidden = !text;
	}
	function setMode(next: 'signin' | 'signup'): void {
		mode = next;
		submit.textContent = next === 'signin' ? 'Sign in' : 'Sign up';
		toggle.textContent = next === 'signin' ? 'Switch to sign up' : 'Switch to sign in';
	}
	setMode('signin');
	const EXPAND_LABEL = 'Sign in, sign up, or magic link';
	const COLLAPSE_LABEL = 'Hide email, password & magic link';
	function setEmailPanelOpen(open: boolean): void {
		if (open) {
			emailPassBlock.removeAttribute('hidden');
			expandBtn.setAttribute('aria-expanded', 'true');
			expandBtn.textContent = COLLAPSE_LABEL;
			(email as HTMLInputElement).focus();
		} else {
			emailPassBlock.setAttribute('hidden', '');
			expandBtn.setAttribute('aria-expanded', 'false');
			expandBtn.textContent = EXPAND_LABEL;
		}
	}
	expandBtn.addEventListener('click', () => {
		setEmailPanelOpen(emailPassBlock.hasAttribute('hidden'));
	});
	toggle.addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));
	submit.addEventListener('click', async () => {
		const e = (email as HTMLInputElement).value.trim();
		const p = (pass as HTMLInputElement).value;
		if (!e || !p) { setMsg('Enter email and password.'); return; }
		if (mode === 'signup' && !authPolicyInput.checked) {
			setMsg('Accept the privacy policy before sign up.');
			return;
		}
		const res = mode === 'signin' ? await signIn(e, p) : await signUp(e, p);
		setMsg(res.ok ? '' : res.error.message);
		if (res.ok && mode === 'signup') {
			const consent = await saveConsentState(POLICY_KEY, true, POLICY_VERSION);
			if (consent.ok) {
				void recordConsentEvent(
					POLICY_KEY,
					true,
					POLICY_VERSION,
					'password_signup',
				);
			}
		}
		if (res.ok) { closeDrawer?.(); }
	});
	magic.addEventListener('click', async () => {
		const e = (email as HTMLInputElement).value.trim();
		if (!e) { setMsg('Enter email first.'); return; }
		if (!authPolicyInput.checked) {
			setMsg('Accept the privacy policy before requesting magic link sign-in.');
			return;
		}
		pendingConsentSource = 'magic_link';
		const res = await signInWithMagicLink(e);
		setMsg(
			res.ok
				? 'Check your email and open the link. If it opens in another tab, this tab ' +
						'will sign you in when you are done. You can close the extra tab afterward.'
				: (res.error?.message ?? 'Failed.'),
		);
	});
	type OAuthFlowResult = Awaited<ReturnType<typeof signInWithGitHub>>;
	function attachPopupOAuth(
		el: HTMLElement,
		waitMsg: string,
		sign: () => Promise<OAuthFlowResult>,
	): void {
		el.addEventListener('click', async () => {
			if (!authPolicyInput.checked) {
				setMsg('Accept the privacy policy before continuing.');
				return;
			}
			setMsg(waitMsg);
			const origin = window.location.origin;
			const pullSessionIntoUi = async (): Promise<void> => {
				const client = getClient();
				await client.auth.initialize();
				let user: User | null = null;
				let sessErr: { message: string } | null = null;
				const deadline = Date.now() + 8000;
				while (Date.now() < deadline && !user) {
					const { data, error } = await client.auth.getSession();
					if (error) {
						sessErr = error;
						break;
					}
					user = data.session?.user ?? null;
					if (user) { break; }
					await new Promise((r) => {
						window.setTimeout(r, 120);
					});
				}
				if (sessErr) {
					setMsg(sessErr.message);
					syncAuthUi(null);
					return;
				}
				syncAuthUi(user);
				if (!user) {
					setMsg(
						'OAuth sign-in did not produce a session. Check Supabase Site URL ' +
							'and redirect allow list, popup blockers, and try again.',
					);
				}
			};
			const onOpenerMsg = (e: MessageEvent): void => {
				if (e.origin !== origin) { return; }
				if (e.data?.type !== OAUTH_POST_MESSAGE_TYPE || e.data?.ok !== true) { return; }
				void pullSessionIntoUi();
			};
			window.addEventListener('message', onOpenerMsg);
			const msgTimer = window.setTimeout(
				() => window.removeEventListener('message', onOpenerMsg),
				120_000,
			);
			try {
				const res = await sign();
				if (!res.ok) {
					setMsg(res.error.message);
					return;
				}
				pendingConsentSource = sign === signInWithGoogle
					? 'oauth_google'
					: 'oauth_github';
				await pullSessionIntoUi();
			} finally {
				window.clearTimeout(msgTimer);
				window.removeEventListener('message', onOpenerMsg);
			}
		});
	}
	attachPopupOAuth(
		github,
		'Complete sign-in in the new window (GitHub, then back here)…',
		signInWithGitHub,
	);
	attachPopupOAuth(
		google,
		'Complete sign-in in the new window (Google, then back here)…',
		signInWithGoogle,
	);
	out.addEventListener('click', async () => {
		await signOut();
		setMsg('');
	});
	function setPrivacyStatus(text: string, isErr = false): void {
		privacyStatus.textContent = text;
		privacyStatus.hidden = !text;
		privacyStatus.className = 'cv-auth-privacy__status' + (
			isErr ? ' cv-auth-privacy__status--error' : ''
		);
	}
	async function refreshPrivacy(user: User | null): Promise<void> {
		if (!user) {
			privacy.hidden = true;
			return;
		}
		privacy.hidden = false;
		const consent = await getConsentState('cloud_privacy_notice');
		if (consent.ok) {
			consentInput.checked = Boolean(consent.data?.consent_value);
		}
		const requests = await listPrivacyRequests();
		requestList.innerHTML = '';
		if (!requests.ok) {
			requestList.appendChild(
				h('p', { class: 'cv-cloud-drawer__muted' }, requests.error.message),
			);
			return;
		}
		if (requests.data.length === 0) {
			requestList.appendChild(
				h('p', { class: 'cv-cloud-drawer__muted' }, 'No privacy requests yet.'),
			);
			return;
		}
		for (const req of requests.data.slice(0, 5)) {
			requestList.appendChild(
				h('p', { class: 'cv-cloud-drawer__muted' }, `${req.request_type}: ${req.status}`),
			);
		}
	}
	consentInput.addEventListener('change', async () => {
		const saved = await saveConsentState(
			'cloud_privacy_notice',
			consentInput.checked,
			'v1',
		);
		if (!saved.ok) {
			setPrivacyStatus(saved.error.message, true);
			return;
		}
		setPrivacyStatus('Consent updated.');
	});
	exportBtn.addEventListener('click', async () => {
		const exported = await downloadDataExport();
		if (!exported.ok) {
			setPrivacyStatus(exported.error.message, true);
			return;
		}
		const blob = new Blob([exported.data], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'cv-export.json';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		setPrivacyStatus('Data export downloaded.');
	});
	exportReqBtn.addEventListener('click', async () => {
		const req = await requestDataExport();
		if (!req.ok) {
			setPrivacyStatus(req.error.message, true);
			return;
		}
		setPrivacyStatus('Export request recorded.');
		const user = await getClient().auth.getUser();
		await refreshPrivacy(user.data.user ?? null);
	});
	deleteBtn.addEventListener('click', async () => {
		const ok = window.confirm(
			'Delete your cloud data? This cannot be undone.',
		);
		if (!ok) { return; }
		const deleted = await requestAccountDeletion('hard');
		if (!deleted.ok) {
			setPrivacyStatus(deleted.error.message, true);
			return;
		}
		setPrivacyStatus('Cloud data deletion completed.');
	});
	emailPassBlock.append(fieldHint, email, pass, submit, toggle, magic);
	mount.append(
		introHint,
		msg,
		authPolicyLabel,
		github,
		google,
		expandBtn,
		emailPassBlock,
		out,
		privacy,
	);

	function syncAuthUi(user: User | null): void {
		lastKnownUserId = user?.id ?? null;
		dispatchAuthChanged(user);
		const signedIn = Boolean(user);
		out.hidden = !signedIn;
		introHint.hidden = signedIn;
		expandBtn.hidden = signedIn;
		if (signedIn) {
			emailPassBlock.setAttribute('hidden', '');
			expandBtn.setAttribute('aria-expanded', 'false');
			expandBtn.textContent = EXPAND_LABEL;
		}
		submit.hidden = signedIn;
		toggle.hidden = signedIn;
		magic.hidden = signedIn;
		github.hidden = signedIn;
		google.hidden = signedIn;
		authPolicyLabel.hidden = signedIn;
		email.hidden = signedIn;
		pass.hidden = signedIn;
		fieldHint.hidden = signedIn;
		if (signedIn && user) {
			setMsg(`Signed in as ${displayNameForUser(user)}`);
			if (pendingConsentSource) {
				const source = pendingConsentSource;
				pendingConsentSource = null;
				void saveConsentState(POLICY_KEY, true, POLICY_VERSION).then((saved) => {
					if (!saved.ok) { return; }
					void recordConsentEvent(
						POLICY_KEY,
						true,
						POLICY_VERSION,
						source,
					);
				});
			}
			void refreshPrivacy(user);
		} else {
			setMsg('');
			void refreshPrivacy(null);
		}
	}

	function oauthParamsMessage(): string {
		const sp = new URLSearchParams(window.location.search);
		const raw = sp.get('error_description') || sp.get('error');
		if (!raw) { return ''; }
		try {
			return decodeURIComponent(raw.replace(/\+/g, ' '));
		} catch {
			return raw;
		}
	}

	const sessionStorageKey = supabaseAuthSessionStorageKey();
	window.addEventListener('storage', (e: StorageEvent) => {
		if (e.storageArea !== localStorage || e.key !== sessionStorageKey) {
			return;
		}
		void (async () => {
			const prior = lastKnownUserId;
			const client = getClient();
			await client.auth.initialize();
			const { data } = await client.auth.getSession();
			const u = data.session?.user ?? null;
			syncAuthUi(u);
			if (u && u.id !== prior) {
				closeDrawer?.();
			}
		})();
	});

	void (async () => {
		const client = getClient();
		const { error: bootInitErr } = await client.auth.initialize();
		const { data: first, error: firstSessErr } = await client.auth.getSession();
		syncAuthUi(first.session?.user ?? null);
		if (bootInitErr) {
			setMsg(bootInitErr.message);
		} else if (firstSessErr) {
			setMsg(firstSessErr.message);
		} else if (!first.session) {
			const pm = oauthParamsMessage();
			if (pm) { setMsg(pm); }
		}
		onAuthStateChange((user) => {
			syncAuthUi(user);
		});
	})();
}

