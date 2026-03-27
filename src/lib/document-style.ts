/**
 * document-style.ts
 *
 * Runtime document style system.
 *
 * Responsibilities:
 *   - Colour derivation: sidebar hex → harmonious main-column accents (HSL)
 *   - WCAG contrast: auto-switch sidebar text between light and dark
 *   - Font application: set --font-body / --font-heading CSS vars
 *   - Apply: write all tokens to document.documentElement style
 *   - Persist: localStorage under STYLE_KEY
 *   - Load: startup rehydration before first paint
 *   - Presets: 8 curated DocumentStyle objects
 *
 * The bot writes to this system via a ```style fenced block in its response.
 * The style panel UI calls applyDocumentStyle() directly on every picker change.
 */

import type {
	DocumentStyle,
	HeadingFont,
	BodyFont,
	StylePreset,
} from '@cv/document-style';

export type { DocumentStyle, HeadingFont, BodyFont, StylePreset };
export type { PrintSidebarStyle } from '@cv/document-style';

// ─── Constants ────────────────────────────────────────────────────────────────

const STYLE_KEY = 'blemmy-document-style';
const CUSTOM_FONT_LINK_ID = 'cv-custom-font-css';
const ALLOWED_CUSTOM_CSS_VARS = new Set<string>([
	'--text-body',
	'--text-meta',
	'--text-label',
	'--text-name',
	'--print-main-padding',
	'--print-sidebar-padding',
	'--cv-slack-gap-p1-main',
	'--cv-slack-gap-p1-sidebar',
	'--cv-slack-gap-p2-main',
	'--cv-slack-gap-p2-sidebar',
	'--cv-align-gap-p1-main',
	'--cv-align-gap-p1-sidebar',
	'--cv-align-gap-p2-main',
	'--cv-align-gap-p2-sidebar',
]);

export const STYLE_DEFAULTS: DocumentStyle = {
	sidebarColor:    '#1A1A1A',
	pageBackground:  '#F7F7F5',
	headingFont:     'dm-sans',
	bodyFont:        'dm-sans',
	headingDistinct: false,
	printSidebar:    'color',
};

function assertSafeGoogleFontUrl(raw?: string): string | null {
	if (!raw) { return null; }
	const value = raw.trim();
	if (!value) { return null; }
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('customFontCssUrl must be a valid URL.');
	}
	if (url.protocol !== 'https:') {
		throw new Error('customFontCssUrl must use https.');
	}
	if (url.hostname !== 'fonts.googleapis.com') {
		throw new Error('customFontCssUrl must point to fonts.googleapis.com.');
	}
	return url.toString();
}

function applyCustomFontStylesheet(url: string | null): void {
	const prev = document.getElementById(CUSTOM_FONT_LINK_ID);
	if (!url) {
		prev?.remove();
		return;
	}
	let link = prev as HTMLLinkElement | null;
	if (!(link instanceof HTMLLinkElement)) {
		link = document.createElement('link');
		link.id = CUSTOM_FONT_LINK_ID;
		link.rel = 'stylesheet';
		document.head.appendChild(link);
	}
	link.href = url;
}

function sanitizeCssVarValue(raw: string): string {
	const v = raw.trim();
	if (!v) { throw new Error('customCssVars values cannot be empty.'); }
	if (v.length > 160) {
		throw new Error('customCssVars values must be <= 160 chars.');
	}
	if (/[{};]/.test(v)) {
		throw new Error('customCssVars values must not contain ; { }.');
	}
	return v;
}

function applyCustomCssVars(root: HTMLElement, vars?: Record<string, string>): void {
	for (const name of ALLOWED_CUSTOM_CSS_VARS) {
		if (!vars || !(name in vars)) {
			root.style.removeProperty(name);
		}
	}
	if (!vars) { return; }
	for (const [name, value] of Object.entries(vars)) {
		if (!ALLOWED_CUSTOM_CSS_VARS.has(name)) {
			throw new Error(`customCssVars key not allowed: ${name}`);
		}
		root.style.setProperty(name, sanitizeCssVarValue(value));
	}
}

// ─── Font CSS values ──────────────────────────────────────────────────────────

export const HEADING_FONT_CSS: Record<HeadingFont, string> = {
	'dm-sans':            "'DM Sans', system-ui, sans-serif",
	'playfair-display':   "'Playfair Display', Georgia, serif",
	'cormorant-garamond': "'Cormorant Garamond', Georgia, serif",
	'libre-baskerville':  "'Libre Baskerville', Georgia, serif",
	'eb-garamond':        "'EB Garamond', Georgia, serif",
};

export const BODY_FONT_CSS: Record<BodyFont, string> = {
	'dm-sans':       "'DM Sans', system-ui, sans-serif",
	'work-sans':     "'Work Sans', system-ui, sans-serif",
	'source-sans-3': "'Source Sans 3', system-ui, sans-serif",
};

/** Display labels for the font picker UI. */
export const HEADING_FONT_LABELS: Record<HeadingFont, string> = {
	'dm-sans':            'DM Sans',
	'playfair-display':   'Playfair Display',
	'cormorant-garamond': 'Cormorant Garamond',
	'libre-baskerville':  'Libre Baskerville',
	'eb-garamond':        'EB Garamond',
};

export const BODY_FONT_LABELS: Record<BodyFont, string> = {
	'dm-sans':       'DM Sans',
	'work-sans':     'Work Sans',
	'source-sans-3': 'Source Sans 3',
};

// ─── Colour utilities ─────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
	const h    = hex.replace('#', '');
	const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
	const n    = parseInt(full, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
	r /= 255; g /= 255; b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l   = (max + min) / 2;
	let h = 0;
	let s = 0;
	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
			case g: h = ((b - r) / d + 2) / 6; break;
			case b: h = ((r - g) / d + 4) / 6; break;
		}
	}
	return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
	h /= 360; s /= 100; l /= 100;
	let r: number, g: number, b: number;
	if (s === 0) {
		r = g = b = l;
	} else {
		const hue2rgb = (p: number, q: number, t: number): number => {
			if (t < 0) { t += 1; }
			if (t > 1) { t -= 1; }
			if (t < 1 / 6) { return p + (q - p) * 6 * t; }
			if (t < 1 / 2) { return q; }
			if (t < 2 / 3) { return p + (q - p) * (2 / 3 - t) * 6; }
			return p;
		};
		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		r = hue2rgb(p, q, h + 1 / 3);
		g = hue2rgb(p, q, h);
		b = hue2rgb(p, q, h - 1 / 3);
	}
	const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * WCAG relative luminance of an RGB colour.
 * Returns 0 (black) to 1 (white).
 */
function relativeLuminance(r: number, g: number, b: number): number {
	const sRGB = [r, g, b].map(c => {
		const v = c / 255;
		return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
}

/**
 * Returns true if white text meets WCAG AA (3:1) against this background.
 * When false, the sidebar background is light enough to require dark text.
 */
function needsLightText(hex: string): boolean {
	const [r, g, b] = hexToRgb(hex);
	const lum       = relativeLuminance(r, g, b);
	// Contrast ratio of white (lum=1) against background
	return (1.05 / (lum + 0.05)) >= 3;
}

/**
 * Given a sidebar hex colour, derive harmonious accent tones for the main column.
 * Uses HSL to echo the sidebar hue at reduced saturation and varied lightness.
 *
 * mid   → --color-teal-mid   (dates, position sub-text on light background)
 * light → --color-teal-light (muted label text on light background)
 * deep  → --color-teal-deep  (bullet marker squares — used on both surfaces)
 */
export function deriveAccents(hex: string): { mid: string; light: string; deep: string } {
	const [r, g, b]  = hexToRgb(hex);
	const [h, s]     = rgbToHsl(r, g, b);

	// Reduce saturation dramatically for main column — these are subtle echoes
	const mid   = hslToHex(h, Math.min(s * 0.38, 18), 42);
	const light = hslToHex(h, Math.min(s * 0.28, 14), 58);
	// Deep: keep more saturation, very dark — readable on both light + dark surfaces
	const deep  = hslToHex(h, Math.min(s * 0.65, 45), 18);

	return { mid, light, deep };
}

// ─── Presets ──────────────────────────────────────────────────────────────────

export const STYLE_PRESETS: StylePreset[] = [
	{
		presetName:      'Carbon',
		sidebarColor:    '#1A1A1A',
		pageBackground:  '#F7F7F5',
		headingFont:     'dm-sans',
		bodyFont:        'dm-sans',
		headingDistinct: false,
		printSidebar:    'color',
	},
	{
		presetName:      'Teal',
		sidebarColor:    '#1A3C40',
		pageBackground:  '#F7F7F5',
		headingFont:     'dm-sans',
		bodyFont:        'dm-sans',
		headingDistinct: false,
		printSidebar:    'color',
	},
	{
		presetName:      'Navy',
		sidebarColor:    '#1B2A4A',
		pageBackground:  '#F7F7F5',
		headingFont:     'playfair-display',
		bodyFont:        'dm-sans',
		headingDistinct: true,
		printSidebar:    'color',
	},
	{
		presetName:      'Forest',
		sidebarColor:    '#1C3B2E',
		pageBackground:  '#F7F7F5',
		headingFont:     'cormorant-garamond',
		bodyFont:        'dm-sans',
		headingDistinct: true,
		printSidebar:    'grayscale',
	},
	{
		presetName:      'Slate',
		sidebarColor:    '#2D3B4F',
		pageBackground:  '#F7F7F5',
		headingFont:     'dm-sans',
		bodyFont:        'work-sans',
		headingDistinct: false,
		printSidebar:    'color',
	},
	{
		presetName:      'Ivory',
		sidebarColor:    '#2C2520',
		pageBackground:  '#F5F3EE',
		headingFont:     'eb-garamond',
		bodyFont:        'dm-sans',
		headingDistinct: true,
		printSidebar:    'color',
	},
	{
		presetName:      'Legal',
		sidebarColor:    '#1A1A2E',
		pageBackground:  '#F7F7F5',
		headingFont:     'libre-baskerville',
		bodyFont:        'source-sans-3',
		headingDistinct: true,
		printSidebar:    'grayscale',
	},
	{
		presetName:      'Mono Print',
		sidebarColor:    '#2A2A2A',
		pageBackground:  '#FFFFFF',
		headingFont:     'dm-sans',
		bodyFont:        'dm-sans',
		headingDistinct: false,
		printSidebar:    'outline',
	},
];

// ─── Persistence ──────────────────────────────────────────────────────────────

export function loadStyle(): DocumentStyle {
	try {
		const raw = localStorage.getItem(STYLE_KEY);
		if (!raw) { return { ...STYLE_DEFAULTS }; }
		const parsed = JSON.parse(raw) as Partial<DocumentStyle>;
		const merged = { ...STYLE_DEFAULTS, ...parsed } as DocumentStyle;
		// Backward compatibility for older saved styles.
		if ((parsed as { bodyFont?: string }).bodyFont === 'inter') {
			merged.bodyFont = 'work-sans';
		}
		return merged;
	} catch {
		return { ...STYLE_DEFAULTS };
	}
}

export function saveStyle(style: DocumentStyle): void {
	try {
		localStorage.setItem(STYLE_KEY, JSON.stringify(style));
	} catch { /* quota or private mode */ }
}

// ─── Apply ────────────────────────────────────────────────────────────────────

/**
 * Applies a (partial) DocumentStyle to the document.
 * Merges with the current persisted style, then:
 *   1. Sets --color-sidebar and sidebar text contrast tokens
 *   2. Sets --color-paper (CV page background)
 *   3. Sets --color-teal-mid/light/deep (accent derivation or override)
 *   4. Sets --font-body and --font-heading CSS vars
 *   5. Sets data-print-sidebar attribute for print.css selectors
 *   6. Persists the merged style to localStorage
 *
 * Call this on startup (loadStyle + applyDocumentStyle) and on every change.
 */
export function applyDocumentStyle(patch: Partial<DocumentStyle>): DocumentStyle {
	const current = loadStyle();
	const style: DocumentStyle = { ...current, ...patch };

	// Clear presetName if the user changed a value manually (not via preset)
	if (patch.presetName === undefined && Object.keys(patch).length > 0) {
		style.presetName = undefined;
	}

	const root = document.documentElement;
	const safeFontUrl = assertSafeGoogleFontUrl(style.customFontCssUrl);
	applyCustomFontStylesheet(safeFontUrl);

	// ── Sidebar colour ────────────────────────────────────────────────────────
	root.style.setProperty('--color-sidebar', style.sidebarColor);

	// Sidebar text contrast — auto-switch between white and dark text
	if (needsLightText(style.sidebarColor)) {
		// Dark sidebar → white text (default behaviour; remove any overrides)
		root.style.removeProperty('--color-sidebar-text');
		root.style.removeProperty('--color-sidebar-muted');
		root.style.removeProperty('--color-sidebar-muted-2');
		root.style.removeProperty('--color-sidebar-muted-3');
		root.style.removeProperty('--color-sidebar-muted-4');
		root.style.removeProperty('--color-sidebar-muted-5');
		root.style.removeProperty('--color-sidebar-muted-6');
		root.style.removeProperty('--color-sidebar-muted-7');
		root.style.removeProperty('--color-sidebar-muted-8');
		root.style.removeProperty('--color-sidebar-border');
		root.style.removeProperty('--color-skill-tag-bg');
		root.style.removeProperty('--color-skill-tag-border');
	} else {
		// Light sidebar → dark text
		root.style.setProperty('--color-sidebar-text',    '#1A1A1A');
		root.style.setProperty('--color-sidebar-muted',   '#1A1A1A80');
		root.style.setProperty('--color-sidebar-muted-2', '#1A1A1A99');
		root.style.setProperty('--color-sidebar-muted-3', '#1A1A1AB3');
		root.style.setProperty('--color-sidebar-muted-4', '#1A1A1ACC');
		root.style.setProperty('--color-sidebar-muted-5', '#1A1A1AE0');
		root.style.setProperty('--color-sidebar-muted-6', '#1A1A1AEE');
		root.style.setProperty('--color-sidebar-muted-7', '#1A1A1A73');
		root.style.setProperty('--color-sidebar-muted-8', '#1A1A1AF2');
		root.style.setProperty('--color-sidebar-border',  '#1A1A1A30');
		root.style.setProperty('--color-skill-tag-bg',    'rgba(0,0,0,0.06)');
		root.style.setProperty('--color-skill-tag-border','rgba(0,0,0,0.14)');
	}

	// ── Page background (CV paper only, not app canvas) ──────────────────────
	root.style.setProperty('--color-paper', style.pageBackground);
	// Clear legacy override from earlier builds where pageBackground targeted
	// --color-ink-bg (app UI surface token).
	root.style.removeProperty('--color-ink-bg');

	// ── Accent colours ────────────────────────────────────────────────────────
	const accents = style.accentOverride ?? deriveAccents(style.sidebarColor);
	root.style.setProperty('--color-teal-mid',   accents.mid);
	root.style.setProperty('--color-teal-light',  accents.light);
	root.style.setProperty('--color-teal-deep',   accents.deep);

	// ── Font families ─────────────────────────────────────────────────────────
	const bodyCSS    = BODY_FONT_CSS[style.bodyFont];
	const bodyFontCss = style.customBodyFontFamily?.trim() || bodyCSS;
	const headingFontCss = style.customHeadingFontFamily?.trim() ||
		HEADING_FONT_CSS[style.headingFont];
	const headingCSS = style.headingDistinct ? headingFontCss : bodyFontCss;

	root.style.setProperty('--font-body',    bodyFontCss);
	root.style.setProperty('--font-heading', headingCSS);

	// ── Print sidebar mode ────────────────────────────────────────────────────
	root.dataset.printSidebar = style.printSidebar;
	applyCustomCssVars(root, style.customCssVars);

	// ── Persist ───────────────────────────────────────────────────────────────
	saveStyle(style);

	return style;
}

/**
 * Loads the persisted style and applies it.
 * Call once on startup before the layout engine runs.
 */
export function rehydrateStyle(): DocumentStyle {
	return applyDocumentStyle({});
}
