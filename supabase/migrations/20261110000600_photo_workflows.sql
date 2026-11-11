-- FR-PHO-005: promote a photo to Latest (previous stays in history). FR-PHO-007: Manager picks stock image.
create or replace function app.promote_latest_photo(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ph record; v_role text := app.actor_role();
begin
  if v_role is null or v_role = 'Read-only' then perform app.fail('NOT_ALLOWED', 'your role cannot change photos'); end if;
  select * into v_ph from photos where id = (p ->> 'photo_id')::uuid;
  if not found or v_ph.item_id is null then perform app.fail('NOT_FOUND', 'photo not found'); end if;
  if v_ph.kind not in ('Check-in','Latest','Audit','Damage','Check-out') then perform app.fail('BAD_KIND', 'only real photos of the item can become the latest photo'); end if;
  if v_role = 'Team member' and v_ph.taken_by is distinct from auth.uid() then perform app.fail('NOT_ALLOWED', 'Team members can promote only photos they took'); end if;
  update items set latest_photo_id = v_ph.id where id = v_ph.item_id;
  return jsonb_build_object('item_id', v_ph.item_id, 'latest_photo_id', v_ph.id);
end $$;

create or replace function app.set_stock_image(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ph record;
begin
  if app.actor_role() not in ('Owner','Manager') then perform app.fail('NOT_ALLOWED', 'only Managers set the stock image'); end if;
  select * into v_ph from photos where id = (p ->> 'photo_id')::uuid;
  if not found or v_ph.item_id is null or v_ph.kind <> 'Stock' then perform app.fail('NOT_FOUND', 'stock photo not found'); end if;
  update items set stock_image_photo_id = v_ph.id where id = v_ph.item_id;
  return jsonb_build_object('item_id', v_ph.item_id);
end $$;
grant execute on function app.promote_latest_photo(jsonb), app.set_stock_image(jsonb) to authenticated, service_role;
