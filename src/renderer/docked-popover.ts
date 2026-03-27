type PopoverGroupMember = {
	isOpen: () => boolean;
	close: () => void;
};

const GROUPS = new Map<string, Set<PopoverGroupMember>>();

type DockedPopoverOptions = {
	panel: HTMLElement;
	trigger: HTMLElement;
	openClass?: string;
	group?: string;
	marginPx?: number;
	onOpen?: () => void;
	onClose?: () => void;
	outsideCloseGuard?: (target: Node) => boolean;
};

export type DockedPopoverController = {
	isOpen: () => boolean;
	open: () => void;
	close: () => void;
	toggle: () => void;
	refreshViewportFit: () => void;
	destroy: () => void;
};

function registerToGroup(group: string, member: PopoverGroupMember): () => void {
	let set = GROUPS.get(group);
	if (!set) {
		set = new Set();
		GROUPS.set(group, set);
	}
	set.add(member);
	return () => {
		const target = GROUPS.get(group);
		if (!target) { return; }
		target.delete(member);
		if (target.size === 0) {
			GROUPS.delete(group);
		}
	};
}

export function initDockedPopover(
	options: DockedPopoverOptions,
): DockedPopoverController {
	const openClass = options.openClass ?? '';
	const group = options.group ?? 'dock-popovers';
	const marginPx = options.marginPx ?? 12;
	let open = !options.panel.hidden;

	const applyViewportFit = (): void => {
		if (options.panel.hidden) { return; }
		const vv = window.visualViewport;
		const viewportH = vv?.height ?? window.innerHeight;
		const cssVars = getComputedStyle(document.documentElement);
		const utilityH = Number.parseFloat(
			cssVars.getPropertyValue('--cv-mobile-utility-h'),
		);
		const reservedBottom = Number.isFinite(utilityH) ? utilityH : 0;
		const baseMaxH = Math.max(
			180,
			Math.floor(viewportH - marginPx * 2 - reservedBottom),
		);
		const rect = options.panel.getBoundingClientRect();
		/*
		 * Use top-anchored available height; using rect.bottom can create a
		 * shrinking feedback loop while scrolling internal overflow content.
		 */
		const topInset = Math.max(marginPx, Math.floor(rect.top));
		const availableFromTop = Math.max(
			180,
			Math.floor(viewportH - topInset - marginPx - reservedBottom),
		);
		const maxH = Math.min(baseMaxH, availableFromTop);
		options.panel.style.maxHeight = `${maxH}px`;
		options.panel.style.overflowY = 'auto';
		options.panel.style.overscrollBehavior = 'contain';
	};

	const syncOpenUi = (): void => {
		options.panel.hidden = !open;
		options.trigger.setAttribute('aria-expanded', String(open));
		if (openClass) {
			options.trigger.classList.toggle(openClass, open);
		}
		if (open) {
			requestAnimationFrame(() => { applyViewportFit(); });
		}
	};

	const member: PopoverGroupMember = {
		isOpen: () => open,
		close: () => {
			if (!open) { return; }
			open = false;
			syncOpenUi();
			options.onClose?.();
		},
	};
	const unregister = registerToGroup(group, member);

	const closeOthersInGroup = (): void => {
		const set = GROUPS.get(group);
		if (!set) { return; }
		for (const other of set) {
			if (other === member || !other.isOpen()) { continue; }
			other.close();
		}
	};

	const openSelf = (): void => {
		if (open) { return; }
		closeOthersInGroup();
		open = true;
		syncOpenUi();
		options.onOpen?.();
	};

	const closeSelf = (): void => {
		if (!open) { return; }
		open = false;
		syncOpenUi();
		options.onClose?.();
	};

	const toggleSelf = (): void => {
		if (open) {
			closeSelf();
			return;
		}
		openSelf();
	};

	const onTriggerClick = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();
		toggleSelf();
	};

	const onDocClick = (event: MouseEvent): void => {
		if (!open) { return; }
		const t = event.target;
		if (!(t instanceof Node)) { return; }
		if (options.panel.contains(t) || options.trigger.contains(t)) { return; }
		if (options.outsideCloseGuard?.(t)) { return; }
		closeSelf();
	};

	const onEsc = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape' || !open) { return; }
		closeSelf();
	};

	options.trigger.addEventListener('click', onTriggerClick);
	document.addEventListener('click', onDocClick);
	document.addEventListener('keydown', onEsc);
	window.addEventListener('resize', applyViewportFit);
	window.visualViewport?.addEventListener('resize', applyViewportFit);
	window.visualViewport?.addEventListener('scroll', applyViewportFit);
	window.addEventListener('cv-ui-viewport-changed', applyViewportFit);

	syncOpenUi();

	return {
		isOpen: () => open,
		open: openSelf,
		close: closeSelf,
		toggle: toggleSelf,
		refreshViewportFit: applyViewportFit,
		destroy: () => {
			closeSelf();
			unregister();
			options.trigger.removeEventListener('click', onTriggerClick);
			document.removeEventListener('click', onDocClick);
			document.removeEventListener('keydown', onEsc);
			window.removeEventListener('resize', applyViewportFit);
			window.visualViewport?.removeEventListener('resize', applyViewportFit);
			window.visualViewport?.removeEventListener('scroll', applyViewportFit);
			window.removeEventListener('cv-ui-viewport-changed', applyViewportFit);
		},
	};
}
