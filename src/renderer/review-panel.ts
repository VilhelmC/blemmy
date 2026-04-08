/**
 * review-panel.ts
 *
 * Side drawer UI for the review annotation layer.
 *
 * States:
 *   closed      — hidden, no content rendered
 *   browse      — list of all open comments, grouped by path
 *   thread      — expanded comment thread for a specific path
 *   new-comment — blank comment form pre-targeted to a path
 *
 * Called from ui-components.ts. The review toggle button in leftDock
 * opens/closes the panel and activates review mode on the CV shell.
 */

import type { CVData } from '@cv/cv';
import type { CVReview, ReviewComment, ContentPath } from '@cv/review-types';
import {
	addComment,
	resolveComment,
	addReply,
	deleteComment,
	nanoId,
	openCommentCount,
} from '@lib/review-dom';
import { DOCK_CONTROLS } from '@renderer/dock-controls';
import {
	DOCKED_SIDE_PANEL_CLASS,
	dispatchDockedPanelClose,
	dispatchDockedPanelOpen,
} from '@renderer/docked-side-panels';

// ─── DOM helper ───────────────────────────────────────────────────────────────

function h(
	tag:   string,
	attrs: Record<string, string> = {},
	...children: (Node | string | null | undefined)[]
): HTMLElement {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		el.setAttribute(k === 'className' ? 'class' : k, v);
	}
	for (const c of children) {
		if (c == null) { continue; }
		el.append(typeof c === 'string' ? document.createTextNode(c) : c);
	}
	return el;
}

function fmtDate(iso: string): string {
	try {
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	} catch {
		return '';
	}
}

function fmtAuthor(author: string): string {
	if (author === 'user')      { return 'You'; }
	if (author === 'assistant') { return 'Assistant'; }
	return author;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export const REVIEW_CHANGED_EVENT = 'blemmy-review-changed';
export const REVIEW_PANEL_OPEN_EVENT = 'blemmy-review-open';
export const REVIEW_PANEL_CLOSE_EVENT = 'blemmy-review-close';
export type ReviewChangedDetail = { review: CVReview };

function dispatch(review: CVReview): void {
	window.dispatchEvent(
		new CustomEvent<ReviewChangedDetail>(REVIEW_CHANGED_EVENT, { detail: { review } }),
	);
}

// ─── Comment item ─────────────────────────────────────────────────────────────

function buildCommentItem(
	comment:   ReviewComment,
	review:    CVReview,
	onRefresh: () => void,
	onOpen:    (path: ContentPath) => void,
): HTMLElement {
	const isResolved = comment.status === 'resolved';
	const isFlagged  = comment.status === 'flagged';

	const statusDot = h('span', {
		class: `blemmy-review-item__dot blemmy-review-item__dot--${comment.status}`,
		title: comment.status,
	});

	const authorEl = h('span', { class: 'blemmy-review-item__author' },
		fmtAuthor(comment.author),
	);
	const dateEl = h('span', { class: 'blemmy-review-item__date' }, fmtDate(comment.createdAt));
	const pathEl = h('button', {
		type:  'button',
		class: 'blemmy-review-item__path',
		title: `Jump to ${comment.path}`,
	}, comment.path);
	pathEl.addEventListener('click', () => onOpen(comment.path));

	const meta = h('div', { class: 'blemmy-review-item__meta' }, statusDot, authorEl, dateEl, pathEl);

	const body = h('p', { class: 'blemmy-review-item__body' }, comment.text);
	if (isFlagged) { body.classList.add('blemmy-review-item__body--flagged'); }
	if (isResolved) { body.classList.add('blemmy-review-item__body--resolved'); }

	// Replies
	const repliesEl = h('div', { class: 'blemmy-review-item__replies' });
	for (const reply of comment.replies ?? []) {
		const replyEl = h('div', { class: 'blemmy-review-item__reply' },
			h('span', { class: 'blemmy-review-item__reply-author' }, fmtAuthor(reply.author)),
			h('span', { class: 'blemmy-review-item__reply-text' }, reply.text),
		);
		repliesEl.appendChild(replyEl);
	}

	// Actions
	const actions = h('div', { class: 'blemmy-review-item__actions' });

	if (!isResolved) {
		// Reply input
		const replyInput = h('input', {
			type:        'text',
			class:       'blemmy-review-item__reply-input',
			placeholder: 'Reply…',
		}) as HTMLInputElement;

		const replyBtn = h('button', { type: 'button', class: 'blemmy-review-item__action-btn' }, 'Reply');
		replyBtn.addEventListener('click', () => {
			const text = replyInput.value.trim();
			if (!text) { return; }
			addReply(review, comment.id, text, 'user');
			dispatch(review);
			onRefresh();
		});
		replyInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { replyBtn.click(); }
		});

		// Resolve button
		const resolveBtn = h('button', { type: 'button', class: 'blemmy-review-item__action-btn blemmy-review-item__action-btn--resolve' }, '✓ Resolve');
		resolveBtn.addEventListener('click', () => {
			resolveComment(review, comment.id, 'user');
			dispatch(review);
			onRefresh();
		});

		actions.append(replyInput, replyBtn, resolveBtn);
	}

	// Delete
	const deleteBtn = h('button', { type: 'button', class: 'blemmy-review-item__action-btn blemmy-review-item__action-btn--delete', title: 'Delete comment' }, '✕');
	deleteBtn.addEventListener('click', () => {
		if (!window.confirm('Delete this comment?')) { return; }
		deleteComment(review, comment.id);
		dispatch(review);
		onRefresh();
	});
	actions.appendChild(deleteBtn);

	return h('div', { class: `blemmy-review-item${isResolved ? ' blemmy-review-item--resolved' : ''}` },
		meta, body, repliesEl, actions,
	);
}

// ─── New comment form ─────────────────────────────────────────────────────────

function buildNewCommentForm(
	review:      CVReview,
	initialPath: ContentPath,
	onSaved:     () => void,
	onCancel:    () => void,
): HTMLElement {
	const pathInput = h('input', {
		type:        'text',
		class:       'blemmy-review-form__path-input',
		value:       initialPath,
		placeholder: 'Path e.g. work[0].highlights[1]',
	}) as HTMLInputElement;

	const textarea = h('textarea', {
		class:       'blemmy-review-form__textarea',
		placeholder: 'Write a comment…',
		rows:        '3',
	}) as HTMLTextAreaElement;
	textarea.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { saveBtn.click(); }
	});

	const saveBtn = h('button', { type: 'button', class: 'blemmy-review-form__save' }, 'Add comment');
	const cancelBtn = h('button', { type: 'button', class: 'blemmy-review-form__cancel' }, 'Cancel');

	saveBtn.addEventListener('click', () => {
		const path = pathInput.value.trim();
		const text = textarea.value.trim();
		if (!path || !text) { return; }
		addComment(review, path, text, 'user', 'open');
		dispatch(review);
		onSaved();
	});
	cancelBtn.addEventListener('click', onCancel);

	setTimeout(() => textarea.focus(), 50);

	return h('div', { class: 'blemmy-review-form' },
		h('p', { class: 'blemmy-review-form__label' }, 'New comment'),
		h('p', { class: 'blemmy-review-form__path-label' }, 'Target'),
		pathInput,
		textarea,
		h('div', { class: 'blemmy-review-form__btns' }, saveBtn, cancelBtn),
	);
}

// ─── Main panel builder ───────────────────────────────────────────────────────

export type ReviewPanelOptions = {
	getReview:  () => CVReview | undefined;
	setReview:  (r: CVReview) => void;
	getData:    () => CVData | undefined;
};

export type ReviewPanelInstance = {
	panel:       HTMLElement;
	toggle:      HTMLElement;
	open:        (path?: ContentPath) => void;
	close:       () => void;
	syncReview:  (r: CVReview) => void;
};

export function initReviewPanel(opts: ReviewPanelOptions): ReviewPanelInstance {
	let panelOpen      = false;
	let activePath:    ContentPath | null = null;
	let showResolved   = false;
	let isNewComment   = false;
	let newCommentPath: ContentPath = '';

	// ── Outer panel ──────────────────────────────────────────────────────────
	const panel = h('div', {
		id:           'blemmy-review-panel',
		class: `blemmy-review-panel blemmy-side-panel ${DOCKED_SIDE_PANEL_CLASS} no-print`,
		'aria-label': 'Review comments',
		hidden:       '',
	});

	// Header
	const heading  = h('h2', { class: 'blemmy-review-panel__heading' }, 'Review');
	const closeBtn = h('button', { type: 'button', class: 'blemmy-review-panel__close', 'aria-label': 'Close review panel' }, '×');
	closeBtn.addEventListener('click', () => closePanel());

	const addBtn = h('button', { type: 'button', class: 'blemmy-review-panel__add', title: 'Add comment' }, '+ Comment');
	addBtn.addEventListener('click', () => {
		isNewComment   = true;
		newCommentPath = activePath ?? '';
		refresh();
	});

	const showResolvedToggle = h('label', { class: 'blemmy-review-panel__show-resolved' });
	const showResolvedCb     = h('input', { type: 'checkbox', class: 'blemmy-review-panel__show-resolved-cb' }) as HTMLInputElement;
	showResolvedToggle.append(showResolvedCb, ' Resolved');
	showResolvedCb.addEventListener('change', () => {
		showResolved = showResolvedCb.checked;
		refresh();
	});

	const headerRow = h('div', { class: 'blemmy-review-panel__header' }, heading, showResolvedToggle, addBtn, closeBtn);

	// Body
	const body = h('div', { class: 'blemmy-review-panel__body' });

	panel.append(headerRow, body);

	// ── Toggle button ─────────────────────────────────────────────────────────
	const toggle = h('button', {
		id:              DOCK_CONTROLS.reviewMode.id,
		type:            'button',
		class:           'blemmy-review-toggle blemmy-dock-btn no-print',
		'aria-expanded': 'false',
		'aria-controls': 'blemmy-review-panel',
		'aria-label':    DOCK_CONTROLS.reviewMode.ariaLabel,
		title:           DOCK_CONTROLS.reviewMode.title,
		'data-icon':     DOCK_CONTROLS.reviewMode.icon,
	}, DOCK_CONTROLS.reviewMode.label);

	toggle.addEventListener('click', () => {
		if (panelOpen) { closePanel(); } else { openPanel(); }
	});

	// ── Refresh (re-render body) ───────────────────────────────────────────────
	function refresh(): void {
		body.innerHTML = '';
		const review = opts.getReview();

		// New comment form
		if (isNewComment) {
			body.appendChild(buildNewCommentForm(
				review ?? emptyReviewInline(),
				newCommentPath,
				() => {
					isNewComment = false;
					if (!opts.getReview()) {
						// review was just created — propagate
					}
					refresh();
				},
				() => {
					isNewComment = false;
					refresh();
				},
			));
			return;
		}

		if (!review || review.comments.length === 0) {
			body.appendChild(h('p', { class: 'blemmy-review-panel__empty' },
				'No comments yet. Click any element on the CV in review mode to annotate it, or use the + button.',
			));
			return;
		}

		let comments = review.comments;
		if (!showResolved) {
			comments = comments.filter(c => c.status !== 'resolved');
		}
		if (activePath) {
			comments = comments.filter(c => c.path === activePath);
		}

		if (comments.length === 0) {
			body.appendChild(h('p', { class: 'blemmy-review-panel__empty' },
				activePath ? `No open comments on ${activePath}.` : 'No open comments.',
			));
		}

		for (const comment of comments) {
			body.appendChild(buildCommentItem(
				comment,
				review,
				refresh,
				(path) => {
					activePath = path;
					refresh();
				},
			));
		}

		// Back link when filtered to a path
		if (activePath) {
			const back = h('button', { type: 'button', class: 'blemmy-review-panel__back' }, '← All comments');
			back.addEventListener('click', () => { activePath = null; refresh(); });
			body.prepend(back);
		}
	}

	function emptyReviewInline(): CVReview {
		const r: CVReview = { version: 1, comments: [], active: true };
		opts.setReview(r);
		return r;
	}

	// ── Open / close ──────────────────────────────────────────────────────────
	function openPanel(path?: ContentPath): void {
		panelOpen = true;
		if (path) {
			activePath = path;
			const review = opts.getReview();
			const hasThread = Boolean(
				review?.comments.some((c) => c.path === path && c.status !== 'resolved'),
			);
			if (!hasThread) {
				isNewComment = true;
				newCommentPath = path;
			} else {
				isNewComment = false;
			}
		}
		(panel as HTMLElement & { hidden: boolean }).hidden = false;
		toggle.setAttribute('aria-expanded', 'true');
		toggle.classList.add('blemmy-review-toggle--active');
		document.querySelectorAll('.blemmy-shell').forEach((el) => {
			el.setAttribute('data-review-mode', 'true');
		});
		document.documentElement.classList.add('blemmy-review-mode');
		dispatchDockedPanelOpen('blemmy-review-panel');
		window.dispatchEvent(new Event(REVIEW_PANEL_OPEN_EVENT));
		refresh();
	}

	function closePanel(): void {
		panelOpen = false;
		activePath = null;
		isNewComment = false;
		(panel as HTMLElement & { hidden: boolean }).hidden = true;
		toggle.setAttribute('aria-expanded', 'false');
		toggle.classList.remove('blemmy-review-toggle--active');
		document.querySelectorAll('.blemmy-shell').forEach((el) => {
			el.removeAttribute('data-review-mode');
		});
		document.documentElement.classList.remove('blemmy-review-mode');
		dispatchDockedPanelClose('blemmy-review-panel');
		window.dispatchEvent(new Event(REVIEW_PANEL_CLOSE_EVENT));
	}

	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && panelOpen) { closePanel(); }
	});

	return {
		panel,
		toggle,
		open:   openPanel,
		close:  closePanel,
		syncReview: (r) => {
			if (panelOpen) { refresh(); }
			const n = openCommentCount(r);
			toggle.setAttribute('data-count', n > 0 ? String(n) : '');
		},
	};
}
