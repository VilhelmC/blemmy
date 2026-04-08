type DockControlSpec = {
	id: string;
	label: string;
	ariaLabel: string;
	title: string;
	icon: string;
};

export const DOCK_CONTROLS = {
	debugLayout: {
		id: 'blemmy-layout-debug-toggle',
		label: 'Debug',
		ariaLabel: 'Toggle layout debugging',
		title: 'Toggle layout debugging',
		icon: '◫',
	},
	viewMode: {
		id: 'blemmy-view-mode-toggle',
		label: 'Print view',
		ariaLabel: 'Switch between print and web view',
		title: 'Switch between print and web view',
		icon: '▣',
	},
	theme: {
		id: 'theme-toggle',
		label: 'Theme',
		ariaLabel: 'Toggle light and dark mode',
		title: 'Toggle light and dark mode',
		icon: '◐',
	},
	uploadJson: {
		id: 'blemmy-upload-btn',
		label: 'Upload JSON',
		ariaLabel: 'Load CV data from JSON file',
		title: 'Load CV data from JSON file',
		icon: '↑',
	},
	downloadJson: {
		id: 'blemmy-download-json',
		label: 'Download JSON',
		ariaLabel: 'Download CV data as JSON',
		title: 'Download CV data as JSON',
		icon: '↓',
	},
	exportHtml: {
		id: 'blemmy-export-html',
		label: 'Export HTML',
		ariaLabel: 'Export document as standalone HTML file',
		title: 'Export as standalone HTML',
		icon: '⬡',
	},
	/** Opens menu with JSON + standalone HTML actions. */
	exportMenu: {
		id: 'blemmy-export-menu-trigger',
		label: 'Export',
		ariaLabel: 'Open export menu',
		title: 'Download JSON or export HTML',
		icon: '⬇',
	},
	printPdf: {
		id: 'blemmy-download-pdf',
		label: 'Preview PDF',
		ariaLabel: 'Preview PDF',
		title: 'Preview PDF',
		icon: '⎙',
	},
	editMode: {
		id: 'blemmy-edit-btn',
		label: 'Edit',
		ariaLabel: 'Toggle edit mode',
		title: 'Toggle edit mode',
		icon: '✎',
	},
	undo: {
		id: 'blemmy-undo-btn',
		label: 'Undo',
		ariaLabel: 'Undo last change',
		title: 'Undo last change (Ctrl/Cmd+Z)',
		icon: '↶',
	},
	redo: {
		id: 'blemmy-redo-btn',
		label: 'Redo',
		ariaLabel: 'Redo last change',
		title: 'Redo last change (Ctrl/Cmd+Shift+Z)',
		icon: '↷',
	},
	resetDraft: {
		id: 'blemmy-reset-draft-btn',
		label: 'Reset draft',
		ariaLabel: 'Reset local draft edits',
		title: 'Reset local draft edits to current loaded CV',
		icon: '⟲',
	},
	reviewMode: {
		id: 'blemmy-review-toggle',
		label: 'Review',
		ariaLabel: 'Toggle review mode',
		title: 'Toggle review mode',
		icon: '◍',
	},
	chat: {
		id: 'blemmy-chat-trigger',
		label: 'Assistant',
		ariaLabel: 'Open CV Assistant',
		title: 'CV Assistant',
		icon: '✦',
	},
	cloud: {
		id: 'blemmy-cloud-trigger',
		label: 'Cloud',
		ariaLabel: 'Cloud sync',
		title: 'Cloud sync',
		icon: '☁',
	},
	layoutPreferences: {
		id: 'blemmy-prefs-trigger',
		label: 'Layout',
		ariaLabel: 'Layout preferences',
		title: 'Layout preferences',
		icon: '⚙',
	},
	/** Dev build only — wired from ui-components when import.meta.env.DEV. */
	devConsoleHelp: {
		id: 'blemmy-dev-console-help-trigger',
		label: 'Console',
		ariaLabel: 'Developer console commands',
		title: 'Window globals for the browser console (dev build)',
		icon: '>',
	},
} as const satisfies Record<string, DockControlSpec>;

type DockButtonBuildOptions = {
	id: string;
	className: string;
	pressed?: 'true' | 'false';
	extraAttrs?: Record<string, string>;
};

export function buildDockButton(
	createEl: (
		tag: string,
		attrs: Record<string, string>,
		...children: (Node | string | null | undefined)[]
	) => HTMLElement,
	spec: DockControlSpec,
	opts: DockButtonBuildOptions,
): HTMLButtonElement {
	const attrs: Record<string, string> = {
		id: opts.id,
		type: 'button',
		class: `${opts.className} blemmy-dock-btn no-print`,
		'aria-label': spec.ariaLabel,
		title: spec.title,
		'data-icon': spec.icon,
		...opts.extraAttrs,
	};
	if (opts.pressed) { attrs['aria-pressed'] = opts.pressed; }
	return createEl('button', attrs, spec.label) as HTMLButtonElement;
}
