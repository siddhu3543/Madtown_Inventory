-- Reference data and default settings. Every default that the source marks "to confirm" is
-- flagged in docs/DECISIONS.md and editable by the Owner in Settings (SCR-22).

insert into public.id_counters(name, next_value) values ('item', 204), ('kit', 1)   -- FR-CAT-001: new items from MTMH_204
on conflict (name) do nothing;

insert into public.people(name, person_type, is_madtown, notes)
values ('Madtown', 'Organisation', true, 'Default owner of all items (FR-CAT-008)')
on conflict do nothing;

insert into public.locations(name, location_type, is_default_home, notes)
values ('Office', 'Office', true, 'Sheet Posession "Madtown" = office store. Which office (Rushikonda?) to confirm: OQ-N-18')
on conflict do nothing;

-- FR-CAT-003 Types (sheet list). FR-CHK-002 defaults (2 d camera, 7 d tripod per Sheldon Cooper; others placeholder, D-13).
-- FR-CHK-003 photo rule Camera/Lens/Drone; check-in rule per D-14. FR-CON-006 camera service every 6 months (proposal).
insert into public.item_types(name, sort, default_loan_days, loan_days_confirmed, checkout_photo_required, checkin_photo_required, service_interval_days) values
  ('Camera', 10, 2, false, true, true, 180),
  ('Lens', 20, 7, false, true, true, null),
  ('Audio', 30, 7, false, false, false, null),
  ('Light', 40, 7, false, false, false, null),
  ('Light accessory', 50, 7, false, false, false, null),
  ('Accessory', 60, 7, false, false, false, null),
  ('Tripod', 70, 7, false, false, false, null),
  ('Stand', 80, 7, false, false, false, null),
  ('Reflector', 90, 7, false, false, false, null),
  ('Backdrop', 100, 7, false, false, false, null),
  ('SD Card', 110, 7, false, false, false, null),
  ('Battery', 120, 7, false, false, false, null),
  ('Drone', 130, 7, false, true, true, null)
on conflict (name) do nothing;

-- FR-CAT-004 / 6.2 proposed subtypes (list to be confirmed)
insert into public.item_subtypes(name, sort) values
  ('Bag or case', 10), ('Charger', 20), ('Card reader', 30), ('Filter', 40), ('Rig part', 50),
  ('Clamp or mount', 60), ('Gimbal', 70), ('Monitor', 80), ('Cable', 90), ('Other', 100)
on conflict (name) do nothing;

-- FR-CON-001 / D-09: Good and Bad condition from the sheet; Fair and New proposed, disabled until OQ-N-16 answered
insert into public.conditions(name, rank, enabled, source_note) values
  ('New', 4, false, 'Proposed by Sheldon Cooper (OQ-N-16)'),
  ('Good', 3, true, 'Sheet (82 rows)'),
  ('Fair', 2, false, 'Proposed by Sheldon Cooper (OQ-N-16)'),
  ('Bad condition', 1, true, 'Sheet (8 rows)')
on conflict (name) do nothing;

insert into public.settings(key, value, description) values
  ('finance_roles', '["Manager","Read-only"]', 'D-04 / OQ-N-07: roles that see purchase prices, repair costs and asset value (Owner always). To confirm.'),
  ('overdue_policy', '"block_team_override_manager"', 'D-05: block_team_override_manager | warn_only'),
  ('team_max_extensions', '1', 'D-21: Team members may extend their own loan this many times ("extend once, to confirm")'),
  ('team_can_propose', 'true', 'Section 9: Team members propose to-buy lines ("to confirm")'),
  ('split_enabled', 'true', 'D-17: allow splitting Counted items into MTMH_NNN-01 units (proposal pending approval; set false in production until approved)'),
  ('escalation_days', '3', 'FR-LOAN-004 / NTF-004: days overdue before escalation (Naveen to confirm)'),
  ('escalation_recipients', '["Anand","Naveen Pinapatruni"]', 'FR-LOAN-004: people names whose login emails receive escalations'),
  ('bot_cc', '["naveen@madtown.in"]', 'Section 8: naveen@madtown.in copied on bot-sent mail'),
  ('reminder_hour_ist', '9', 'NTF-002/003: due-today and overdue reminder hour (IST)'),
  ('weekly_summary', '{"dow":1,"hour":9}', 'NTF-012: Monday 09:00 IST (to confirm)'),
  ('mirror_hour_ist', '2', 'FR-RPT-009 / A8: nightly mirror time (to confirm)'),
  ('mask_prices_in_notes', 'true', 'D-07: mask Rs amounts in notes for non-finance viewers, exports and mirror'),
  ('upkeep_days_before', '7', 'NTF-009: days before service due'),
  ('audit_stale_days', '90', 'FR-AUD-008'),
  ('slack_enabled', 'false', 'Phase 2: Slack alerts once the inventory channel exists (Stewart Butterfield, Naveen approval)'),
  ('whatsapp_enabled', 'false', 'Phase 3: WhatsApp via Graham Bell (roadmap)')
on conflict (key) do nothing;
