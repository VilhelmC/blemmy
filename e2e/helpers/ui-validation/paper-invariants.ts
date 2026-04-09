import { expect, type Page } from '@playwright/test';

/**
 * Full snapshot for uniform-scale regressions: card/shell rects, first page
 * shape, and `--blemmy-paper-scale` from the document root.
 */
export type PaperInvariantSnapshot = {
	cardWidth: number;
	cardHeight: number;
	shellWidth: number;
	shellHeight: number;
	/** `#blemmy-card` width / height (viewport px). */
	cardAspectRatio: number;
	/** `#blemmy-page-1` width / height — reflow squeeze breaks this. */
	page1AspectRatio: number;
	/** Parsed `html` custom property `--blemmy-paper-scale` (JS-driven). */
	rootPaperScale: number;
};

export async function measurePaperInvariantSnapshot(
	page: Page,
): Promise<PaperInvariantSnapshot | null> {
	return page.evaluate(() => {
		const shell = document.getElementById('blemmy-doc-shell');
		const card = document.getElementById('blemmy-card');
		const p1 = document.getElementById('blemmy-page-1');
		if (!shell || !card) {
			return null;
		}
		const sr = shell.getBoundingClientRect();
		const cr = card.getBoundingClientRect();
		const pr = p1?.getBoundingClientRect();
		const scaleStr = getComputedStyle(document.documentElement)
			.getPropertyValue('--blemmy-paper-scale')
			.trim();
		const rootPaperScale = Number.parseFloat(scaleStr);
		const ch = cr.height;
		const ph = pr && pr.height > 0 ? pr.height : 0;
		return {
			cardWidth: cr.width,
			cardHeight: cr.height,
			shellWidth: sr.width,
			shellHeight: sr.height,
			cardAspectRatio: ch > 0 ? cr.width / ch : 0,
			page1AspectRatio: ph > 0 && pr ? pr.width / ph : 0,
			rootPaperScale: Number.isFinite(rootPaperScale) ? rootPaperScale : 1,
		};
	});
}

export function expectCardAspectRatioStable(
	baseline: PaperInvariantSnapshot,
	current: PaperInvariantSnapshot,
	hint: string,
	maxRatioDelta = 0.02,
): void {
	const delta = Math.abs(baseline.cardAspectRatio - current.cardAspectRatio);
	expect(
		delta,
		`${hint}: card aspect ratio Δ=${delta.toFixed(4)} ` +
			`(baseline ${baseline.cardAspectRatio.toFixed(4)}, ` +
			`current ${current.cardAspectRatio.toFixed(4)})`,
	).toBeLessThanOrEqual(maxRatioDelta);
}

export function expectShellAspectRatioStable(
	baseline: PaperInvariantSnapshot,
	current: PaperInvariantSnapshot,
	hint: string,
	maxRatioDelta = 0.02,
): void {
	const b = baseline.shellHeight > 0 ? baseline.shellWidth / baseline.shellHeight : 0;
	const c = current.shellHeight > 0 ? current.shellWidth / current.shellHeight : 0;
	const delta = Math.abs(b - c);
	expect(
		delta,
		`${hint}: shell aspect ratio Δ=${delta.toFixed(4)}`,
	).toBeLessThanOrEqual(maxRatioDelta);
}

export function expectPageOneAspectRatioStable(
	baseline: PaperInvariantSnapshot,
	current: PaperInvariantSnapshot,
	hint: string,
	maxRatioDelta = 0.03,
): void {
	if (baseline.page1AspectRatio <= 0 || current.page1AspectRatio <= 0) {
		throw new Error(`${hint}: missing #blemmy-page-1 for aspect check`);
	}
	const delta = Math.abs(baseline.page1AspectRatio - current.page1AspectRatio);
	expect(
		delta,
		`${hint}: page-1 aspect ratio Δ=${delta.toFixed(4)} ` +
			`(uniform scale preserves each page’s proportions; reflow squeeze does not)`,
	).toBeLessThanOrEqual(maxRatioDelta);
}

/**
 * When the column is narrower than the fixed paper width, opening a rail must
 * lower `--blemmy-paper-scale` (uniform shrink), not only CSS max-width.
 */
export function expectPaperScaleDropped(
	beforePanel: PaperInvariantSnapshot,
	afterPanel: PaperInvariantSnapshot,
	hint: string,
	minDrop = 0.04,
): void {
	expect(
		beforePanel.rootPaperScale - afterPanel.rootPaperScale,
		`${hint}: expected --blemmy-paper-scale to drop by at least ${minDrop} ` +
			`(before ${beforePanel.rootPaperScale}, after ${afterPanel.rootPaperScale})`,
	).toBeGreaterThanOrEqual(minDrop);
}
