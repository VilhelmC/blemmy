/**
 * Registered CV JSON sources. Add a file under `src/data/` (and whitelist in
 * `.gitignore` if needed) plus an entry in `CV_PROFILES`.
 */

import type { CVData } from '@cv/cv';

import defaultRaw from '../data/cv-demo.json';

export type CvProfileId = 'default';

export interface CvProfileEntry {
	id:    CvProfileId;
	label: string;
	/** Site path for this profile (`/` = index). */
	path:  string;
	data:  CVData;
}

function asCvData(raw: unknown): CVData {
	return raw as CVData;
}

export const CV_PROFILES: CvProfileEntry[] = [
	{
		id:    'default',
		label: 'General',
		path:  '/',
		data:  asCvData(defaultRaw),
	},
];

export function getProfileById(id: string): CvProfileEntry | undefined {
	return CV_PROFILES.find((p) => p.id === id);
}

export function getDefaultProfile(): CvProfileEntry {
	return CV_PROFILES[0];
}

/** Secondary profile route params (e.g. `/cv/:profile`). */
export function getSecondaryProfileParams(): { profile: CvProfileId }[] {
	return CV_PROFILES
		.filter((p) => p.id !== 'default')
		.map((p) => ({ profile: p.id }));
}

/** Resolved URL for static / client navigation (respects `base`). */
export function profileNavHref(profile: CvProfileEntry): string {
	const b = import.meta.env.BASE_URL;
	if (profile.id === 'default') {
		if (b === '/') {
			return '/';
		}
		return b.endsWith('/') ? b.slice(0, -1) : b;
	}
	const root = b === '/' ? '' : b.endsWith('/') ? b.slice(0, -1) : b;
	return `${root}/cv/${profile.id}`;
}

/** Path under site root to the static PDF built for this profile. */
export function profilePdfPublicPath(id: CvProfileId): string {
	const file = id === 'default' ? 'cv.pdf' : `cv-${id}.pdf`;
	const b = import.meta.env.BASE_URL;
	if (b === '/' || b === '') {
		return '/' + file;
	}
	return (b.endsWith('/') ? b.slice(0, -1) : b) + '/' + file;
}

/** Suggested filename when downloading from Preview PDF. */
export function profilePdfDownloadName(id: CvProfileId): string {
	return id === 'default' ? 'cv.pdf' : `cv-${id}.pdf`;
}
