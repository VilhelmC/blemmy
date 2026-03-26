/**
 * cv-review.ts  (lib)
 *
 * Runtime review layer operations.
 *
 * Responsibilities:
 *   - nanoid generation (no dependency — inline implementation)
 *   - Comment CRUD: add, resolve, flag, reply
 *   - CommentOperation batch apply (from bot response)
 *   - Path → DOM element resolution (for overlay positioning)
 *   - localStorage persistence of active review state
 *   - System prompt summary builder (for cv-chat-prompts.ts)
 */

import type {
	CVReview,
	ReviewComment,
	ReviewReply,
	CommentOperation,
	CommentAuthor,
	CommentStatus,
	ContentPath,
} from '@cv/cv-review';

export type {
	CVReview,
	ReviewComment,
	ReviewReply,
	CommentOperation,
	CommentAuthor,
	CommentStatus,
	ContentPath,
};

// ─── nanoid (inline, no dep) ──────────────────────────────────────────────────

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function nanoId(size = 10): string {
	const bytes = crypto.getRandomValues(new Uint8Array(size));
	return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}

// ─── Empty review ─────────────────────────────────────────────────────────────

export function emptyReview(): CVReview {
	return { version: 1, comments: [], active: true };
}

// ─── Comment CRUD ─────────────────────────────────────────────────────────────

export function addComment(
	review: CVReview,
	path:   ContentPath,
	text:   string,
	author: CommentAuthor = 'user',
	status: CommentStatus = 'open',
): ReviewComment {
	const comment: ReviewComment = {
		id:        nanoId(),
		path,
		text,
		author,
		createdAt: new Date().toISOString(),
		status,
	};
	review.comments.push(comment);
	return comment;
}

export function resolveComment(
	review:     CVReview,
	id:         string,
	resolvedBy: CommentAuthor = 'user',
): boolean {
	const c = review.comments.find(c => c.id === id);
	if (!c) { return false; }
	c.status     = 'resolved';
	c.resolvedBy = resolvedBy;
	c.resolvedAt = new Date().toISOString();
	return true;
}

export function addReply(
	review: CVReview,
	id:     string,
	text:   string,
	author: CommentAuthor = 'user',
): ReviewReply | null {
	const c = review.comments.find(c => c.id === id);
	if (!c) { return null; }
	const reply: ReviewReply = {
		id:        nanoId(),
		text,
		author,
		createdAt: new Date().toISOString(),
	};
	if (!c.replies) { c.replies = []; }
	c.replies.push(reply);
	return reply;
}

export function deleteComment(review: CVReview, id: string): boolean {
	const idx = review.comments.findIndex(c => c.id === id);
	if (idx === -1) { return false; }
	review.comments.splice(idx, 1);
	return true;
}

// ─── Batch apply bot operations ───────────────────────────────────────────────

export function applyCommentOps(
	review: CVReview,
	ops:    CommentOperation[],
): void {
	for (const op of ops) {
		switch (op.op) {
			case 'resolve':
				resolveComment(review, op.id, 'assistant');
				break;
			case 'reply':
				addReply(review, op.id, op.text, 'assistant');
				break;
			case 'flag':
				addComment(review, op.path, op.text, 'assistant', 'flagged');
				break;
			case 'add':
				addComment(review, op.path, op.text, 'assistant', op.status ?? 'open');
				break;
		}
	}
}

// ─── Path → DOM element ───────────────────────────────────────────────────────

/**
 * Maps a ContentPath to the best matching DOM element in the CV shell.
 * Returns null if the path cannot be resolved.
 *
 * Strategy:
 *  - basics.*       → masthead field (data-cv-field attribute)
 *  - work[N]        → #cv-work-item-N (or matching entry-company text)
 *  - work[N].highlights[M] → specific <li> within that work item
 *  - education[N]   → #cv-edu-item-N
 *  - skills.*       → skills section root
 *  - languages[N]   → language row
 *  - layout / style → preferences trigger button (closest available anchor)
 */
export function resolvePathToElement(path: ContentPath): HTMLElement | null {
	// basics.summary → masthead profile area
	if (path === 'basics.summary') {
		return document.querySelector<HTMLElement>('[data-cv-field="summary"]')
			?? document.getElementById('cv-p1-profile-main');
	}

	// basics.* → matching data-cv-field
	const basicsMatch = path.match(/^basics\.(\w+)$/);
	if (basicsMatch) {
		return document.querySelector<HTMLElement>(`[data-cv-field="${basicsMatch[1]}"]`);
	}

	// work[N] or work[N].*
	const workMatch = path.match(/^work\[(\d+)\]/);
	if (workMatch) {
		const idx = parseInt(workMatch[1], 10);
		const items = document.querySelectorAll<HTMLElement>('.experience-block');
		const item  = items[idx] ?? null;
		if (!item) { return null; }

		// work[N].highlights[M]
		const hlMatch = path.match(/^work\[\d+\]\.highlights\[(\d+)\]$/);
		if (hlMatch) {
			const hls = item.querySelectorAll<HTMLElement>('.highlight-list li');
			return hls[parseInt(hlMatch[1], 10)] ?? item;
		}
		return item;
	}

	// education[N]
	const eduMatch = path.match(/^education\[(\d+)\]/);
	if (eduMatch) {
		const idx   = parseInt(eduMatch[1], 10);
		const items = document.querySelectorAll<HTMLElement>('.edu-block');
		return items[idx] ?? null;
	}

	// skills.*
	if (path.startsWith('skills')) {
		return document.getElementById('cv-skills-section')
			?? document.querySelector<HTMLElement>('.skills-section');
	}

	// languages[N]
	const langMatch = path.match(/^languages\[(\d+)\]/);
	if (langMatch) {
		const idx   = parseInt(langMatch[1], 10);
		const items = document.querySelectorAll<HTMLElement>('.language-item');
		return items[idx] ?? null;
	}

	// layout / style → prefs trigger
	if (path.startsWith('layout') || path.startsWith('style')) {
		return document.getElementById('cv-prefs-trigger');
	}

	return null;
}

// ─── Open comment count ───────────────────────────────────────────────────────

export function openCommentCount(review: CVReview): number {
	return review.comments.filter(c => c.status !== 'resolved').length;
}

export function commentsForPath(review: CVReview, path: ContentPath): ReviewComment[] {
	return review.comments.filter(c => c.path === path);
}

// ─── System prompt summary ────────────────────────────────────────────────────

/**
 * Formats open comments for injection into the AI system prompt.
 * Called by cv-chat-prompts.ts when CVData.review is present.
 */
export function buildReviewPromptSection(review: CVReview): string {
	const open = review.comments.filter(c => c.status !== 'resolved');
	if (open.length === 0) { return ''; }

	const lines = open.map(c => {
		const who  = c.author === 'user' ? 'User' : c.author === 'assistant' ? 'Assistant' : c.author;
		const flag = c.status === 'flagged' ? ' [flagged]' : '';
		return `[${c.path}] ${who}${flag}: "${c.text}"`;
	});

	return `## Active review comments (${open.length} open)

Address these in your response. For each comment you have acted on, include
a \`\`\`review block to mark it resolved.

${lines.join('\n')}

To resolve comments or add assistant annotations, return a \`\`\`review block:
\`\`\`review
[
  { "op": "resolve", "id": "COMMENT_ID" },
  { "op": "reply",   "id": "COMMENT_ID", "text": "Done — tightened to two lines." },
  { "op": "flag",    "path": "work[0].highlights[1]", "text": "This bullet lacks an outcome." }
]
\`\`\``;
}
