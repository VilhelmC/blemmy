/**
 * style-panel.ts
 *
 * Builds and wires the document style section within the preferences panel.
 * Mounted by ui-components.ts into #blemmy-prefs-inner.
 *
 * Sections:
 *   1. Colour swatches — sidebar + page background, click-to-pick
 *   2. Font selectors — heading and body, rendered specimen cards
 *   3. Print sidebar — three-button toggle (color / grayscale / outline)
 *   4. Presets — horizontal swatch strip
 */

import {
	applyDocumentStyle,
	loadStyle,
	deriveAccents,
	STYLE_PRESETS,
	HEADING_FONT_LABELS,
	BODY_FONT_LABELS,
	STYLE_DEFAULTS,
	type DocumentStyle,
} from '@lib/document-style';

import type { HeadingFont, BodyFont, PrintSidebarStyle } from '@cv/document-style';

// ─── DOM helper ───────────────────────────────────────────────────────────────

function h(
	tag:   string,
	attrs: Record<string, string> = {},
	...children: (Node | string | null | undefined)[]
): HTMLElement {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		el.setAttribute(k === 'className' ? 'class' : k, v);
	}
	for (const child of children) {
		if (child == null) { continue; }
		el.append(typeof child === 'string' ? document.createTextNode(child) : child);
	}
	return el;
}

// ─── Style change event ───────────────────────────────────────────────────────

export const STYLE_CHANGED_EVENT = 'blemmy-style-changed';
export type StyleChangedDetail  = { style: DocumentStyle };

function dispatchStyleChanged(style: DocumentStyle): void {
	window.dispatchEvent(
		new CustomEvent<StyleChangedDetail>(STYLE_CHANGED_EVENT, { detail: { style } }),
	);
}

// ─── Colour swatch + picker (HSV) ─────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n));
}

function hexToRgb(hex: string): [number, number, number] | null {
	const raw = hex.trim().replace('#', '');
	if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(raw)) { return null; }
	const full = raw.length === 3
		? raw.split('').map((ch) => ch + ch).join('')
		: raw;
	const value = parseInt(full, 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
	const toHex = (v: number) => clamp(Math.round(v), 0, 255)
		.toString(16)
		.padStart(2, '0');
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
	const rr = r / 255;
	const gg = g / 255;
	const bb = b / 255;
	const max = Math.max(rr, gg, bb);
	const min = Math.min(rr, gg, bb);
	const d = max - min;
	const v = max;
	const s = max === 0 ? 0 : d / max;
	let h = 0;
	if (d !== 0) {
		if (max === rr) { h = ((gg - bb) / d + (gg < bb ? 6 : 0)); }
		else if (max === gg) { h = ((bb - rr) / d + 2); }
		else { h = ((rr - gg) / d + 4); }
		h /= 6;
	}
	return [h * 360, s * 100, v * 100];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
	const hh = (((h % 360) + 360) % 360) / 60;
	const ss = clamp(s, 0, 100) / 100;
	const vv = clamp(v, 0, 100) / 100;
	const c = vv * ss;
	const x = c * (1 - Math.abs((hh % 2) - 1));
	const m = vv - c;
	let r = 0;
	let g = 0;
	let b = 0;
	if (hh < 1) { r = c; g = x; }
	else if (hh < 2) { r = x; g = c; }
	else if (hh < 3) { g = c; b = x; }
	else if (hh < 4) { g = x; b = c; }
	else if (hh < 5) { r = x; b = c; }
	else { r = c; b = x; }
	return [
		Math.round((r + m) * 255),
		Math.round((g + m) * 255),
		Math.round((b + m) * 255),
	];
}

function buildColourSwatch(opts: {
	id:       string;
	label:    string;
	initial:  string;
	onChange: (hex: string) => void;
}): HTMLElement {
	const swatch = h('button', {
		type:         'button',
		class:        'blemmy-style-swatch',
		'aria-label': `${opts.label}: ${opts.initial}`,
		title:        opts.label,
	}) as HTMLButtonElement;

	const hueInput = h('input', {
		type:  'range',
		min:   '0',
		max:   '360',
		step:  '1',
		class: 'blemmy-style-hsv-slider',
		'data-role': 'h',
	}) as HTMLInputElement;
	const satInput = h('input', {
		type:  'hidden',
		'data-role': 's',
	}) as HTMLInputElement;
	const valInput = h('input', {
		type:  'hidden',
		'data-role': 'v',
	}) as HTMLInputElement;
	const hexInput = h('input', {
		type:        'text',
		class:       'blemmy-style-hex-input',
		maxlength:   '7',
		placeholder: '#RRGGBB',
	}) as HTMLInputElement;
	const rgbRInput = h('input', {
		type: 'number', min: '0', max: '255', class: 'blemmy-style-rgb-input',
	}) as HTMLInputElement;
	const rgbGInput = h('input', {
		type: 'number', min: '0', max: '255', class: 'blemmy-style-rgb-input',
	}) as HTMLInputElement;
	const rgbBInput = h('input', {
		type: 'number', min: '0', max: '255', class: 'blemmy-style-rgb-input',
	}) as HTMLInputElement;
	const svArea = h('div', { class: 'blemmy-style-sv-area' });
	const svHandle = h('button', {
		type: 'button',
		class: 'blemmy-style-sv-handle',
		'aria-label': `${opts.label} saturation/value`,
	}) as HTMLButtonElement;
	svArea.appendChild(svHandle);

	const popover = h('div', { class: 'blemmy-style-popover', hidden: '' },
		svArea,
		h('label', { class: 'blemmy-style-hsv-row' }, 'Hue', hueInput),
		h('label', { class: 'blemmy-style-hsv-row blemmy-style-hsv-row--hex' },
			'Hex',
			hexInput,
		),
		h('div', { class: 'blemmy-style-rgb-row' },
			h('label', { class: 'blemmy-style-rgb-cell' }, 'R', rgbRInput),
			h('label', { class: 'blemmy-style-rgb-cell' }, 'G', rgbGInput),
			h('label', { class: 'blemmy-style-rgb-cell' }, 'B', rgbBInput),
		),
	);

	function placePopoverInViewport(): void {
		popover.style.removeProperty('left');
		popover.style.removeProperty('right');
		popover.style.removeProperty('transform');
		popover.style.removeProperty('top');
		popover.style.removeProperty('bottom');
		popover.classList.remove('blemmy-style-popover--drop-up');
		popover.classList.remove('blemmy-style-popover--align-right');
		popover.classList.remove('blemmy-style-popover--align-left');
		const rect = popover.getBoundingClientRect();
		if (rect.right > window.innerWidth - 8) {
			popover.classList.add('blemmy-style-popover--align-right');
		}
		if (rect.left < 8) {
			popover.classList.remove('blemmy-style-popover--align-right');
			popover.classList.add('blemmy-style-popover--align-left');
		}
		const nextRect = popover.getBoundingClientRect();
		if (nextRect.bottom > window.innerHeight - 8) {
			popover.classList.add('blemmy-style-popover--drop-up');
		}
	}

	function applyHex(hex: string, emit: boolean): void {
		const rgb = hexToRgb(hex);
		if (!rgb) { return; }
		const normalized = rgbToHex(rgb[0], rgb[1], rgb[2]);
		const [hue, sat, val] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
		hueInput.value = String(Math.round(hue));
		satInput.value = String(Math.round(sat));
		valInput.value = String(Math.round(val));
		hexInput.value = normalized;
		rgbRInput.value = String(rgb[0]);
		rgbGInput.value = String(rgb[1]);
		rgbBInput.value = String(rgb[2]);
		swatch.style.setProperty('--swatch-color', normalized);
		swatch.setAttribute('aria-label', `${opts.label}: ${normalized}`);
		svArea.style.setProperty('--hue-color', rgbToHex(...hsvToRgb(hue, 100, 100)));
		svHandle.style.left = `${sat}%`;
		svHandle.style.top = `${100 - val}%`;
		if (emit) { opts.onChange(normalized); }
	}

	function emitFromHSV(): void {
		const hue = Number(hueInput.value);
		const sat = Number(satInput.value);
		const val = Number(valInput.value);
		const [r, g, b] = hsvToRgb(hue, sat, val);
		applyHex(rgbToHex(r, g, b), true);
	}
	function emitFromRGB(): void {
		const r = clamp(Number(rgbRInput.value) || 0, 0, 255);
		const g = clamp(Number(rgbGInput.value) || 0, 0, 255);
		const b = clamp(Number(rgbBInput.value) || 0, 0, 255);
		applyHex(rgbToHex(r, g, b), true);
	}
	function setSVFromPoint(clientX: number, clientY: number): void {
		const rect = svArea.getBoundingClientRect();
		const x = clamp(clientX - rect.left, 0, rect.width);
		const y = clamp(clientY - rect.top, 0, rect.height);
		const sat = rect.width <= 0 ? 0 : (x / rect.width) * 100;
		const val = rect.height <= 0 ? 100 : 100 - (y / rect.height) * 100;
		satInput.value = String(Math.round(sat));
		valInput.value = String(Math.round(val));
		emitFromHSV();
	}

	swatch.addEventListener('click', (event) => {
		event.stopPropagation();
		document.querySelectorAll<HTMLElement>('.blemmy-style-popover').forEach((el) => {
			if (el !== popover) { el.setAttribute('hidden', ''); }
		});
		const open = popover.hasAttribute('hidden');
		if (open) {
			popover.removeAttribute('hidden');
			placePopoverInViewport();
		}
		else { popover.setAttribute('hidden', ''); }
	});

	document.addEventListener('click', (event) => {
		if (!wrap.contains(event.target as Node)) {
			popover.setAttribute('hidden', '');
		}
	});
	window.addEventListener('resize', () => {
		if (!popover.hasAttribute('hidden')) {
			placePopoverInViewport();
		}
	});

	hueInput.addEventListener('input', emitFromHSV);
	hexInput.addEventListener('change', () => applyHex(hexInput.value, true));
	rgbRInput.addEventListener('change', emitFromRGB);
	rgbGInput.addEventListener('change', emitFromRGB);
	rgbBInput.addEventListener('change', emitFromRGB);
	svArea.addEventListener('pointerdown', (event) => {
		setSVFromPoint(event.clientX, event.clientY);
		const move = (ev: PointerEvent) => setSVFromPoint(ev.clientX, ev.clientY);
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	});

	const wrap = h('div', { class: 'blemmy-style-swatch-wrap' },
		h('span', { class: 'blemmy-style-swatch-label' }, opts.label),
		swatch,
		popover,
	);
	applyHex(opts.initial, false);

	return wrap;
}

/** Updates a swatch element's colour without triggering onChange. */
function updateSwatch(wrap: HTMLElement, hex: string): void {
	const swatch = wrap.querySelector<HTMLElement>('.blemmy-style-swatch');
	const hueInput = wrap.querySelector<HTMLInputElement>('input[data-role="h"]');
	const satInput = wrap.querySelector<HTMLInputElement>('input[data-role="s"]');
	const valInput = wrap.querySelector<HTMLInputElement>('input[data-role="v"]');
	const hexInput = wrap.querySelector<HTMLInputElement>('.blemmy-style-hex-input');
	const rgbInputs = wrap.querySelectorAll<HTMLInputElement>('.blemmy-style-rgb-input');
	const svArea = wrap.querySelector<HTMLElement>('.blemmy-style-sv-area');
	const svHandle = wrap.querySelector<HTMLElement>('.blemmy-style-sv-handle');
	const rgb = hexToRgb(hex);
	if (!swatch || !rgb) { return; }
	const normalized = rgbToHex(rgb[0], rgb[1], rgb[2]);
	const [hue, sat, val] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
	swatch.style.setProperty('--swatch-color', normalized);
	swatch.setAttribute('aria-label', `Color: ${normalized}`);
	if (hueInput) { hueInput.value = String(Math.round(hue)); }
	if (satInput) { satInput.value = String(Math.round(sat)); }
	if (valInput) { valInput.value = String(Math.round(val)); }
	if (hexInput) { hexInput.value = normalized; }
	if (rgbInputs[0]) { rgbInputs[0].value = String(rgb[0]); }
	if (rgbInputs[1]) { rgbInputs[1].value = String(rgb[1]); }
	if (rgbInputs[2]) { rgbInputs[2].value = String(rgb[2]); }
	if (svArea) {
		svArea.style.setProperty('--hue-color', rgbToHex(...hsvToRgb(hue, 100, 100)));
	}
	if (svHandle) {
		svHandle.style.left = `${sat}%`;
		svHandle.style.top = `${100 - val}%`;
	}
}

// ─── Font specimen cards ──────────────────────────────────────────────────────

type FontOption = { id: string; label: string; cssFamily: string };

function buildFontGrid(opts: {
	id:       string;
	label:    string;
	options:  FontOption[];
	selected: string;
	onChange: (id: string) => void;
}): HTMLElement {
	const grid = h('div', { class: 'blemmy-style-font-grid', role: 'radiogroup', 'aria-label': opts.label });
	const specimenText = opts.label === 'Heading'
		? 'Heading Aa'
		: 'Body text';

	for (const opt of opts.options) {
		const card = h('button', {
			type:           'button',
			class:          'blemmy-style-font-card',
			role:           'radio',
			'aria-pressed': String(opt.id === opts.selected),
			'aria-label':   opt.label,
			'data-font-tip': opt.label,
		});
		card.style.setProperty('--font-tip-family', opt.cssFamily);

		// Specimen text
		const specimen = h('span', { class: 'blemmy-style-font-specimen' }, specimenText);
		specimen.style.fontFamily = opt.cssFamily;

		const name = h('span', { class: 'blemmy-style-font-name' }, opt.label);

		card.appendChild(specimen);
		card.appendChild(name);

		card.addEventListener('click', () => {
			grid.querySelectorAll('.blemmy-style-font-card').forEach(c => {
				c.setAttribute('aria-pressed', 'false');
				c.classList.remove('blemmy-style-font-card--selected');
			});
			card.setAttribute('aria-pressed', 'true');
			card.classList.add('blemmy-style-font-card--selected');
			opts.onChange(opt.id);
		});

		if (opt.id === opts.selected) {
			card.setAttribute('aria-pressed', 'true');
			card.classList.add('blemmy-style-font-card--selected');
		}

		grid.appendChild(card);
	}

	return h('div', { class: 'blemmy-style-font-row' },
		h('span', { class: 'blemmy-style-font-row-label' }, opts.label),
		grid,
	);
}

function updateFontGrid(grid: HTMLElement, selectedId: string): void {
	grid.querySelectorAll<HTMLElement>('.blemmy-style-font-card').forEach(card => {
		const isSelected = card.getAttribute('aria-label') ===
			(card.querySelector('.blemmy-style-font-name')?.textContent ?? '');
		// Match by aria-label → font label
		const label  = card.querySelector('.blemmy-style-font-name')?.textContent ?? '';
		const matched = Object.entries(HEADING_FONT_LABELS).find(([, l]) => l === label)?.[0] ??
		                Object.entries(BODY_FONT_LABELS).find(([, l]) => l === label)?.[0];
		const active = matched === selectedId;
		card.setAttribute('aria-pressed', String(active));
		card.classList.toggle('blemmy-style-font-card--selected', active);
		void isSelected;
	});
}

// ─── Print sidebar toggle ─────────────────────────────────────────────────────

function buildPrintSidebarToggle(opts: {
	selected: PrintSidebarStyle;
	onChange: (mode: PrintSidebarStyle) => void;
}): HTMLElement {
	const modes: { id: PrintSidebarStyle; label: string; title: string }[] = [
		{ id: 'color',     label: 'Colour',    title: 'Print sidebar in full colour' },
		{ id: 'grayscale', label: 'Greyscale', title: 'Print sidebar desaturated — saves ink' },
		{ id: 'outline',   label: 'Outline',   title: 'White sidebar with left border — minimal ink' },
	];

	const btns = modes.map(mode => {
		const btn = h('button', {
			type:           'button',
			class:          'blemmy-style-print-btn',
			'data-mode':    mode.id,
			'aria-pressed': String(mode.id === opts.selected),
			title:          mode.title,
		}, mode.label) as HTMLButtonElement;

		if (mode.id === opts.selected) {
			btn.classList.add('blemmy-style-print-btn--active');
		}

		btn.addEventListener('click', () => {
			row.querySelectorAll('.blemmy-style-print-btn').forEach(b => {
				b.classList.remove('blemmy-style-print-btn--active');
				b.setAttribute('aria-pressed', 'false');
			});
			btn.classList.add('blemmy-style-print-btn--active');
			btn.setAttribute('aria-pressed', 'true');
			opts.onChange(mode.id);
		});

		return btn;
	});

	const toggle = h('div', { class: 'blemmy-style-print-toggle', role: 'group', 'aria-label': 'Print sidebar mode' },
		...btns,
	);

	const row = h('div', { class: 'blemmy-style-section-row' },
		h('span', { class: 'blemmy-style-section-label' }, 'Print sidebar'),
		toggle,
	);

	return row;
}

// ─── Presets strip ────────────────────────────────────────────────────────────

function buildPresetsStrip(opts: {
	current:  string | undefined;
	onChange: (preset: typeof STYLE_PRESETS[number]) => void;
}): HTMLElement {
	const strip = h('div', { class: 'blemmy-style-presets', 'aria-label': 'Style presets', role: 'listbox' });

	for (const preset of STYLE_PRESETS) {
		const dot = h('button', {
			type:           'button',
			class:          'blemmy-style-preset-dot',
			'aria-label':   preset.presetName,
			title:          preset.presetName,
			'data-preset':  preset.presetName,
			role:           'option',
			'aria-selected': String(preset.presetName === opts.current),
		});
		dot.style.setProperty('--preset-color', preset.sidebarColor);
		if (preset.presetName === opts.current) {
			dot.classList.add('blemmy-style-preset-dot--active');
		}
		dot.addEventListener('click', () => {
			strip.querySelectorAll('.blemmy-style-preset-dot').forEach(d => {
				d.classList.remove('blemmy-style-preset-dot--active');
				d.setAttribute('aria-selected', 'false');
			});
			dot.classList.add('blemmy-style-preset-dot--active');
			dot.setAttribute('aria-selected', 'true');
			opts.onChange(preset);
		});
		strip.appendChild(dot);
	}

	return h('div', { class: 'blemmy-style-presets-row' },
		h('span', { class: 'blemmy-style-section-label' }, 'Presets'),
		strip,
	);
}

function updatePresetsStrip(strip: HTMLElement, presetName: string | undefined): void {
	strip.querySelectorAll<HTMLElement>('.blemmy-style-preset-dot').forEach(dot => {
		const active = dot.dataset.preset === presetName;
		dot.classList.toggle('blemmy-style-preset-dot--active', active);
		dot.setAttribute('aria-selected', String(active));
	});
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Builds the style section element.
 * Returns the element and an update function for external sync
 * (e.g. when the bot applies a style change).
 */
export function buildStyleSection(): {
	el:     HTMLElement;
	syncUI: (style: DocumentStyle) => void;
} {
	let current = loadStyle();

	// ── Colour swatches ───────────────────────────────────────────────────────

	const sidebarSwatchWrap = buildColourSwatch({
		id:      'blemmy-style-sidebar-color',
		label:   'Sidebar',
		initial: current.sidebarColor,
		onChange: (hex) => {
			current = applyDocumentStyle({ sidebarColor: hex });
			// Clear accent override so derivation re-runs on new color
			current = applyDocumentStyle({ accentOverride: undefined });
			dispatchStyleChanged(current);
		},
	});

	const bgSwatchWrap = buildColourSwatch({
		id:      'blemmy-style-page-bg',
		label:   'Page',
		initial: current.pageBackground,
		onChange: (hex) => {
			current = applyDocumentStyle({ pageBackground: hex });
			dispatchStyleChanged(current);
		},
	});

	const resetAccentsBtn = h('button', {
		type:   'button',
		class:  'blemmy-style-reset-accents',
		title:  'Reset accent colours to automatic derivation',
	}, '↺ Accents');

	resetAccentsBtn.addEventListener('click', () => {
		current = applyDocumentStyle({ accentOverride: undefined });
		dispatchStyleChanged(current);
	});

	const colourRow = h('div', { class: 'blemmy-style-colour-row' },
		sidebarSwatchWrap,
		bgSwatchWrap,
		resetAccentsBtn,
	);

	// ── Font grids ────────────────────────────────────────────────────────────

	const headingOptions = (Object.keys(HEADING_FONT_LABELS) as HeadingFont[]).map(id => ({
		id,
		label:     HEADING_FONT_LABELS[id],
		cssFamily: `'${HEADING_FONT_LABELS[id]}', serif`,
	}));

	const bodyOptions = (Object.keys(BODY_FONT_LABELS) as BodyFont[]).map(id => ({
		id,
		label:     BODY_FONT_LABELS[id],
		cssFamily: `'${BODY_FONT_LABELS[id]}', sans-serif`,
	}));

	const headingGridRow = buildFontGrid({
		id:       'blemmy-style-heading-font',
		label:    'Heading',
		options:  headingOptions,
		selected: current.headingFont,
		onChange: (id) => {
			current = applyDocumentStyle({ headingFont: id as HeadingFont, headingDistinct: id !== current.bodyFont });
			dispatchStyleChanged(current);
		},
	});

	const bodyGridRow = buildFontGrid({
		id:       'blemmy-style-body-font',
		label:    'Body',
		options:  bodyOptions,
		selected: current.bodyFont,
		onChange: (id) => {
			current = applyDocumentStyle({ bodyFont: id as BodyFont });
			dispatchStyleChanged(current);
		},
	});

	// ── Print sidebar ─────────────────────────────────────────────────────────

	const printRow = buildPrintSidebarToggle({
		selected: current.printSidebar,
		onChange: (mode) => {
			current = applyDocumentStyle({ printSidebar: mode });
			dispatchStyleChanged(current);
		},
	});

	// ── Presets ───────────────────────────────────────────────────────────────

	const presetsRow = buildPresetsStrip({
		current: current.presetName,
		onChange: (preset) => {
			current = applyDocumentStyle({ ...preset });
			// Sync all UI elements
			syncUI(current);
			dispatchStyleChanged(current);
		},
	});

	// ── Reset button ──────────────────────────────────────────────────────────

	const resetBtn = h('button', {
		type:  'button',
		class: 'blemmy-style-reset',
	}, 'Reset style');

	resetBtn.addEventListener('click', () => {
		current = applyDocumentStyle({ ...STYLE_DEFAULTS });
		syncUI(current);
		dispatchStyleChanged(current);
	});

	// ── Section wrapper ───────────────────────────────────────────────────────

	const el = h('div', { class: 'blemmy-style-section' },
		h('p', { class: 'blemmy-prefs-heading' }, 'Style'),
		h('div', { class: 'blemmy-style-colours' },
			h('p', { class: 'blemmy-style-sub-label' }, 'Colours'),
			colourRow,
		),
		h('div', { class: 'blemmy-style-fonts' },
			h('p', { class: 'blemmy-style-sub-label' }, 'Typography'),
			headingGridRow,
			bodyGridRow,
		),
		printRow,
		presetsRow,
		resetBtn,
	);

	// ── syncUI — called externally when bot applies a style ───────────────────

	function syncUI(style: DocumentStyle): void {
		updateSwatch(sidebarSwatchWrap, style.sidebarColor);
		updateSwatch(bgSwatchWrap, style.pageBackground);
		updateFontGrid(headingGridRow, style.headingFont);
		updateFontGrid(bodyGridRow, style.bodyFont);
		// Print buttons
		printRow.querySelectorAll<HTMLElement>('.blemmy-style-print-btn').forEach(btn => {
			const active = btn.dataset.mode === style.printSidebar;
			btn.classList.toggle('blemmy-style-print-btn--active', active);
			btn.setAttribute('aria-pressed', String(active));
		});
		// Presets
		updatePresetsStrip(presetsRow, style.presetName);
	}

	return { el, syncUI };
}
