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
	const github = h('button', {
		id: 'cv-auth-github', class: 'cv-auth-btn', type: 'button',
	}, 'Continue with GitHub');
	const google = h('button', {
		id: 'cv-auth-google', class: 'cv-auth-btn', type: 'button',
	}, 'Continue with Google');
	const out = h('button', { id: 'cv-auth-signout', class: 'cv-auth-btn', type: 'button', hidden: '' }, 'Sign out');
	const privacy = h('div', { id: 'cv-auth-privacy', class: 'cv-auth-privacy', hidden: '' });
	const privacyTitle = h('p', { class: 'cv-auth-privacy__title' }, 'Privacy');
	const privacyStatus = h('p', { class: 'cv-auth-privacy__status', hidden: '' });
	const consentLabel = h('label', { class: 'cv-auth-privacy__consent' });
	const consentInput = h('input', { type: 'checkbox' }) as HTMLInputElement;
	const noticeLink = h('a', {
		href: 'https://github.com/vilhelm',
		target: '_blank',
		rel: 'noopener noreferrer',
	}, 'privacy notice v1');
	consentLabel.append(
		consentInput,
		document.createTextNode('I accept cloud '),
		noticeLink,
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
	emailPassBlock.append(fieldHint, authPolicyLabel, email, pass, submit, toggle, magic);
	mount.append(introHint, msg, github, google, expandBtn, emailPassBlock, out, privacy);

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

