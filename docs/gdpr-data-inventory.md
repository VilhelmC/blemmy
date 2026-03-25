# GDPR Data Inventory

## Scope

This inventory covers personal data handled by the cloud-enabled CV app for
authenticated end users.

## Data Categories

- Account identifiers: user id, email address from auth provider.
- CV content: profile text, work history, education, skills, languages, and
  any free-text fields entered by users.
- Document metadata: document names, timestamps, sync metadata.
- Sharing metadata: share records, token hashes, expiry and revoke timestamps.
- Share access logs: access timestamps and outcomes.
- Privacy operations: consent records and privacy request records.

## Processing Purposes and Legal Basis

- Provide cloud CV storage and versioning.
  - Legal basis: contract necessity.
- Provide share-link functionality.
  - Legal basis: contract necessity and legitimate interest in user-requested
    sharing.
- Security monitoring and abuse prevention.
  - Legal basis: legitimate interest.
- Privacy rights handling (export/deletion history).
  - Legal basis: legal obligation.

## Retention Targets

- Documents and versions: until user deletion request, then grace window per
  configured deletion mode.
- Share links: retained until revoked/expired plus retention window.
- Share access logs: 90 days default.
- Privacy requests: 24 months for audit trail.
- Consent history: retained while account exists and for audit period after
  deletion request fulfillment where required.

## Data Subject Rights Supported

- Access/export of own cloud data package.
- Deletion request for own account data.
- Transparent consent and notice state visibility.
- Revocation of share links at any time.

## Subprocessors and Hosting

- Supabase is used for storage/auth and must be covered by an executed DPA.
- Region selection must match declared privacy policy commitments.
