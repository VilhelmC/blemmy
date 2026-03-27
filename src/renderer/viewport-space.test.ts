import { describe, expect, it } from 'vitest';
import {
	clientDeltaToLayoutShift,
	dockPeekSlideLayoutPx,
	layoutShiftToClientDelta,
	normalizePinchScale,
	uiZoomCompFromScale,
	MIN_PINCH_SCALE,
} from '@renderer/viewport-space';

describe('normalizePinchScale', () => {
	it('uses 1 for null, undefined, NaN', () => {
		expect(normalizePinchScale(null)).toBe(1);
		expect(normalizePinchScale(undefined)).toBe(1);
		expect(normalizePinchScale(Number.NaN)).toBe(1);
	});
	it('clamps tiny values to MIN_PINCH_SCALE', () => {
		expect(normalizePinchScale(0)).toBe(MIN_PINCH_SCALE);
		expect(normalizePinchScale(0.001)).toBe(MIN_PINCH_SCALE);
	});
	it('passes through typical pinch values', () => {
		expect(normalizePinchScale(1)).toBe(1);
		expect(normalizePinchScale(2)).toBe(2);
		expect(normalizePinchScale(0.5)).toBe(0.5);
	});
});

describe('uiZoomCompFromScale', () => {
	it('inverts σ', () => {
		expect(uiZoomCompFromScale(2)).toBeCloseTo(0.5);
		expect(uiZoomCompFromScale(1)).toBe(1);
		expect(uiZoomCompFromScale(0.5)).toBeCloseTo(2);
	});
});

describe('layout ↔ client delta (pinch invariants)', () => {
	const sigmas = [1, 1.25, 1.5, 2, 3];

	it('round-trips client → layout → client', () => {
		for (const σ of sigmas) {
			const client = 100;
			const layout = clientDeltaToLayoutShift(client, σ);
			const back = layoutShiftToClientDelta(layout, σ);
			expect(back).toBeCloseTo(client, 10);
		}
	});

	it('round-trips layout → client → layout', () => {
		for (const σ of sigmas) {
			const layout = 80;
			const client = layoutShiftToClientDelta(layout, σ);
			const back = clientDeltaToLayoutShift(client, σ);
			expect(back).toBeCloseTo(layout, 10);
		}
	});

	it('satisfies Δ_client ≈ Δ_layout × σ (doc model)', () => {
		expect(layoutShiftToClientDelta(40, 2)).toBeCloseTo(80, 10);
		expect(clientDeltaToLayoutShift(80, 2)).toBeCloseTo(40, 10);
	});
});

/**
 * Idealized: full layout width W, local scale(1/σ) ⇒ gbcr width ≈ W/σ.
 * Slide_layout = (W/σ) + m/σ  ⇒  Slide_layout × σ = W + m  (one strip + margin).
 */
describe('dockPeekSlideLayoutPx (idealized strip)', () => {
	const cases: Array<{ W: number; σ: number; m: number }> = [
		{ W: 100, σ: 1, m: 58 },
		{ W: 200, σ: 2, m: 58 },
		{ W: 160, σ: 1.6, m: 40 },
	];

	it('visual travel ≈ W + m under model slide×σ', () => {
		for (const { W, σ, m } of cases) {
			const painted = W / σ;
			const slide = dockPeekSlideLayoutPx({
				paintedLayoutWidth: painted,
				clearanceClientRefPx: m,
				scale: σ,
			});
			const visualTravel = layoutShiftToClientDelta(slide, σ);
			expect(visualTravel).toBeCloseTo(W + m, 9);
		}
	});

	it('matches explicit sum painted + m/σ', () => {
		const slide = dockPeekSlideLayoutPx({
			paintedLayoutWidth: 50,
			clearanceClientRefPx: 10,
			scale: 2,
		});
		expect(slide).toBeCloseTo(50 + 5, 10);
	});
});
