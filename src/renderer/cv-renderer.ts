/**
 * cv-renderer.ts
 *
 * Builds the entire CV page structure as live DOM from a CVData object.
 * Client-side DOM for the CV (replaces the old Astro templates). The layout
 * engine manipulates the
 * resulting DOM by ID — every element ID the engine depends on is produced
 * here and documented next to its construction.
 *
 * renderCV(cv) → #cv-shell  (append to document.body in main.ts)
 */

import type {
	CVData,
	CVBasics,
	CVWork,
	CVEducation,
	CVSkills,
	CVLanguage,
	CVVisibility,
	CVSidebarSectionId,
	CVSkillsCategoryId,
} from '@cv/cv';

import {
	extractAllTags,
	resolveFilteredVisibility,
	isFilterActive,
} from '@lib/cv-filter';

// ─── DOM helpers ──────────────────────────────────────────────────────────────

/**
 * Creates an HTML element, setting attributes and appending children.
 * Accepts strings (as text nodes) and Elements as children.
 * `class` can be passed as `class` or `className` — both work.
 */
function h(
	tag:      string,
	attrs:    Record<string, string> = {},
	...children: (Node | string | null | undefined)[]
): HTMLElement {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		el.setAttribute(k === 'className' ? 'class' : k, v);
	}
	for (const child of children) {
		if (child == null) { continue; }
		el.append(typeof child === 'string' ? document.createTextNode(child) : child);
	}
	return el;
}

/** Sets `id` and `class` together — very common pattern. */
function section(id: string, className: string): HTMLElement {
	const el = document.createElement('div');
	el.id        = id;
	el.className = className;
	return el;
}

// ─── Thin-space character (mirrors Astro &thinsp;) ───────────────────────────

const THINSP = '\u2009';

// ─── Email display (zero-width space before @, prevents auto-linking) ────────

function emailDisplay(email: string): string {
	const at = email.indexOf('@');
	if (at <= 0) { return email; }
	return email.slice(0, at) + '\u200B' + email.slice(at);
}

// ─── WorkItem ─────────────────────────────────────────────────────────────────

function parseHighlight(text: string): { lead: string | null; body: string } {
	const colonIdx = text.indexOf(':');
	if (colonIdx === -1 || colonIdx > 30) { return { lead: null, body: text }; }
	return {
		lead: text.slice(0, colonIdx),
		body: text.slice(colonIdx + 1).trim(),
	};
}

function renderWorkItem(entry: CVWork, idx: number): HTMLElement {
	const block = h('div', {
		class:              'experience-block',
		'data-work-idx':    String(idx),
		draggable:          'false', // editor enables this
	});

	const header = h('div', { class: 'entry-header' },
		h('div', { class: 'entry-header-left' },
			h('h3', { class: 'entry-company', 'data-cv-field': `work.${idx}.company` }, entry.company),
			h('p',  { class: 'entry-position', 'data-cv-field': `work.${idx}.position` }, entry.position),
		),
		h('span', { class: 'entry-dates', 'data-cv-field': `work.${idx}.dates` },
			entry.startDate + THINSP + '–' + THINSP + entry.endDate,
		),
	);
	block.appendChild(header);

	if (entry.summary) {
		block.appendChild(h('p', {
			class:           'entry-summary',
			'data-cv-field': `work.${idx}.summary`,
		}, entry.summary));
	}

	const ul = h('ul', { class: 'entry-highlights' });
	for (let hi = 0; hi < entry.highlights.length; hi++) {
		const highlight        = entry.highlights[hi];
		const { lead, body }   = parseHighlight(highlight);
		const li               = document.createElement('li');
		li.dataset.cvField     = `work.${idx}.highlights.${hi}`;
		if (lead) {
			li.appendChild(h('strong', { class: 'highlight-lead' }, lead + ':'));
			li.appendChild(document.createTextNode(' ' + body));
		} else {
			li.textContent = body;
		}
		ul.appendChild(li);
	}
	block.appendChild(ul);

	return block;
}

// ─── Work pool ────────────────────────────────────────────────────────────────

/**
 * #cv-work-pool — hidden holding area for visible work items.
 * Hidden work items (in visibility.hiddenWork) are excluded entirely.
 * Engine moves items into [data-work-section] wrappers in main-1 / main-2.
 */
function renderWorkPool(work: CVWork[], hiddenWork: number[]): HTMLElement {
	const pool = document.createElement('div');
	pool.id              = 'cv-work-pool';
	pool.setAttribute('aria-hidden', 'true');
	pool.style.display   = 'none';

	// We use the original index (i) as data-work-index so editor field paths
	// stay stable even when items are hidden. The engine sorts by this index.
	work.forEach((entry, i) => {
		if (hiddenWork.includes(i)) { return; }
		const wrapper = document.createElement('div');
		wrapper.dataset.workIndex = String(i);
		wrapper.appendChild(renderWorkItem(entry, i));
		pool.appendChild(wrapper);
	});

	return pool;
}

// ─── EducationItem ────────────────────────────────────────────────────────────

function renderEducationItem(entry: CVEducation, idx: number): HTMLElement {
	const p    = `education.${idx}`;
	const block = h('div', { class: 'education-block' });

	const degreeRow = h('div', { class: 'edu-degree-row' },
		h('p', { class: 'edu-degree', 'data-cv-field': `${p}.degree` }, entry.degree),
	);
	if (entry.score) {
		degreeRow.appendChild(h('span', { class: 'edu-score', 'data-cv-field': `${p}.score` }, entry.score));
	}
	block.appendChild(degreeRow);
	block.appendChild(h('p', { class: 'edu-institution', 'data-cv-field': `${p}.institution` }, entry.institution));
	block.appendChild(h('p', { class: 'edu-area',        'data-cv-field': `${p}.area` }, entry.area));
	block.appendChild(
		h('p', { class: 'edu-dates', 'data-cv-field': `${p}.dates` },
			entry.startDate + THINSP + '–' + THINSP + entry.endDate,
		),
	);

	return block;
}

// ─── SkillsBlock ──────────────────────────────────────────────────────────────

function renderSkillsBlock(
	skills: CVSkills,
	categoryOrder: CVSkillsCategoryId[],
): HTMLElement {
	const wrapper = h('div', { class: 'skills-wrapper' });
	const labels: Record<CVSkillsCategoryId, string> = {
		programming: 'Programming',
		design_bim: 'Design & BIM',
		strategic: 'Strategy & ESG',
	};
	for (let ci = 0; ci < categoryOrder.length; ci++) {
		const catKey = categoryOrder[ci];
		const items = skills[catKey];
		if (!items || items.length === 0) { continue; }
		const catEl = h('div', { class: 'skill-category' },
			h('p', { class: 'skill-category-label' }, labels[catKey]),
		);
		catEl.dataset.skillCategory = catKey;
		const tags = h('div', { class: 'skill-tags' });
		for (let si = 0; si < items.length; si++) {
			tags.appendChild(h('span', {
				class:           'skill-tag',
				'data-cv-field': `skills.${catKey}.${si}`,
			}, items[si]));
		}
		catEl.appendChild(tags);
		wrapper.appendChild(catEl);
	}

	return wrapper;
}

// ─── LanguageList ─────────────────────────────────────────────────────────────

function renderLanguageList(languages: CVLanguage[]): HTMLElement {
	const ul = h('ul', { class: 'language-list' });
	for (let i = 0; i < languages.length; i++) {
		const lang = languages[i];
		ul.appendChild(
			h('li', { class: 'language-item' },
				h('span', { class: 'language-name',    'data-cv-field': `languages.${i}.language` }, lang.language),
				h('span', { class: 'language-fluency', 'data-cv-field': `languages.${i}.fluency`  }, lang.fluency),
			),
		);
	}
	return ul;
}

// ─── MastheadIdentity ─────────────────────────────────────────────────────────

/**
 * Renders #cv-masthead-right — the identity/contact column that lives in
 * the masthead band or can be relocated by the engine to the sidebar.
 */
function renderMastheadIdentity(basics: CVBasics): HTMLElement {
	const labelParts = basics.label.split('·').map((s) => s.trim());
	const labelEl = h('p', { class: 'cv-label' });
	for (let i = 0; i < labelParts.length; i++) {
		labelEl.appendChild(h('span', {
			class:           'cv-label-part',
			'data-cv-field': `basics.label.${i}`,
		}, labelParts[i]));
	}

	const nameLabelBlock = h('div',
		{ class: 'cv-name-label-block', id: 'cv-name-label-block' },
		h('h1', { class: 'cv-name', 'data-cv-field': 'basics.name' }, basics.name),
		h('div', { id: 'cv-rebalance-label' }, labelEl),
	);

	function contactItem(
		icon:  string,
		text:  string,
		field: string,
		href?: string,
	): HTMLElement {
		const content = href
			? h('a', { class: 'contact-link', href, 'data-cv-field': field }, text)
			: h('span', { 'data-cv-field': field }, text);
		return h('li', { class: 'contact-item' },
			h('span', { class: 'contact-icon', 'aria-hidden': 'true' }, icon),
			content,
		);
	}

	const contactList = h('ul', { class: 'contact-list' });
	contactList.appendChild(contactItem('✉', emailDisplay(basics.email), 'basics.email', `mailto:${basics.email}`));
	contactList.appendChild(contactItem('✆', basics.phone, 'basics.phone', `tel:${basics.phone.replace(/\s/g, '')}`));
	contactList.appendChild(contactItem('◎', basics.location,    'basics.location'));
	contactList.appendChild(contactItem('◇', basics.nationality, 'basics.nationality'));

	const contactSection = h('div', { id: 'cv-rebalance-contact' },
		h('span', { class: 'section-label' }, 'Contact'),
		contactList,
	);

	return h('div',
		{ id: 'cv-masthead-right', class: 'cv-masthead-right' },
		nameLabelBlock,
		contactSection,
	);
}

// ─── Page 1 portrait cell ─────────────────────────────────────────────────────

function renderPortraitCell(basics: CVBasics): HTMLElement {
	const base = import.meta.env.BASE_URL ?? '/';
	const portraitSrc = `${base}blemmy.png`;
	const img = h('img', {
		src:              portraitSrc,
		alt:              basics.name,
		class:            'cv-portrait',
		id:               'cv-portrait-img',
		width:            '160',
		height:           '200',
		fetchpriority:    'high',
		'data-cv-field':  'portrait',
	});

	return h('div', { id: 'cv-p1-portrait-cell', class: 'cv-p1-portrait-cell' },
		h('div', { class: 'cv-header-block' },
			h('div', { class: 'cv-portrait-wrap' },
				img,
				h('span', {
					class:     'cv-portrait-upload-hint',
					'aria-hidden': 'true',
				}, 'Upload photo'),
			),
		),
	);
}

// ─── Masthead band ────────────────────────────────────────────────────────────

function renderMasthead(basics: CVBasics, hiddenSections: string[]): HTMLElement {
	const isProfileHidden = hiddenSections.includes('profile');

	const summaryEl = h('p', { class: 'cv-summary', 'data-cv-field': 'basics.summary' }, basics.summary);
	const profileDiv = h('div', {
		id:               'cv-rebalance-profile',
		'data-section-id': 'profile',
	},
		h('span', { class: 'section-label' }, 'Profile'),
		summaryEl,
	);
	const profileCol = h('div',
		{ id: 'cv-masthead-profile-col', class: 'cv-masthead-col cv-masthead-col-profile' },
		profileDiv,
	);

	if (isProfileHidden) {
		profileCol.style.display   = 'none';
		profileDiv.dataset.hidden  = 'true';
	}

	return h('div', {
		class:        'cv-main-masthead',
		id:           'cv-page-1-masthead',
		'aria-label': 'Page 1 masthead band',
	},
		renderMastheadIdentity(basics),
		profileCol,
	);
}

// ─── Page 1 ───────────────────────────────────────────────────────────────────

function renderPage1WithVisibility(
	cv:  CVData,
	vis: Required<CVVisibility>,
): HTMLElement {
	const { hiddenEducation: hiddenEdu, hiddenSections: hiddenSects } = vis;
	const visibleWorkIdx = cv.work
		.map((_, i) => i)
		.filter((i) => !vis.hiddenWork.includes(i));
	const page1WorkIdx = visibleWorkIdx.slice(0, 2);

	const topBand = h('div', { class: 'cv-p1-top-band' },
		renderPortraitCell(cv.basics),
		renderMasthead(cv.basics, hiddenSects as string[]),
	);

	const eduDiv = h('div', {
		id:                'cv-education',
		'data-section-id': 'education',
	},
		h('span', { class: 'section-label' }, 'Education'),
	);
	for (let i = 0; i < cv.education.length; i++) {
		if (hiddenEdu.includes(i)) { continue; }
		eduDiv.appendChild(renderEducationItem(cv.education[i], i));
	}

	const sidebar1 = h('aside', { class: 'cv-sidebar', id: 'cv-sidebar-1' },
		eduDiv,
		h('div', { class: 'cv-sidebar-tail-spacer', 'aria-hidden': 'true' }),
	);

	const main1Section = h('div', { 'data-work-section': '1' },
		h('span', { class: 'section-label' }, 'Experience'),
	);
	for (let i = 0; i < page1WorkIdx.length; i++) {
		const wi = page1WorkIdx[i];
		main1Section.appendChild(renderWorkItem(cv.work[wi], wi));
	}

	const main1   = h('main',   { class: 'cv-main', id: 'cv-main-1' }, main1Section);
	const footer1 = h('footer', {
		class:        'cv-body-column-footer',
		id:           'cv-page-1-body-footer',
		'aria-label': 'Page 1 supplementary footer',
	});

	return h('div', { class: 'cv-page', id: 'cv-page-1', 'aria-label': 'Page 1' },
		h('div', { class: 'cv-grid' }, topBand, sidebar1, main1, footer1),
	);
}

// ─── SimPlaceholder ───────────────────────────────────────────────────────────

function renderSimPlaceholder(): HTMLElement {
	return h('div', { class: 'sim-placeholder' },
		h('p', {}, 'Interactive simulation — ',
			h('a', {
				href:   'https://github.com/VilhelmC/blemmy',
				class:  'sim-link',
				target: '_blank',
				rel:    'noopener noreferrer',
			}, 'view on GitHub'),
		),
	);
}

// ─── Page 2 ───────────────────────────────────────────────────────────────────

function renderPage2WithVisibility(
	cv:  CVData,
	vis: Required<CVVisibility>,
): HTMLElement {
	const hiddenSects = vis.hiddenSections as string[];
	const visibleWorkIdx = cv.work
		.map((_, i) => i)
		.filter((i) => !vis.hiddenWork.includes(i));
	const page2WorkIdx = visibleWorkIdx.slice(2);

	function sectionDiv(
		id:        string,
		sectionId: string,
		...children: HTMLElement[]
	): HTMLElement {
		const el = h('div', { id, 'data-section-id': sectionId }, ...children);
		if (hiddenSects.includes(sectionId)) {
			el.style.display  = 'none';
			el.dataset.hidden = 'true';
		}
		return el;
	}

	const skillsDiv = sectionDiv('cv-rebalance-skills', 'skills',
		h('span', { class: 'section-label' }, 'Technical Skills'),
		renderSkillsBlock(cv.skills, vis.skillsOrder ?? ['programming', 'design_bim', 'strategic']),
	);
	const langDiv = sectionDiv('cv-rebalance-languages', 'languages',
		h('span', { class: 'section-label' }, 'Languages'),
		renderLanguageList(cv.languages),
	);
	const intDiv = sectionDiv('cv-rebalance-interests', 'interests',
		h('span', { class: 'section-label' }, 'Interests'),
		h('p', { class: 'contact-item', 'data-cv-field': 'personal.interests' }, cv.personal.interests),
	);

	const defaultSidebarOrder: CVSidebarSectionId[] = [
		'skills',
		'languages',
		'interests',
	];
	const configuredOrder = vis.sidebarOrder ?? defaultSidebarOrder;
	const uniqueOrder = configuredOrder.filter((id, idx, arr) => arr.indexOf(id) === idx);
	const normalizedOrder = [
		...uniqueOrder,
		...defaultSidebarOrder.filter((id) => !uniqueOrder.includes(id)),
	];
	const sectionById: Record<CVSidebarSectionId, HTMLElement> = {
		skills: skillsDiv,
		languages: langDiv,
		interests: intDiv,
	};
	const orderedSidebarChildren = normalizedOrder.map((id) => sectionById[id]);

	const sidebar2 = h('aside', { class: 'cv-sidebar', id: 'cv-sidebar-2' },
		...orderedSidebarChildren,
		h('div', { class: 'cv-sidebar-tail-spacer', 'aria-hidden': 'true' }),
	);

	const main2 = h('main', { class: 'cv-main', id: 'cv-main-2' });
	if (page2WorkIdx.length > 0) {
		const section = h('div', { 'data-work-section': '2' },
			h('span', { class: 'section-label' }, 'Additional Experience'),
		);
		for (let i = 0; i < page2WorkIdx.length; i++) {
			const wi = page2WorkIdx[i];
			section.appendChild(renderWorkItem(cv.work[wi], wi));
		}
		main2.appendChild(section);
	}
	main2.appendChild(
		h('div', { 'data-cv-interactive': '' },
			h('span', { class: 'section-label' }, 'Computational Research'),
			renderSimPlaceholder(),
		),
	);

	const footer2 = h('footer', {
		class:        'cv-body-column-footer',
		id:           'cv-page-2-body-footer',
		'aria-label': 'Page 2 supplementary footer',
	});

	return h('div', {
		class:        'cv-page cv-page-2',
		id:           'cv-page-2',
		'aria-label': 'Page 2',
	},
		h('div', { class: 'cv-grid' }, sidebar2, main2, footer2),
	);
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

/**
 * Renders the tag filter bar. Hidden when there are no tags in the data.
 * Tag chips are rendered with data-tag attributes so initFilterBar() can
 * wire up click handlers after mounting.
 */
function renderFilterBar(cv: CVData): HTMLElement {
	const allTags      = extractAllTags(cv);
	const activeFilters = cv.activeFilters ?? [];

	const bar = h('div', {
		id:    'cv-filter-bar',
		class: 'cv-filter-bar no-print',
	});

	if (allTags.length === 0) {
		bar.hidden = true;
		return bar;
	}

	bar.appendChild(h('span', { class: 'cv-filter-bar__label' }, 'Filter'));

	const chips = h('div', { class: 'cv-filter-bar__chips', role: 'group', 'aria-label': 'Tag filters' });
	for (const tag of allTags) {
		const active = isFilterActive(tag, activeFilters);
		const chip   = h('button', {
			type:          'button',
			class:         'cv-filter-chip' + (active ? ' cv-filter-chip--active' : ''),
			'data-tag':    tag,
			'aria-pressed': String(active),
			'aria-label':  `Filter by ${tag}`,
		}, tag);
		chips.appendChild(chip);
	}
	bar.appendChild(chips);

	// Clear button — only visible when filters are active
	const clearBtn = h('button', {
		type:   'button',
		id:     'cv-filter-clear',
		class:  'cv-filter-clear' + (activeFilters.length === 0 ? ' cv-filter-clear--hidden' : ''),
	}, 'Clear');
	bar.appendChild(clearBtn);

	// Count badge
	const { work: wVis, education: eVis } = (() => {
		const resolved = resolveFilteredVisibility(cv, activeFilters);
		return {
			work:      cv.work.length      - resolved.hiddenWork.length,
			education: cv.education.length - resolved.hiddenEducation.length,
		};
	})();
	const total   = cv.work.length + cv.education.length;
	const visible = wVis + eVis;
	if (activeFilters.length > 0 && total > 0) {
		bar.appendChild(h('span', { class: 'cv-filter-count' },
			`${visible} / ${total} items`,
		));
	}

	return bar;
}

/**
 * Updates the filter bar's chip active states without re-rendering.
 * Called by initFilterBar() after each filter toggle.
 */
export function syncFilterBar(cv: CVData): void {
	const bar = document.getElementById('cv-filter-bar');
	if (!bar) { return; }

	const allTags      = extractAllTags(cv);
	const activeFilters = cv.activeFilters ?? [];

	// Show/hide bar itself
	bar.hidden = allTags.length === 0;

	// Update chips
	const chips = bar.querySelectorAll<HTMLButtonElement>('[data-tag]');
	chips.forEach((chip) => {
		const tag    = chip.dataset.tag ?? '';
		const active = isFilterActive(tag, activeFilters);
		chip.classList.toggle('cv-filter-chip--active', active);
		chip.setAttribute('aria-pressed', String(active));
	});

	// Clear button
	const clearBtn = document.getElementById('cv-filter-clear');
	if (clearBtn) {
		clearBtn.classList.toggle('cv-filter-clear--hidden', activeFilters.length === 0);
	}

	// Count badge
	const countEl = bar.querySelector('.cv-filter-count');
	if (countEl) {
		if (activeFilters.length > 0) {
			const resolved = resolveFilteredVisibility(cv, activeFilters);
			const total    = cv.work.length + cv.education.length;
			const visible  = (cv.work.length      - resolved.hiddenWork.length) +
			                 (cv.education.length  - resolved.hiddenEducation.length);
			countEl.textContent = `${visible} / ${total} items`;
			(countEl as HTMLElement).style.display = '';
		} else {
			(countEl as HTMLElement).style.display = 'none';
		}
	}
}

// ─── Candidate selector (inside shell) ───────────────────────────────────────

function renderCandidateSelectorShell(): HTMLElement {
	const optionsEl = h('div', {
		id:    'cv-candidate-options',
		class: 'cv-candidate-options',
		role:  'radiogroup',
	});

	return h('div', {
		id:           'cv-candidate-selector',
		class:        'cv-candidate-selector no-print',
		'aria-label': 'Layout alternatives',
		hidden:       '',
	},
		h('span', { class: 'cv-candidate-selector__label' }, 'Layout alternatives'),
		optionsEl,
	);
}

// ─── Top-level shell ──────────────────────────────────────────────────────────

/**
 * Renders the complete CV document into #cv-root.
 * Resolves tag-filter visibility merged with manual visibility before rendering.
 *
 * Structure:
 *   #cv-root
 *     .cv-ui-deck             (screen UI, outside the CV document shell)
 *       #cv-filter-bar
 *       #cv-candidate-selector
 *     #cv-shell
 *       #cv-work-pool         (hidden; engine moves items to pages)
 *       .cv-card#cv-card
 *         .cv-page#cv-page-1
 *         .cv-page#cv-page-2
 */
export function renderCV(cv: CVData): HTMLElement {
	// Update document metadata
	document.title = `${cv.basics.name} — CV`;
	document.documentElement.lang = cv.meta.language;
	const meta = document.querySelector('meta[name="description"]');
	if (meta) { meta.setAttribute('content', cv.basics.label); }

	// Resolve merged visibility (manual hides ∪ tag-filter hides)
	const activeFilters = cv.activeFilters ?? [];
	const resolvedVis   = resolveFilteredVisibility(cv, activeFilters);

	// Build a view-data object with the resolved visibility for the sub-renderers.
	// We don't mutate cv — we pass resolvedVis directly where needed.
	const card = h('div', { class: 'cv-card', id: 'cv-card' },
		renderPage1WithVisibility(cv, resolvedVis),
		renderPage2WithVisibility(cv, resolvedVis),
	);

	const shell = h('div', { id: 'cv-shell', class: 'cv-shell' },
		renderWorkPool(cv.work, resolvedVis.hiddenWork),
		card,
	);

	const uiDeck = h('div', {
		id: 'cv-ui-deck',
		class: 'cv-ui-deck no-print',
	},
		renderFilterBar(cv),
		renderCandidateSelectorShell(),
	);

	return h('div', { id: 'cv-root' }, uiDeck, shell);
}
