import {
	expect as baseExpect,
	test as baseTest,
	type ConsoleMessage,
	type Request,
	type Response,
} from '@playwright/test';

type DebugEvent = {
	ts: number;
	type: string;
	data: Record<string, unknown>;
};

const EVENT_LIMIT = 500;

function pushLimited(events: DebugEvent[], ev: DebugEvent): void {
	if (events.length >= EVENT_LIMIT) {
		events.shift();
	}
	events.push(ev);
}

export const test = baseTest.extend({
	page: async ({ page }, use, testInfo) => {
		const events: DebugEvent[] = [];
		const onConsole = (msg: ConsoleMessage): void => {
			pushLimited(events, {
				ts: Date.now(),
				type: `console:${msg.type()}`,
				data: {
					text: msg.text(),
					location: msg.location(),
				},
			});
		};
		const onPageError = (err: Error): void => {
			pushLimited(events, {
				ts: Date.now(),
				type: 'pageerror',
				data: {
					message: err.message,
					stack: err.stack ?? '',
				},
			});
		};
		const onRequest = (req: Request): void => {
			pushLimited(events, {
				ts: Date.now(),
				type: 'request',
				data: {
					method: req.method(),
					url: req.url(),
					resourceType: req.resourceType(),
				},
			});
		};
		const onResponse = async (res: Response): Promise<void> => {
			pushLimited(events, {
				ts: Date.now(),
				type: 'response',
				data: {
					status: res.status(),
					url: res.url(),
					ok: res.ok(),
				},
			});
		};

		page.on('console', onConsole);
		page.on('pageerror', onPageError);
		page.on('request', onRequest);
		page.on('response', onResponse);

		await use(page);

		const perf = await page.evaluate(() => {
			const nav = performance.getEntriesByType('navigation')[0] as
				| PerformanceNavigationTiming
				| undefined;
			return nav
				? {
					domContentLoadedMs: Math.round(
						nav.domContentLoadedEventEnd - nav.startTime,
					),
					loadMs: Math.round(nav.loadEventEnd - nav.startTime),
					responseMs: Math.round(nav.responseEnd - nav.requestStart),
				}
				: null;
		}).catch(() => null);

		await testInfo.attach('runtime-debug-events', {
			body: JSON.stringify({ perf, events }, null, 2),
			contentType: 'application/json',
		});

		page.off('console', onConsole);
		page.off('pageerror', onPageError);
		page.off('request', onRequest);
		page.off('response', onResponse);
	},
});

export const expect = baseExpect;
