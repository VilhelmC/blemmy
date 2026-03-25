/**
 * Split a highlight string on the first colon for a bold lead-in
 * ("Predictive Modelling: body…"). Used by work, publications, merits.
 */
export function parseHighlightLead(text: string): {
	lead: string | null;
	body: string;
} {
	const colonIdx = text.indexOf(':');
	if (colonIdx === -1 || colonIdx > 30) {
		return { lead: null, body: text };
	}
	return {
		lead: text.slice(0, colonIdx),
		body: text.slice(colonIdx + 1).trim(),
	};
}
