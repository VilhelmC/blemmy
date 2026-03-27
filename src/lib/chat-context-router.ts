/**
 * chat-context-router.ts
 *
 * Deterministic chat intent routing and context budgeting.
 * Keeps style/layout prompts lean while preserving full data for content work.
 */

export type ChatIntent =
	| 'style'
	| 'layout'
	| 'review'
	| 'content'
	| 'generate'
	| 'general';

export type ContextMode = 'minimal' | 'full';
export type ExpectedBlock = 'json' | 'style' | 'review' | 'none';

export type RouteInput = {
	message: string;
	onboarding: boolean;
	hasSourceText: boolean;
	selectedPaths: string[];
	reviewPaths: string[];
};

export type RoutedContext = {
	intent: ChatIntent;
	contextMode: ContextMode;
	expectedBlock: ExpectedBlock;
	includeSource: boolean;
	includeReview: boolean;
	scopedPaths: string[];
};

const STYLE_KEYWORDS = [
	'style', 'theme', 'font', 'color', 'colour', 'palette',
	'css', 'sidebar color', 'page background', 'print sidebar',
];
const LAYOUT_KEYWORDS = [
	'layout', 'overflow', 'fit', 'page', 'spacing', 'margin',
	'alignment', 'sidebar width', 'density', 'reflow',
];
const REVIEW_KEYWORDS = [
	'review', 'comment', 'resolve', 'flag', 'annotation',
];
const GENERATE_KEYWORDS = [
	'generate', 'create from', 'build from', 'from scratch',
	'make cv from', 'import this',
];
const CONTENT_KEYWORDS = [
	'rewrite', 'edit', 'update', 'modify', 'improve', 'tighten',
	'add bullet', 'remove bullet', 'change summary', 'tailor',
	'letter', 'cover letter',
];

function includesAny(text: string, patterns: string[]): boolean {
	return patterns.some((p) => text.includes(p));
}

function dedupePaths(paths: string[]): string[] {
	return Array.from(new Set(paths.map((p) => p.trim()).filter(Boolean)));
}

export function classifyIntent(message: string, onboarding: boolean): ChatIntent {
	const msg = message.toLowerCase();
	const onboardingNarrative =
		/\b(i|my|worked|studied|graduated|years?)\b/.test(msg);
	if (onboarding && (
		msg.length > 220 ||
		includesAny(msg, GENERATE_KEYWORDS) ||
		onboardingNarrative
	)) {
		return 'generate';
	}
	if (includesAny(msg, STYLE_KEYWORDS)) { return 'style'; }
	if (includesAny(msg, REVIEW_KEYWORDS)) { return 'review'; }
	if (includesAny(msg, LAYOUT_KEYWORDS)) { return 'layout'; }
	if (includesAny(msg, CONTENT_KEYWORDS)) { return 'content'; }
	if (includesAny(msg, GENERATE_KEYWORDS)) { return 'generate'; }
	return 'general';
}

export function routeChatContext(input: RouteInput): RoutedContext {
	const intent = classifyIntent(input.message, input.onboarding);
	const mergedScope = dedupePaths([
		...input.selectedPaths,
		...input.reviewPaths,
	]);
	const contextMode: ContextMode =
		intent === 'style' || intent === 'layout'
			? 'minimal'
			: 'full';
	let expectedBlock: ExpectedBlock = 'none';
	if (intent === 'style') { expectedBlock = 'style'; }
	if (intent === 'review') { expectedBlock = 'review'; }
	if (intent === 'content' || intent === 'generate') { expectedBlock = 'json'; }
	return {
		intent,
		contextMode,
		expectedBlock,
		includeSource: input.hasSourceText && (intent === 'content' || intent === 'generate'),
		includeReview: intent === 'review' || intent === 'content' || mergedScope.length > 0,
		scopedPaths: mergedScope,
	};
}

