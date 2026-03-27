/**
 * letter.ts
 *
 * Type contracts for cover letter content (letter.doctype.json).
 * Mirrors the structure of CVData for the CV document type.
 *
 * The letter reuses CVBasics for the sender's identity so a user with an
 * existing CV does not need to re-enter their name, email, and phone.
 */

import type { CVBasics } from '@cv/cv';

// ─── Recipient ────────────────────────────────────────────────────────────────

export interface LetterRecipient {
	name?:         string;    // "Ms. Jensen" — optional, allows generic opening
	title?:        string;    // "Head of Research"
	organisation?: string;    // "Royal Danish Academy"
	address?:      string;    // Multi-line, rendered as-is
}

// ─── Body paragraph ───────────────────────────────────────────────────────────

export interface LetterParagraph {
	text: string;
}

// ─── Closing ─────────────────────────────────────────────────────────────────

export interface LetterClosing {
	salutation: string;   // "Yours sincerely," / "Kind regards,"
	name:       string;   // Signer's name (defaults to basics.name)
	title?:     string;   // Optional role/title line below name
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

export interface LetterMeta {
	lastUpdated: string;   // ISO date
	version:     string;
	language:    string;   // BCP-47
	/** Role or position this letter is written for. */
	targetRole?: string;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

/**
 * The complete shape of a cover letter document.
 *
 * basics is reused from CVData — same person, same contact details.
 * The renderer reads this directly from the loaded CVData if available.
 */
export interface LetterData {
	meta:       LetterMeta;
	/** Sender identity — shared with CVData.basics. */
	basics:     Pick<CVBasics, 'name' | 'email' | 'phone' | 'location' | 'label'>;
	recipient:  LetterRecipient;
	date:       string;           // Display date string e.g. "25 March 2026"
	subject?:   string;           // Optional Re: line
	opening:    string;           // "Dear Ms. Jensen," / "To whom it may concern,"
	body:       LetterParagraph[];
	closing:    LetterClosing;
}
