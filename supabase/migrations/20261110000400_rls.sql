-- Row Level Security, grants and remaining guards (section 9 permission matrix, NFR-004, A5).

-- ---------------------------------------------------------------- extra workflow: create item (FR-CAT-001/005/006)
create or replace function app.create_item(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text; v_mode text := coalesce(nullif(p ->> 'quantity_mode', ''), 'Single'); v_stock int;
  v_home uuid := coalesce(nullif(p ->> 'home_location_id', '')::uuid, app.default_home_location_id());
begin
  if app.actor_role() not in ('Owner','Manager','Service') then perform app.fail('NOT_ALLOWED', 'only Managers add items'); end if;
  v_stock := case when v_mode = 'Single' then 1 else coalesce((p ->> 'stock')::int, 0) end;
  if v_stock < 0 then perform app.fail('BAD_QTY', 'stock cannot be negative'); end if;
  if not exists (select 1 from item_types where name = p ->> 'type' and status = 'Approved') then
    perform app.fail('BAD_TYPE', 'type must be an approved value');
  end if;
  insert into items(id, name, model_number, model_tbd, brand, serial_number, type, subtype, quantity_mode, stock, stock_to_verify, stock_to_verify_reason,
                    condition, owner_person_id, holder_location_id, home_location_id, parent_item_id, case_item_id, case_capacity_note, needs_case,
                    label_target, label_note, notes, to_verify, to_verify_reason, created_by)
  values (null, btrim(regexp_replace(p ->> 'name', '\s+', ' ', 'g')), nullif(btrim(p ->> 'model_number'), ''), coalesce((p ->> 'model_tbd')::boolean, false),
          nullif(btrim(p ->> 'brand'), ''), nullif(btrim(p ->> 'serial_number'), ''), p ->> 'type', nullif(p ->> 'subtype', ''), v_mode, v_stock,
          coalesce((p ->> 'stock_to_verify')::boolean, false), nullif(p ->> 'stock_to_verify_reason', ''),
          coalesce(nullif(p ->> 'condition', ''), 'Good'), coalesce(nullif(p ->> 'owner_person_id', '')::uuid, app.madtown_person_id()),
          case when v_mode = 'Single' then v_home end, v_home, nullif(p ->> 'parent_item_id', ''), nullif(p ->> 'case_item_id', ''),
          nullif(p ->> 'case_capacity_note', ''), coalesce((p ->> 'needs_case')::boolean, false),
          coalesce(nullif(p ->> 'label_target', ''), 'Item'), nullif(p ->> 'label_note', ''), nullif(p ->> 'notes', ''),
          coalesce((p ->> 'to_verify')::boolean, false) or coalesce((p ->> 'model_tbd')::boolean, false),
          coalesce(nullif(p ->> 'to_verify_reason', ''), case when coalesce((p ->> 'model_tbd')::boolean, false) then 'Model TBD' end), auth.uid())
  returning id into v_id;
  if v_mode = 'Counted' and v_stock > 0 then
    perform app.add_holding(v_id, null, v_home, 'Available', v_stock);
  end if;
  if (p ? 'purchase_price' or p ? 'purchase_date' or p ? 'vendor' or p ? 'order_ref' or p ? 'warranty_until') then
    if app.can_view_financials() then
      insert into item_financials(item_id, purchase_date, vendor, order_ref, purchase_price, warranty_until)
      values (v_id, nullif(p ->> 'purchase_date', '')::date, nullif(p ->> 'vendor', ''), nullif(p ->> 'order_ref', ''),
              nullif(p ->> 'purchase_price', '')::numeric, nullif(p ->> 'warranty_until', '')::date);
    end if;
  end if;
  return jsonb_build_object('item_id', v_id);
end $$;

-- kit ids
create or replace function app.kits_before_insert() returns trigger language plpgsql as $$
begin
  if new.id is null or app.is_end_user() then new.id := app.next_kit_id(); end if;
  return new;
end $$;
create trigger kits_bi before insert on public.kits for each row execute function app.kits_before_insert();

-- to-buy approvals and receipt only through workflows (FR-BUY-005, AC-BUY-02)
create or replace function app.wishlist_guard() returns trigger language plpgsql as $$
begin
  if not app.is_end_user() then return new; end if;
  if tg_op = 'INSERT' then
    if new.status not in ('To research','To buy') then raise exception 'WISHLIST_STATUS: new lines start as To research or To buy' using errcode = '42501'; end if;
    new.approved_by := null; new.approved_at := null; new.rejected_by := null; new.rejected_at := null;
    new.verified_by := null; new.verified_at := null; new.proposed_by := auth.uid(); new.proposed_at := now();
    return new;
  end if;
  if new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at
     or new.rejected_by is distinct from old.rejected_by or new.verified_at is distinct from old.verified_at
     or new.proposed_by is distinct from old.proposed_by then
    raise exception 'WISHLIST_DECISION: approval fields change only through the approval action' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if new.status in ('Approved','Rejected','Received') or old.status in ('Approved','Rejected','Received') and not (old.status = 'Approved' and new.status = 'Ordered') then
      raise exception 'WISHLIST_STATUS: % -> % is not allowed directly', old.status, new.status using errcode = '42501';
    end if;
    if new.status = 'Ordered' and old.status <> 'Approved' then
      raise exception 'WISHLIST_STATUS: only Approved lines can be ordered' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger wishlist_guard before insert or update on public.wishlist_items for each row execute function app.wishlist_guard();

-- maintenance state and incidents status only through workflows
create or replace function app.workflow_table_guard() returns trigger language plpgsql as $$
begin
  if app.is_end_user() then
    raise exception 'WORKFLOW_TABLE: % changes only through workflow actions', tg_table_name using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

-- mask notes inside audit payloads for viewers without finance access
create or replace function app.mask_json(j jsonb) returns jsonb language sql stable as $$
  select case when j is null or app.can_view_financials() then j
              when j ? 'notes' then jsonb_set(j, '{notes}', to_jsonb(app.mask_prices(j ->> 'notes')))
              else j end
$$;

create or replace function app.item_audit(p_item text) returns setof public.audit_log
language sql stable security definer set search_path = public as $$
  select a.id, a.at, a.actor_user_id, a.actor_label, a.action, a.table_name, a.record_id, a.item_id,
         app.mask_json(a.before_json), app.mask_json(a.after_json), a.source, a.reason
    from audit_log a
   where app.is_manager()
     and (a.item_id = p_item or (a.table_name in ('loans','loan_lines') and a.record_id in (select loan_id::text from loan_lines where item_id = p_item)))
     and (app.can_view_financials() or a.table_name not in ('item_financials','maintenance_costs','order_financials','wishlist_options','wishlist_financials','item_import_raw'))
   order by a.at desc, a.id desc
$$;

-- masked to-buy view (D-08)
create or replace view public.wishlist_v as
select w.id, w.item_description, w.reason, w.replaces_or_adds, w.replaces_or_adds_note, w.priority, w.status, w.verify_first, w.verify_note,
       w.verified_by, w.verified_at, w.verification_result, w.links, app.mask_prices(w.notes) as notes, w.proposed_by, w.proposed_at,
       w.approved_by, w.approved_at, w.decision_comment, w.rejected_by, w.rejected_at, w.source_missing_part_id, w.source_incident_id,
       w.sheet_row, w.legacy, w.created_at, w.updated_at
  from wishlist_items w
 where app.is_member() or app.is_service();

-- ---------------------------------------------------------------- grants
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

revoke insert, update, delete, truncate on public.audit_log from authenticated, service_role;
revoke all on public.id_counters from authenticated;

-- D-07: raw notes are not readable by end users; read through items_v / wishlist_v (masked)
revoke select on public.items from authenticated;
grant select (id, name, model_number, model_tbd, brand, serial_number, type, subtype, quantity_mode, stock, stock_to_verify, stock_to_verify_reason,
  status, condition, owner_person_id, holder_person_id, holder_location_id, home_location_id, parent_item_id, case_item_id, case_capacity_note,
  needs_case, label_target, label_note, stock_image_photo_id, latest_photo_id, to_verify, to_verify_reason, retired_at, retirement_kind,
  retired_reason, sheet_row, imported, last_audited_at, archived, created_by, created_at, updated_at) on public.items to authenticated;
revoke select on public.wishlist_items from authenticated;
grant select (id, item_description, reason, replaces_or_adds, replaces_or_adds_note, priority, status, verify_first, verify_note, verified_by,
  verified_at, verification_result, links, proposed_by, proposed_at, approved_by, approved_at, decision_comment, rejected_by, rejected_at,
  source_missing_part_id, source_incident_id, sheet_row, legacy, created_at, updated_at) on public.wishlist_items to authenticated;
grant select on public.items_v, public.wishlist_v to authenticated, service_role;

revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function app.add_holding(text, uuid, uuid, text, int, uuid) from authenticated;
revoke execute on function app.take_holding(text, text, int, uuid, uuid, uuid) from authenticated;
revoke execute on function app.log_event(text, text, text, text, jsonb, jsonb, text) from authenticated;
revoke execute on function app.check_item_holdings(text) from authenticated;
revoke execute on function app.refresh_counted_status(text) from authenticated;
revoke execute on function app.job_mark_overdue() from authenticated;

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
-- Not FORCEd: the table owner (migration role, owner of the SECURITY DEFINER workflows) and
-- service_role bypass RLS; every end-user request runs as `authenticated` and is filtered.

-- helper macro-ish policies
create policy settings_read on public.settings for select to authenticated using (app.is_member() and (not is_secret or app.is_owner()));
create policy settings_write on public.settings for all to authenticated using (app.is_owner()) with check (app.is_owner());

create policy types_read on public.item_types for select to authenticated using (app.is_member());
create policy types_propose on public.item_types for insert to authenticated with check (app.is_owner() or (app.is_manager() and status = 'Proposed'));
create policy types_owner on public.item_types for update to authenticated using (app.is_owner()) with check (app.is_owner());
create policy types_delete on public.item_types for delete to authenticated using (app.is_owner());
create policy subtypes_read on public.item_subtypes for select to authenticated using (app.is_member());
create policy subtypes_propose on public.item_subtypes for insert to authenticated with check (app.is_owner() or (app.is_manager() and status = 'Proposed'));
create policy subtypes_owner on public.item_subtypes for update to authenticated using (app.is_owner()) with check (app.is_owner());
create policy conditions_read on public.conditions for select to authenticated using (app.is_member());
create policy conditions_owner on public.conditions for update to authenticated using (app.is_owner()) with check (app.is_owner());

create policy people_read on public.people for select to authenticated using (app.is_member());
create policy people_write on public.people for insert to authenticated with check (app.is_manager());
create policy people_update on public.people for update to authenticated using (app.is_manager()) with check (app.is_manager() and (not is_madtown or app.is_owner()));
create policy contacts_read on public.people_contacts for select to authenticated using (app.is_manager());
create policy contacts_write on public.people_contacts for all to authenticated using (app.is_manager()) with check (app.is_manager());

create policy users_read on public.users for select to authenticated using (app.is_owner() or id = auth.uid() or app.is_member());
create policy users_owner on public.users for all to authenticated using (app.is_owner()) with check (app.is_owner());

create policy locations_read on public.locations for select to authenticated using (app.is_member());
create policy locations_write on public.locations for insert to authenticated with check (app.is_manager());
create policy locations_update on public.locations for update to authenticated using (app.is_manager()) with check (app.is_manager());

create policy photos_read on public.photos for select to authenticated using (app.is_member() and (kind <> 'Invoice' or app.can_view_financials()));
create policy photos_insert on public.photos for insert to authenticated with check (
  app.can_write_ops() and taken_by = auth.uid() and (kind not in ('Invoice','Stock') or app.is_manager()) and (kind <> 'Invoice' or app.can_view_financials()));
create policy photos_update on public.photos for update to authenticated using (app.is_manager() or taken_by = auth.uid()) with check (app.is_manager() or taken_by = auth.uid());

create policy items_read on public.items for select to authenticated using (app.is_member());
create policy items_insert on public.items for insert to authenticated with check (app.is_manager());
create policy items_update on public.items for update to authenticated using (app.is_manager()) with check (app.is_manager());

create policy fin_read on public.item_financials for select to authenticated using (app.can_view_financials());
create policy fin_write on public.item_financials for all to authenticated using (app.can_view_financials() and app.is_manager()) with check (app.can_view_financials() and app.is_manager());
create policy raw_read on public.item_import_raw for select to authenticated using (app.can_view_financials() or app.is_developer());

create policy holdings_read on public.item_holdings for select to authenticated using (app.is_member());

create policy mp_read on public.missing_parts for select to authenticated using (app.is_member());
create policy mp_insert on public.missing_parts for insert to authenticated with check (app.can_write_ops() and reported_by = auth.uid());
create policy mp_update on public.missing_parts for update to authenticated using (app.is_manager()) with check (app.is_manager());

create policy det_read on public.detached_accessories for select to authenticated using (app.is_member());
create policy det_write on public.detached_accessories for all to authenticated using (app.is_manager()) with check (app.is_manager());

create policy ret_read on public.retirement_requests for select to authenticated using (app.is_manager());

create policy kits_read on public.kits for select to authenticated using (app.is_member());
create policy kits_write on public.kits for all to authenticated using (app.is_manager()) with check (app.is_manager());
create policy kit_items_read on public.kit_items for select to authenticated using (app.is_member());
create policy kit_items_write on public.kit_items for all to authenticated using (app.is_manager()) with check (app.is_manager());

create policy loans_read on public.loans for select to authenticated using (app.is_member());
create policy lines_read on public.loan_lines for select to authenticated using (app.is_member());
create policy events_read on public.loan_events for select to authenticated using (app.is_member());
create policy ext_read on public.loan_extensions for select to authenticated using (app.is_member());

create policy res_read on public.reservations for select to authenticated using (app.is_member());
create policy res_insert on public.reservations for insert to authenticated with check (
  app.can_write_ops() and created_by = auth.uid() and status = 'Active' and (app.is_manager() or person_id = app.current_person_id()));
create policy res_update on public.reservations for update to authenticated using (app.is_manager() or created_by = auth.uid())
  with check (app.is_manager() or created_by = auth.uid());

create policy maint_read on public.maintenance_events for select to authenticated using (app.is_member());
create policy maint_hist_read on public.maintenance_state_history for select to authenticated using (app.is_member());
create policy cost_read on public.maintenance_costs for select to authenticated using (app.can_view_financials());
create policy cost_write on public.maintenance_costs for all to authenticated using (app.can_view_financials() and app.is_manager()) with check (app.can_view_financials() and app.is_manager());
create policy sched_read on public.maintenance_schedules for select to authenticated using (app.is_member());
create policy sched_write on public.maintenance_schedules for all to authenticated using (app.is_manager()) with check (app.is_manager());

create policy inc_read on public.incidents for select to authenticated using (app.is_member());

create policy wl_read on public.wishlist_items for select to authenticated using (app.is_member());
create policy wl_insert on public.wishlist_items for insert to authenticated with check (
  app.is_manager() or (app.current_role() = 'Team member' and coalesce((app.setting('team_can_propose') #>> '{}')::boolean, true)));
create policy wl_update on public.wishlist_items for update to authenticated using (app.is_manager()) with check (app.is_manager());
create policy wlr_read on public.wishlist_related_items for select to authenticated using (app.is_member());
create policy wlr_write on public.wishlist_related_items for insert to authenticated with check (
  app.is_manager() or exists (select 1 from wishlist_items w where w.id = wishlist_id and w.proposed_by = auth.uid() and w.status in ('To research','To buy')));
create policy wlr_delete on public.wishlist_related_items for delete to authenticated using (app.is_manager());
create policy wlf_read on public.wishlist_financials for select to authenticated using (app.can_view_financials());
create policy wlf_write on public.wishlist_financials for all to authenticated using (app.can_view_financials() and app.is_manager()) with check (app.can_view_financials() and app.is_manager());
create policy wlo_read on public.wishlist_options for select to authenticated using (app.can_view_financials());
create policy wlo_write on public.wishlist_options for all to authenticated using (app.can_view_financials() and app.is_manager()) with check (app.can_view_financials() and app.is_manager());

create policy ord_read on public.orders for select to authenticated using (app.current_role() in ('Owner','Manager','Read-only'));
create policy ord_write on public.orders for all to authenticated using (app.is_manager()) with check (app.is_manager());
create policy ordl_read on public.order_lines for select to authenticated using (app.current_role() in ('Owner','Manager','Read-only'));
create policy ordl_write on public.order_lines for all to authenticated using (app.is_manager()) with check (app.is_manager());
create policy ordli_read on public.order_line_items for select to authenticated using (app.current_role() in ('Owner','Manager','Read-only'));
create policy ordf_read on public.order_financials for select to authenticated using (app.can_view_financials());
create policy ordf_write on public.order_financials for all to authenticated using (app.can_view_financials() and app.is_manager()) with check (app.can_view_financials() and app.is_manager());

create policy aud_read on public.audits for select to authenticated using (app.is_member());
create policy aud_insert on public.audits for insert to authenticated with check (app.is_manager() and started_by = auth.uid() and status = 'Open');
create policy aud_update on public.audits for update to authenticated using (app.is_manager()) with check (app.is_manager());
create policy audl_read on public.audit_lines for select to authenticated using (app.is_member());

create policy log_owner on public.audit_log for select to authenticated using (app.is_owner());

create policy notif_read on public.notifications_log for select to authenticated using (app.is_manager());

create policy imp_read on public.import_runs for select to authenticated using (app.is_owner() or app.is_developer());
create policy impr_read on public.import_row_results for select to authenticated using (app.is_owner() or app.is_developer());
create policy rules_read on public.import_mapping_rules for select to authenticated using (app.is_manager() or app.is_developer());
create policy rules_write on public.import_mapping_rules for all to authenticated using (app.is_owner() or app.is_developer()) with check (app.is_owner() or app.is_developer());
create policy uns_read on public.unsorted_items for select to authenticated using (app.is_manager() or app.is_developer());
create policy uns_update on public.unsorted_items for update to authenticated using (app.is_manager()) with check (app.is_manager());

create policy sv_own on public.saved_views for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sc_read on public.sync_conflicts for select to authenticated using (app.is_manager() or user_id = auth.uid());
create policy sc_update on public.sync_conflicts for update to authenticated using (app.is_manager()) with check (app.is_manager());
create policy mr_read on public.mirror_runs for select to authenticated using (app.is_manager() or app.is_developer());
create policy jr_read on public.job_runs for select to authenticated using (app.is_manager() or app.is_developer());

-- tables with no policies for writes (loans, loan_lines, loan_events, loan_extensions, item_holdings, incidents,
-- maintenance_events, maintenance_state_history, retirement_requests, audit_lines, audit_log, notifications_log,
-- import_*, id_counters, item_import_raw) are writable only through the SECURITY DEFINER workflows or service jobs.
