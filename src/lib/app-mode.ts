import {
	embedTokenFromLocationParts,
	shareTokenFromLocationParts,
} from '@lib/share-link-url';

export type AppMode =
	| 'normal'
	| 'shareReadonly'
	| 'pdfEmbed'
	| 'portfolioEmbed'
	| 'publishedEmbed';

export type ResolvedAppMode = {
	mode: AppMode;
	shareToken: string | null;
	embedToken: string | null;
	isEmbedLike: boolean;
	/** When `blemmy-pdf=1` is set — doc-type to render for PDF export. */
	pdfDocType?: string;
};

export function resolveAppModeFromLocation(
	locationLike: Pick<Location, 'pathname' | 'search'>,
	baseUrl = '/',
): ResolvedAppMode {
	const params = new URLSearchParams(locationLike.search);
	const isPdfEmbed = params.get('cv-embed') === '1'
		|| params.get('blemmy-pdf') === '1';
	const isPortfolioEmbed = params.get('cv-portfolio') === '1';
	const shareToken = shareTokenFromLocationParts(
		locationLike.pathname,
		locationLike.search,
		baseUrl,
	);
	const embedToken = embedTokenFromLocationParts(
		locationLike.pathname,
		locationLike.search,
		baseUrl,
	);
	if (isPortfolioEmbed) {
		return {
			mode: 'portfolioEmbed',
			shareToken: null,
			embedToken: null,
			isEmbedLike: true,
		};
	}
	if (embedToken) {
		return {
			mode: 'publishedEmbed',
			shareToken: null,
			embedToken,
			isEmbedLike: true,
		};
	}
	if (isPdfEmbed) {
		return {
			mode: 'pdfEmbed',
			shareToken: null,
			embedToken: null,
			isEmbedLike: true,
			pdfDocType: params.get('doc-type') ?? 'cv',
		};
	}
	if (shareToken) {
		return {
			mode: 'shareReadonly',
			shareToken,
			embedToken: null,
			isEmbedLike: false,
		};
	}
	return {
		mode: 'normal',
		shareToken: null,
		embedToken: null,
		isEmbedLike: false,
	};
}

export function isReadonlyMode(mode: AppMode): boolean {
	return mode === 'shareReadonly' || mode === 'publishedEmbed';
}
