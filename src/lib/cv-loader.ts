/**
 * cv-loader.ts
 *
 * Handles loading CV data from three sources, in priority order:
 *
 *   1. A JSON file uploaded by the user (stored in localStorage)
 *   2. A URL-supplied JSON file (?cv-data=<url>)  [future / CI use]
 *   3. The bundled default cv-demo.json (public demo; real data is local-only)
 *
 * Exports:
 *   loadCvData()          → CVData (sync, reads from storage or bundled default)
 *   uploadCvData(file)    → Promise<CVData>  (validates, persists, returns data)
 *   clearUploadedCvData() → void  (revert to default)
 *   onCvDataChanged(fn)   → unsubscribe  (called after upload or clear)
 *
 * Validation is structural — it checks required fields are present and have
 * the right types. It does not enforce business rules (e.g. date formats).
 * Unknown extra fields are silently ignored, which makes the format forward-
 * compatible and forgiving of minor JSON editing mistakes.
 */

import type {
	CVData,
	CVMeta,
	CVBasics,
	CVEducation,
	CVWork,
	CVSkills,
	CVLanguage,
	CVPersonal,
} from '@cv/cv';

import bundledData from '@data/cv-demo.json';
import { CV_PORTRAIT_DATA_URL_MAX_CHARS } from '@lib/cv-portrait';

// ─── Storage key ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'cv-user-data';

// ─── Validation ───────────────────────────────────────────────────────────────

export class CvValidationError extends Error {
	constructor(
		message: string,
		public readonly path: string,
	) {
		super(`${path}: ${message}`);
		this.name = 'CvValidationError';
	}
}

function assert(condition: boolean, message: string, path: string): void {
	if (!condition) { throw new CvValidationError(message, path); }
}

function assertString(v: unknown, path: string): string {
	assert(typeof v === 'string', `expected string, got ${typeof v}`, path);
	return v as string;
}

function assertArray(v: unknown, path: string): unknown[] {
	assert(Array.isArray(v), `expected array, got ${typeof v}`, path);
	return v as unknown[];
}

function assertObject(v: unknown, path: string): Record<string, unknown> {
	assert(v != null && typeof v === 'object' && !Array.isArray(v),
		`expected object, got ${typeof v}`, path);
	return v as Record<string, unknown>;
}

function assertStringArray(v: unknown, path: string): string[] {
	const arr = assertArray(v, path);
	arr.forEach((item, i) => assertString(item, `${path}[${i}]`));
	return arr as string[];
}

function validateMeta(raw: unknown): CVMeta {
	const o = assertObject(raw, 'meta');
	return {
		lastUpdated: assertString(o.lastUpdated, 'meta.lastUpdated'),
		version:     assertString(o.version,     'meta.version'),
		language:    assertString(o.language,    'meta.language'),
	};
}

function optionalPortraitDataUrl(
	v: unknown,
	path: string,
): string | undefined {
	if (v == null || v === '') {
		return undefined;
	}
	const s = assertString(v, path);
	assert(
		s.length <= CV_PORTRAIT_DATA_URL_MAX_CHARS,
		`portrait data URL exceeds ${CV_PORTRAIT_DATA_URL_MAX_CHARS} characters`,
		path,
	);
	assert(
		/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(s),
		'expected data:image/jpeg, data:image/png, or data:image/webp;base64,...',
		path,
	);
	return s;
}

function optionalPortraitSha256(
	v: unknown,
	path: string,
): string | undefined {
	if (v == null || v === '') {
		return undefined;
	}
	const s = assertString(v, path).trim().toLowerCase();
	assert(
		/^[a-f0-9]{64}$/.test(s),
		'expected 64-character lowercase hex SHA-256',
		path,
	);
	return s;
}

function validateBasics(raw: unknown): CVBasics {
	const o = assertObject(raw, 'basics');
	const portrait = optionalPortraitDataUrl(
		o.portraitDataUrl,
		'basics.portraitDataUrl',
	);
	const sha = optionalPortraitSha256(
		o.portraitSha256,
		'basics.portraitSha256',
	);
	return {
		name:        assertString(o.name,        'basics.name'),
		label:       assertString(o.label,       'basics.label'),
		email:       assertString(o.email,       'basics.email'),
		phone:       assertString(o.phone,       'basics.phone'),
		location:    assertString(o.location,    'basics.location'),
		nationality: assertString(o.nationality, 'basics.nationality'),
		born:        assertString(o.born,        'basics.born'),
		summary:     assertString(o.summary,     'basics.summary'),
		...(portrait !== undefined ? { portraitDataUrl: portrait } : {}),
		...(sha !== undefined ? { portraitSha256: sha } : {}),
	};
}

function validateEducation(raw: unknown, idx: number): CVEducation {
	const p = `education[${idx}]`;
	const o = assertObject(raw, p);
	return {
		institution: assertString(o.institution, `${p}.institution`),
		area:        assertString(o.area,        `${p}.area`),
		degree:      assertString(o.degree,      `${p}.degree`),
		startDate:   assertString(o.startDate,   `${p}.startDate`),
		endDate:     assertString(o.endDate,     `${p}.endDate`),
		score:       o.score != null ? assertString(o.score, `${p}.score`) : undefined,
		highlights:  assertStringArray(o.highlights ?? [], `${p}.highlights`),
		tags:        o.tags == null
			? undefined
			: assertStringArray(o.tags, `${p}.tags`),
	};
}

function validateWork(raw: unknown, idx: number): CVWork {
	const p = `work[${idx}]`;
	const o = assertObject(raw, p);
	return {
		company:    assertString(o.company,    `${p}.company`),
		position:   assertString(o.position,   `${p}.position`),
		startDate:  assertString(o.startDate,  `${p}.startDate`),
		endDate:    assertString(o.endDate,    `${p}.endDate`),
		summary:    o.summary != null ? assertString(o.summary, `${p}.summary`) : undefined,
		highlights: assertStringArray(o.highlights ?? [], `${p}.highlights`),
		tags:       o.tags == null
			? undefined
			: assertStringArray(o.tags, `${p}.tags`),
	};
}

function validateSkills(raw: unknown): CVSkills {
	const o = assertObject(raw, 'skills');
	return {
		programming: assertStringArray(o.programming ?? [], 'skills.programming'),
		design_bim:  assertStringArray(o.design_bim  ?? [], 'skills.design_bim'),
		strategic:   assertStringArray(o.strategic   ?? [], 'skills.strategic'),
	};
}

function validateLanguage(raw: unknown, idx: number): CVLanguage {
	const p = `languages[${idx}]`;
	const o = assertObject(raw, p);
	return {
		language: assertString(o.language, `${p}.language`),
		fluency:  assertString(o.fluency,  `${p}.fluency`) as CVLanguage['fluency'],
	};
}

function validatePersonal(raw: unknown): CVPersonal {
	const o = assertObject(raw, 'personal');
	return {
		interests: assertString(o.interests, 'personal.interests'),
	};
}

/**
 * Validates a raw parsed JSON object against the CVData schema.
 * Throws CvValidationError with a human-readable path on the first failure.
 */
export function validateCvData(raw: unknown): CVData {
	const o        = assertObject(raw, 'root');
	const eduArr   = assertArray(o.education ?? [], 'education');
	const workArr  = assertArray(o.work      ?? [], 'work');
	const langArr  = assertArray(o.languages ?? [], 'languages');

	return {
		meta:      validateMeta(o.meta),
		basics:    validateBasics(o.basics),
		education: eduArr.map((e, i)  => validateEducation(e, i)),
		work:      workArr.map((w, i) => validateWork(w, i)),
		skills:    validateSkills(o.skills),
		languages: langArr.map((l, i) => validateLanguage(l, i)),
		personal:  validatePersonal(o.personal),
	};
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function saveToStorage(data: CVData): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	} catch {
		// Storage quota or private mode — fail silently, data still in memory
	}
}

function loadFromStorage(): CVData | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) { return null; }
		return validateCvData(JSON.parse(raw));
	} catch {
		// Corrupted storage — ignore and fall back to default
		return null;
	}
}

// ─── Change listeners ─────────────────────────────────────────────────────────

type CvDataListener = (data: CVData) => void;
const listeners = new Set<CvDataListener>();

function notifyListeners(data: CVData): void {
	for (const fn of listeners) { fn(data); }
}

/**
 * Subscribes to CV data changes (upload or clear).
 * Returns an unsubscribe function.
 */
export function onCvDataChanged(fn: CvDataListener): () => void {
	listeners.add(fn);
	return () => { listeners.delete(fn); };
}

// ─── Legacy portrait (pre–CVData field) ─────────────────────────────────────

const LEGACY_PORTRAIT_KEY = 'cv-portrait';

function migrateLegacyPortraitInPlace(data: CVData): CVData {
	try {
		const legacy = localStorage.getItem(LEGACY_PORTRAIT_KEY);
		if (
			legacy &&
			legacy.startsWith('data:image/') &&
			legacy.length <= CV_PORTRAIT_DATA_URL_MAX_CHARS &&
			!data.basics.portraitDataUrl
		) {
			data.basics.portraitDataUrl = legacy;
			localStorage.removeItem(LEGACY_PORTRAIT_KEY);
			saveToStorage(data);
		}
	} catch {
		/* private mode / quota */
	}
	return data;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the active CV data: user-uploaded if present, else bundled default.
 * Safe to call synchronously before the DOM is ready.
 */
export function loadCvData(): CVData {
	const stored = loadFromStorage();
	if (stored) {
		return migrateLegacyPortraitInPlace(stored);
	}
	const clone = JSON.parse(JSON.stringify(bundledData)) as CVData;
	return migrateLegacyPortraitInPlace(clone);
}

/** Removes pre–CVData local portrait storage (optional cleanup). */
export function clearLegacyPortraitStorage(): void {
	try {
		localStorage.removeItem(LEGACY_PORTRAIT_KEY);
	} catch {
		/* ignore */
	}
}

/**
 * Returns true if the user has uploaded custom CV data.
 */
export function hasUploadedData(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) !== null;
	} catch {
		return false;
	}
}

/**
 * Reads, validates, and persists a JSON File object as the active CV data.
 * Notifies all listeners on success.
 * Throws CvValidationError or a plain Error on failure.
 */
export function uploadCvData(file: File): Promise<CVData> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();

		reader.onload = (e) => {
			try {
				const raw  = JSON.parse(e.target?.result as string);
				const data = validateCvData(raw);
				saveToStorage(data);
				notifyListeners(data);
				resolve(data);
			} catch (err) {
				reject(err);
			}
		};

		reader.onerror = () => {
			reject(new Error('Failed to read file'));
		};

		reader.readAsText(file);
	});
}

/**
 * Clears uploaded CV data and reverts to the bundled default.
 * Notifies all listeners.
 */
export function clearUploadedCvData(): void {
	try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
	notifyListeners(bundledData as CVData);
}
