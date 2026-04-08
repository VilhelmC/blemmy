import { expect, test } from './test-base';
import { waitForCvLayoutReady } from './helpers/paper-containment';

type LayoutRenderFingerprint = {
	layoutReady:      boolean;
	layoutAttrs:      Record<string, string>;
	pageEls:          number;
	experienceBlocks: number;
	hasAlternatives:  boolean;
};

/**
 * Catches accidental layout telemetry / DOM renames. The snapshot stores
 * sorted attribute names plus a few stable demo-derived fields — not timings,
 * pixel slack strings, or candidate counts (those vary with engine tuning).
 */
test('CV demo layout fingerprint matches snapshot', async ({ page }) => {
	await page.goto('/');
	await page.setViewportSize({ width: 1280, height: 900 });
	await waitForCvLayoutReady(page);

	const fp = await page.evaluate((): LayoutRenderFingerprint => {
		const card = document.getElementById('blemmy-card');
		const layoutAttrs: Record<string, string> = {};
		if (card) {
			for (const a of Array.from(card.attributes)) {
				if (a.name.startsWith('data-blemmy-layout-')) {
					layoutAttrs[a.name] = a.value;
				}
			}
		}
		return {
			layoutReady:
				card?.getAttribute('data-blemmy-layout-ready') === 'true',
			layoutAttrs,
			pageEls: document.querySelectorAll('.blemmy-page').length,
			experienceBlocks: document.querySelectorAll('.experience-block').length,
			hasAlternatives: !!document.getElementById('blemmy-layout-alternatives'),
		};
	});

	expect(fp.layoutReady).toBe(true);
	expect(fp.hasAlternatives).toBe(true);
	expect(fp.pageEls).toBe(2);
	expect(fp.experienceBlocks).toBe(4);
	expect(fp.layoutAttrs['data-blemmy-layout-pages']).toMatch(/^[12]$/);
	expect(fp.layoutAttrs['data-blemmy-layout-disposition'] ?? '').toMatch(
		/^(single-page|two-page|web-idle)$/,
	);

	const stable = {
		blemmyLayoutAttrNames: Object.keys(fp.layoutAttrs).sort(),
		pages:                 fp.layoutAttrs['data-blemmy-layout-pages'],
		disposition:           fp.layoutAttrs['data-blemmy-layout-disposition'],
		headerVariant:         fp.layoutAttrs['data-blemmy-layout-header-variant'],
		sectionsJson:          fp.layoutAttrs['data-blemmy-layout-sections'],
		workSplit:             fp.layoutAttrs['data-blemmy-layout-work-split'],
	};
	expect(JSON.stringify(stable, null, 2)).toMatchSnapshot();
});
