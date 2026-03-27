/**
 * @vitest-environment jsdom
 *
 * Exercises `window.visualViewport`-bound helpers (pinch-zoom is unavailable
 * in the default Vitest node environment).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
	clientCssDeltaToLayoutTransformShift,
	pinchZoomScale,
	uiZoomCompensation,
} from '@renderer/viewport-space';

describe('pinchZoomScale() → window.visualViewport', () => {
	afterEach(() => {
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: undefined,
		});
	});

	it('returns 1 when visualViewport is undefined', () => {
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: undefined,
		});
		expect(pinchZoomScale()).toBe(1);
	});

	it('reads visualViewport.scale', () => {
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: { scale: 2 },
		});
		expect(pinchZoomScale()).toBe(2);
		expect(uiZoomCompensation()).toBeCloseTo(0.5, 10);
		expect(clientCssDeltaToLayoutTransformShift(100)).toBeCloseTo(50, 10);
	});
});
