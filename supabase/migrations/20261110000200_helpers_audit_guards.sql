-- Identity helpers, audit log, integrity guards, read views.

-- ---------------------------------------------------------------- identity helpers
create or replace function app.is_service() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
$$;

create or replace function app.current_role() returns text
language sql stable security definer set search_path = public as $$
  select u.role from public.users u where u.id = auth.uid() and u.active
$$;

create or replace function app.current_person_id() returns uuid
language sql stable security definer set search_path = public as $$
  select u.person_id from public.users u where u.id = auth.uid() and u.active
$$;

create or replace function app.is_owner() returns boolean language sql stable as $$
  select coalesce(app.current_role() = 'Owner', false) $$;
create or replace function app.is_manager() returns boolean language sql stable as $$
  select coalesce(app.current_role() in ('Owner','Manager'), false) $$;
create or replace function app.is_member() returns boolean language sql stable as $$
  select app.current_role() is not null $$;
create or replace function app.can_write_ops() returns boolean language sql stable as $$
  select coalesce(app.current_role() in ('Owner','Manager','Team member'), false) $$;

create or replace function app.is_developer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select u.is_developer from public.users u where u.id = auth.uid() and u.active), false)
$$;

create or replace function app.setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.settings where key = p_key
$$;

-- D-04: finance visibility = Owner always; per-user override; else role listed in settings.finance_roles
create or replace function app.can_view_financials() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when u.role = 'Owner' then true
      when u.finance_access = 'on' then true
      when u.finance_access = 'off' then false
      else exists (select 1 from jsonb_array_elements_text(coalesce(app.setting('finance_roles'), '[]'::jsonb)) r where r = u.role)
    end
    from public.users u where u.id = auth.uid() and u.active
  ), app.is_service())
$$;

create or replace function app.current_source() returns text language sql stable as $$
  select case when s in ('App','Import','Sync','Job') then s else 'App' end
  from (select coalesce(nullif(current_setting('app.source', true), ''), 'App') s) x
$$;

create or replace function app.actor_label() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.name || ' <' || u.login_email || '>' from public.users u join public.people p on p.id = u.person_id where u.id = auth.uid()),
    case when app.is_service() then 'system (' || app.current_source() || ')' else 'unknown' end)
$$;

create or replace function app.madtown_person_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.people where is_madtown
$$;

create or replace function app.default_home_location_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.locations where is_default_home
$$;

-- D-07: mask currency amounts for viewers without finance access
create or replace function app.mask_prices(p text) returns text language sql stable as $$
  select case
    when p is null then null
    when app.can_view_financials() then p
    else regexp_replace(p, '(Rs\.?|INR|₹)\s?[0-9][0-9,]*(\.[0-9]+)?(\s*/-)?', '\1 ▒▒▒', 'gi')
  end
$$;

-- ---------------------------------------------------------------- id allocation (FR-CAT-001, ADR-07)
create or replace function app.next_item_id() returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.id_counters set next_value = next_value + 1 where name = 'item' returning next_value - 1 into n;
  if n is null then raise exception 'id counter missing'; end if;
  return 'MTMH_' || lpad(n::text, 3, '0');
end $$;

create or replace function app.next_kit_id() returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.id_counters set next_value = next_value + 1 where name = 'kit' returning next_value - 1 into n;
  return 'KIT_' || lpad(n::text, 3, '0');
end $$;

-- ---------------------------------------------------------------- audit log (FR-AUD-001, NFR-015/016)
create or replace function app.jsonb_diff(a jsonb, b jsonb, out before_part jsonb, out after_part jsonb)
language sql immutable as $$
  select
    coalesce((select jsonb_object_agg(k, a -> k) from jsonb_object_keys(a) k where (a -> k) is distinct from (b -> k) and k not in ('updated_at')), '{}'::jsonb),
    coalesce((select jsonb_object_agg(k, b -> k) from jsonb_object_keys(b) k where (a -> k) is distinct from (b -> k) and k not in ('updated_at')), '{}'::jsonb)
$$;

create or replace function app.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb; v_after jsonb; v_id text; v_item text; d record;
begin
  if tg_op in ('UPDATE','DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_after := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    select * into d from app.jsonb_diff(v_before, v_after);
    if d.before_part = '{}'::jsonb and d.after_part = '{}'::jsonb then return null; end if;
    v_id := coalesce(v_after ->> 'id', v_after ->> 'key', v_after ->> 'item_id', v_after ->> 'event_id', v_after ->> 'wishlist_id', v_after ->> 'order_id', v_after ->> 'person_id');
    v_item := case when tg_table_name = 'items' then v_after ->> 'id' else v_after ->> 'item_id' end;
    v_before := d.before_part; v_after := d.after_part;
  else
    v_id := coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'key', v_before ->> 'key', v_after ->> 'item_id', v_before ->> 'item_id',
                     v_after ->> 'event_id', v_before ->> 'event_id', v_after ->> 'wishlist_id', v_before ->> 'wishlist_id',
                     v_after ->> 'order_id', v_before ->> 'order_id', v_after ->> 'person_id', v_before ->> 'person_id',
                     v_after ->> 'kit_id', v_before ->> 'kit_id');
    v_item := case when tg_table_name = 'items' then coalesce(v_after ->> 'id', v_before ->> 'id')
                   else coalesce(v_after ->> 'item_id', v_before ->> 'item_id') end;
  end if;
  -- never store secrets (A5)
  if tg_table_name = 'settings' and coalesce((coalesce(v_after, v_before) ->> 'is_secret')::boolean, false) then
    v_before := case when v_before is null then null else jsonb_set(v_before, '{value}', '"***"') end;
    v_after := case when v_after is null then null else jsonb_set(v_after, '{value}', '"***"') end;
  end if;
  insert into public.audit_log (actor_user_id, actor_label, action, table_name, record_id, item_id, before_json, after_json, source, reason)
  values (auth.uid(), app.actor_label(), lower(tg_op), tg_table_name, v_id, v_item, v_before, v_after,
          app.current_source(), nullif(current_setting('app.reason', true), ''));
  return null;
end $$;

-- Semantic business events (check-out, check-in, transfer, import, sync ...)
create or replace function app.log_event(p_action text, p_table text, p_record text, p_item text, p_before jsonb, p_after jsonb, p_reason text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor_user_id, actor_label, action, table_name, record_id, item_id, before_json, after_json, source, reason)
  values (auth.uid(), app.actor_label(), p_action, p_table, p_record, p_item, p_before, p_after, app.current_source(),
          coalesce(p_reason, nullif(current_setting('app.reason', true), '')));
$$;

create or replace function app.audit_log_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'AUDIT_IMMUTABLE: the audit log is append-only' using errcode = '42501';
end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function app.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.audit_log_immutable();

do $$
declare t text;
begin
  foreach t in array array[
    'settings','item_types','item_subtypes','conditions','people','people_contacts','users','locations',
    'items','item_financials','item_holdings','missing_parts','detached_accessories','retirement_requests',
    'kits','kit_items','loans','loan_lines','loan_extensions','reservations',
    'maintenance_events','maintenance_costs','maintenance_schedules','incidents',
    'wishlist_items','wishlist_related_items','wishlist_financials','wishlist_options',
    'orders','order_financials','order_lines','order_line_items','audits','audit_lines',
    'photos','unsorted_items','import_mapping_rules','sync_conflicts']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function app.audit_trigger()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- updated_at
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
do $$
declare t text;
begin
  foreach t in array array['people','items','item_financials','kits','loans','maintenance_events','wishlist_items','orders','unsorted_items','people_contacts','maintenance_costs','item_holdings']
  loop
    execute format('create trigger touch_%1$s before update on public.%1$I for each row execute function app.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- item guards
-- New items get the next MTMH id; only the importer may supply explicit ids (FR-CAT-001, MIG-002).
-- End users reach tables as `authenticated` (our server and Supabase's Data API alike). Inside the
-- SECURITY DEFINER workflow functions current_user is the function owner, so these guards let workflows
-- through and block direct tampering — no session flag can be set to bypass them.
create or replace function app.is_end_user() returns boolean language sql stable as $$
  select current_user in ('authenticated', 'anon') $$;

create or replace function app.items_before_insert() returns trigger
language plpgsql as $$
declare n int;
begin
  if not app.is_end_user() and app.current_source() = 'Import' and new.id is not null then
    n := (regexp_match(new.id, '^MTMH_([0-9]+)'))[1]::int;
    insert into public.id_counters(name, next_value) values ('item', n + 1)
      on conflict (name) do update set next_value = greatest(public.id_counters.next_value, excluded.next_value);
  elsif not app.is_end_user() and coalesce(current_setting('app.explicit_id', true), '') = 'on' and new.id is not null then
    null; -- unit-suffix ids created by split (FR-CAT-007)
  else
    new.id := app.next_item_id();
  end if;
  if app.is_end_user() then
    new.status := 'Available';
    new.retired_at := null; new.retirement_kind := null; new.retired_reason := null;
    new.imported := false; new.sheet_row := null; new.last_audited_at := null;
    if new.quantity_mode = 'Counted' and new.stock > 0 then
      raise exception 'COUNTED_VIA_WORKFLOW: create Counted items through the add-item action so holdings are recorded' using errcode = '42501';
    end if;
  end if;
  if new.owner_person_id is null then new.owner_person_id := app.madtown_person_id(); end if;
  return new;
end $$;
create trigger items_bi before insert on public.items for each row execute function app.items_before_insert();

-- Workflow-owned fields change only through workflow functions (A5: no frontend-only validation).
create or replace function app.items_before_update() returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id then
    raise exception 'ITEM_ID_IMMUTABLE: item ids never change (FR-CAT-001)' using errcode = '42501';
  end if;
  if app.is_end_user() and (
       new.status is distinct from old.status or new.holder_person_id is distinct from old.holder_person_id
    or new.holder_location_id is distinct from old.holder_location_id or new.stock is distinct from old.stock
    or new.quantity_mode is distinct from old.quantity_mode or new.retired_at is distinct from old.retired_at
    or new.retirement_kind is distinct from old.retirement_kind) then
    raise exception 'WORKFLOW_FIELD: status, holder, stock and retirement change only through check-out/check-in, repair, incident, audit or retirement workflows' using errcode = '42501';
  end if;
  if app.is_end_user() and (new.imported is distinct from old.imported or new.last_audited_at is distinct from old.last_audited_at or new.sheet_row is distinct from old.sheet_row) then
    raise exception 'IMPORT_FIELD: import traceability fields are read-only (FR-CAT-014)' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger items_bu before update on public.items for each row execute function app.items_before_update();

create or replace function app.items_before_delete() returns trigger language plpgsql as $$
begin
  if app.is_end_user() then
    raise exception 'DELETE_VIA_WORKFLOW: items are deleted only by the Owner delete-created-in-error action' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger items_bd before delete on public.items for each row execute function app.items_before_delete();

-- Counted holdings must add up to stock; Single items have no holdings (6.6, ADR-06)
create or replace function app.check_item_holdings(p_item text) returns void
language plpgsql security definer set search_path = public as $$
declare v_mode text; v_stock int; v_sum int; v_neg int;
begin
  select quantity_mode, stock into v_mode, v_stock from public.items where id = p_item;
  if not found then return; end if;
  select coalesce(sum(quantity), 0), count(*) filter (where quantity < 0) into v_sum, v_neg from public.item_holdings where item_id = p_item;
  if v_mode = 'Counted' and v_sum <> v_stock then
    raise exception 'HOLDINGS_MISMATCH: % holdings total % but stock is %', p_item, v_sum, v_stock using errcode = '23514';
  end if;
  if v_mode = 'Single' and exists (select 1 from public.item_holdings where item_id = p_item and quantity > 0) then
    raise exception 'HOLDINGS_SINGLE: % is a Single item and cannot have holdings', p_item using errcode = '23514';
  end if;
end $$;

create or replace function app.holdings_constraint() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'items' then
    perform app.check_item_holdings(new.id);
  else
    perform app.check_item_holdings(coalesce(new.item_id, old.item_id));
    if tg_op = 'UPDATE' and new.item_id is distinct from old.item_id then perform app.check_item_holdings(old.item_id); end if;
  end if;
  return null;
end $$;
create constraint trigger holdings_sum after insert or update or delete on public.item_holdings
  deferrable initially deferred for each row execute function app.holdings_constraint();
create constraint trigger items_holdings_sum after insert or update of stock, quantity_mode on public.items
  deferrable initially deferred for each row execute function app.holdings_constraint();

-- Fill is_single on loan lines from the item (ADR-05 guard)
create or replace function app.loan_lines_before() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    select quantity_mode = 'Single' into new.is_single from public.items where id = new.item_id;
  elsif new.is_single is distinct from old.is_single or new.item_id is distinct from old.item_id then
    raise exception 'LOAN_LINE_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger loan_lines_bi before insert or update on public.loan_lines for each row execute function app.loan_lines_before();

-- ---------------------------------------------------------------- derived quantities and flags
create or replace function app.item_quantities(p_item text,
  out available_qty int, out out_qty int, out in_repair_qty int, out missing_qty int, out lost_qty int)
language sql stable security definer set search_path = public as $$
  select
    case when i.quantity_mode = 'Single' then (case when i.status = 'Available' and i.stock = 1 then 1 else 0 end)
         else coalesce((select sum(quantity) from item_holdings h where h.item_id = i.id and h.status = 'Available'), 0)::int end,
    case when i.quantity_mode = 'Single' then (case when i.status = 'Checked out' then 1 else 0 end)
         else coalesce((select sum(quantity) from item_holdings h where h.item_id = i.id and h.status = 'Checked out'), 0)::int end,
    case when i.quantity_mode = 'Single' then (case when i.status = 'In repair' then 1 else 0 end)
         else coalesce((select sum(quantity) from item_holdings h where h.item_id = i.id and h.status = 'In repair'), 0)::int end,
    case when i.quantity_mode = 'Single' then (case when i.status = 'Missing' then 1 else 0 end)
         else coalesce((select sum(quantity) from item_holdings h where h.item_id = i.id and h.status = 'Missing'), 0)::int end,
    case when i.quantity_mode = 'Single' then (case when i.status = 'Lost' then 1 else 0 end)
         else coalesce((select sum(quantity) from item_holdings h where h.item_id = i.id and h.status = 'Lost'), 0)::int end
  from items i where i.id = p_item
$$;

-- Status of a Counted item summarises its holdings (6.3 "Status: derived").
create or replace function app.refresh_counted_status(p_item text) returns void
language plpgsql security definer set search_path = public as $$
declare q record; v_status text; v_mode text; v_cur text;
begin
  select quantity_mode, status into v_mode, v_cur from items where id = p_item;
  if v_mode <> 'Counted' or v_cur = 'Retired' then return; end if;
  select * into q from app.item_quantities(p_item);
  v_status := case
    when q.available_qty > 0 then 'Available'
    when q.out_qty > 0 then 'Checked out'
    when q.in_repair_qty > 0 then 'In repair'
    when q.missing_qty > 0 then 'Missing'
    when q.lost_qty > 0 then 'Lost'
    else 'Available' end;
  if v_status is distinct from v_cur then
    perform set_config('app.state_change', 'on', true);
    update items set status = v_status where id = p_item;
  end if;
end $$;

create or replace function app.photo_is_valid(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select link_kind = 'file' and (provider_file_id is not null) and upload_state in ('uploaded','legacy','pending') from photos where id = p), false)
$$;

-- Read view used by every list, search, dashboard and export.
-- Owner-privileged view (not security_invoker) because items.notes is column-revoked from
-- `authenticated` (D-07): the only way to read notes is masked, through this view. Row access is
-- restricted to active members / service by the WHERE clause, mirroring the items RLS policy.
create or replace view public.items_v as
select
  i.id, i.name, i.model_number, i.model_tbd, i.brand, i.serial_number, i.type, i.subtype, i.quantity_mode, i.stock,
  i.stock_to_verify, i.stock_to_verify_reason, i.status, i.condition, i.owner_person_id, i.holder_person_id, i.holder_location_id,
  i.home_location_id, i.parent_item_id, i.case_item_id, i.case_capacity_note, i.needs_case, i.label_target, i.label_note,
  i.stock_image_photo_id, i.latest_photo_id,
  app.mask_prices(i.notes) as notes,
  i.to_verify, i.to_verify_reason, i.retired_at, i.retirement_kind, i.retired_reason, i.sheet_row, i.imported,
  i.last_audited_at, i.created_at, i.updated_at,
  op.name as owner_name, (op.is_madtown) as owned_by_madtown,
  coalesce(hp.name, hl.name) as holder_label,
  q.available_qty, q.out_qty, q.in_repair_qty, q.missing_qty, q.lost_qty,
  case when i.status = 'Available' and exists (
         select 1 from reservations r where r.status = 'Active' and r.item_id = i.id and now() <@ tstzrange(r.starts_at, r.ends_at))
       then 'Reserved' else i.status end as display_status,
  (i.status <> 'Retired') as is_active,
  exists (select 1 from loan_lines l where l.item_id = i.id and l.active) as flag_out_now,
  exists (select 1 from loan_lines l join loans lo on lo.id = l.loan_id where l.item_id = i.id and l.active and lo.status = 'Overdue') as flag_overdue,
  (i.status = 'In repair' or q.in_repair_qty > 0) as flag_in_repair,
  (i.status = 'Lost' or q.lost_qty > 0) as flag_lost,
  (i.status = 'Missing' or q.missing_qty > 0) as flag_missing,
  (i.condition = 'Bad condition') as flag_bad_condition,
  (not op.is_madtown) as flag_owned_by_others,
  (not app.photo_is_valid(i.stock_image_photo_id) or not app.photo_is_valid(i.latest_photo_id)) as flag_missing_photos,
  (i.to_verify or i.stock_to_verify or i.model_tbd) as flag_to_verify,
  exists (select 1 from missing_parts m where m.item_id = i.id and m.status = 'Missing') as flag_missing_parts
from items i
join people op on op.id = i.owner_person_id
left join people hp on hp.id = i.holder_person_id
left join locations hl on hl.id = i.holder_location_id
cross join lateral app.item_quantities(i.id) q
where app.is_member() or app.is_service();
