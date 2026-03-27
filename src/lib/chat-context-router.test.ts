import { describe, expect, it } from 'vitest';
import { classifyIntent, routeChatContext } from './chat-context-router';

describe('chat-context-router', () => {
	it('classifies style intent with minimal context', () => {
		const route = routeChatContext({
			message: 'Change the font and sidebar color',
			onboarding: false,
			hasSourceText: true,
			selectedPaths: [],
			reviewPaths: [],
		});
		expect(route.intent).toBe('style');
		expect(route.contextMode).toBe('minimal');
		expect(route.expectedBlock).toBe('style');
		expect(route.includeSource).toBe(false);
	});

	it('classifies content intent with full context and source', () => {
		const route = routeChatContext({
			message: 'Rewrite my summary and apply the changes',
			onboarding: false,
			hasSourceText: true,
			selectedPaths: ['basics.summary'],
			reviewPaths: ['work[0]'],
		});
		expect(route.intent).toBe('content');
		expect(route.contextMode).toBe('full');
		expect(route.expectedBlock).toBe('json');
		expect(route.includeSource).toBe(true);
		expect(route.scopedPaths).toEqual(['basics.summary', 'work[0]']);
	});

	it('classifies onboarding long text as generate', () => {
		const intent = classifyIntent(
			'I worked in architecture and investment for many years and graduated with a masters degree...',
			true,
		);
		expect(intent).toBe('generate');
	});
});

