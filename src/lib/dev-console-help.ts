/**
 * Reference list for globals attached to `window` in dev (normal app mode).
 * Kept in one module so the dock “Console” panel and optional logging stay in
 * sync.
 */

export type BlemmyDevConsoleEntry = {
	/** Paste into the browser console (include () for calls). */
	expr: string;
	kind: 'call' | 'inspect';
	hint: string;
};

export const BLEMMY_DEV_CONSOLE_ENTRIES: readonly BlemmyDevConsoleEntry[] = [
	{
		expr: 'blemmyResetToBundledDefaults()',
		kind: 'call',
		hint: 'Clear document-related storage and remount bundled CV (no reload).',
	},
	{
		expr: 'cvUndo()',
		kind: 'call',
		hint: 'Undo the last CV data change.',
	},
	{
		expr: 'cvRedo()',
		kind: 'call',
		hint: 'Redo a CV data change.',
	},
	{
		expr: 'cvCanUndo()',
		kind: 'call',
		hint: 'Whether undo is available.',
	},
	{
		expr: 'cvCanRedo()',
		kind: 'call',
		hint: 'Whether redo is available.',
	},
	{
		expr: "cvRevertField('basics.name')",
		kind: 'call',
		hint: 'Revert one field (replace path with a real content path).',
	},
	{
		expr: "__blemmyRemountDocument__(__blemmyDocument__, __blemmyDocumentType__)",
		kind: 'call',
		hint: 'Re-mount the active document (replace args to change data / type id).',
	},
	{
		expr: '__blemmyDocument__',
		kind: 'inspect',
		hint: 'Live JSON payload for the active document.',
	},
	{
		expr: '__blemmyDocumentType__',
		kind: 'inspect',
		hint: 'Active document type id (matches cloud doc_type / doctype JSON).',
	},
	{
		expr: '__blemmySyncStyleUI__',
		kind: 'inspect',
		hint: 'function(style) — refresh style controls after JSON changes.',
	},
];

export function formatBlemmyDevConsoleHelpText(): string {
	return BLEMMY_DEV_CONSOLE_ENTRIES
		.map((e) => `${e.expr}\n  ${e.hint}`)
		.join('\n\n');
}

export function printBlemmyDevConsoleHelp(): void {
	console.info(
		'[Blemmy] window console helpers:\n\n' + formatBlemmyDevConsoleHelpText(),
	);
}

export async function copyBlemmyDevConsoleExpr(expr: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(expr);
		return true;
	} catch {
		return false;
	}
}

/**
 * Evaluate `expr` in global scope (same as pasting in the devtools console).
 * Async results are awaited; return values are logged unless undefined.
 */
export function runBlemmyDevConsoleExpr(
	expr: string,
	kind: 'call' | 'inspect',
): void {
	void (async (): Promise<void> => {
		try {
			const geval = window.eval.bind(window) as (src: string) => unknown;
			const raw = geval(expr);
			const settled = await Promise.resolve(raw);
			if (kind === 'inspect') {
				console.log('[Blemmy dev]', expr, settled);
				return;
			}
			if (settled !== undefined) {
				console.log('[Blemmy dev]', settled);
			}
		} catch (err) {
			console.error('[Blemmy dev]', expr, err);
		}
	})();
}
