/**
 * cv-review.ts
 *
 * Type contracts for the Blemmy review mode annotation layer.
 *
 * A CVReview sits parallel to CVData — it is never mixed into content,
 * and is stored/loaded independently. The path system addresses any
 * annotatable element in the document by a string key.
 */

// ─── Path ─────────────────────────────────────────────────────────────────────

/**
 * A dot/bracket path into the document or its configuration.
 *
 * Content paths:
 *   "basics.summary"            the summary paragraph
 *   "basics.name"               name field
 *   "work[2].highlights[1]"     a specific bullet
 *   "work[0]"                   an entire work entry
 *   "education[1]"              an entire education entry
 *   "skills.programming[3]"     a specific skill tag
 *   "languages[0]"              a language entry
 *
 * Non-content paths:
 *   "layout"                    a layout decision
 *   "layout.sidebar"            sidebar composition
 *   "style.sidebarColor"        colour decision
 *   "style.fontPair"            typography decision
 */
export type ContentPath = string;

// ─── Author ───────────────────────────────────────────────────────────────────

export type CommentAuthor =
	| 'user'           // the document owner
	| 'assistant'      // the AI assistant
	| string;          // named external reviewer e.g. "Jonas M."

// ─── Status ───────────────────────────────────────────────────────────────────

export type CommentStatus =
	| 'open'           // unaddressed
	| 'resolved'       // addressed and closed
	| 'flagged';       // flagged for attention (typically by the assistant)

// ─── Comment ──────────────────────────────────────────────────────────────────

export interface ReviewReply {
	id:        string;      // nanoid — 10 chars
	text:      string;
	author:    CommentAuthor;
	createdAt: string;      // ISO datetime
}

export interface ReviewComment {
	id:          string;    // nanoid — 10 chars
	path:        ContentPath;
	text:        string;
	author:      CommentAuthor;
	createdAt:   string;    // ISO datetime
	status:      CommentStatus;
	resolvedBy?: CommentAuthor;
	resolvedAt?: string;
	/** Flat reply thread — one level only, no nesting. */
	replies?:    ReviewReply[];
}

// ─── Review layer ─────────────────────────────────────────────────────────────

/**
 * The complete review annotation layer for a document.
 * Stored in CVData.review (optional field).
 * When present and active, review mode UI activates on load.
 */
export interface CVReview {
	/** Schema version for forward compatibility. Always 1. */
	version:  1;
	comments: ReviewComment[];
	/** True when review mode UI should be active on load. */
	active?:  boolean;
}

// ─── Bot response operations ──────────────────────────────────────────────────

/**
 * Operations the AI assistant can perform on the review layer.
 * Returned in the bot response as a ```review fenced block.
 */
export type CommentOperation =
	| { op: 'resolve'; id: string; }
	| { op: 'reply';   id: string; text: string; }
	| { op: 'flag';    path: ContentPath; text: string; }
	| { op: 'add';     path: ContentPath; text: string; status?: CommentStatus; };
