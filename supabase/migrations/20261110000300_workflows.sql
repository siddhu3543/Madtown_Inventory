-- Workflow functions. SECURITY DEFINER with explicit role checks; each runs atomically with
-- row locks (SELECT ... FOR UPDATE) so concurrent requests cannot double-allocate (A5).
-- Error messages start with a stable CODE: that the app maps to user-facing text.

create or replace function app.fail(p_code text, p_msg text) returns void language plpgsql as $$
begin raise exception '%: %', p_code, p_msg using errcode = 'P0001'; end $$;

create or replace function app.actor_role() returns text language sql stable as $$
  select case when app.is_service() then 'Service' else app.current_role() end $$;

create or replace function app.state_on() returns void language sql as $$ select set_config('app.state_change', 'on', true) $$;
create or replace function app.state_off() returns void language sql as $$ select set_config('app.state_change', 'off', true) $$;

create or replace function app.condition_rank(p text) returns int language sql stable security definer set search_path = public as $$
  select rank from conditions where name = p $$;

-- ------------------------------------------------------------- holdings helpers (Counted items)
create or replace function app.add_holding(p_item text, p_person uuid, p_location uuid, p_status text, p_qty int, p_line uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_qty <= 0 then return; end if;
  select id into v_id from item_holdings
   where item_id = p_item and status = p_status
     and holder_person_id is not distinct from p_person and holder_location_id is not distinct from p_location
     and loan_line_id is not distinct from p_line
   limit 1 for update;
  if v_id is null then
    insert into item_holdings(item_id, holder_person_id, holder_location_id, status, quantity, loan_line_id)
    values (p_item, p_person, p_location, p_status, p_qty, p_line);
  else
    update item_holdings set quantity = quantity + p_qty where id = v_id;
  end if;
end $$;

-- take p_qty from holdings matching status (and optional holder/line), preferring the home location
create or replace function app.take_holding(p_item text, p_status text, p_qty int, p_line uuid default null,
  p_person uuid default null, p_location uuid default null,
  out took_person uuid, out took_location uuid)
language plpgsql security definer set search_path = public as $$
declare r record; v_left int := p_qty; v_take int; v_home uuid := app.default_home_location_id();
begin
  for r in
    select * from item_holdings
     where item_id = p_item and status = p_status and quantity > 0
       and (p_line is null or loan_line_id = p_line)
       and (p_person is null or holder_person_id = p_person)
       and (p_location is null or holder_location_id = p_location)
     order by (holder_location_id = v_home) desc nulls last, (holder_location_id is not null) desc, quantity desc
     for update
  loop
    exit when v_left = 0;
    v_take := least(v_left, r.quantity);
    if r.quantity - v_take = 0 then delete from item_holdings where id = r.id;
    else update item_holdings set quantity = quantity - v_take where id = r.id; end if;
    v_left := v_left - v_take;
    took_person := coalesce(took_person, r.holder_person_id);
    took_location := coalesce(took_location, r.holder_location_id);
  end loop;
  if v_left > 0 then
    perform app.fail('INSUFFICIENT_QTY', format('%s: only %s of %s units are %s', p_item, p_qty - v_left, p_qty, p_status));
  end if;
end $$;

-- ------------------------------------------------------------- check-out (FR-CHK-001..003, 006, 007, 010, 012, 013)
create or replace function app.checkout(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := app.actor_role();
  v_me uuid := app.current_person_id();
  v_borrower uuid := coalesce((p ->> 'borrower_person_id')::uuid, v_me);
  v_kit text := nullif(p ->> 'kit_id', '');
  v_item text := nullif(p ->> 'item_id', '');
  v_qty int := coalesce((p ->> 'quantity')::int, 1);
  v_override text := nullif(btrim(p ->> 'override_reason'), '');
  v_photos uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'photo_ids', '[]'::jsonb))::uuid), '{}');
  v_due timestamptz := nullif(p ->> 'due_at', '')::timestamptz;
  v_cond text := nullif(p ->> 'condition_out', '');
  v_client uuid := nullif(p ->> 'client_uuid', '')::uuid;
  v_loan uuid; v_line uuid; v_days int; v_warn jsonb := '[]'::jsonb;
  t record; v_item_row record; v_policy text; v_has_overdue boolean; v_took record; v_stale record;
begin
  if v_role is null or v_role not in ('Owner','Manager','Team member','Service') then
    perform app.fail('NOT_ALLOWED', 'your role cannot check items out');
  end if;
  if v_client is not null then
    select id into v_loan from loans where client_uuid = v_client;
    if v_loan is not null then return jsonb_build_object('loan_id', v_loan, 'duplicate', true, 'warnings', v_warn); end if;
  end if;
  if v_borrower is null then perform app.fail('BORROWER_REQUIRED', 'choose a borrower'); end if;
  if v_role = 'Team member' and v_borrower is distinct from v_me then
    perform app.fail('NOT_ALLOWED', 'Team members can check out only to themselves; ask a Manager to record a loan for someone else');
  end if;
  if not exists (select 1 from people where id = v_borrower and active and person_type <> 'Organisation') then
    perform app.fail('BORROWER_INACTIVE', 'borrower is inactive or not a person');
  end if;
  if (v_item is null) = (v_kit is null) then perform app.fail('TARGET_REQUIRED', 'give exactly one item or kit'); end if;
  if v_qty < 1 then perform app.fail('BAD_QTY', 'quantity must be at least 1'); end if;

  -- overdue borrower (FR-CHK-007, D-05)
  v_policy := coalesce(app.setting('overdue_policy') #>> '{}', 'block_team_override_manager');
  select exists (select 1 from loans where borrower_person_id = v_borrower and status = 'Overdue') into v_has_overdue;
  if v_has_overdue then
    if v_policy = 'warn_only' then
      v_warn := v_warn || jsonb_build_array('BORROWER_HAS_OVERDUE');
    elsif v_role = 'Team member' then
      perform app.fail('OVERDUE_BLOCKED', 'you have overdue items; return them or ask a Manager to override');
    elsif v_override is null then
      perform app.fail('OVERDUE_NEEDS_REASON', 'borrower has overdue items; a Manager override needs a recorded reason');
    else
      v_warn := v_warn || jsonb_build_array('OVERDUE_OVERRIDDEN');
    end if;
  end if;

  if v_kit is not null and not exists (select 1 from kits where id = v_kit and active) then
    perform app.fail('KIT_NOT_FOUND', v_kit || ' not found or inactive');
  end if;

  perform app.state_on();

  insert into loans (kit_id, borrower_person_id, purpose_or_project, checked_out_by, checked_out_at, due_at, condition_out, status, override_reason, client_uuid, created_via, notes)
  values (v_kit, v_borrower, nullif(p ->> 'purpose', ''), auth.uid(), now(), now() + interval '1 day', null, 'Open', v_override, v_client,
          case when coalesce((p ->> 'offline')::boolean, false) then 'Offline' else 'App' end, nullif(p ->> 'notes', ''))
  returning id into v_loan;

  for t in
    select x.item_id, x.qty, x.required from (
      select v_item as item_id, v_qty as qty, null::boolean as required where v_item is not null
      union all
      select ki.item_id, ki.quantity, ki.required from kit_items ki where ki.kit_id = v_kit
    ) x order by x.item_id
  loop
    select * into v_item_row from items where id = t.item_id for update;
    if not found then perform app.fail('ITEM_NOT_FOUND', t.item_id || ' not found'); end if;
    if v_item_row.status = 'Retired' then perform app.fail('RETIRED', t.item_id || ' is retired'); end if;

    if v_item_row.quantity_mode = 'Single' then
      if t.qty <> 1 then perform app.fail('BAD_QTY', t.item_id || ' is a Single item'); end if;
      if v_item_row.status = 'In repair' then perform app.fail('IN_REPAIR', t.item_id || ' is in repair and cannot be checked out'); end if;
      if v_item_row.status in ('Lost','Missing') then perform app.fail('NOT_AVAILABLE', t.item_id || ' is ' || v_item_row.status); end if;
      if v_item_row.stock = 0 then perform app.fail('STOCK_UNKNOWN', t.item_id || ' has no confirmed stock; verify it first'); end if;
      if v_item_row.status = 'Checked out' or exists (select 1 from loan_lines where item_id = t.item_id and active) then
        if v_override is not null and v_role in ('Owner','Manager') and coalesce((p ->> 'override_double')::boolean, false) then
          -- D-06: close the stale loan instead of creating a second holder
          for v_stale in select l.id as line_id, l.loan_id from loan_lines l where l.item_id = t.item_id and l.active loop
            update loan_lines set qty_returned = quantity - qty_lost - qty_transferred where id = v_stale.line_id;
            insert into loan_events(loan_id, line_id, item_id, event, quantity, by_user, note)
              values (v_stale.loan_id, v_stale.line_id, t.item_id, 'override-close', 1, auth.uid(), v_override);
            if not exists (select 1 from loan_lines where loan_id = v_stale.loan_id and active) then
              update loans set status = 'Returned', close_reason = 'Override closed', checked_in_at = now(), checked_in_by = auth.uid(),
                     notes = concat_ws(E'\n', notes, 'Closed by override: ' || v_override) where id = v_stale.loan_id;
            end if;
          end loop;
          perform app.log_event('override-close', 'loans', v_stale.loan_id::text, t.item_id, null, null, v_override);
        else
          perform app.fail('ALREADY_OUT', t.item_id || ' is already checked out');
        end if;
      end if;
      insert into loan_lines (loan_id, item_id, quantity, required_in_kit, source_location_id, source_person_id)
      values (v_loan, t.item_id, 1, t.required, v_item_row.holder_location_id, v_item_row.holder_person_id)
      returning id into v_line;
      update items set status = 'Checked out', holder_person_id = v_borrower, holder_location_id = null where id = t.item_id;
    else
      insert into loan_lines (loan_id, item_id, quantity, required_in_kit)
      values (v_loan, t.item_id, t.qty, t.required) returning id into v_line;
      select * into v_took from app.take_holding(t.item_id, 'Available', t.qty, null, null, nullif(p ->> 'source_location_id', '')::uuid);
      update loan_lines set source_location_id = v_took.took_location, source_person_id = v_took.took_person where id = v_line;
      perform app.add_holding(t.item_id, v_borrower, null, 'Checked out', t.qty, v_line);
      perform app.refresh_counted_status(t.item_id);
    end if;

    -- photo rule per Type (FR-CHK-003, D-14)
    if exists (select 1 from item_types where name = v_item_row.type and checkout_photo_required) and not exists (
         select 1 from photos ph where ph.id = any(v_photos) and ph.kind = 'Check-out' and ph.item_id = t.item_id) then
      perform app.fail('PHOTO_REQUIRED', format('%s (%s) needs at least one check-out photo', t.item_id, v_item_row.type));
    end if;

    -- reservations (FR-CHK-012): someone else's booking in the loan window
    if exists (select 1 from reservations r
               where r.status = 'Active' and (r.item_id = t.item_id or r.kit_id = v_kit)
                 and r.person_id <> v_borrower
                 and tstzrange(r.starts_at, r.ends_at) && tstzrange(now(), coalesce(v_due, now() + interval '1 day'))) then
      if not coalesce((p ->> 'ack_reservation')::boolean, false) then
        perform app.fail('RESERVED_CONFLICT', t.item_id || ' is reserved by someone else in this period');
      end if;
      v_warn := v_warn || jsonb_build_array('RESERVATION_ACKNOWLEDGED');
    end if;

    select default_loan_days into v_days from item_types where name = v_item_row.type;
    v_days := coalesce(v_days, 7);
    if v_due is null then v_due := now() + make_interval(days => v_days);
    end if;
    v_cond := coalesce(v_cond, v_item_row.condition);

    insert into loan_events(loan_id, line_id, item_id, event, quantity, by_user, person_id)
      values (v_loan, v_line, t.item_id, 'check-out', t.qty, auth.uid(), v_borrower);
    perform app.log_event('check-out', 'loans', v_loan::text, t.item_id,
      jsonb_build_object('status', v_item_row.status, 'holder_person_id', v_item_row.holder_person_id, 'holder_location_id', v_item_row.holder_location_id),
      jsonb_build_object('borrower_person_id', v_borrower, 'quantity', t.qty, 'due_at', v_due));
  end loop;

  if v_due <= now() then perform app.fail('BAD_DUE', 'due date must be in the future'); end if;
  if v_cond is null then perform app.fail('CONDITION_REQUIRED', 'record the condition at check-out'); end if;
  update loans set due_at = v_due, condition_out = v_cond where id = v_loan;
  update photos set loan_id = v_loan where id = any(v_photos) and kind = 'Check-out' and loan_id is null;
  update reservations set status = 'Fulfilled'
   where status = 'Active' and person_id = v_borrower and (item_id = v_item or kit_id = v_kit) and now() <@ tstzrange(starts_at - interval '1 day', ends_at);

  perform app.state_off();
  return jsonb_build_object('loan_id', v_loan, 'due_at', v_due, 'warnings', v_warn);
end $$;

-- ------------------------------------------------------------- check-in (FR-CHK-004, 005, 011, 014; FR-KIT-003/004)
create or replace function app.checkin(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := app.actor_role();
  v_me uuid := app.current_person_id();
  v_loan record; v_line record; v_item record; v_in jsonb;
  v_backdate timestamptz := nullif(p ->> 'backdated_at', '')::timestamptz;
  v_reason text := nullif(btrim(p ->> 'backdate_reason'), '');
  v_at timestamptz;
  v_cond text := nullif(p ->> 'condition_in', '');
  v_photos uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'photo_ids', '[]'::jsonb))::uuid), '{}');
  v_complete boolean := coalesce((p ->> 'complete')::boolean, true);
  v_damage boolean := coalesce((p ->> 'damage')::boolean, false);
  v_create_repair boolean := coalesce((p ->> 'create_repair')::boolean, false);
  v_home uuid := coalesce(nullif(p ->> 'return_location_id', '')::uuid, app.default_home_location_id());
  v_ret int; v_lost int; v_out int; v_worse boolean := false; v_repairs jsonb := '[]'::jsonb; v_incidents jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb; v_missing_required text[] := '{}'; v_id uuid; v_any_returned boolean := false; v_new_status text;
  mp jsonb;
begin
  select * into v_loan from loans where id = (p ->> 'loan_id')::uuid for update;
  if not found then perform app.fail('LOAN_NOT_FOUND', 'loan not found'); end if;
  if v_loan.status not in ('Open','Overdue') then perform app.fail('LOAN_CLOSED', 'this loan is already closed'); end if;
  if v_role is null or v_role = 'Read-only' then perform app.fail('NOT_ALLOWED', 'your role cannot check items in'); end if;
  if v_role = 'Team member' and v_loan.borrower_person_id is distinct from v_me then
    perform app.fail('NOT_ALLOWED', 'Team members can check in only their own loans');
  end if;
  if v_backdate is not null then
    if v_role not in ('Owner','Manager','Service') then perform app.fail('NOT_ALLOWED', 'only a Manager can back-date a check-in'); end if;
    if v_reason is null then perform app.fail('REASON_REQUIRED', 'back-dated check-in needs a reason'); end if;
    if v_backdate > now() then perform app.fail('BAD_DATE', 'back-dated time cannot be in the future'); end if;
    if v_loan.checked_out_at is not null and v_backdate < v_loan.checked_out_at then perform app.fail('BAD_DATE', 'check-in cannot be before check-out'); end if;
  end if;
  v_at := coalesce(v_backdate, now());

  -- kit completeness: required parts not coming back block a "complete" check-in (FR-KIT-003, AC-KIT-02)
  for v_line in select l.*, i.name as item_name from loan_lines l join items i on i.id = l.item_id where l.loan_id = v_loan.id and l.active loop
    v_in := (select e from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) e where (e ->> 'line_id')::uuid = v_line.id);
    v_out := v_line.quantity - v_line.qty_returned - v_line.qty_lost - v_line.qty_transferred;
    v_ret := case when p ? 'lines' then coalesce((v_in ->> 'returned')::int, 0) else v_out end;
    if v_loan.kit_id is not null and v_ret < v_out then
      if coalesce(v_line.required_in_kit, true) then v_missing_required := v_missing_required || (v_line.item_id || ' ' || v_line.item_name);
      else v_warn := v_warn || jsonb_build_array('OPTIONAL_PART_NOT_RETURNED:' || v_line.item_id); end if;
    end if;
  end loop;
  if v_complete and array_length(v_missing_required, 1) > 0 then
    perform app.fail('KIT_INCOMPLETE', 'required parts missing: ' || array_to_string(v_missing_required, ', ') || '. Record a missing part or check in as partial.');
  end if;

  perform app.state_on();
  for v_line in select l.* from loan_lines l where l.loan_id = v_loan.id and l.active order by l.item_id loop
    v_in := (select e from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) e where (e ->> 'line_id')::uuid = v_line.id);
    v_out := v_line.quantity - v_line.qty_returned - v_line.qty_lost - v_line.qty_transferred;
    v_ret := case when p ? 'lines' then coalesce((v_in ->> 'returned')::int, 0) else v_out end;
    v_lost := case when p ? 'lines' then coalesce((v_in ->> 'lost')::int, 0) else 0 end;
    if v_ret < 0 or v_lost < 0 or v_ret + v_lost > v_out then
      perform app.fail('BAD_QTY', format('%s: returned %s + lost %s exceeds %s outstanding', v_line.item_id, v_ret, v_lost, v_out));
    end if;
    continue when v_ret = 0 and v_lost = 0;
    select * into v_item from items where id = v_line.item_id for update;

    if v_ret > 0 then
      v_any_returned := true;
      if exists (select 1 from item_types where name = v_item.type and checkin_photo_required) and not exists (
           select 1 from photos ph where ph.id = any(v_photos) and ph.kind = 'Check-in' and ph.item_id = v_item.id) then
        perform app.fail('PHOTO_REQUIRED', format('%s (%s) needs at least one check-in photo', v_item.id, v_item.type));
      end if;
      v_new_status := case when v_damage and v_create_repair then 'In repair' else 'Available' end;
      if v_item.quantity_mode = 'Single' then
        update items set status = v_new_status, holder_person_id = null, holder_location_id = v_home,
               condition = coalesce(v_cond, condition) where id = v_item.id;
      else
        perform app.take_holding(v_item.id, 'Checked out', v_ret, v_line.id);
        perform app.add_holding(v_item.id, null, v_home, v_new_status, v_ret);
        if v_cond is not null then update items set condition = v_cond where id = v_item.id; end if;
      end if;
      insert into loan_events(loan_id, line_id, item_id, event, quantity, at, by_user, person_id, note)
        values (v_loan.id, v_line.id, v_item.id, 'return', v_ret, v_at, auth.uid(), v_loan.borrower_person_id, v_reason);
      if v_damage and v_create_repair then
        insert into maintenance_events(item_id, type, state, issue_description, quantity, reported_by, reported_by_person_id, linked_loan_id)
        values (v_item.id, 'Repair', 'Reported', coalesce(nullif(p ->> 'damage_description', ''), 'Damage reported at check-in'), v_ret, auth.uid(), v_me, v_loan.id)
        returning id into v_id;
        insert into maintenance_state_history(event_id, from_state, to_state, by_user) values (v_id, null, 'Reported', auth.uid());
        v_repairs := v_repairs || to_jsonb(v_id);
      end if;
    end if;

    if v_lost > 0 then
      if v_item.quantity_mode = 'Single' then
        update items set status = 'Lost', holder_person_id = null, holder_location_id = null where id = v_item.id;
      else
        perform app.take_holding(v_item.id, 'Checked out', v_lost, v_line.id);
        perform app.add_holding(v_item.id, null, null, 'Lost', v_lost);
      end if;
      insert into incidents(item_id, type, quantity, description, reported_by, last_known_holder_person_id, responsible_person_id, linked_loan_id, last_seen_place)
      values (v_item.id, 'Loss', v_lost, coalesce(nullif(p ->> 'lost_description', ''), 'Not returned at check-in; reported lost'),
              auth.uid(), v_loan.borrower_person_id, v_loan.borrower_person_id, v_loan.id, nullif(p ->> 'lost_place', ''))
      returning id into v_id;
      v_incidents := v_incidents || to_jsonb(v_id);
      insert into loan_events(loan_id, line_id, item_id, event, quantity, at, by_user, person_id)
        values (v_loan.id, v_line.id, v_item.id, 'lost', v_lost, v_at, auth.uid(), v_loan.borrower_person_id);
    end if;

    update loan_lines set qty_returned = qty_returned + v_ret, qty_lost = qty_lost + v_lost where id = v_line.id;
    perform app.refresh_counted_status(v_item.id);
    perform app.log_event(case when v_ret > 0 then 'check-in' else 'report-lost' end, 'loans', v_loan.id::text, v_item.id,
      jsonb_build_object('status', v_item.status, 'condition', v_item.condition),
      jsonb_build_object('returned', v_ret, 'lost', v_lost, 'condition_in', v_cond, 'at', v_at), v_reason);
  end loop;

  -- missing parts recorded at check-in (FR-KIT-005, AC-KIT-02)
  for mp in select * from jsonb_array_elements(coalesce(p -> 'missing_parts', '[]'::jsonb)) loop
    insert into missing_parts(item_id, description, quantity, reported_by, loan_id)
    values (mp ->> 'item_id', mp ->> 'description', coalesce((mp ->> 'quantity')::int, 1), auth.uid(), v_loan.id);
  end loop;

  if v_cond is not null and v_loan.condition_out is not null and app.condition_rank(v_cond) < app.condition_rank(v_loan.condition_out) then
    v_worse := true;    -- FR-CHK-005: UI prompts one-tap repair/incident
  end if;

  update photos set loan_id = v_loan.id where id = any(v_photos) and kind = 'Check-in' and loan_id is null;

  if not exists (select 1 from loan_lines where loan_id = v_loan.id and active) then
    update loans set
      status = case when (select sum(qty_lost) from loan_lines where loan_id = v_loan.id) = (select sum(quantity - qty_transferred) from loan_lines where loan_id = v_loan.id) then 'Lost' else 'Returned' end,
      close_reason = case when (select sum(qty_lost) from loan_lines where loan_id = v_loan.id) = (select sum(quantity - qty_transferred) from loan_lines where loan_id = v_loan.id) then 'Lost' else 'Returned' end,
      checked_in_at = v_at, checked_in_by = auth.uid(), condition_in = coalesce(v_cond, condition_in),
      checkin_backdated = v_backdate is not null, checkin_backdate_reason = v_reason,
      accessories_checklist = coalesce(p -> 'accessories', accessories_checklist),
      notes = concat_ws(E'\n', notes, nullif(p ->> 'notes', ''))
    where id = v_loan.id;
  else
    update loans set condition_in = coalesce(v_cond, condition_in),
      accessories_checklist = coalesce(p -> 'accessories', accessories_checklist),
      notes = concat_ws(E'\n', notes, nullif(p ->> 'notes', '')) where id = v_loan.id;
  end if;
  perform app.state_off();
  return jsonb_build_object('loan_id', v_loan.id, 'status', (select status from loans where id = v_loan.id),
    'condition_worse', v_worse, 'repair_ids', v_repairs, 'incident_ids', v_incidents, 'warnings', v_warn);
end $$;

-- ------------------------------------------------------------- transfer (FR-CHK-008, AC-CHK-05)
create or replace function app.transfer_loan(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := app.actor_role(); v_me uuid := app.current_person_id();
  v_old record; v_new uuid; v_to uuid := (p ->> 'to_person_id')::uuid; v_line record; v_newline uuid; v_out int;
  v_reason text := nullif(btrim(p ->> 'reason'), ''); v_due timestamptz := nullif(p ->> 'due_at', '')::timestamptz;
begin
  select * into v_old from loans where id = (p ->> 'loan_id')::uuid for update;
  if not found then perform app.fail('LOAN_NOT_FOUND', 'loan not found'); end if;
  if v_old.status not in ('Open','Overdue') then perform app.fail('LOAN_CLOSED', 'only open loans can be transferred'); end if;
  if v_reason is null then perform app.fail('REASON_REQUIRED', 'a transfer needs a reason'); end if;
  if v_to is null or v_to = v_old.borrower_person_id then perform app.fail('BAD_TARGET', 'choose a different person'); end if;
  if not exists (select 1 from people where id = v_to and active and person_type <> 'Organisation') then perform app.fail('BORROWER_INACTIVE', 'target person inactive'); end if;
  if v_role not in ('Owner','Manager','Service') then
    if v_role = 'Team member' and v_old.borrower_person_id = v_me and exists (select 1 from users where person_id = v_to and active) then
      null; -- D-21: own loan to another login user
    else
      perform app.fail('NOT_ALLOWED', 'only a Manager can transfer this loan');
    end if;
  end if;
  if v_due is null then v_due := greatest(v_old.due_at, now() + interval '1 day'); end if;
  if v_due <= now() then perform app.fail('BAD_DUE', 'due date must be in the future'); end if;
  perform app.state_on();
  insert into loans (kit_id, borrower_person_id, purpose_or_project, checked_out_by, checked_out_at, due_at, condition_out, status, transferred_from_loan_id, notes)
  values (v_old.kit_id, v_to, coalesce(nullif(p ->> 'purpose', ''), v_old.purpose_or_project), auth.uid(), now(), v_due,
          coalesce(nullif(p ->> 'condition', ''), v_old.condition_out, (select condition from items i join loan_lines l on l.item_id = i.id where l.loan_id = v_old.id limit 1), 'Good'), 'Open', v_old.id,
          'Transferred: ' || v_reason)
  returning id into v_new;
  for v_line in select * from loan_lines where loan_id = v_old.id and active order by item_id loop
    v_out := v_line.quantity - v_line.qty_returned - v_line.qty_lost - v_line.qty_transferred;
    update loan_lines set qty_transferred = qty_transferred + v_out where id = v_line.id;   -- old line inactive first (unique guard)
    insert into loan_lines (loan_id, item_id, quantity, required_in_kit, source_person_id)
      values (v_new, v_line.item_id, v_out, v_line.required_in_kit, v_old.borrower_person_id) returning id into v_newline;
    if v_line.is_single then
      update items set holder_person_id = v_to, holder_location_id = null where id = v_line.item_id;
    else
      update item_holdings set loan_line_id = v_newline, holder_person_id = v_to where loan_line_id = v_line.id and status = 'Checked out';
    end if;
    insert into loan_events(loan_id, line_id, item_id, event, quantity, by_user, person_id, note)
      values (v_old.id, v_line.id, v_line.item_id, 'transfer-out', v_out, auth.uid(), v_to, v_reason),
             (v_new, v_newline, v_line.item_id, 'transfer-in', v_out, auth.uid(), v_old.borrower_person_id, v_reason);
    perform app.log_event('transfer', 'loans', v_new::text, v_line.item_id,
      jsonb_build_object('loan_id', v_old.id, 'borrower_person_id', v_old.borrower_person_id),
      jsonb_build_object('loan_id', v_new, 'borrower_person_id', v_to, 'due_at', v_due), v_reason);
  end loop;
  update loans set status = 'Returned', close_reason = 'Transferred', checked_in_at = now(), checked_in_by = auth.uid(), transferred_to_loan_id = v_new
   where id = v_old.id;
  perform app.state_off();
  return jsonb_build_object('loan_id', v_new, 'previous_loan_id', v_old.id);
end $$;

-- ------------------------------------------------------------- extension (FR-CHK-009)
create or replace function app.extend_loan(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text := app.actor_role(); v_l record; v_new timestamptz := (p ->> 'new_due_at')::timestamptz;
  v_reason text := nullif(btrim(p ->> 'reason'), ''); v_max int := coalesce((app.setting('team_max_extensions') #>> '{}')::int, 1);
begin
  select * into v_l from loans where id = (p ->> 'loan_id')::uuid for update;
  if not found then perform app.fail('LOAN_NOT_FOUND', 'loan not found'); end if;
  if v_l.status not in ('Open','Overdue') then perform app.fail('LOAN_CLOSED', 'loan is closed'); end if;
  if v_reason is null then perform app.fail('REASON_REQUIRED', 'an extension needs a reason'); end if;
  if v_new is null or v_new <= now() then perform app.fail('BAD_DUE', 'new due date must be in the future'); end if;
  if v_l.due_at is not null and v_new <= v_l.due_at then perform app.fail('BAD_DUE', 'new due date must be later than the current one'); end if;
  if v_role not in ('Owner','Manager','Service') then
    if v_role = 'Team member' and v_l.borrower_person_id = app.current_person_id() and v_l.extension_count < v_max then null;
    else perform app.fail('NOT_ALLOWED', format('Team members can extend their own loan %s time(s); ask a Manager', v_max)); end if;
  end if;
  insert into loan_extensions(loan_id, old_due_at, new_due_at, reason, by_user) values (v_l.id, v_l.due_at, v_new, v_reason, auth.uid());
  update loans set due_at = v_new, extension_count = extension_count + 1, status = 'Open' where id = v_l.id;
  insert into loan_events(loan_id, event, by_user, note) values (v_l.id, 'extend', auth.uid(), v_reason || ' (new due ' || v_new || ')');
  return jsonb_build_object('loan_id', v_l.id, 'due_at', v_new);
end $$;

-- ------------------------------------------------------------- mark loan lost (FR-LOAN-008)
create or replace function app.mark_loan_lost(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_l record; v_line record; v_out int; v_ids jsonb := '[]'::jsonb; v_id uuid; v_reason text := nullif(btrim(p ->> 'reason'), '');
begin
  if app.actor_role() not in ('Owner','Manager','Service') then perform app.fail('NOT_ALLOWED', 'only a Manager can mark a loan lost'); end if;
  if v_reason is null then perform app.fail('REASON_REQUIRED', 'give a reason'); end if;
  select * into v_l from loans where id = (p ->> 'loan_id')::uuid for update;
  if not found or v_l.status not in ('Open','Overdue') then perform app.fail('LOAN_CLOSED', 'only open loans can be marked lost'); end if;
  perform app.state_on();
  for v_line in select * from loan_lines where loan_id = v_l.id and active loop
    v_out := v_line.quantity - v_line.qty_returned - v_line.qty_lost - v_line.qty_transferred;
    if v_line.is_single then
      update items set status = 'Lost', holder_person_id = null, holder_location_id = null where id = v_line.item_id;
    else
      perform app.take_holding(v_line.item_id, 'Checked out', v_out, v_line.id);
      perform app.add_holding(v_line.item_id, null, null, 'Lost', v_out);
      perform app.refresh_counted_status(v_line.item_id);
    end if;
    update loan_lines set qty_lost = qty_lost + v_out where id = v_line.id;
    insert into incidents(item_id, type, quantity, description, reported_by, last_known_holder_person_id, responsible_person_id, linked_loan_id, last_seen_place, history_known)
      values (v_line.item_id, 'Loss', v_out, v_reason, auth.uid(), v_l.borrower_person_id, v_l.borrower_person_id, v_l.id, nullif(p ->> 'last_seen_place', ''), true)
      returning id into v_id;
    v_ids := v_ids || to_jsonb(v_id);
    insert into loan_events(loan_id, line_id, item_id, event, quantity, by_user, person_id, note)
      values (v_l.id, v_line.id, v_line.item_id, 'lost', v_out, auth.uid(), v_l.borrower_person_id, v_reason);
    perform app.log_event('loan-lost', 'loans', v_l.id::text, v_line.item_id, null, jsonb_build_object('quantity', v_out), v_reason);
  end loop;
  update loans set status = 'Lost', close_reason = 'Lost', checked_in_at = now(), checked_in_by = auth.uid() where id = v_l.id;
  perform app.state_off();
  return jsonb_build_object('loan_id', v_l.id, 'incident_ids', v_ids);
end $$;

-- ------------------------------------------------------------- incidents (FR-LST-001..004)
create or replace function app.report_incident(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text := app.actor_role(); v_item record; v_id uuid; v_type text := p ->> 'type';
  v_qty int := coalesce((p ->> 'quantity')::int, 1); v_mark text := nullif(p ->> 'mark', ''); v_on_loan boolean;
  v_photos uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'photo_ids', '[]'::jsonb))::uuid), '{}');
begin
  if v_role is null or v_role = 'Read-only' then perform app.fail('NOT_ALLOWED', 'your role cannot report incidents'); end if;
  if v_type not in ('Damage','Loss','Theft') then perform app.fail('BAD_TYPE', 'use Damage, Loss or Theft (Found has its own action)'); end if;
  select * into v_item from items where id = p ->> 'item_id' for update;
  if not found then perform app.fail('ITEM_NOT_FOUND', 'item not found'); end if;
  if coalesce(btrim(p ->> 'description'), '') = '' then perform app.fail('DESCRIPTION_REQUIRED', 'describe what happened'); end if;
  if v_mark = 'Lost' and v_role = 'Team member' then v_mark := 'Missing'; end if;   -- D-36: Managers confirm Lost
  select exists (select 1 from loan_lines where item_id = v_item.id and active) into v_on_loan;
  perform app.state_on();
  insert into incidents(item_id, type, quantity, description, history_known, reported_by, last_known_holder_person_id, last_seen_at, last_seen_at_text,
                        last_seen_place, responsible_person_id, linked_loan_id)
  values (v_item.id, v_type, v_qty, p ->> 'description', coalesce((p ->> 'history_known')::boolean, true), auth.uid(),
          coalesce(nullif(p ->> 'last_known_holder_person_id', '')::uuid, v_item.holder_person_id), nullif(p ->> 'last_seen_at', '')::date,
          nullif(p ->> 'last_seen_at_text', ''), nullif(p ->> 'last_seen_place', ''), nullif(p ->> 'responsible_person_id', '')::uuid,
          coalesce(nullif(p ->> 'linked_loan_id', '')::uuid, (select l.loan_id from loan_lines l where l.item_id = v_item.id and l.active limit 1)))
  returning id into v_id;
  update photos set incident_id = v_id where id = any(v_photos);
  if v_type = 'Damage' then
    if v_item.condition is distinct from 'Bad condition' then update items set condition = 'Bad condition' where id = v_item.id; end if;
  elsif v_mark in ('Lost','Missing') and not v_on_loan then
    if v_item.quantity_mode = 'Single' then
      update items set status = v_mark, holder_person_id = null, holder_location_id = null where id = v_item.id;
    else
      perform app.take_holding(v_item.id, 'Available', v_qty, null, nullif(p ->> 'from_person_id', '')::uuid, nullif(p ->> 'from_location_id', '')::uuid);
      perform app.add_holding(v_item.id, null, null, v_mark, v_qty);
      perform app.refresh_counted_status(v_item.id);
    end if;
  end if;
  perform app.state_off();
  return jsonb_build_object('incident_id', v_id, 'on_loan', v_on_loan);
end $$;

-- Found flow (FR-LST-007, AC-LST-03)
create or replace function app.mark_found(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text := app.actor_role(); v_item record; v_qty int := coalesce((p ->> 'quantity')::int, 1);
  v_loc uuid := coalesce(nullif(p ->> 'location_id', '')::uuid, app.default_home_location_id()); v_id uuid; v_from text;
begin
  if v_role is null or v_role = 'Read-only' then perform app.fail('NOT_ALLOWED', 'your role cannot mark items found'); end if;
  if coalesce(btrim(p ->> 'place'), '') = '' then perform app.fail('PLACE_REQUIRED', 'say where it was found'); end if;
  select * into v_item from items where id = p ->> 'item_id' for update;
  if not found then perform app.fail('ITEM_NOT_FOUND', 'item not found'); end if;
  perform app.state_on();
  if v_item.quantity_mode = 'Single' then
    if v_item.status not in ('Lost','Missing') then perform app.fail('NOT_LOST', v_item.id || ' is not Lost or Missing'); end if;
    v_from := v_item.status;
    update items set status = 'Available', holder_location_id = v_loc, holder_person_id = null,
           condition = coalesce(nullif(p ->> 'condition', ''), condition, 'Good') where id = v_item.id;
  else
    v_from := coalesce(nullif(p ->> 'from_status', ''), case when exists (select 1 from item_holdings where item_id = v_item.id and status = 'Missing') then 'Missing' else 'Lost' end);
    perform app.take_holding(v_item.id, v_from, v_qty);
    perform app.add_holding(v_item.id, null, v_loc, 'Available', v_qty);
    perform app.refresh_counted_status(v_item.id);
  end if;
  update incidents set status = 'Resolved', resolution = 'Found', resolved_at = now(), resolved_by = auth.uid(),
         found_by = auth.uid(), found_place = p ->> 'place'
   where item_id = v_item.id and type in ('Loss','Theft') and status <> 'Resolved';
  insert into incidents(item_id, type, quantity, description, reported_by, found_by, found_place, status, resolution, resolved_at, resolved_by)
  values (v_item.id, 'Found', v_qty, coalesce(nullif(p ->> 'note', ''), 'Found'), auth.uid(), auth.uid(), p ->> 'place', 'Resolved', 'Found', now(), auth.uid())
  returning id into v_id;
  perform app.log_event('found', 'items', v_item.id, v_item.id, jsonb_build_object('status', v_from), jsonb_build_object('status', 'Available', 'place', p ->> 'place'));
  perform app.state_off();
  return jsonb_build_object('incident_id', v_id, 'from_status', v_from);
end $$;

-- Resolution (FR-LST-006): Found handled above; Written off needs Owner approval (D-28)
create or replace function app.resolve_incident(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text := app.actor_role(); v_inc record; v_item record; v_res text := p ->> 'resolution'; v_note text := nullif(btrim(p ->> 'note'), '');
begin
  if v_role not in ('Owner','Manager','Service') then perform app.fail('NOT_ALLOWED', 'only Managers resolve incidents'); end if;
  select * into v_inc from incidents where id = (p ->> 'incident_id')::uuid for update;
  if not found then perform app.fail('NOT_FOUND', 'incident not found'); end if;
  if v_inc.status = 'Resolved' then perform app.fail('ALREADY_RESOLVED', 'incident already resolved'); end if;
  if v_res not in ('Written off','Insurance claim','Replaced') then perform app.fail('BAD_RESOLUTION', 'use the Found action for found items'); end if;
  if v_note is null then perform app.fail('REASON_REQUIRED', 'give a reason or note'); end if;
  if v_res = 'Written off' and v_role <> 'Owner' and v_role <> 'Service' then
    update incidents set status = 'Pending write-off', resolution_note = v_note where id = v_inc.id;
    return jsonb_build_object('incident_id', v_inc.id, 'status', 'Pending write-off');
  end if;
  perform app.state_on();
  if v_res = 'Written off' then
    select * into v_item from items where id = v_inc.item_id for update;
    if v_item.quantity_mode = 'Single' then
      update items set status = 'Retired', retired_at = now(), retirement_kind = 'Written off', retired_reason = v_note,
             holder_person_id = null, holder_location_id = null where id = v_item.id;
    else
      perform app.take_holding(v_item.id, 'Lost', v_inc.quantity);
      update items set stock = stock - v_inc.quantity where id = v_item.id;
      perform app.refresh_counted_status(v_item.id);
    end if;
    update incidents set status = 'Resolved', resolution = 'Written off', resolved_at = now(), resolved_by = auth.uid(),
           approved_by = auth.uid(), approved_at = now(), resolution_note = v_note where id = v_inc.id;
  elsif v_res = 'Insurance claim' then
    update incidents set status = 'Resolved', resolution = 'Insurance claim', resolved_at = now(), resolved_by = auth.uid(),
           insurance_claim_ref = nullif(p ->> 'claim_ref', ''), resolution_note = v_note where id = v_inc.id;
  else
    if nullif(p ->> 'wishlist_id', '') is null then perform app.fail('WISHLIST_REQUIRED', 'link the to-buy line for the replacement'); end if;
    update incidents set status = 'Resolved', resolution = 'Replaced', resolved_at = now(), resolved_by = auth.uid(),
           replaced_wishlist_id = (p ->> 'wishlist_id')::uuid, resolution_note = v_note where id = v_inc.id;
  end if;
  perform app.state_off();
  return jsonb_build_object('incident_id', v_inc.id, 'status', 'Resolved', 'resolution', v_res);
end $$;

create or replace function app.decide_writeoff(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_inc record;
begin
  if app.actor_role() <> 'Owner' then perform app.fail('NOT_ALLOWED', 'only the Owner approves write-offs'); end if;
  select * into v_inc from incidents where id = (p ->> 'incident_id')::uuid for update;
  if v_inc.status <> 'Pending write-off' then perform app.fail('NOT_PENDING', 'incident is not pending write-off'); end if;
  if coalesce((p ->> 'approve')::boolean, false) then
    return app.resolve_incident(jsonb_build_object('incident_id', v_inc.id, 'resolution', 'Written off',
           'note', concat_ws(' / ', v_inc.resolution_note, nullif(p ->> 'comment', ''))));
  end if;
  update incidents set status = 'Open', resolution_note = concat_ws(' / ', resolution_note, 'Write-off rejected: ' || coalesce(p ->> 'comment', '')) where id = v_inc.id;
  return jsonb_build_object('incident_id', v_inc.id, 'status', 'Open');
end $$;

-- ------------------------------------------------------------- maintenance (FR-CON-002..005, D-37)
create or replace function app.maint_blocks(p_type text, p_state text) returns boolean language sql immutable as $$
  select (p_type = 'Repair' and p_state not in ('Returned','Closed')) or p_state in ('Sent for repair','In repair') $$;

create or replace function app.open_maintenance(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_item record; v_id uuid; v_type text := p ->> 'type'; v_state text := coalesce(nullif(p ->> 'state', ''), 'Reported');
  v_qty int := coalesce((p ->> 'quantity')::int, 1); v_on_loan boolean;
begin
  if app.actor_role() not in ('Owner','Manager','Service') then perform app.fail('NOT_ALLOWED', 'only Managers create repairs'); end if;
  if coalesce(btrim(p ->> 'issue_description'), '') = '' then perform app.fail('DESCRIPTION_REQUIRED', 'describe the issue'); end if;
  select * into v_item from items where id = p ->> 'item_id' for update;
  if not found then perform app.fail('ITEM_NOT_FOUND', 'item not found'); end if;
  select exists (select 1 from loan_lines where item_id = v_item.id and active) into v_on_loan;
  perform app.state_on();
  insert into maintenance_events(item_id, type, state, issue_description, cause, quantity, reported_by, reported_by_person_id, vendor, sent_at, expected_back,
                                 linked_loan_id, linked_incident_id, event_date, outcome)
  values (v_item.id, v_type, v_state, p ->> 'issue_description', nullif(p ->> 'cause', ''), v_qty, auth.uid(), app.current_person_id(),
          nullif(p ->> 'vendor', ''), nullif(p ->> 'sent_at', '')::date, nullif(p ->> 'expected_back', '')::date,
          nullif(p ->> 'linked_loan_id', '')::uuid, nullif(p ->> 'linked_incident_id', '')::uuid, nullif(p ->> 'event_date', '')::date, nullif(p ->> 'outcome', ''))
  returning id into v_id;
  insert into maintenance_state_history(event_id, from_state, to_state, by_user, note) values (v_id, null, v_state, auth.uid(), nullif(p ->> 'note', ''));
  if p ? 'cost' and nullif(p ->> 'cost', '') is not null then
    if not app.can_view_financials() then perform app.fail('NOT_ALLOWED', 'you cannot record costs'); end if;
    insert into maintenance_costs(event_id, cost) values (v_id, (p ->> 'cost')::numeric);
  end if;
  if app.maint_blocks(v_type, v_state) and not v_on_loan then
    if v_item.quantity_mode = 'Single' then
      if v_item.status in ('Available','Reserved') then update items set status = 'In repair' where id = v_item.id; end if;
    else
      perform app.take_holding(v_item.id, 'Available', v_qty);
      perform app.add_holding(v_item.id, null, app.default_home_location_id(), 'In repair', v_qty);
      perform app.refresh_counted_status(v_item.id);
    end if;
  end if;
  perform app.state_off();
  return jsonb_build_object('event_id', v_id);
end $$;

create or replace function app.advance_maintenance(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_e record; v_item record; v_to text := p ->> 'to_state'; v_order text[] := array['Reported','Sent for repair','In repair','Returned','Closed'];
  v_was boolean; v_now boolean; v_other boolean;
begin
  if app.actor_role() not in ('Owner','Manager','Service') then perform app.fail('NOT_ALLOWED', 'only Managers update repairs'); end if;
  select * into v_e from maintenance_events where id = (p ->> 'event_id')::uuid for update;
  if not found then perform app.fail('NOT_FOUND', 'event not found'); end if;
  if v_to is not null and array_position(v_order, v_to) is null then perform app.fail('BAD_STATE', 'unknown state'); end if;
  if v_to is not null and array_position(v_order, v_to) < array_position(v_order, v_e.state) then
    perform app.fail('BAD_TRANSITION', format('cannot move from %s back to %s', v_e.state, v_to));
  end if;
  select * into v_item from items where id = v_e.item_id for update;
  perform app.state_on();
  update maintenance_events set
    state = coalesce(v_to, state),
    vendor = coalesce(nullif(p ->> 'vendor', ''), vendor),
    sent_at = coalesce(nullif(p ->> 'sent_at', '')::date, sent_at, case when v_to = 'Sent for repair' then current_date end),
    expected_back = coalesce(nullif(p ->> 'expected_back', '')::date, expected_back),
    returned_at = coalesce(nullif(p ->> 'returned_at', '')::date, returned_at, case when v_to = 'Returned' then current_date end),
    outcome = coalesce(nullif(p ->> 'outcome', ''), outcome),
    cause = coalesce(nullif(p ->> 'cause', ''), cause),
    closed_at = case when v_to = 'Closed' then now() else closed_at end
  where id = v_e.id;
  if p ? 'cost' and nullif(p ->> 'cost', '') is not null then
    if not app.can_view_financials() then perform app.fail('NOT_ALLOWED', 'you cannot record costs'); end if;
    insert into maintenance_costs(event_id, cost) values (v_e.id, (p ->> 'cost')::numeric)
      on conflict (event_id) do update set cost = excluded.cost;
  end if;
  if v_to is not null and v_to <> v_e.state then
    insert into maintenance_state_history(event_id, from_state, to_state, by_user, note) values (v_e.id, v_e.state, v_to, auth.uid(), nullif(p ->> 'note', ''));
  end if;
  v_was := app.maint_blocks(v_e.type, v_e.state);
  v_now := app.maint_blocks(v_e.type, coalesce(v_to, v_e.state));
  select exists (select 1 from maintenance_events where item_id = v_e.item_id and id <> v_e.id and app.maint_blocks(type, state)) into v_other;
  if v_item.quantity_mode = 'Single' then
    if v_now and v_item.status = 'Available' then update items set status = 'In repair' where id = v_item.id; end if;
    if not v_now and not v_other and v_item.status = 'In repair' then
      update items set status = 'Available', holder_person_id = null, holder_location_id = coalesce(holder_location_id, app.default_home_location_id()),
             condition = coalesce(nullif(p ->> 'condition_after', ''), condition) where id = v_item.id;
    end if;
  else
    if v_now and not v_was then
      perform app.take_holding(v_item.id, 'Available', v_e.quantity);
      perform app.add_holding(v_item.id, null, app.default_home_location_id(), 'In repair', v_e.quantity);
    elsif v_was and not v_now then
      perform app.take_holding(v_item.id, 'In repair', least(v_e.quantity, (select coalesce(sum(quantity),0)::int from item_holdings where item_id = v_item.id and status = 'In repair')));
      perform app.add_holding(v_item.id, null, app.default_home_location_id(), 'Available', least(v_e.quantity, v_e.quantity));
    end if;
    perform app.refresh_counted_status(v_item.id);
  end if;
  perform app.state_off();
  return jsonb_build_object('event_id', v_e.id, 'state', coalesce(v_to, v_e.state));
end $$;

-- ------------------------------------------------------------- retirement and deletion (FR-CAT-013, section 9, D-20)
create or replace function app.request_retirement(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text := app.actor_role(); v_id uuid;
begin
  if v_role not in ('Owner','Manager') then perform app.fail('NOT_ALLOWED', 'only Managers propose retirement'); end if;
  if coalesce(btrim(p ->> 'reason'), '') = '' then perform app.fail('REASON_REQUIRED', 'give a reason'); end if;
  if exists (select 1 from retirement_requests where item_id = p ->> 'item_id' and status = 'Pending') then
    perform app.fail('ALREADY_PENDING', 'a retirement request is already pending');
  end if;
  insert into retirement_requests(item_id, kind, reason, requested_by) values (p ->> 'item_id', p ->> 'kind', p ->> 'reason', auth.uid()) returning id into v_id;
  if v_role = 'Owner' then
    return app.decide_retirement(jsonb_build_object('request_id', v_id, 'approve', true, 'comment', 'Owner action'));
  end if;
  return jsonb_build_object('request_id', v_id, 'status', 'Pending');
end $$;

create or replace function app.decide_retirement(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_r record;
begin
  if app.actor_role() <> 'Owner' then perform app.fail('NOT_ALLOWED', 'only the Owner approves retirement, sale or write-off'); end if;
  select * into v_r from retirement_requests where id = (p ->> 'request_id')::uuid for update;
  if not found or v_r.status <> 'Pending' then perform app.fail('NOT_PENDING', 'request is not pending'); end if;
  if coalesce((p ->> 'approve')::boolean, false) then
    perform 1 from items where id = v_r.item_id for update;
    if exists (select 1 from loan_lines where item_id = v_r.item_id and active) then perform app.fail('ON_LOAN', 'check the item in first'); end if;
    perform app.state_on();
    update items set status = 'Retired', retired_at = now(), retirement_kind = v_r.kind, retired_reason = v_r.reason where id = v_r.item_id;
    update retirement_requests set status = 'Approved', decided_by = auth.uid(), decided_at = now(), decision_comment = p ->> 'comment' where id = v_r.id;
    perform app.state_off();
  else
    update retirement_requests set status = 'Rejected', decided_by = auth.uid(), decided_at = now(), decision_comment = p ->> 'comment' where id = v_r.id;
  end if;
  return jsonb_build_object('request_id', v_r.id, 'status', (select status from retirement_requests where id = v_r.id));
end $$;

create or replace function app.delete_item_created_in_error(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_item record; v_reason text := nullif(btrim(p ->> 'reason'), '');
begin
  if app.actor_role() <> 'Owner' then perform app.fail('NOT_ALLOWED', 'only the Owner can delete an item record'); end if;
  if v_reason is null then perform app.fail('REASON_REQUIRED', 'say why the record was created in error'); end if;
  select * into v_item from items where id = p ->> 'item_id' for update;
  if not found then perform app.fail('ITEM_NOT_FOUND', 'item not found'); end if;
  if exists (select 1 from loan_lines where item_id = v_item.id) or exists (select 1 from maintenance_events where item_id = v_item.id)
     or exists (select 1 from incidents where item_id = v_item.id) or exists (select 1 from audit_lines where item_id = v_item.id)
     or exists (select 1 from order_line_items where item_id = v_item.id) or exists (select 1 from kit_items where item_id = v_item.id)
     or exists (select 1 from items where parent_item_id = v_item.id or case_item_id = v_item.id) or v_item.imported then
    perform app.fail('HAS_HISTORY', 'this item has history or was imported; retire it instead');
  end if;
  perform set_config('app.reason', v_reason, true);
  perform app.log_event('delete-created-in-error', 'items', v_item.id, v_item.id, to_jsonb(v_item), null, v_reason);
  perform app.state_on();
  update items set stock_image_photo_id = null, latest_photo_id = null where id = v_item.id;
  delete from items where id = v_item.id;
  perform app.state_off();
  return jsonb_build_object('deleted', v_item.id);
end $$;

-- ------------------------------------------------------------- stock adjustment (walkthrough corrections, import review; D-06)
create or replace function app.adjust_stock(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_item record; h jsonb; v_reason text := nullif(btrim(p ->> 'reason'), ''); v_before jsonb; v_loan_qty int; v_stock int;
begin
  if app.actor_role() not in ('Owner','Manager','Service') then perform app.fail('NOT_ALLOWED', 'only Managers adjust stock'); end if;
  if v_reason is null then perform app.fail('REASON_REQUIRED', 'stock changes need a reason'); end if;
  select * into v_item from items where id = p ->> 'item_id' for update;
  if not found then perform app.fail('ITEM_NOT_FOUND', 'item not found'); end if;
  if v_item.quantity_mode <> 'Counted' then perform app.fail('NOT_COUNTED', 'only Counted items have holdings'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) - 'updated_at'), '[]') into v_before from item_holdings x where item_id = v_item.id;
  perform app.state_on();
  delete from item_holdings where item_id = v_item.id and loan_line_id is null;
  for h in select * from jsonb_array_elements(coalesce(p -> 'holdings', '[]'::jsonb)) loop
    if (h ->> 'status') = 'Checked out' then perform app.fail('BAD_STATUS', 'checked-out units move only through loans'); end if;
    perform app.add_holding(v_item.id, nullif(h ->> 'person_id', '')::uuid, nullif(h ->> 'location_id', '')::uuid, h ->> 'status', (h ->> 'quantity')::int);
  end loop;
  select coalesce(sum(quantity), 0) into v_stock from item_holdings where item_id = v_item.id;
  update items set stock = v_stock,
         stock_to_verify = coalesce((p ->> 'stock_to_verify')::boolean, false),
         stock_to_verify_reason = case when coalesce((p ->> 'stock_to_verify')::boolean, false) then stock_to_verify_reason end
   where id = v_item.id;
  perform app.refresh_counted_status(v_item.id);
  perform app.log_event('adjust-stock', 'item_holdings', v_item.id, v_item.id, jsonb_build_object('stock', v_item.stock, 'holdings', v_before),
    jsonb_build_object('stock', v_stock, 'holdings', p -> 'holdings'), v_reason);
  perform app.state_off();
  return jsonb_build_object('item_id', v_item.id, 'stock', v_stock);
end $$;

-- move a Single item to a location/person without a loan (custodian, Manager only)
create or replace function app.set_custodian(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_item record; v_reason text := nullif(btrim(p ->> 'reason'), '');
begin
  if app.actor_role() not in ('Owner','Manager','Service') then perform app.fail('NOT_ALLOWED', 'only Managers change custody'); end if;
  if v_reason is null then perform app.fail('REASON_REQUIRED', 'give a reason'); end if;
  select * into v_item from items where id = p ->> 'item_id' for update;
  if v_item.quantity_mode <> 'Single' then perform app.fail('NOT_SINGLE', 'use stock adjustment for Counted items'); end if;
  if exists (select 1 from loan_lines where item_id = v_item.id and active) then perform app.fail('ON_LOAN', 'item is on a loan; check it in or transfer'); end if;
  if v_item.status not in ('Available') then perform app.fail('NOT_AVAILABLE', 'item must be Available'); end if;
  perform app.state_on();
  update items set holder_person_id = nullif(p ->> 'person_id', '')::uuid, holder_location_id = nullif(p ->> 'location_id', '')::uuid where id = v_item.id;
  perform app.log_event('set-custodian', 'items', v_item.id, v_item.id,
    jsonb_build_object('holder_person_id', v_item.holder_person_id, 'holder_location_id', v_item.holder_location_id),
    jsonb_build_object('holder_person_id', p ->> 'person_id', 'holder_location_id', p ->> 'location_id'), v_reason);
  perform app.state_off();
  return jsonb_build_object('item_id', v_item.id);
end $$;

-- ------------------------------------------------------------- to-buy decisions (FR-BUY-005, 009)
create or replace function app.decide_wishlist(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_w record; v_approve boolean := coalesce((p ->> 'approve')::boolean, false);
begin
  if app.actor_role() <> 'Owner' then perform app.fail('NOT_ALLOWED', 'only the Owner approves or rejects purchases'); end if;
  select * into v_w from wishlist_items where id = (p ->> 'wishlist_id')::uuid for update;
  if not found then perform app.fail('NOT_FOUND', 'to-buy line not found'); end if;
  if v_w.status not in ('To research','To buy') then perform app.fail('BAD_STATUS', 'only To research / To buy lines can be decided'); end if;
  if v_approve and v_w.verify_first and v_w.verified_at is null then perform app.fail('VERIFY_FIRST', 'this line must be verified before approval'); end if;
  if not v_approve and coalesce(btrim(p ->> 'comment'), '') = '' then perform app.fail('COMMENT_REQUIRED', 'give a comment when rejecting'); end if;
  if v_approve then
    update wishlist_items set status = 'Approved', approved_by = auth.uid(), approved_at = now(), decision_comment = nullif(p ->> 'comment', '') where id = v_w.id;
  else
    update wishlist_items set status = 'Rejected', rejected_by = auth.uid(), rejected_at = now(), decision_comment = p ->> 'comment' where id = v_w.id;
  end if;
  return jsonb_build_object('wishlist_id', v_w.id, 'status', case when v_approve then 'Approved' else 'Rejected' end);
end $$;

create or replace function app.verify_wishlist(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if app.actor_role() not in ('Owner','Manager') then perform app.fail('NOT_ALLOWED', 'only Managers record verification'); end if;
  if coalesce(btrim(p ->> 'result'), '') = '' then perform app.fail('RESULT_REQUIRED', 'record what was verified'); end if;
  update wishlist_items set verified_by = auth.uid(), verified_at = now(), verification_result = p ->> 'result' where id = (p ->> 'wishlist_id')::uuid;
  return jsonb_build_object('wishlist_id', p ->> 'wishlist_id');
end $$;

-- Receive an order and create items in one step (FR-BUY-007, AC-BUY-03)
create or replace function app.receive_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_o record; ln jsonb; it jsonb; v_line record; v_new text; v_created jsonb := '[]'::jsonb; v_qty int; v_home uuid := app.default_home_location_id();
  v_mode text; v_stock int;
begin
  if app.actor_role() not in ('Owner','Manager','Service') then perform app.fail('NOT_ALLOWED', 'only Managers receive orders'); end if;
  select * into v_o from orders where id = (p ->> 'order_id')::uuid for update;
  if not found then perform app.fail('NOT_FOUND', 'order not found'); end if;
  if v_o.status = 'Cancelled' then perform app.fail('CANCELLED', 'order was cancelled'); end if;
  perform app.state_on();
  for ln in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) loop
    select * into v_line from order_lines where id = (ln ->> 'order_line_id')::uuid and order_id = v_o.id for update;
    if not found then perform app.fail('NOT_FOUND', 'order line not found'); end if;
    v_qty := coalesce((ln ->> 'quantity')::int, v_line.quantity - v_line.received_qty);
    if v_qty <= 0 or v_line.received_qty + v_qty > v_line.quantity then perform app.fail('BAD_QTY', 'received quantity exceeds ordered'); end if;
    for it in select * from jsonb_array_elements(coalesce(ln -> 'items', '[]'::jsonb)) loop
      v_mode := coalesce(nullif(it ->> 'quantity_mode', ''), 'Single');
      v_stock := case when v_mode = 'Single' then 1 else coalesce((it ->> 'stock')::int, 1) end;
      insert into items(id, name, model_number, brand, type, subtype, quantity_mode, stock, status, condition, owner_person_id,
                        holder_location_id, home_location_id, serial_number, notes, created_by, to_verify, to_verify_reason)
      values (null, btrim(regexp_replace(it ->> 'name', '\s+', ' ', 'g')), nullif(it ->> 'model_number', ''), nullif(it ->> 'brand', ''), it ->> 'type',
              nullif(it ->> 'subtype', ''), v_mode, v_stock, 'Available', coalesce(nullif(it ->> 'condition', ''), 'Good'), app.madtown_person_id(),
              case when v_mode = 'Single' then coalesce(nullif(it ->> 'home_location_id', '')::uuid, v_home) end,
              coalesce(nullif(it ->> 'home_location_id', '')::uuid, v_home), nullif(it ->> 'serial_number', ''),
              'Received on order ' || v_o.order_ref || ' from ' || v_o.vendor, auth.uid(), true, 'New item: add stock photo and print QR label')
      returning id into v_new;
      if v_mode = 'Counted' then perform app.add_holding(v_new, null, coalesce(nullif(it ->> 'home_location_id', '')::uuid, v_home), 'Available', v_stock); end if;
      insert into item_financials(item_id, purchase_date, vendor, order_ref, purchase_price, invoice_photo_id)
      values (v_new, coalesce(nullif(p ->> 'delivered_at', '')::date, current_date), v_o.vendor, v_o.order_ref, nullif(it ->> 'purchase_price', '')::numeric,
              (select invoice_photo_id from order_financials where order_id = v_o.id));
      insert into order_line_items(order_line_id, item_id) values (v_line.id, v_new);
      if v_line.wishlist_id is not null then
        insert into wishlist_related_items(wishlist_id, item_id) values (v_line.wishlist_id, v_new) on conflict do nothing;
      end if;
      v_created := v_created || to_jsonb(v_new);
    end loop;
    update order_lines set received_qty = received_qty + v_qty where id = v_line.id;
    if v_line.wishlist_id is not null and v_line.received_qty + v_qty >= v_line.quantity then
      update wishlist_items set status = 'Received' where id = v_line.wishlist_id;
    end if;
  end loop;
  update orders set
    status = case when exists (select 1 from order_lines where order_id = v_o.id and received_qty < quantity) then 'Partially delivered' else 'Delivered' end,
    delivered_at = coalesce(nullif(p ->> 'delivered_at', '')::date, current_date)
  where id = v_o.id;
  perform app.log_event('receive-order', 'orders', v_o.id::text, null, null, jsonb_build_object('items_created', v_created));
  perform app.state_off();
  return jsonb_build_object('order_id', v_o.id, 'items_created', v_created, 'status', (select status from orders where id = v_o.id));
end $$;

-- ------------------------------------------------------------- walkthrough (FR-AUD-003..008)
create or replace function app.record_audit_line(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_a record; v_item record; v_id uuid; v_exp int; q record;
begin
  if app.actor_role() not in ('Owner','Manager','Team member','Service') then perform app.fail('NOT_ALLOWED', 'your role cannot scan in a walkthrough'); end if;
  select * into v_a from audits where id = (p ->> 'audit_id')::uuid;
  if not found or v_a.status <> 'Open' then perform app.fail('AUDIT_CLOSED', 'walkthrough is not open'); end if;
  select * into v_item from items where id = p ->> 'item_id';
  if not found then perform app.fail('ITEM_NOT_FOUND', 'item not found'); end if;
  select * into q from app.item_quantities(v_item.id);
  v_exp := case when v_item.quantity_mode = 'Counted' then v_item.stock - q.lost_qty - q.out_qty else 1 end;
  insert into audit_lines(audit_id, item_id, result, expected_qty, counted_qty, condition_seen, location_seen_id, photo_id, note, scanned_by)
  values (v_a.id, v_item.id, p ->> 'result', v_exp, nullif(p ->> 'counted_qty', '')::int, nullif(p ->> 'condition_seen', ''),
          nullif(p ->> 'location_seen_id', '')::uuid, nullif(p ->> 'photo_id', '')::uuid, nullif(p ->> 'note', ''), auth.uid())
  on conflict (audit_id, item_id) do update set result = excluded.result, counted_qty = excluded.counted_qty, condition_seen = excluded.condition_seen,
     location_seen_id = excluded.location_seen_id, photo_id = coalesce(excluded.photo_id, audit_lines.photo_id), note = coalesce(excluded.note, audit_lines.note),
     scanned_by = excluded.scanned_by, scanned_at = now(), expected_qty = excluded.expected_qty
  returning id into v_id;
  if (p ->> 'result') <> 'Not found' then
    perform app.state_on();
    update items set last_audited_at = now() where id = v_item.id;
    perform app.state_off();
  end if;
  return jsonb_build_object('line_id', v_id, 'expected_qty', v_exp, 'found_candidate', v_item.status in ('Lost','Missing') and (p ->> 'result') <> 'Not found');
end $$;

create or replace function app.apply_audit_correction(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_l record; v_item record; v_reason text; v_kind text := p ->> 'action';
begin
  if app.actor_role() not in ('Owner','Manager') then perform app.fail('NOT_ALLOWED', 'only Managers apply walkthrough corrections'); end if;
  select al.*, a.started_at into v_l from audit_lines al join audits a on a.id = al.audit_id where al.id = (p ->> 'line_id')::uuid for update of al;
  if not found then perform app.fail('NOT_FOUND', 'line not found'); end if;
  if v_l.correction_applied then perform app.fail('ALREADY_APPLIED', 'correction already applied'); end if;
  v_reason := 'Walkthrough ' || to_char(v_l.started_at at time zone 'Asia/Kolkata', 'DD Mon YYYY') || coalesce(': ' || nullif(p ->> 'note', ''), '');
  perform set_config('app.reason', v_reason, true);
  select * into v_item from items where id = v_l.item_id for update;
  if v_kind = 'set_count' then
    perform app.adjust_stock(jsonb_build_object('item_id', v_item.id, 'reason', v_reason, 'holdings', p -> 'holdings'));
  elsif v_kind = 'set_condition' then
    update items set condition = v_l.condition_seen where id = v_item.id;
  elsif v_kind = 'set_location' then
    perform app.state_on();
    if v_item.quantity_mode = 'Single' then update items set holder_location_id = v_l.location_seen_id, holder_person_id = null, home_location_id = coalesce(nullif(p ->> 'home', '')::uuid, home_location_id) where id = v_item.id; end if;
    perform app.state_off();
  elsif v_kind = 'mark_missing' then
    perform app.report_incident(jsonb_build_object('item_id', v_item.id, 'type', 'Loss', 'mark', 'Missing',
            'description', 'Not found during walkthrough', 'quantity', greatest(coalesce(v_l.expected_qty, 1) - coalesce(v_l.counted_qty, 0), 1)));
  elsif v_kind = 'none' then null;
  else perform app.fail('BAD_ACTION', 'unknown correction');
  end if;
  update audit_lines set correction_applied = true, correction_note = coalesce(nullif(p ->> 'note', ''), v_kind) where id = v_l.id;
  perform app.log_event('walkthrough-correction', 'audit_lines', v_l.id::text, v_item.id, null, jsonb_build_object('action', v_kind), v_reason);
  return jsonb_build_object('line_id', v_l.id);
end $$;

-- ------------------------------------------------------------- split Counted into Single units (FR-CAT-007, D-17)
create or replace function app.split_counted(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_item record; h record; n int := 0; v_new text; v_created jsonb := '[]'::jsonb; i int;
begin
  if app.actor_role() not in ('Owner','Manager') then perform app.fail('NOT_ALLOWED', 'only Managers split items'); end if;
  if not coalesce((app.setting('split_enabled') #>> '{}')::boolean, false) then perform app.fail('DISABLED', 'splitting is disabled until the suffix format is approved'); end if;
  select * into v_item from items where id = p ->> 'item_id' for update;
  if v_item.quantity_mode <> 'Counted' then perform app.fail('NOT_COUNTED', 'only Counted items can be split'); end if;
  if v_item.id ~ '-' then perform app.fail('NESTED', 'unit records cannot be split again'); end if;
  if exists (select 1 from loan_lines where item_id = v_item.id and active) then perform app.fail('ON_LOAN', 'check in all units before splitting'); end if;
  perform app.state_on();
  perform set_config('app.explicit_id', 'on', true);
  for h in select * from item_holdings where item_id = v_item.id and status <> 'Lost' order by status, holder_location_id nulls last loop
    for i in 1..h.quantity loop
      n := n + 1;
      v_new := v_item.id || '-' || lpad(n::text, 2, '0');
      insert into items(id, name, model_number, model_tbd, brand, type, subtype, quantity_mode, stock, status, condition, owner_person_id,
                        holder_person_id, holder_location_id, home_location_id, parent_item_id, notes, created_by)
      values (v_new, v_item.name || ' #' || lpad(n::text, 2, '0'), v_item.model_number, v_item.model_tbd, v_item.brand, v_item.type, v_item.subtype,
              'Single', 1, case when h.status = 'Available' then 'Available' else h.status end, v_item.condition, v_item.owner_person_id,
              h.holder_person_id, h.holder_location_id, v_item.home_location_id, v_item.id, 'Unit split from ' || v_item.id, auth.uid());
      v_created := v_created || to_jsonb(v_new);
    end loop;
  end loop;
  perform set_config('app.explicit_id', 'off', true);
  update items set status = 'Retired', retired_at = now(), retirement_kind = 'Split', retired_reason = 'Split into ' || n || ' tagged units' where id = v_item.id;
  perform app.log_event('split', 'items', v_item.id, v_item.id, null, jsonb_build_object('units', v_created), p ->> 'reason');
  perform app.state_off();
  return jsonb_build_object('item_id', v_item.id, 'units', v_created);
end $$;

-- ------------------------------------------------------------- jobs
create or replace function app.job_mark_overdue() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update loans set status = 'Overdue' where status = 'Open' and due_at is not null and due_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- users: offboarding (NFR-006)
create or replace function app.deactivate_user(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if app.actor_role() <> 'Owner' then perform app.fail('NOT_ALLOWED', 'only the Owner manages users'); end if;
  if (p ->> 'user_id')::uuid = auth.uid() then perform app.fail('SELF', 'you cannot deactivate yourself'); end if;
  update users set active = false, session_version = session_version + 1, deactivated_at = now(), deactivated_by = auth.uid()
   where id = (p ->> 'user_id')::uuid;
  return jsonb_build_object('user_id', p ->> 'user_id', 'active', false);
end $$;

-- item-level audit history for Owner and Managers (D-03); finance rows only for finance viewers
create or replace function app.item_audit(p_item text) returns setof public.audit_log
language sql stable security definer set search_path = public as $$
  select * from audit_log a
   where app.is_manager()
     and (a.item_id = p_item or (a.table_name in ('loans','loan_lines') and a.record_id in (select loan_id::text from loan_lines where item_id = p_item)))
     and (app.can_view_financials() or a.table_name not in ('item_financials','maintenance_costs','order_financials','wishlist_options','wishlist_financials','item_import_raw'))
   order by a.at desc, a.id desc
$$;
