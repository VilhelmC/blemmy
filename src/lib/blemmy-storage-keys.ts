/**
 * localStorage keys for document + session persistence (blemmy-prefixed).
 * Legacy `blemmy-*` keys are still read once and migrated on load.
 */

export const BLEMMY_CV_USER_DATA_KEY = 'blemmy-user-data';
export const LEGACY_CV_USER_DATA_KEY = 'cv-user-data';

export const BLEMMY_CV_EDIT_DRAFT_KEY = 'blemmy-edit-draft';
export const LEGACY_CV_EDIT_DRAFT_KEY = 'cv-edit-draft';

export const BLEMMY_APP_SESSION_STATE_KEY = 'blemmy-app-session-state';
export const LEGACY_CV_APP_SESSION_STATE_KEY = 'cv-app-session-state';

export const BLEMMY_SOURCE_TEXT_KEY = 'blemmy-source-text';
export const BLEMMY_SOURCE_META_KEY = 'blemmy-source-meta';
export const LEGACY_CV_SOURCE_TEXT_KEY = 'cv-source-text';
export const LEGACY_CV_SOURCE_META_KEY = 'cv-source-meta';
