/**
 * UI validation: uniform paper scale when rails open — extend with letter doc,
 * mobile sheet, popovers.
 */
import { expect, test } from '../test-base';
import { clickDockControl, expandPeekDocksIfNeeded } from '../helpers/dock-controls';
import {
	measurePaperContainment,
	waitForCvLayoutReady,
} from '../helpers/paper-containment';
import {
	expectCardAspectRatioStable,
	expectPageOneAspectRatioStable,
	expectPaperScaleDropped,
	expectShellAspectRatioStable,
	measurePaperInvariantSnapshot,
	type PaperInvariantSnapshot,
} from '../helpers/ui-validation/paper-invariants';

function assertNoPaperOverflow(
	report: Awaited<ReturnType<typeof measurePaperContainment>>,
	hint: string,
): void {
	expect(report.ok, `${hint}: measurement`).toBe(true);
	if (!report.ok) {
		return;
	}
	expect(
		report.violationCount,
		`${hint}: ${report.violationCount} node(s) overflow shell horizontally`,
	).toBe(0);
}

async function requireSnapshot(
	page: import('@playwright/test').Page,
): Promise<PaperInvariantSnapshot> {
	const m = await measurePaperInvariantSnapshot(page);
	expect(m, 'paper invariant snapshot').not.toBeNull();
	return m as PaperInvariantSnapshot;
}

test.describe('ui-validation / paper invariants (unified panels)', () => {
	test('assistant open: card, shell, page-1 aspects vs baseline @ 1280', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 900 });
		await waitForCvLayoutReady(page);
		await expandPeekDocksIfNeeded(page);
		const baseline = await requireSnapshot(page);

		await clickDockControl(page, 'blemmy-chat-trigger', 'Assistant');
		await expect(page.locator('#blemmy-chat-panel')).toBeVisible();
		await waitForCvLayoutReady(page);

		const during = await requireSnapshot(page);
		expectCardAspectRatioStable(baseline, during, 'assistant@1280');
		expectShellAspectRatioStable(baseline, during, 'assistant@1280');
		expectPageOneAspectRatioStable(baseline, during, 'assistant@1280');
		assertNoPaperOverflow(await measurePaperContainment(page), 'assistant@1280');
	});

	test('edit open: card, shell, page-1 aspects vs baseline @ 1280', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 900 });
		await waitForCvLayoutReady(page);
		await expandPeekDocksIfNeeded(page);
		const baseline = await requireSnapshot(page);

		await clickDockControl(page, 'blemmy-edit-btn', 'Edit');
		await expect(page.locator('#blemmy-edit-btn')).toHaveAttribute('aria-pressed', 'true');
		await expect(page.locator('#blemmy-edit-panel')).toHaveCount(1);
		await waitForCvLayoutReady(page);

		const during = await requireSnapshot(page);
		expectCardAspectRatioStable(baseline, during, 'edit@1280');
		expectShellAspectRatioStable(baseline, during, 'edit@1280');
		expectPageOneAspectRatioStable(baseline, during, 'edit@1280');
		assertNoPaperOverflow(await measurePaperContainment(page), 'edit@1280');
	});

	test('review open: card, shell, page-1 aspects vs baseline @ 1280', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 900 });
		await waitForCvLayoutReady(page);
		await expandPeekDocksIfNeeded(page);
		const baseline = await requireSnapshot(page);

		const toggle = page.locator('#blemmy-review-toggle');
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await expect(page.locator('#blemmy-review-panel')).toBeVisible();
		await waitForCvLayoutReady(page);

		const during = await requireSnapshot(page);
		expectCardAspectRatioStable(baseline, during, 'review@1280');
		expectShellAspectRatioStable(baseline, during, 'review@1280');
		expectPageOneAspectRatioStable(baseline, during, 'review@1280');
		assertNoPaperOverflow(await measurePaperContainment(page), 'review@1280');
	});

	test('narrow viewport: assistant open lowers --blemmy-paper-scale (uniform fit)', async ({
		page,
	}) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1000, height: 900 });
		await waitForCvLayoutReady(page);
		await expandPeekDocksIfNeeded(page);
		const closed = await requireSnapshot(page);
		expect(
			closed.rootPaperScale,
			'precondition: wide enough to hit scale 1 without rail',
		).toBeGreaterThanOrEqual(0.99);

		await clickDockControl(page, 'blemmy-chat-trigger', 'Assistant');
		await expect(page.locator('#blemmy-chat-panel')).toBeVisible();
		await waitForCvLayoutReady(page);

		const open = await requireSnapshot(page);
		expectPaperScaleDropped(closed, open, '1000px + assistant');
		expectPageOneAspectRatioStable(closed, open, '1000px + assistant');
		expectCardAspectRatioStable(closed, open, '1000px + assistant');
		assertNoPaperOverflow(await measurePaperContainment(page), '1000px + assistant');
	});
});
