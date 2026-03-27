type HoverPinItem = {
	id: string;
	handle: HTMLElement;
	panel: HTMLElement;
	hoverRegion: HTMLElement;
};

type HoverPinControllerOptions = {
	isEnabled: () => boolean;
	openClass: string;
	closeDelayMs?: number;
	oneOpenAtATime?: boolean;
};

type HoverPinController = {
	closeAll: () => void;
	destroy: () => void;
};

type ItemState = {
	pinned: boolean;
	closeTimer: number | null;
};

const DEFAULT_CLOSE_DELAY_MS = 320;

export function initHoverPinController(
	items: HoverPinItem[],
	options: HoverPinControllerOptions,
): HoverPinController {
	const closeDelayMs = options.closeDelayMs ?? DEFAULT_CLOSE_DELAY_MS;
	const oneOpenAtATime = options.oneOpenAtATime ?? true;
	const states = new Map<string, ItemState>();
	for (const item of items) {
		states.set(item.id, { pinned: false, closeTimer: null });
	}

	const clearCloseTimer = (id: string): void => {
		const st = states.get(id);
		if (!st || st.closeTimer == null) { return; }
		window.clearTimeout(st.closeTimer);
		st.closeTimer = null;
	};

	const setOpen = (item: HoverPinItem, open: boolean): void => {
		item.panel.classList.toggle(options.openClass, open);
		item.handle.setAttribute('aria-expanded', open ? 'true' : 'false');
	};

	const closeItem = (item: HoverPinItem): void => {
		clearCloseTimer(item.id);
		const st = states.get(item.id);
		if (!st) { return; }
		st.pinned = false;
		setOpen(item, false);
	};

	const closeOthers = (keepId: string): void => {
		for (const item of items) {
			if (item.id === keepId) { continue; }
			closeItem(item);
		}
	};

	const openPreview = (item: HoverPinItem): void => {
		if (!options.isEnabled()) { return; }
		clearCloseTimer(item.id);
		if (oneOpenAtATime) {
			closeOthers(item.id);
		}
		setOpen(item, true);
	};

	const pinOpen = (item: HoverPinItem): void => {
		if (!options.isEnabled()) { return; }
		const st = states.get(item.id);
		if (!st) { return; }
		clearCloseTimer(item.id);
		if (oneOpenAtATime) {
			closeOthers(item.id);
		}
		st.pinned = true;
		setOpen(item, true);
	};

	const togglePinned = (item: HoverPinItem): void => {
		if (!options.isEnabled()) { return; }
		const st = states.get(item.id);
		if (!st) { return; }
		if (st.pinned) {
			closeItem(item);
			return;
		}
		pinOpen(item);
	};

	const scheduleCloseIfUnpinned = (item: HoverPinItem): void => {
		if (!options.isEnabled()) { return; }
		const st = states.get(item.id);
		if (!st || st.pinned) { return; }
		clearCloseTimer(item.id);
		st.closeTimer = window.setTimeout(() => {
			const current = states.get(item.id);
			if (!current || current.pinned || !options.isEnabled()) { return; }
			setOpen(item, false);
			current.closeTimer = null;
		}, closeDelayMs);
	};

	const closeAll = (): void => {
		for (const item of items) {
			closeItem(item);
		}
	};

	const onDocClick = (event: MouseEvent): void => {
		if (!options.isEnabled()) { return; }
		const t = event.target;
		if (!(t instanceof Node)) { return; }
		for (const item of items) {
			if (item.hoverRegion.contains(t)) { return; }
		}
		closeAll();
	};

	const onEsc = (event: KeyboardEvent): void => {
		if (!options.isEnabled() || event.key !== 'Escape') { return; }
		closeAll();
	};

	for (const item of items) {
		item.handle.addEventListener('click', (event) => {
			event.stopPropagation();
			togglePinned(item);
		});
		item.hoverRegion.addEventListener('pointerenter', () => {
			openPreview(item);
		});
		item.hoverRegion.addEventListener('pointerleave', () => {
			scheduleCloseIfUnpinned(item);
		});
		item.panel.addEventListener('click', () => {
			pinOpen(item);
		});
	}

	document.addEventListener('click', onDocClick);
	document.addEventListener('keydown', onEsc);

	return {
		closeAll,
		destroy: () => {
			closeAll();
			document.removeEventListener('click', onDocClick);
			document.removeEventListener('keydown', onEsc);
		},
	};
}

type DefaultHoverPinOptions = {
	isEnabled: () => boolean;
	openClass: string;
};

/**
 * Convenience factory with the project defaults:
 * - one-open-at-a-time
 * - 350ms close grace
 * - outside-dismiss + Escape
 */
export function initDefaultHoverPinController(
	items: HoverPinItem[],
	options: DefaultHoverPinOptions,
): HoverPinController {
	return initHoverPinController(items, {
		isEnabled: options.isEnabled,
		openClass: options.openClass,
		closeDelayMs: 350,
		oneOpenAtATime: true,
	});
}
