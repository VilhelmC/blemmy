/**
 * document-style.ts
 *
 * Type contracts for the Blemmy document style system.
 * Governs bot-addressable colours, font pairs, and print behaviour.
 *
 * The runtime implementation lives in src/lib/document-style.ts.
 */

// ─── Fonts ────────────────────────────────────────────────────────────────────

/**
 * Available heading fonts. Bundled via @fontsource (see src/styles/fonts.css).
 * Identifier maps to the CSS font-family string in HEADING_FONT_CSS.
 */
export type HeadingFont =
	| 'dm-sans'              // default — clean sans for all text
	| 'playfair-display'     // editorial serif — strong contrast
	| 'cormorant-garamond'   // refined serif — elegant, slightly condensed
	| 'libre-baskerville'    // traditional serif — legal/finance tone
	| 'eb-garamond';         // literary serif — academic/research tone

/**
 * Available body fonts. All are pre-loaded in index.html via Google Fonts.
 */
export type BodyFont =
	| 'dm-sans'              // default — geometric sans, excellent for CV
	| 'work-sans'            // modern sans — clearer contrast vs DM Sans
	| 'source-sans-3';       // humanist sans — clean and readable

// ─── Print sidebar ────────────────────────────────────────────────────────────

/**
 * How the sidebar renders in print / PDF output.
 * Applied via data-print-sidebar on the style token root (usually :root / html).
 */
export type PrintSidebarStyle =
	| 'color'       // sidebar prints in full colour (default)
	| 'grayscale'   // sidebar desaturated to equivalent grey — saves ink
	| 'outline';    // white sidebar with a left border in sidebar colour

// ─── Document style ───────────────────────────────────────────────────────────

/**
 * The complete document style schema.
 *
 * All fields are required in a persisted DocumentStyle.
 * When the bot returns a style block it may be partial — the runtime
 * merges it with the current style before applying.
 *
 * @see applyDocumentStyle() in src/lib/document-style.ts
 */
export interface DocumentStyle {
	/**
	 * Sidebar background colour. Hex string, 3 or 6 digit.
	 * Drives --color-sidebar. Accent colours are automatically derived
	 * from this value unless accentOverride is set.
	 */
	sidebarColor:    string;

	/**
	 * Page background colour in light mode.
	 * Drives --color-paper. Defaults to #F7F7F5.
	 */
	pageBackground:  string;

	/**
	 * Optional manual override for the three main-column accent colours.
	 * When absent, accents are derived from sidebarColor via HSL math.
	 * Use this for curated presets where the designer has chosen exact values.
	 */
	accentOverride?: {
		mid:   string;  // dates, position sub-text    (--color-teal-mid)
		light: string;  // muted label text             (--color-teal-light)
		deep:  string;  // bullet marker squares        (--color-teal-deep)
	};

	/** Heading font identifier. */
	headingFont:     HeadingFont;

	/** Body font identifier. */
	bodyFont:        BodyFont;

	/**
	 * When true, headings use headingFont. When false, headings inherit bodyFont.
	 * Allows single-font documents even when headingFont is set.
	 */
	headingDistinct: boolean;

	/** Print sidebar rendering mode. */
	printSidebar:    PrintSidebarStyle;

	/**
	 * Optional remote @font-face stylesheet URL (https only).
	 * Allowlisted hosts: fonts.googleapis.com, fonts.bunny.net.
	 * Use with customBodyFontFamily / customHeadingFontFamily so tokens match
	 * the loaded face names. Preset heading/body ids use bundled @fontsource
	 * files and work offline without this field.
	 */
	customFontCssUrl?: string;

	/**
	 * Optional custom font-family CSS value used for body text.
	 * Example: "'Merriweather', Georgia, serif"
	 */
	customBodyFontFamily?: string;

	/**
	 * Optional custom font-family CSS value used for headings when
	 * headingDistinct is true.
	 */
	customHeadingFontFamily?: string;

	/**
	 * Optional allowlisted CSS variable overrides.
	 * Keys must be existing style tokens supported by runtime apply logic.
	 */
	customCssVars?: Record<string, string>;

	/**
	 * Name of the preset that produced this style, if any.
	 * Informational only — displayed in the style panel.
	 * Cleared when the user makes a manual change after applying a preset.
	 */
	presetName?:     string;
}

// ─── Preset ───────────────────────────────────────────────────────────────────

/** A named preset — a complete DocumentStyle with a display label. */
export interface StylePreset extends DocumentStyle {
	presetName: string;
}
