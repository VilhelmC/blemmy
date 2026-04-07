/**
 * letter-renderer.ts
 *
 * Renders a cover letter document into a DOM subtree from LetterData.
 *
 * Structure mirrors cv-renderer.ts conventions so the shared shell/card/page
 * classes pick up the same print CSS.
 *
 *   #letter-root
 *     #letter-shell  (.cv-shell)
 *       #letter-card  (.cv-card .letter-card)
 *         #letter-page-1  (.cv-page .letter-page)
 *           #letter-masthead  (.letter-masthead)
 *           #letter-section-recipient
 *           #letter-section-body
 *           #letter-section-closing
 *
 * Element IDs follow the domPrefix: "letter" convention from letter.doctype.json.
 * The layout engine is initialised in fill+slack-only mode for single-column
 * documents (no candidate search).
 *
 * renderLetter(data) → #letter-root  (append to document.body in main.ts)
 */

import type { LetterData } from '@cv/letter';

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function h(
	tag:      string,
	attrs:    Record<string, string> = {},
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

function emailDisplay(email: string): string {
	const at = email.indexOf('@');
	if (at <= 0) { return email; }
	return email.slice(0, at) + '\u200B' + email.slice(at);
}

// ─── Masthead ─────────────────────────────────────────────────────────────────

function renderMasthead(data: LetterData): HTMLElement {
	const { basics } = data;

	const name = h('div', { class: 'letter-sender-name', 'data-blemmy-field': 'basics.name' },
		basics.name,
	);

	const label = h('div', { class: 'letter-sender-label', 'data-blemmy-field': 'basics.label' },
		basics.label,
	);

	const contact = h('div', { class: 'letter-sender-contact' });

	if (basics.email) {
		contact.appendChild(h('span', { class: 'letter-contact-item', 'data-blemmy-field': 'basics.email' },
			emailDisplay(basics.email),
		));
	}
	if (basics.phone) {
		contact.appendChild(h('span', { class: 'letter-contact-item', 'data-blemmy-field': 'basics.phone' },
			basics.phone,
		));
	}
	if (basics.location) {
		contact.appendChild(h('span', { class: 'letter-contact-item', 'data-blemmy-field': 'basics.location' },
			basics.location,
		));
	}

	return h('div', { id: 'letter-masthead', class: 'letter-masthead' },
		h('div', { class: 'letter-masthead-identity' },
			name,
			label,
		),
		contact,
	);
}

// ─── Recipient ────────────────────────────────────────────────────────────────

function renderRecipient(data: LetterData): HTMLElement {
	const { recipient } = data;
	const block = h('div', {
		id:    'letter-section-recipient',
		class: 'letter-section letter-recipient',
	});

	const dateEl = h('p', { class: 'letter-date', 'data-blemmy-field': 'date' }, data.date);
	block.appendChild(dateEl);

	if (data.subject) {
		block.appendChild(h('p', {
			class:              'letter-subject',
			'data-blemmy-field': 'subject',
		}, `Re: ${data.subject}`));
	}

	if (recipient.name || recipient.title || recipient.organisation || recipient.address) {
		const recipientBlock = h('div', { class: 'letter-recipient-address' });
		if (recipient.name) {
			recipientBlock.appendChild(h('p', {
				class:              'letter-recipient-name',
				'data-blemmy-field': 'recipient.name',
			}, recipient.name));
		}
		if (recipient.title) {
			recipientBlock.appendChild(h('p', {
				class:              'letter-recipient-title',
				'data-blemmy-field': 'recipient.title',
			}, recipient.title));
		}
		if (recipient.organisation) {
			recipientBlock.appendChild(h('p', {
				class:              'letter-recipient-org',
				'data-blemmy-field': 'recipient.organisation',
			}, recipient.organisation));
		}
		if (recipient.address) {
			// Multi-line address — render each line
			for (const line of recipient.address.split('\n')) {
				if (line.trim()) {
					recipientBlock.appendChild(h('p', { class: 'letter-recipient-address-line' }, line.trim()));
				}
			}
		}
		block.appendChild(recipientBlock);
	}

	block.appendChild(h('p', {
		class:              'letter-opening',
		'data-blemmy-field': 'opening',
	}, data.opening));

	return block;
}

// ─── Body ─────────────────────────────────────────────────────────────────────

function renderBody(data: LetterData): HTMLElement {
	const block = h('div', {
		id:    'letter-section-body',
		class: 'letter-section letter-body',
	});

	for (let i = 0; i < data.body.length; i++) {
		const para = data.body[i];
		block.appendChild(h('p', {
			class:                   'letter-paragraph',
			'data-blemmy-field':     `body.${i}.text`,
			'data-blemmy-drag-group': 'body',
			'data-blemmy-drag-idx':   String(i),
		}, para.text));
	}

	return block;
}

// ─── Closing ──────────────────────────────────────────────────────────────────

function renderClosing(data: LetterData): HTMLElement {
	const { closing } = data;

	const salutationEl = h('p', {
		class:              'letter-closing-salutation',
		'data-blemmy-field': 'closing.salutation',
	}, closing.salutation);

	const signatureBlock = h('div', { class: 'letter-signature' });
	signatureBlock.appendChild(h('p', {
		class:              'letter-signature-name',
		'data-blemmy-field': 'closing.name',
	}, closing.name));

	if (closing.title) {
		signatureBlock.appendChild(h('p', {
			class:              'letter-signature-title',
			'data-blemmy-field': 'closing.title',
		}, closing.title));
	}

	return h('div', {
		id:    'letter-section-closing',
		class: 'letter-section letter-closing',
	},
		salutationEl,
		signatureBlock,
	);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function renderPage(data: LetterData): HTMLElement {
	const main = h('div', { id: 'letter-main-1', class: 'letter-main' },
		renderRecipient(data),
		renderBody(data),
		renderClosing(data),
	);

	return h('div', {
		id:    'letter-page-1',
		class: 'cv-page letter-page',
	},
		renderMasthead(data),
		main,
	);
}

// ─── Root export ──────────────────────────────────────────────────────────────

/**
 * Renders a complete letter document into a detached DOM subtree.
 * The subtree is appended to document.body by the caller (main.ts or
 * the document panel when switching document types).
 *
 * Returns #letter-root.
 */
export function renderLetter(data: LetterData): HTMLElement {
	document.title       = `${data.basics.name} — Cover Letter`;
	document.documentElement.lang = data.meta.language;

	const card = h('div', { id: 'letter-card', class: 'cv-card letter-card' },
		renderPage(data),
	);

	const shell = h('div', { id: 'letter-shell', class: 'cv-shell letter-shell' },
		card,
	);

	return h('div', { id: 'letter-root' }, shell);
}
