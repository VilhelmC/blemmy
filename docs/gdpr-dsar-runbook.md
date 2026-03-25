# GDPR DSAR Runbook

## Purpose

Operational runbook for handling data subject access and deletion requests for
the cloud CV app.

## Intake

- Preferred channel: in-app privacy request actions.
- Fallback channel: operator support email/contact.
- Record each request in `privacy_requests`.

## Identity verification

- In-app authenticated requests are treated as verified for that account.
- Out-of-band requests must prove control of the account email before action.

## Request types

- Access/export request.
- Deletion request (soft or hard mode based on policy).

## Service levels

- Acknowledge request within 72 hours.
- Complete within 30 days unless extension is legally justified.

## Export procedure

- Execute `export_user_data(p_user_id)`.
- Deliver machine-readable JSON package securely.
- Update `privacy_requests` status and completion timestamp.

## Deletion procedure

- Execute `delete_user_data(p_user_id, p_mode)`.
- Confirm related documents, versions, shares, and privacy-linked rows are
  handled.
- Update `privacy_requests` status and completion timestamp.

## Exception handling

- If verification fails, reject and record reason.
- If deletion is legally restricted, retain only required minimum and record
  rationale.
- If automation fails, retry once, then escalate to manual SQL validation.

## Audit logging

- Keep immutable request records with:
  - request type,
  - actor,
  - timestamps,
  - outcome,
  - error details (if any).

## Security

- Never expose raw tokens, service keys, or full SQL traces to end users.
- Use least-privilege credentials for automation.
