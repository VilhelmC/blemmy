/**
 * PDF outputs for `build-cv-pdf.mjs`. Keep in sync with `src/lib/cv-sources.ts`
 * (each non-default profile needs an entry with matching `file` name).
 */
export const PDF_EXPORTS = [
	{ urlSuffix: '/?cv-pdf=1', file: 'cv.pdf' },
	{ urlSuffix: '/cv/byens/?cv-pdf=1', file: 'cv-byens.pdf' },
];
