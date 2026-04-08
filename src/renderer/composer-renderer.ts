/**
 * letter-renderer.ts
 *
 * Renders a cover letter document into a DOM subtree from LetterData.
 *
 * Structure mirrors blemmy-renderer.ts conventions so the shared shell/card/page
 * classes pick up the same print CSS.
 *
 *   #blemmy-doc-root
 *     #blemmy-doc-shell  (.blemmy-shell)
 *       #blemmy-card  (.blemmy-card .blemmy-card)
 *         #blemmy-page-1  (.blemmy-page .blemmy-page)
 *           #blemmy-masthead  (.blemmy-masthead)
 *           #blemmy-section-recipient
 *           #blemmy-section-body
 *           #blemmy-section-closing
 *
 * Element IDs follow the domPrefix: "letter" convention from letter.doctype.json.
 * The layout engine is initialised in fill+slack-only mode for single-column
 * documents (no candidate search).
 *
 * renderLetter(data) → #blemmy-doc-root (append in main.ts)
 */

import type { LetterData } from '@cv/letter';
import {
	BLEMMY_DOC_ROOT_ID,
	BLEMMY_DOC_SHELL_ID,
} from '@lib/blemmy-dom-ids';

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

	const name = h('div', { class: 'blemmy-sender-name', 'data-blemmy-field': 'basics.name' },
		basics.name,
	);

	const label = h('div', { class: 'blemmy-sender-label', 'data-blemmy-field': 'basics.label' },
		basics.label,
	);

	const contact = h('div', { class: 'blemmy-sender-contact' });

	if (basics.email) {
		contact.appendChild(h('span', { class: 'blemmy-contact-item', 'data-blemmy-field': 'basics.email' },
			emailDisplay(basics.email),
		));
	}
	if (basics.phone) {
		contact.appendChild(h('span', { class: 'blemmy-contact-item', 'data-blemmy-field': 'basics.phone' },
			basics.phone,
		));
	}
	if (basics.location) {
		contact.appendChild(h('span', { class: 'blemmy-contact-item', 'data-blemmy-field': 'basics.location' },
			basics.location,
		));
	}

	return h('div', { id: 'blemmy-masthead', class: 'blemmy-masthead' },
		h('div', { class: 'blemmy-masthead-identity' },
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
		id:    'blemmy-section-recipient',
		class: 'blemmy-section letter-recipient',
	});

	const dateEl = h('p', { class: 'blemmy-date', 'data-blemmy-field': 'date' }, data.date);
	block.appendChild(dateEl);

	if (data.subject) {
		block.appendChild(h('p', {
			class:              'blemmy-subject',
			'data-blemmy-field': 'subject',
		}, `Re: ${data.subject}`));
	}

	if (recipient.name || recipient.title || recipient.organisation || recipient.address) {
		const recipientBlock = h('div', { class: 'blemmy-recipient-address' });
		if (recipient.name) {
			recipientBlock.appendChild(h('p', {
				class:              'blemmy-recipient-name',
				'data-blemmy-field': 'recipient.name',
			}, recipient.name));
		}
		if (recipient.title) {
			recipientBlock.appendChild(h('p', {
				class:              'blemmy-recipient-title',
				'data-blemmy-field': 'recipient.title',
			}, recipient.title));
		}
		if (recipient.organisation) {
			recipientBlock.appendChild(h('p', {
				class:              'blemmy-recipient-org',
				'data-blemmy-field': 'recipient.organisation',
			}, recipient.organisation));
		}
		if (recipient.address) {
			// Multi-line address — render each line
			for (const line of recipient.address.split('\n')) {
				if (line.trim()) {
					recipientBlock.appendChild(h('p', { class: 'blemmy-recipient-address-line' }, line.trim()));
				}
			}
		}
		block.appendChild(recipientBlock);
	}

	block.appendChild(h('p', {
		class:              'blemmy-opening',
		'data-blemmy-field': 'opening',
	}, data.opening));

	return block;
}

// ─── Body ─────────────────────────────────────────────────────────────────────

function renderBody(data: LetterData): HTMLElement {
	const block = h('div', {
		id:    'blemmy-section-body',
		class: 'blemmy-section blemmy-body',
	});

	for (let i = 0; i < data.body.length; i++) {
		const para = data.body[i];
		block.appendChild(h('p', {
			class:                   'blemmy-paragraph',
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
		class:              'blemmy-closing-salutation',
		'data-blemmy-field': 'closing.salutation',
	}, closing.salutation);

	const signatureBlock = h('div', { class: 'blemmy-signature' });
	signatureBlock.appendChild(h('p', {
		class:              'blemmy-signature-name',
		'data-blemmy-field': 'closing.name',
	}, closing.name));

	if (closing.title) {
		signatureBlock.appendChild(h('p', {
			class:              'blemmy-signature-title',
			'data-blemmy-field': 'closing.title',
		}, closing.title));
	}

	return h('div', {
		id:    'blemmy-section-closing',
		class: 'blemmy-section blemmy-closing-block',
	},
		salutationEl,
		signatureBlock,
	);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function renderPage(data: LetterData): HTMLElement {
	const main = h('div', { id: 'blemmy-main-1', class: 'blemmy-main' },
		renderRecipient(data),
		renderBody(data),
		renderClosing(data),
	);

	return h('div', {
		id:    'blemmy-page-1',
		class: 'blemmy-page',
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
 * Returns #blemmy-doc-root.
 */
export type BlemmyLetterRenderOptions = { skipDocumentMeta?: boolean };

export function renderLetter(
	data: LetterData,
	opts?: BlemmyLetterRenderOptions,
): HTMLElement {
	if (!opts?.skipDocumentMeta) {
		document.title = `${data.basics.name} · Blemmy`;
		document.documentElement.lang = data.meta.language;
	}

	const card = h('div', { id: 'blemmy-card', class: 'blemmy-card' },
		renderPage(data),
	);

	const shell = h('div', {
		id:    BLEMMY_DOC_SHELL_ID,
		class: 'blemmy-shell',
	},
		card,
	);

	return h('div', { id: BLEMMY_DOC_ROOT_ID }, shell);
}
