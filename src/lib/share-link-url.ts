export function shareTokenFromPathname(
	pathname: string,
	baseUrl = '/',
): string | null {
	const basePath = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
	const normalized = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
	const withBase = basePath && basePath !== '/'
		? normalized.startsWith(basePath)
			? normalized.slice(basePath.length)
			: normalized
		: normalized;
	const parts = withBase.split('/').filter(Boolean);
	if (parts.length >= 2 && parts[0] === 'share') {
		return decodeURIComponent(parts.slice(1).join('/')).trim() || null;
	}
	return null;
}

export function shareTokenFromLocationParts(
	pathname: string,
	search: string,
	baseUrl = '/',
): string | null {
	const fromPath = shareTokenFromPathname(pathname, baseUrl);
	if (fromPath) {
		return fromPath;
	}
	const params = new URLSearchParams(search);
	const token = params.get('cv-share') ?? params.get('share');
	return token?.trim() || null;
}

export function canonicalSharePath(
	token: string,
	baseUrl = '/',
): string {
	const basePath = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
	const prefix = basePath && basePath !== '/' ? basePath : '';
	return `${prefix}/share/${encodeURIComponent(token)}`;
}
