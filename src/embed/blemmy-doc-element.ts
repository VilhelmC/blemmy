/**
 * Custom element: <blemmy-doc src="url" doctype="cv|letter">
 *
 * Fetches JSON, optionally applies embedded DocumentStyle, mounts read-only
 * layout. One document per page is supported (fixed #blemmy-doc-root ids).
 */

import type { DocumentStyle } from '@lib/document-style';
import { applyDocumentStyle } from '@lib/document-style';
import { mountReadonlyBlemmyInContainer } from '@lib/blemmy-readonly-mount';
import { isRegisteredDocumentType } from '@lib/document-runtime-registry';

const STYLE_JSON_KEY = 'blemmyDocumentStyle';

function splitEmbedPayload(raw: unknown): {
	document: unknown;
	stylePatch?: Partial<DocumentStyle>;
} {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return { document: raw };
	}
	const o = raw as Record<string, unknown>;
	if (!(STYLE_JSON_KEY in o)) {
		return { document: raw };
	}
	const { [STYLE_JSON_KEY]: st, ...rest } = o;
	const stylePatch =
		st && typeof st === 'object' && !Array.isArray(st)
			? (st as Partial<DocumentStyle>)
			: undefined;
	return { document: rest, stylePatch };
}

function setStatus(el: BlemmyDocElement, message: string, isErr: boolean): void {
	el.replaceChildren();
	const p = document.createElement('p');
	p.className = isErr
		? 'blemmy-doc-embed__status blemmy-doc-embed__status--error'
		: 'blemmy-doc-embed__status';
	p.textContent = message;
	el.appendChild(p);
}

export class BlemmyDocElement extends HTMLElement {
	private mountCleanup: (() => void) | null = null;
	private loadAbort: AbortController | null = null;

	private static rootTypoLocks = 0;

	static get observedAttributes(): string[] {
		return ['src', 'doctype'];
	}

	connectedCallback(): void {
		BlemmyDocElement.rootTypoLocks += 1;
		if (BlemmyDocElement.rootTypoLocks === 1) {
			document.documentElement.classList.add('blemmy-doc-embed-typography');
		}
		this.classList.add(
			'blemmy-doc-embed',
			'blemmy-print-surface',
		);
		void this.reload();
	}

	disconnectedCallback(): void {
		BlemmyDocElement.rootTypoLocks = Math.max(
			0,
			BlemmyDocElement.rootTypoLocks - 1,
		);
		if (BlemmyDocElement.rootTypoLocks === 0) {
			document.documentElement.classList.remove('blemmy-doc-embed-typography');
		}
		this.loadAbort?.abort();
		this.loadAbort = null;
		this.mountCleanup?.();
		this.mountCleanup = null;
	}

	attributeChangedCallback(
		name: string,
		oldVal: string | null,
		newVal: string | null,
	): void {
		if (oldVal === newVal) { return; }
		if (name === 'src' || name === 'doctype') {
			void this.reload();
		}
	}

	private async reload(): Promise<void> {
		this.loadAbort?.abort();
		const ac = new AbortController();
		this.loadAbort = ac;

		this.mountCleanup?.();
		this.mountCleanup = null;
		this.replaceChildren();

		const src = this.getAttribute('src')?.trim();
		if (!src) {
			setStatus(this, 'Missing src attribute (URL to document JSON).', true);
			return;
		}

		const doctypeAttr = this.getAttribute('doctype')?.trim();
		const docTypeOpt =
			doctypeAttr && isRegisteredDocumentType(doctypeAttr)
				? doctypeAttr
				: undefined;

		setStatus(this, 'Loading document…', false);

		try {
			const res = await fetch(src, {
				signal: ac.signal,
				credentials: 'same-origin',
			});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}
			const raw: unknown = await res.json();
			if (ac.signal.aborted) { return; }

			const { document: docJson, stylePatch } = splitEmbedPayload(raw);

			applyDocumentStyle(stylePatch ?? {}, { tokenRoot: this });

			this.replaceChildren();
			if (ac.signal.aborted) { return; }
			const { cleanup } = mountReadonlyBlemmyInContainer(
				this,
				docJson,
				{ docType: docTypeOpt },
			);
			if (ac.signal.aborted) {
				cleanup();
				return;
			}
			this.mountCleanup = cleanup;
		} catch (e) {
			if (ac.signal.aborted) { return; }
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(this, `Could not load document: ${msg}`, true);
		}
	}
}

export function registerBlemmyDocElement(tagName = 'blemmy-doc'): void {
	if (!customElements.get(tagName)) {
		customElements.define(tagName, BlemmyDocElement);
	}
}
