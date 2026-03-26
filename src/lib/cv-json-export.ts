/**
 * CV JSON file export (toolbar / editor) — omit bulky embedded portraits.
 */

import type { CVData } from '@cv/cv';

/** Shallow-safe deep clone via JSON. */
export function stripPortraitForJsonExport(data: CVData): CVData {
	const o = JSON.parse(JSON.stringify(data)) as CVData;
	if (o.basics) {
		delete o.basics.portraitDataUrl;
		delete o.basics.portraitSha256;
	}
	return o;
}
