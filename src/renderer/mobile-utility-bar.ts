type UtilityAction = {
	id: string;
	label: string;
	icon: string;
	targetId: string;
};

type MobileUtilityBarOptions = {
	isEnabled: () => boolean;
	primaryActions: UtilityAction[];
	moreActions: UtilityAction[];
};

type MobileUtilityBar = {
	sync: () => void;
	destroy: () => void;
};

function h(
	tag: string,
	attrs: Record<string, string> = {},
	...children: Array<Node | string>
): HTMLElement {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		el.setAttribute(k === 'className' ? 'class' : k, v);
	}
	for (const child of children) {
		el.append(
			typeof child === 'string'
				? document.createTextNode(child)
				: child,
		);
	}
	return el;
}

export function initMobileUtilityBar(
	options: MobileUtilityBarOptions,
): MobileUtilityBar {
	const root = document.documentElement;
	const body = document.body;
	const bar = h('div', {
		id: 'cv-mobile-utility-bar',
		class: 'cv-mobile-utility-bar no-print',
		hidden: '',
	});
	const row = h('div', { class: 'cv-mobile-utility-bar__row' });
	const moreSheet = h('div', {
		id: 'cv-mobile-utility-sheet',
		class: 'cv-mobile-utility-sheet no-print',
		hidden: '',
	});
	const backdrop = h('button', {
		type: 'button',
		class: 'cv-mobile-utility-sheet__backdrop',
		'aria-label': 'Close actions menu',
	});
	const panel = h('div', {
		class: 'cv-mobile-utility-sheet__panel',
		role: 'dialog',
		'aria-modal': 'true',
		'aria-label': 'More actions',
	});
	const panelHead = h('div', { class: 'cv-mobile-utility-sheet__head' }, 'More');
	const panelBody = h('div', { class: 'cv-mobile-utility-sheet__body' });
	panel.append(panelHead, panelBody);
	moreSheet.append(backdrop, panel);
	bar.appendChild(row);
	document.body.append(bar, moreSheet);

	let moreOpen = false;
	const ro = new ResizeObserver(() => {
		const hPx = Math.max(0, Math.round(bar.getBoundingClientRect().height));
		root.style.setProperty('--cv-mobile-utility-h', `${hPx}px`);
	});
	ro.observe(bar);

	const clickTarget = (targetId: string): void => {
		const target = document.getElementById(targetId);
		if (target instanceof HTMLElement) {
			// Defer proxied trigger click so outside-click handlers for the
			// *current* pointer event run first and do not immediately close it.
			window.setTimeout(() => { target.click(); }, 0);
		}
	};

	const setMoreOpen = (open: boolean): void => {
		moreOpen = open;
		moreSheet.hidden = !open;
		root.classList.toggle('cv-mobile-utility-sheet-open', open);
	};

	const mkActionBtn = (
		action: UtilityAction,
		className: string,
		onAfterClick?: () => void,
	): HTMLElement => {
		const btn = h('button', {
			type: 'button',
			class: `cv-mobile-utility-bar__btn ${className}`,
			'data-icon': action.icon,
			'aria-label': action.label,
			title: action.label,
		}, action.label);
		btn.addEventListener('click', () => {
			clickTarget(action.targetId);
			onAfterClick?.();
		});
		return btn;
	};

	for (const action of options.primaryActions) {
		row.appendChild(mkActionBtn(action, 'cv-mobile-utility-bar__btn--primary'));
	}

	const moreBtn = h('button', {
		type: 'button',
		class: 'cv-mobile-utility-bar__btn cv-mobile-utility-bar__btn--primary',
		'data-icon': '⋯',
		'aria-label': 'More actions',
		title: 'More actions',
	}, 'More');
	moreBtn.addEventListener('click', () => { setMoreOpen(!moreOpen); });
	row.appendChild(moreBtn);

	for (const action of options.moreActions) {
		panelBody.appendChild(
			mkActionBtn(action, 'cv-mobile-utility-bar__btn--sheet', () => {
				setMoreOpen(false);
			}),
		);
	}
	backdrop.addEventListener('click', () => { setMoreOpen(false); });
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') { setMoreOpen(false); }
	});

	const sync = (): void => {
		const enabled = options.isEnabled();
		bar.hidden = !enabled;
		if (!enabled) { setMoreOpen(false); }
		root.classList.toggle('cv-mobile-utility-active', enabled);
		const hPx = enabled
			? Math.max(0, Math.round(bar.getBoundingClientRect().height))
			: 0;
		root.style.setProperty('--cv-mobile-utility-h', `${hPx}px`);
		body.classList.toggle('cv-mobile-utility-active', enabled);
	};
	sync();

	return {
		sync,
		destroy: () => {
			ro.disconnect();
			setMoreOpen(false);
			bar.remove();
			moreSheet.remove();
			root.classList.remove('cv-mobile-utility-active');
			body.classList.remove('cv-mobile-utility-active');
			root.style.removeProperty('--cv-mobile-utility-h');
		},
	};
}
