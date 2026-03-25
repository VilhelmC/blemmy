-- CV app: documents + version history for Supabase.
-- Run in: Supabase Dashboard → SQL Editor → New query → Paste → Run.
-- Prereq: Project created; Authentication → Providers configured as you prefer.

-- UUID helper (Supabase: keep extensions in the extensions schema)
create extension if not exists pgcrypto with schema extensions;

-- ── documents ─────────────────────────────────────────────────────────────
create table if not exists public.documents (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
	name text not null,
	doc_type text not null default 'cv',
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists documents_user_id_updated_idx
	on public.documents (user_id, updated_at desc);

-- Keep updated_at fresh on row changes
create or replace function public.set_documents_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at := now();
	return new;
end;
$$;

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
	before update on public.documents
	for each row
	execute function public.set_documents_updated_at();

-- ── document_versions ────────────────────────────────────────────────────
create table if not exists public.document_versions (
	id uuid primary key default gen_random_uuid(),
	document_id uuid not null references public.documents (id) on delete cascade,
	data jsonb not null,
	label text,
	created_at timestamptz not null default now()
);

create index if not exists document_versions_document_id_created_idx
	on public.document_versions (document_id, created_at desc);

-- ── Row Level Security ────────────────────────────────────────────────────
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;

-- Explicit grants for app users
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.document_versions to authenticated;

-- documents: owners only
drop policy if exists "documents_select_own" on public.documents;
create policy "documents_select_own"
	on public.documents for select
	using (user_id = (select auth.uid()));

drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own"
	on public.documents for insert
	with check (
		(select auth.uid()) is not null
		and coalesce(user_id, (select auth.uid())) = (select auth.uid())
	);

drop policy if exists "documents_update_own" on public.documents;
create policy "documents_update_own"
	on public.documents for update
	using (user_id = (select auth.uid()))
	with check (user_id = (select auth.uid()));

drop policy if exists "documents_delete_own" on public.documents;
create policy "documents_delete_own"
	on public.documents for delete
	using (user_id = (select auth.uid()));

-- document_versions: only for documents you own
drop policy if exists "document_versions_select_own" on public.document_versions;
create policy "document_versions_select_own"
	on public.document_versions for select
	using (
		exists (
			select 1 from public.documents d
			where d.id = document_id and d.user_id = (select auth.uid())
		)
	);

drop policy if exists "document_versions_insert_own" on public.document_versions;
create policy "document_versions_insert_own"
	on public.document_versions for insert
	with check (
		exists (
			select 1 from public.documents d
			where d.id = document_id and d.user_id = (select auth.uid())
		)
	);

drop policy if exists "document_versions_delete_own" on public.document_versions;
create policy "document_versions_delete_own"
	on public.document_versions for delete
	using (
		exists (
			select 1 from public.documents d
			where d.id = document_id and d.user_id = (select auth.uid())
		)
	);

-- ── GDPR-related metadata on documents ─────────────────────────────────────
alter table public.documents
	add column if not exists contains_personal_data boolean not null default true,
	add column if not exists retention_until timestamptz,
	add column if not exists deleted_at timestamptz;

-- ── Share links ─────────────────────────────────────────────────────────────
create table if not exists public.document_shares (
	id uuid primary key default gen_random_uuid(),
	document_id uuid not null references public.documents (id) on delete cascade,
	owner_user_id uuid not null references auth.users (id) on delete cascade,
	token_hash text not null unique,
	expires_at timestamptz not null,
	revoked_at timestamptz,
	created_at timestamptz not null default now(),
	last_accessed_at timestamptz,
	access_count integer not null default 0
);

create index if not exists document_shares_owner_idx
	on public.document_shares (owner_user_id, created_at desc);

create index if not exists document_shares_document_idx
	on public.document_shares (document_id, created_at desc);

create table if not exists public.document_share_access_log (
	id uuid primary key default gen_random_uuid(),
	share_id uuid not null references public.document_shares (id) on delete cascade,
	accessed_at timestamptz not null default now(),
	outcome text not null,
	ip_hash text,
	ua text
);

create index if not exists document_share_access_log_share_idx
	on public.document_share_access_log (share_id, accessed_at desc);

alter table public.document_shares enable row level security;
alter table public.document_share_access_log enable row level security;

grant select, insert, update, delete on public.document_shares to authenticated;
grant select on public.document_share_access_log to authenticated;

drop policy if exists "document_shares_select_own" on public.document_shares;
create policy "document_shares_select_own"
	on public.document_shares for select
	using (owner_user_id = (select auth.uid()));

drop policy if exists "document_shares_insert_own" on public.document_shares;
create policy "document_shares_insert_own"
	on public.document_shares for insert
	with check (
		owner_user_id = (select auth.uid())
		and exists (
			select 1 from public.documents d
			where d.id = document_id
				and d.user_id = (select auth.uid())
		)
	);

drop policy if exists "document_shares_update_own" on public.document_shares;
create policy "document_shares_update_own"
	on public.document_shares for update
	using (owner_user_id = (select auth.uid()))
	with check (owner_user_id = (select auth.uid()));

drop policy if exists "document_shares_delete_own" on public.document_shares;
create policy "document_shares_delete_own"
	on public.document_shares for delete
	using (owner_user_id = (select auth.uid()));

drop policy if exists "document_share_access_log_select_own" on public.document_share_access_log;
create policy "document_share_access_log_select_own"
	on public.document_share_access_log for select
	using (
		exists (
			select 1
			from public.document_shares s
			where s.id = share_id
				and s.owner_user_id = (select auth.uid())
		)
	);

-- ── Share RPCs ──────────────────────────────────────────────────────────────
create or replace function public.create_document_share(
	p_document_id uuid,
	p_expires_at timestamptz
)
returns table(
	share_id uuid,
	document_id uuid,
	owner_user_id uuid,
	expires_at timestamptz,
	revoked_at timestamptz,
	created_at timestamptz,
	last_accessed_at timestamptz,
	access_count integer,
	token text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
	v_token text;
	v_hash text;
	v_share public.document_shares%rowtype;
begin
	if auth.uid() is null then
		raise exception 'auth required';
	end if;
	if p_expires_at <= now() then
		raise exception 'expiry must be in the future';
	end if;
	if not exists (
		select 1
		from public.documents d
		where d.id = p_document_id
			and d.user_id = auth.uid()
	) then
		raise exception 'document not found';
	end if;

	v_token := encode(gen_random_bytes(32), 'hex');
	v_hash := encode(digest(v_token, 'sha256'), 'hex');

	insert into public.document_shares (
		document_id,
		owner_user_id,
		token_hash,
		expires_at
	)
	values (
		p_document_id,
		auth.uid(),
		v_hash,
		p_expires_at
	)
	returning * into v_share;

	return query
	select
		v_share.id,
		v_share.document_id,
		v_share.owner_user_id,
		v_share.expires_at,
		v_share.revoked_at,
		v_share.created_at,
		v_share.last_accessed_at,
		v_share.access_count,
		v_token;
end;
$$;

create or replace function public.resolve_document_share(
	p_token text
)
returns table(
	document_id uuid,
	document_name text,
	expires_at timestamptz,
	data jsonb
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
	v_hash text;
	v_share public.document_shares%rowtype;
	v_version public.document_versions%rowtype;
	v_doc public.documents%rowtype;
begin
	if p_token is null or length(trim(p_token)) < 16 then
		raise exception 'invalid share token';
	end if;
	v_hash := encode(digest(trim(p_token), 'sha256'), 'hex');

	select *
	into v_share
	from public.document_shares s
	where s.token_hash = v_hash
	limit 1;

	if v_share.id is null then
		raise exception 'shared cv not found';
	end if;
	if v_share.revoked_at is not null then
		insert into public.document_share_access_log (share_id, outcome)
		values (v_share.id, 'revoked');
		raise exception 'share revoked';
	end if;
	if v_share.expires_at <= now() then
		insert into public.document_share_access_log (share_id, outcome)
		values (v_share.id, 'expired');
		raise exception 'share expired';
	end if;

	update public.document_shares
	set
		last_accessed_at = now(),
		access_count = access_count + 1
	where id = v_share.id;

	insert into public.document_share_access_log (share_id, outcome)
	values (v_share.id, 'ok');

	select * into v_doc
	from public.documents d
	where d.id = v_share.document_id
	limit 1;

	select * into v_version
	from public.document_versions dv
	where dv.document_id = v_share.document_id
	order by dv.created_at desc
	limit 1;

	if v_version.id is null then
		raise exception 'no document version found';
	end if;

	return query
	select
		v_doc.id,
		v_doc.name,
		v_share.expires_at,
		v_version.data;
end;
$$;

revoke all on function public.create_document_share(uuid, timestamptz) from public;
revoke all on function public.resolve_document_share(text) from public;
grant execute on function public.create_document_share(uuid, timestamptz) to authenticated;
grant execute on function public.resolve_document_share(text) to anon, authenticated;

-- ── GDPR: consent + privacy requests + retention policies ───────────────────
create table if not exists public.user_privacy_consents (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references auth.users (id) on delete cascade,
	consent_key text not null,
	consent_value boolean not null,
	policy_version text not null,
	updated_at timestamptz not null default now(),
	created_at timestamptz not null default now(),
	unique (user_id, consent_key)
);

create table if not exists public.user_privacy_consent_events (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references auth.users (id) on delete cascade,
	consent_key text not null,
	consent_value boolean not null,
	policy_version text not null,
	source text not null,
	created_at timestamptz not null default now()
);

create table if not exists public.privacy_requests (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references auth.users (id) on delete cascade,
	request_type text not null check (request_type in ('export', 'delete')),
	status text not null default 'requested' check (
		status in ('requested', 'processing', 'completed', 'rejected')
	),
	notes text,
	requested_at timestamptz not null default now(),
	completed_at timestamptz
);

create table if not exists public.data_retention_policies (
	policy_key text primary key,
	retain_days integer not null check (retain_days > 0),
	updated_at timestamptz not null default now()
);

insert into public.data_retention_policies (policy_key, retain_days)
values
	('share_access_log', 90),
	('revoked_share', 180),
	('deleted_document_grace', 30),
	('privacy_request', 730)
on conflict (policy_key) do nothing;

alter table public.user_privacy_consents enable row level security;
alter table public.user_privacy_consent_events enable row level security;
alter table public.privacy_requests enable row level security;
alter table public.data_retention_policies enable row level security;

grant select, insert, update on public.user_privacy_consents to authenticated;
grant select, insert on public.user_privacy_consent_events to authenticated;
grant select, insert on public.privacy_requests to authenticated;
grant select on public.data_retention_policies to authenticated;

drop policy if exists "user_privacy_consents_select_own" on public.user_privacy_consents;
create policy "user_privacy_consents_select_own"
	on public.user_privacy_consents for select
	using (user_id = (select auth.uid()));

drop policy if exists "user_privacy_consents_insert_own" on public.user_privacy_consents;
create policy "user_privacy_consents_insert_own"
	on public.user_privacy_consents for insert
	with check (user_id = (select auth.uid()));

drop policy if exists "user_privacy_consents_update_own" on public.user_privacy_consents;
create policy "user_privacy_consents_update_own"
	on public.user_privacy_consents for update
	using (user_id = (select auth.uid()))
	with check (user_id = (select auth.uid()));

drop policy if exists "privacy_requests_select_own" on public.privacy_requests;
create policy "privacy_requests_select_own"
	on public.privacy_requests for select
	using (user_id = (select auth.uid()));

drop policy if exists "privacy_requests_insert_own" on public.privacy_requests;
create policy "privacy_requests_insert_own"
	on public.privacy_requests for insert
	with check (user_id = (select auth.uid()));

drop policy if exists "retention_policies_select" on public.data_retention_policies;
create policy "retention_policies_select"
	on public.data_retention_policies for select
	using (true);

drop policy if exists "user_privacy_consent_events_select_own" on public.user_privacy_consent_events;
create policy "user_privacy_consent_events_select_own"
	on public.user_privacy_consent_events for select
	using (user_id = (select auth.uid()));

drop policy if exists "user_privacy_consent_events_insert_own" on public.user_privacy_consent_events;
create policy "user_privacy_consent_events_insert_own"
	on public.user_privacy_consent_events for insert
	with check (user_id = (select auth.uid()));

-- ── GDPR functions ───────────────────────────────────────────────────────────
create or replace function public.export_user_data(
	p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
	v_docs jsonb;
	v_versions jsonb;
	v_shares jsonb;
	v_share_logs jsonb;
	v_consents jsonb;
	v_requests jsonb;
begin
	if auth.uid() is null or auth.uid() <> p_user_id then
		raise exception 'not allowed';
	end if;

	select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
	into v_docs
	from public.documents d
	where d.user_id = p_user_id;

	select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
	into v_versions
	from public.document_versions v
	where exists (
		select 1 from public.documents d
		where d.id = v.document_id and d.user_id = p_user_id
	);

	select coalesce(jsonb_agg(to_jsonb(s) - 'token_hash'), '[]'::jsonb)
	into v_shares
	from public.document_shares s
	where s.owner_user_id = p_user_id;

	select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
	into v_share_logs
	from public.document_share_access_log l
	where exists (
		select 1 from public.document_shares s
		where s.id = l.share_id and s.owner_user_id = p_user_id
	);

	select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
	into v_consents
	from public.user_privacy_consents c
	where c.user_id = p_user_id;

	select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
	into v_requests
	from public.privacy_requests r
	where r.user_id = p_user_id;

	return jsonb_build_object(
		'exported_at', now(),
		'user_id', p_user_id,
		'documents', v_docs,
		'document_versions', v_versions,
		'document_shares', v_shares,
		'share_access_logs', v_share_logs,
		'privacy_consents', v_consents,
		'privacy_requests', v_requests
	);
end;
$$;

create or replace function public.delete_user_data(
	p_user_id uuid,
	p_mode text default 'soft'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
	v_count integer := 0;
begin
	if auth.uid() is null or auth.uid() <> p_user_id then
		raise exception 'not allowed';
	end if;
	if p_mode not in ('soft', 'hard') then
		raise exception 'invalid delete mode';
	end if;

	if p_mode = 'soft' then
		update public.documents
		set deleted_at = now()
		where user_id = p_user_id and deleted_at is null;
		get diagnostics v_count = row_count;
	else
		delete from public.documents where user_id = p_user_id;
		get diagnostics v_count = row_count;
		delete from public.user_privacy_consents where user_id = p_user_id;
	end if;

	insert into public.privacy_requests (
		user_id,
		request_type,
		status,
		notes,
		completed_at
	)
	values (
		p_user_id,
		'delete',
		'completed',
		'delete_user_data mode=' || p_mode,
		now()
	);

	return jsonb_build_object(
		'ok', true,
		'mode', p_mode,
		'affected_documents', v_count
	);
end;
$$;

create or replace function public.run_retention_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
	v_share_log_days integer := 90;
	v_revoked_share_days integer := 180;
	v_deleted_doc_grace integer := 30;
	v_deleted_logs integer := 0;
	v_deleted_shares integer := 0;
	v_deleted_docs integer := 0;
begin
	select retain_days into v_share_log_days
	from public.data_retention_policies
	where policy_key = 'share_access_log';

	select retain_days into v_revoked_share_days
	from public.data_retention_policies
	where policy_key = 'revoked_share';

	select retain_days into v_deleted_doc_grace
	from public.data_retention_policies
	where policy_key = 'deleted_document_grace';

	delete from public.document_share_access_log
	where accessed_at < now() - make_interval(days => v_share_log_days);
	get diagnostics v_deleted_logs = row_count;

	delete from public.document_shares
	where revoked_at is not null
		and revoked_at < now() - make_interval(days => v_revoked_share_days);
	get diagnostics v_deleted_shares = row_count;

	delete from public.documents
	where deleted_at is not null
		and deleted_at < now() - make_interval(days => v_deleted_doc_grace);
	get diagnostics v_deleted_docs = row_count;

	return jsonb_build_object(
		'ok', true,
		'deleted_share_logs', v_deleted_logs,
		'deleted_revoked_shares', v_deleted_shares,
		'deleted_soft_deleted_documents', v_deleted_docs
	);
end;
$$;

create or replace function public.log_privacy_consent_event(
	p_consent_key text,
	p_consent_value boolean,
	p_policy_version text,
	p_source text
)
returns public.user_privacy_consent_events
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
	v_row public.user_privacy_consent_events;
begin
	if auth.uid() is null then
		raise exception 'not allowed';
	end if;
	insert into public.user_privacy_consent_events (
		user_id,
		consent_key,
		consent_value,
		policy_version,
		source
	)
	values (
		auth.uid(),
		p_consent_key,
		p_consent_value,
		p_policy_version,
		p_source
	)
	returning * into v_row;
	return v_row;
end;
$$;

revoke all on function public.export_user_data(uuid) from public;
revoke all on function public.delete_user_data(uuid, text) from public;
revoke all on function public.run_retention_cleanup() from public;
revoke all on function public.log_privacy_consent_event(text, boolean, text, text) from public;

grant execute on function public.export_user_data(uuid) to authenticated;
grant execute on function public.delete_user_data(uuid, text) to authenticated;
grant execute on function public.log_privacy_consent_event(text, boolean, text, text) to authenticated;
