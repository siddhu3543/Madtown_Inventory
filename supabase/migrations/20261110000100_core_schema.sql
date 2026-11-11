-- Core schema. Section 6 (data model) of Draft v0.1, with ADR-04..07.
-- Timestamps are timestamptz (stored UTC, shown IST: 6.2 archived/created_at note, NFR-020).

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists btree_gist;

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------- settings
create table public.settings (
  key text primary key,
  value jsonb not null,
  description text,
  is_secret boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- Controlled values (FR-CAT-003/004, FR-CON-001, 6.3). Managers propose, Owner approves.
create table public.item_types (
  name text primary key,
  status text not null default 'Approved' check (status in ('Approved','Proposed','Rejected')),
  sort int not null default 100,
  default_loan_days int check (default_loan_days is null or default_loan_days > 0),   -- FR-CHK-002
  loan_days_confirmed boolean not null default false,                                  -- D-13
  checkout_photo_required boolean not null default false,                              -- FR-CHK-003
  checkin_photo_required boolean not null default false,                               -- D-14
  service_interval_days int check (service_interval_days is null or service_interval_days > 0), -- FR-CON-006
  proposed_by uuid, approved_by uuid, approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.item_subtypes (
  name text primary key,
  status text not null default 'Approved' check (status in ('Approved','Proposed','Rejected')),
  sort int not null default 100,
  proposed_by uuid, approved_by uuid, approved_at timestamptz
);

create table public.conditions (
  name text primary key,
  rank int not null,              -- higher = better; used for "worse than" (FR-CHK-005)
  enabled boolean not null default true,
  source_note text
);

-- ---------------------------------------------------------------- people, users, locations (6.4)
create table public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  person_type text not null check (person_type in ('Staff','Freelancer','Vendor','Client contact','Organisation')),
  person_type_to_verify boolean not null default false,
  is_madtown boolean not null default false,
  active boolean not null default true,         -- inactive people cannot borrow (6.4)
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index people_one_madtown on public.people (is_madtown) where is_madtown;
create unique index people_name_unique on public.people (lower(name));

-- contact details split out (D-35 privacy): Owner/Manager only
create table public.people_contacts (
  person_id uuid primary key references public.people(id) on delete cascade,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or phone ~ '^[0-9+()\-\s]{6,20}$'),
  updated_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  person_id uuid not null unique references public.people(id),
  login_email text not null unique check (lower(login_email) ~ '^[^@\s]+@madtown\.in$'),  -- NFR-003
  role text not null check (role in ('Owner','Manager','Team member','Read-only')),
  active boolean not null default true,
  finance_access text not null default 'default' check (finance_access in ('default','on','off')), -- D-04
  is_developer boolean not null default false,   -- D-25
  session_version int not null default 1,        -- ADR-09
  last_login timestamptz,
  deactivated_at timestamptz,
  deactivated_by uuid,
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  location_type text not null check (location_type in ('Office','Home','Shoot site','Repair shop','Storage')),
  parent_location_id uuid references public.locations(id),
  is_default_home boolean not null default false,
  active boolean not null default true,
  notes text
);
create unique index locations_one_default on public.locations (is_default_home) where is_default_home;

-- ---------------------------------------------------------------- items (6.2)
create table public.id_counters (
  name text primary key,
  next_value int not null check (next_value > 0)
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  item_id text,                -- FKs added after items exists
  loan_id uuid,
  maintenance_event_id uuid,
  incident_id uuid,
  order_id uuid,
  audit_line_id uuid,
  kind text not null check (kind in ('Stock','Latest','Check-out','Check-in','Damage','Invoice','Audit')),
  provider text not null check (provider in ('drive','local','r2','supabase','legacy-link')),
  provider_file_id text,
  provider_folder_id text,
  thumbnail_ref text,
  original_url text,           -- legacy sheet link (FR-PHO-007)
  link_kind text not null default 'file' check (link_kind in ('file','folder','text','none')),
  legacy_text text,            -- e.g. 'lost', 'Need replacement' (FR-PHO-006)
  checksum_sha256 text,
  mime_type text,
  width int, height int, bytes int,
  upload_state text not null default 'pending' check (upload_state in ('pending','uploaded','failed','legacy')),
  upload_error text,
  upload_attempts int not null default 0,
  taken_by uuid,
  taken_at timestamptz not null default now(),
  uploaded_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

create table public.items (
  id text primary key check (id ~ '^MTMH_[0-9]{3,}(-[0-9]{2,})?$'),        -- FR-CAT-001
  name text not null check (name = btrim(name) and name <> '' and name !~ '\s{2,}'), -- MIG-001, 11.2
  model_number text,
  model_tbd boolean not null default false,                                    -- FR-CAT-009
  brand text,
  serial_number text,
  type text not null references public.item_types(name) on update cascade,
  subtype text references public.item_subtypes(name) on update cascade,       -- FR-CAT-004
  quantity_mode text not null check (quantity_mode in ('Single','Counted')),  -- FR-CAT-005
  stock int not null default 1 check (stock >= 0),
  stock_to_verify boolean not null default false,
  stock_to_verify_reason text,
  status text not null default 'Available'
    check (status in ('Available','Checked out','Reserved','In repair','Missing','Lost','Retired')),
  condition text references public.conditions(name),          -- null allowed only when Lost (11.2) or to_verify
  owner_person_id uuid not null references public.people(id), -- FR-CAT-008
  holder_person_id uuid references public.people(id),
  holder_location_id uuid references public.locations(id),
  home_location_id uuid references public.locations(id),
  parent_item_id text references public.items(id),             -- FR-KIT-001
  case_item_id text references public.items(id),               -- FR-KIT-007
  case_capacity_note text,                                     -- FR-KIT-008
  needs_case boolean not null default false,                   -- FR-KIT-008
  label_target text not null default 'Item' check (label_target in ('Item','Pouch','Case','Kit')), -- FR-QR-005
  label_note text,
  stock_image_photo_id uuid references public.photos(id) deferrable initially deferred,
  latest_photo_id uuid references public.photos(id) deferrable initially deferred,
  notes text,
  to_verify boolean not null default false,                    -- FR-CAT-015
  to_verify_reason text,
  retired_at timestamptz,
  retirement_kind text check (retirement_kind in ('Retired','Sold','Written off','Split')),
  retired_reason text,
  sheet_row int,                                               -- FR-CAT-014 (raw values in item_import_raw)
  imported boolean not null default false,
  last_audited_at timestamptz,                                 -- FR-AUD-008
  archived boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint items_one_holder check (holder_person_id is null or holder_location_id is null),
  constraint items_single_stock check (quantity_mode <> 'Single' or stock = 1 or status = 'Retired' or (stock = 0 and stock_to_verify)),
  constraint items_retired_fields check ((status = 'Retired') = (retired_at is not null)),
  constraint items_not_own_parent check (parent_item_id is null or parent_item_id <> id),
  constraint items_case_not_self check (case_item_id is null or case_item_id <> id),
  constraint items_condition_required check (condition is not null or status in ('Lost','Missing','Retired') or to_verify)
);
create index items_trgm on public.items using gin ((id || ' ' || name || ' ' || coalesce(model_number,'') || ' ' || coalesce(brand,'') || ' ' || type) gin_trgm_ops);
create index items_parent on public.items(parent_item_id);
create index items_status on public.items(status);

alter table public.photos add constraint photos_item_fk foreign key (item_id) references public.items(id) on delete cascade;
create index photos_item on public.photos(item_id);
create index photos_loan on public.photos(loan_id);

-- Restricted financial details (FR-CAT-012, A5, ADR-04)
create table public.item_financials (
  item_id text primary key references public.items(id) on delete cascade,
  purchase_date date,
  vendor text,
  order_ref text,
  purchase_price numeric(12,2) check (purchase_price is null or purchase_price >= 0),
  price_note text,
  warranty_until date,
  invoice_photo_id uuid references public.photos(id),
  updated_at timestamptz not null default now()
);

-- Original sheet values (FR-CAT-014, MIG-014). Restricted: raw notes may contain prices.
create table public.item_import_raw (
  item_id text primary key references public.items(id) on delete cascade,
  sheet_row int not null,
  legacy_raw jsonb not null,
  import_run_id uuid,
  imported_at timestamptz not null default now()
);

-- Counted quantities per holder and status (FR-CAT-006, 6.6, ADR-06)
create table public.item_holdings (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.items(id) on delete cascade,
  holder_person_id uuid references public.people(id),
  holder_location_id uuid references public.locations(id),
  status text not null check (status in ('Available','Checked out','In repair','Missing','Lost')),
  quantity int not null check (quantity >= 0),
  loan_line_id uuid,
  to_verify boolean not null default false,
  note text,
  updated_at timestamptz not null default now(),
  constraint holdings_one_holder check (holder_person_id is null or holder_location_id is null),
  constraint holdings_holder_unless_lost check (status in ('Lost','Missing') or holder_person_id is not null or holder_location_id is not null)
);
create index holdings_item on public.item_holdings(item_id);

-- Missing parts (FR-KIT-005, MIG-006)
create table public.missing_parts (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.items(id) on delete cascade,
  description text not null,
  quantity int not null default 1 check (quantity > 0),
  status text not null default 'Missing' check (status in ('Missing','Found','Replaced','Not needed')),
  wishlist_id uuid,
  loan_id uuid,
  reported_by uuid,
  reported_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  legacy boolean not null default false,
  to_verify boolean not null default false
);

-- Detached accessories held by someone else without checking out the parent (FR-KIT-006)
create table public.detached_accessories (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.items(id) on delete cascade,
  description text not null,
  accessory_item_id text references public.items(id),
  holder_person_id uuid not null references public.people(id),
  reason text,
  since timestamptz not null default now(),
  returned_at timestamptz,
  created_by uuid,
  legacy boolean not null default false
);

create table public.retirement_requests (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.items(id) on delete cascade,
  kind text not null check (kind in ('Retired','Sold','Written off')),
  reason text not null check (btrim(reason) <> ''),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
  decided_by uuid,
  decided_at timestamptz,
  decision_comment text
);

-- ---------------------------------------------------------------- kits (6.6)
create table public.kits (
  id text primary key check (id ~ '^KIT_[0-9]{3,}$'),
  name text not null,
  description text,
  home_location_id uuid references public.locations(id),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.kit_items (
  kit_id text not null references public.kits(id) on delete cascade,
  item_id text not null references public.items(id),
  quantity int not null default 1 check (quantity >= 1),
  required boolean not null default true,
  sort int not null default 0,
  primary key (kit_id, item_id)
);

-- ---------------------------------------------------------------- loans (6.5, ADR-05)
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  kit_id text references public.kits(id),
  borrower_person_id uuid not null references public.people(id),
  purpose_or_project text,                                  -- FR-LOAN-009
  project_code text,                                        -- Phase 3
  checked_out_by uuid,                                      -- blank allowed for legacy
  checked_out_at timestamptz,                               -- blank allowed for legacy
  due_at timestamptz,
  checked_in_by uuid,
  checked_in_at timestamptz,
  checkin_backdated boolean not null default false,
  checkin_backdate_reason text,
  condition_out text references public.conditions(name),
  condition_in text references public.conditions(name),
  accessories_checklist jsonb,                              -- 6.5
  status text not null default 'Open' check (status in ('Open','Returned','Overdue','Lost')),
  close_reason text check (close_reason in ('Returned','Transferred','Lost','Override closed')),
  reminder_count int not null default 0 check (reminder_count >= 0),
  extension_count int not null default 0,
  legacy boolean not null default false,
  to_verify boolean not null default false,
  override_reason text,
  transferred_from_loan_id uuid references public.loans(id),
  transferred_to_loan_id uuid references public.loans(id),
  created_via text not null default 'App' check (created_via in ('App','Import','Offline')),
  client_uuid uuid unique,                                  -- offline idempotency (NFR-014)
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loans_due_after_out check (legacy or (checked_out_at is not null and due_at is not null and due_at > checked_out_at)),
  constraint loans_in_after_out check (checked_in_at is null or checked_out_at is null or checked_in_at >= checked_out_at),
  constraint loans_closed_has_time check (status in ('Open','Overdue') or checked_in_at is not null or legacy),
  constraint loans_backdate_reason check (not checkin_backdated or coalesce(btrim(checkin_backdate_reason),'') <> '')
);
create index loans_borrower on public.loans(borrower_person_id);
create index loans_status on public.loans(status);

create table public.loan_lines (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  item_id text not null references public.items(id),
  quantity int not null check (quantity >= 1),
  qty_returned int not null default 0 check (qty_returned >= 0),
  qty_lost int not null default 0 check (qty_lost >= 0),
  qty_transferred int not null default 0 check (qty_transferred >= 0),
  is_single boolean not null,
  source_location_id uuid references public.locations(id),
  source_person_id uuid references public.people(id),
  required_in_kit boolean,
  active boolean generated always as (qty_returned + qty_lost + qty_transferred < quantity) stored,
  constraint lines_not_over check (qty_returned + qty_lost + qty_transferred <= quantity),
  constraint lines_single_qty check (not is_single or quantity = 1)
);
-- THE double-checkout guard (FR-CHK-006, A5): one active line per Single item, enforced by PostgreSQL.
create unique index loan_lines_single_active on public.loan_lines(item_id) where is_single and active;
create index loan_lines_loan on public.loan_lines(loan_id);
create index loan_lines_item on public.loan_lines(item_id);
alter table public.item_holdings add constraint holdings_line_fk foreign key (loan_line_id) references public.loan_lines(id);

-- Chain of custody / timeline events per loan (AC-CHK-05, FR-CON-007)
create table public.loan_events (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  line_id uuid references public.loan_lines(id) on delete cascade,
  item_id text references public.items(id),
  event text not null check (event in ('check-out','return','lost','transfer-out','transfer-in','extend','override-close','legacy')),
  quantity int,
  at timestamptz not null default now(),
  by_user uuid,
  person_id uuid references public.people(id),
  note text
);
create index loan_events_item on public.loan_events(item_id);

create table public.loan_extensions (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  old_due_at timestamptz,
  new_due_at timestamptz not null,
  reason text not null check (btrim(reason) <> ''),          -- FR-CHK-009
  by_user uuid not null,
  at timestamptz not null default now()
);

-- Reservations (FR-CHK-012, Phase 2)
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  item_id text references public.items(id),
  kit_id text references public.kits(id),
  person_id uuid not null references public.people(id),
  shoot text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'Active' check (status in ('Active','Cancelled','Fulfilled')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  note text,
  constraint reservations_target check ((item_id is null) <> (kit_id is null)),
  constraint reservations_period check (ends_at > starts_at)
);
alter table public.reservations add constraint reservations_no_overlap_item
  exclude using gist (item_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'Active' and item_id is not null);
alter table public.reservations add constraint reservations_no_overlap_kit
  exclude using gist (kit_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'Active' and kit_id is not null);

-- ---------------------------------------------------------------- maintenance (6.7)
create table public.maintenance_events (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.items(id) on delete cascade,
  type text not null check (type in ('Service','Repair','Cleaning','Calibration','Firmware')),
  state text not null default 'Reported' check (state in ('Reported','Sent for repair','In repair','Returned','Closed')),
  issue_description text not null,
  cause text,                                      -- FR-CON-005
  quantity int not null default 1 check (quantity >= 1),
  reported_by uuid,
  reported_by_person_id uuid references public.people(id),
  reported_at timestamptz not null default now(),
  event_date date,                                 -- for legacy dated events
  event_date_text text,                            -- e.g. '14 July (year to verify)'
  year_to_verify boolean not null default false,   -- MIG-005, AC-CON-03
  vendor text,
  sent_at date,
  expected_back date,
  returned_at date,
  outcome text,
  linked_loan_id uuid references public.loans(id),
  linked_incident_id uuid,
  legacy boolean not null default false,
  to_verify boolean not null default false,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index maint_item on public.maintenance_events(item_id);

create table public.maintenance_costs (
  event_id uuid primary key references public.maintenance_events(id) on delete cascade,
  cost numeric(12,2) check (cost is null or cost >= 0),
  invoice_photo_id uuid references public.photos(id),
  updated_at timestamptz not null default now()
);

create table public.maintenance_state_history (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.maintenance_events(id) on delete cascade,
  from_state text,
  to_state text not null,
  by_user uuid,
  at timestamptz not null default now(),
  note text
);

create table public.maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  item_id text references public.items(id) on delete cascade,
  item_type text references public.item_types(name),
  interval_days int not null check (interval_days > 0),
  next_due date not null,
  last_done date,
  active boolean not null default true,
  note text,
  constraint schedules_target check ((item_id is null) <> (item_type is null))
);

-- ---------------------------------------------------------------- incidents (6.8)
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.items(id) on delete cascade,
  type text not null check (type in ('Damage','Loss','Theft','Found')),
  quantity int not null default 1 check (quantity >= 1),
  description text not null,
  history_known boolean not null default true,     -- FR-LST-003
  reported_by uuid,
  reported_at timestamptz not null default now(),
  last_known_holder_person_id uuid references public.people(id),
  last_seen_at date,
  last_seen_at_text text,
  last_seen_place text,
  responsible_person_id uuid references public.people(id),
  linked_loan_id uuid references public.loans(id),
  status text not null default 'Open' check (status in ('Open','Pending write-off','Resolved')),
  resolution text check (resolution in ('Found','Written off','Insurance claim','Replaced')),
  resolution_note text,
  insurance_claim_ref text,
  replaced_wishlist_id uuid,
  resolved_at timestamptz,
  resolved_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  found_by uuid,
  found_place text,
  legacy boolean not null default false,
  to_verify boolean not null default false,
  created_at timestamptz not null default now()
);
create index incidents_item on public.incidents(item_id);
alter table public.maintenance_events add constraint maint_incident_fk foreign key (linked_incident_id) references public.incidents(id);

-- ---------------------------------------------------------------- to-buy and orders (6.9)
create table public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  item_description text not null,
  reason text not null default '',
  replaces_or_adds text not null check (replaces_or_adds in ('Replaces','Adds')),  -- FR-BUY-004
  replaces_or_adds_note text,
  priority text not null check (priority in ('High','Medium','Low')),             -- FR-BUY-003
  status text not null default 'To research'
    check (status in ('To research','To buy','Approved','Ordered','Received','Rejected')), -- FR-BUY-002
  verify_first boolean not null default false,       -- FR-BUY-009
  verify_note text,
  verified_by uuid, verified_at timestamptz, verification_result text,
  links text,
  notes text,
  proposed_by uuid,
  proposed_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,         -- FR-BUY-005
  decision_comment text,
  rejected_by uuid, rejected_at timestamptz,
  source_missing_part_id uuid references public.missing_parts(id),
  source_incident_id uuid references public.incidents(id),
  sheet_row int,
  legacy boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.wishlist_related_items (
  wishlist_id uuid not null references public.wishlist_items(id) on delete cascade,
  item_id text not null references public.items(id) on delete cascade,
  primary key (wishlist_id, item_id)
);
create table public.wishlist_financials (
  wishlist_id uuid primary key references public.wishlist_items(id) on delete cascade,
  estimated_cost numeric(12,2),
  legacy_raw jsonb
);
create table public.wishlist_options (                 -- FR-BUY-010 (restricted: contains prices)
  id uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references public.wishlist_items(id) on delete cascade,
  vendor text not null,
  price numeric(12,2),
  stock_note text,
  link text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.missing_parts add constraint missing_parts_wishlist_fk foreign key (wishlist_id) references public.wishlist_items(id) on delete set null;
alter table public.incidents add constraint incidents_wishlist_fk foreign key (replaced_wishlist_id) references public.wishlist_items(id) on delete set null;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  vendor text not null,
  order_ref text not null,
  order_date date not null,
  status text not null default 'Placed' check (status in ('Placed','Cancelled','Delivered','Partially delivered')),
  expected_delivery date,
  delivered_at date,
  cancelled_reason text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vendor, order_ref)
);
create table public.order_financials (
  order_id uuid primary key references public.orders(id) on delete cascade,
  amount numeric(12,2) check (amount is null or amount >= 0),
  invoice_photo_id uuid references public.photos(id)
);
create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  wishlist_id uuid references public.wishlist_items(id),
  description text not null,
  quantity int not null default 1 check (quantity >= 1),
  received_qty int not null default 0 check (received_qty >= 0),
  constraint order_lines_not_over check (received_qty <= quantity)
);
create table public.order_line_items (                 -- items created on receipt (FR-BUY-007)
  order_line_id uuid not null references public.order_lines(id) on delete cascade,
  item_id text not null references public.items(id),
  primary key (order_line_id, item_id)
);
alter table public.photos add constraint photos_order_fk foreign key (order_id) references public.orders(id) on delete set null;

-- ---------------------------------------------------------------- walkthrough audits (6.10)
create table public.audits (
  id uuid primary key default gen_random_uuid(),
  scope_kind text not null check (scope_kind in ('All','Location','Type','Holder')),
  scope_value text,
  status text not null default 'Open' check (status in ('Open','Closed')),
  started_by uuid not null,
  started_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz,
  corrections_applied_at timestamptz,
  note text
);
create table public.audit_lines (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  item_id text not null references public.items(id) on delete cascade,
  result text not null check (result in ('Found','Not found','Wrong location','Condition changed')),
  expected_qty int,
  counted_qty int check (counted_qty is null or counted_qty >= 0),
  condition_seen text references public.conditions(name),
  location_seen_id uuid references public.locations(id),
  photo_id uuid references public.photos(id),
  note text,                                            -- FR-AUD-007 quick note
  scanned_by uuid not null,
  scanned_at timestamptz not null default now(),
  correction_applied boolean not null default false,
  correction_note text,
  unique (audit_id, item_id)
);
alter table public.photos add constraint photos_audit_line_fk foreign key (audit_line_id) references public.audit_lines(id) on delete set null;
alter table public.photos add constraint photos_loan_fk foreign key (loan_id) references public.loans(id) on delete set null;
alter table public.photos add constraint photos_maint_fk foreign key (maintenance_event_id) references public.maintenance_events(id) on delete set null;
alter table public.photos add constraint photos_incident_fk foreign key (incident_id) references public.incidents(id) on delete set null;

-- ---------------------------------------------------------------- audit log (FR-AUD-001, NFR-015)
create table public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_user_id uuid,
  actor_label text,
  action text not null,
  table_name text not null,
  record_id text,
  item_id text,
  before_json jsonb,
  after_json jsonb,
  source text not null check (source in ('App','Import','Sync','Job')),
  reason text
);
create index audit_log_item on public.audit_log(item_id, at desc);
create index audit_log_at on public.audit_log(at desc);

-- ---------------------------------------------------------------- notifications (section 8)
create table public.notifications_log (
  id uuid primary key default gen_random_uuid(),
  event_code text not null,                          -- NTF-001 ...
  dedupe_key text unique,
  channel text not null check (channel in ('email','slack','whatsapp')),
  recipients text[] not null default '{}',
  cc text[] not null default '{}',
  intended_recipients text[] not null default '{}',  -- before sandbox redirect
  subject text,
  body_text text,
  loan_id uuid references public.loans(id) on delete set null,
  item_id text references public.items(id) on delete set null,
  status text not null check (status in ('queued','sent','failed','sandboxed','skipped')),
  provider_message_id text,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notif_loan on public.notifications_log(loan_id);

-- ---------------------------------------------------------------- import / migration (section 11)
create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('dry-run','apply','final')),
  environment text not null,
  source_description text,
  started_by uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','succeeded','failed','rolled-back')),
  summary jsonb
);
create unique index import_one_final on public.import_runs (mode) where mode = 'final' and status = 'succeeded'; -- MIG-015
create table public.import_row_results (
  id bigserial primary key,
  run_id uuid not null references public.import_runs(id) on delete cascade,
  tab text not null,
  sheet_row int,
  record_ref text,
  level text not null check (level in ('info','warning','error')),
  code text not null,
  message text not null
);
create table public.import_mapping_rules (
  id uuid primary key default gen_random_uuid(),
  target text not null,              -- item id (MTMH_110) or 'To buy:3', 'Not yet sorted:2'
  rule jsonb not null,
  note text,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table public.unsorted_items (
  id uuid primary key default gen_random_uuid(),
  sheet_row int,
  item text not null,
  known text,
  question text,
  who_can_answer text,
  status text not null check (status in ('Undecided','Missing: to locate','To clarify','To list','To verify','Converted','Discarded')),
  duplicate_of_item_id text references public.items(id),
  duplicate_cleared boolean not null default false,
  converted_item_ids text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- misc
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  query jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.sync_conflicts (                   -- NFR-014
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null,
  user_id uuid,
  action jsonb not null,
  client_created_at timestamptz,
  error_code text,
  error text,
  created_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text
);

create table public.mirror_runs (                      -- FR-RPT-009
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('nightly','manual')),
  target text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  rows_written int,
  error text,
  started_by uuid
);

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  detail jsonb
);
