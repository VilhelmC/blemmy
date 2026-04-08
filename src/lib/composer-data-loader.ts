/**
 * letter-loader.ts
 *
 * Load, validate, and persist LetterData.
 * Mirrors the pattern of blemmy-loader.ts.
 */

import type { LetterData } from '@cv/letter';
import bundledLetter from '@data/letter-demo.json';

const LETTER_STORAGE_KEY = 'blemmy-letter-draft';

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateLetterData(raw: unknown): LetterData {
	if (!raw || typeof raw !== 'object') {
		throw new Error('Letter data must be an object');
	}
	const d = raw as Record<string, unknown>;

	if (!d.meta || !d.basics || !d.recipient || !d.body || !d.closing) {
		throw new Error('Letter data missing required fields (meta, basics, recipient, body, closing)');
	}
	if (!Array.isArray(d.body)) {
		throw new Error('"body" must be an array of paragraphs');
	}
	if (typeof d.date !== 'string') {
		throw new Error('"date" must be a string');
	}
	if (typeof d.opening !== 'string') {
		throw new Error('"opening" must be a string');
	}

	return d as unknown as LetterData;
}

export function isLetterData(raw: unknown): raw is LetterData {
	try { validateLetterData(raw); return true; }
	catch { return false; }
}

// ─── Default factory ──────────────────────────────────────────────────────────

/**
 * Returns a fresh LetterData pre-populated from a CVData basics object.
 * Call this when a user creates a new letter document from an existing CV.
 */
export function newLetterFromBasics(
	name:     string,
	label:    string,
	email:    string,
	phone:    string,
	location: string,
): LetterData {
	const today = new Date();
	const dateStr = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

	return {
		meta: {
			lastUpdated: today.toISOString().slice(0, 10),
			version:     '1.0',
			language:    'en',
		},
		basics: { name, label, email, phone, location },
		recipient: {},
		date:    dateStr,
		opening: 'Dear Hiring Manager,',
		body:    [{ text: '' }],
		closing: {
			salutation: 'Yours sincerely,',
			name,
		},
	};
}

// ─── Load / save ──────────────────────────────────────────────────────────────

export function loadLetterData(): LetterData {
	try {
		const raw = localStorage.getItem(LETTER_STORAGE_KEY);
		if (raw) {
			return validateLetterData(JSON.parse(raw));
		}
	} catch { /* fall through to bundled default */ }
	return JSON.parse(JSON.stringify(bundledLetter)) as LetterData;
}

export function saveLetterData(data: LetterData): void {
	try {
		localStorage.setItem(LETTER_STORAGE_KEY, JSON.stringify(data));
	} catch { /* quota or private mode */ }
}

export function clearLetterData(): void {
	try { localStorage.removeItem(LETTER_STORAGE_KEY); } catch { /* ignore */ }
}
