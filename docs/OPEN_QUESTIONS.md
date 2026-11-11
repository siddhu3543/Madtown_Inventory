# Open questions (section 14) — all OPEN

Per Part A1 none of these is resolved by the build. Each has a configurable default so work can continue; the default is recorded so Naveen can accept or change it.

| ID | Question | Answer by | Build default until answered | Status |
|---|---|---|---|---|
| OQ-N-01 | Are Anand and Kittu both Managers? Are Kittu and Nagi staff or freelancers? | Naveen | Anand = Manager login; Kittu = person record only (no login) until confirmed; Kittu and Nagi stored with person_type Freelancer and the flag "type to verify" (no assumption shown as fact). See D-26. | OPEN |
| OQ-N-02 | Is a fast no-code MVP wanted first (Option B), or go straight to Option A? (Sheldon Q2) | Naveen | Option A built (Part A2 agreed stack). Option B not pursued. | OPEN |
| OQ-N-03 | Which categories get one tag per unit, and which are tracked by quantity only (for example batteries, clamps, cards, stands)? (Sheldon Q3) | Naveen with Anand | Import rule 11.2: stock 1 = Single, >1 = Counted. Per-category override in Settings → Quantity mode, and FR-CAT-007 split for later tagging. | OPEN |
| OQ-N-04 | Kits: one record per bundle with a contents list, or each part its own item? Which bundles exist (gimbal set, GoPro bundle, mic kit, light kits, Godox SA set)? (Sheldon Q4; Not yet sorted: gimbal accessories) | Naveen with Anand | Kits are a separate record with contents; each part keeps its own ID (FR-KIT-002). Seeded example kit: DJI RS4 Pro set (MTMH_182/183/184) in staging only. Other bundles not created until listed. | OPEN |
| OQ-N-05 | How many people will borrow items, and are freelancers such as Chiru given logins or recorded by a Manager? (Sheldon Q5) | Naveen | Freelancers recorded by a Manager without login (FR-CHK-010). Login creation is Owner-only in Settings. | OPEN |
| OQ-N-06 | Default loan periods per Type, and the overdue chase: who is chased, how often and where (email, Slack, WhatsApp)? (Sheldon Q6) | Naveen | Camera 2 d, Tripod 7 d, others 7 d placeholder; reminders by email; escalation after 3 days to Anand + Naveen. All editable (D-13, D-15, D-16). | OPEN |
| OQ-N-07 | Are purchase prices and values visible to Anand and Kittu and hidden from the team? (Sheldon Q7) | Naveen | Manager and Read-only see costs by default; per-user override (D-04). | OPEN |
| OQ-N-08 | Which items need mandatory photos at check-out and check-in? (Sheldon Q8) | Naveen with Anand | Check-out and check-in photo required for Camera, Lens, Drone (D-14). | OPEN |
| OQ-N-09 | Where does gear live (office, home, shoot sites), and do multiple locations matter? (Sheldon Q9) | Naveen with Anand | Locations table with Office, Home, Shoot site, Repair shop types; single location "Office" seeded. Multi-location reporting is Phase 3. | OPEN |
| OQ-N-10 | Are items insured, and should the app store policy numbers and claim records? (Sheldon Q10) | Naveen | Incident resolution "Insurance claim" records claim reference + notes. No policy table (Phase 3 "insurance reports"). | OPEN |
| OQ-N-11 | Is the existing Drive folder structure kept for photos? (Sheldon Q12) | Naveen | Drive layout: one folder per item named by ID under the configured root (FR-PHO-004). Existing folder links are kept as references and flagged for a Manager to pick a file (FR-PHO-007). | OPEN |
| OQ-N-12 | Label every small accessory, or tag only the pouch or kit? (Sheldon Q13) | Naveen with Anand | Label target per item: item, pouch, case or kit (FR-QR-005). Default: item. | OPEN |
| OQ-N-13 | What is the target go-live date, and which upcoming shoot is the pilot? (Sheldon Q14) | Naveen | No date assumed. Pilot shoot to be named by Naveen. | OPEN |
| OQ-N-14 | Keep Not yet sorted and To buy as imports? What is done about the missing GoPro? (Sheldon Q15) | Naveen with Anand | Both imported (MIG-011, MIG-012). GoPro stays unsorted ("Missing: to locate") until details supplied; conversion creates it with status Missing. | OPEN |
| OQ-N-15 | What is the budget ceiling for the build and for monthly running cost? (Sheldon Q16) | Naveen | Not answered. Running-cost estimate in A7 is indicative only. | OPEN |
| OQ-N-16 | Condition values: keep Good and Bad condition only (as in the sheet), or add Fair and New as Sheldon Cooper proposes? | Naveen | Good and Bad condition only; Fair/New disabled (D-09). | OPEN |
| OQ-N-17 | Type list: keep the sheet Types and add a Subtype for Accessory, or adopt the shorter list proposed by Sheldon Cooper (camera, lens, audio, light, gimbal, drone, bag, cable, other)? | Naveen | Sheet Types kept + Subtype for Accessory (FR-CAT-004). | OPEN |
| OQ-N-18 | Does Madtown in the Posession column mean the office store, and which office (the teleprompter order shipped to the Rushikonda office)? | Naveen | Office location (D-01). | OPEN |
| OQ-N-19 | For items held by Kittu or Anand with no loan (for example MTMH_113, MTMH_118, MTMH_142), are they custodians (no due date) or borrowers? | Naveen | Open legacy loan, due blank, To verify; Import review can switch to custodian (D-11). | OPEN |
| OQ-N-20 | Confirm ownership: MTMH_115 Godox V1S Flash and MTMH_187 SanDisk Extreme 128GB belong to Anand. Are there other personally owned items? | Naveen with Anand | MTMH_115 Anand applied; MTMH_187 flagged To verify (D-12). | OPEN |
| OQ-N-21 | What is the year of the 14 July service on the six camera and lens items? | Naveen with Anand | Year blank, flagged (D-31). | OPEN |
| OQ-N-22 | MTMH_114 Powerpak 100x170 cms Reflector: condition Good and holder Kittu, but latest photo says lost. Which is correct? | Naveen with Anand | MTMH_114 imported as Good, holder Kittu, latest photo none, flagged for review (MIG-009); not auto-classified. | OPEN |
| OQ-N-23 | MTMH_126: what is the actual count of Harison Pro Tower Stands after the call with Purushotham? | Naveen | Stock 4 imported with To verify; walkthrough count corrects it (FR-AUD-004). | OPEN |
| OQ-N-24 | Should Alfred Pennyworth (inventory manager bot) get API or read access to the app, and with what role? | Naveen | No access for Alfred Pennyworth. A read-only API token mechanism is NOT built until decided. | OPEN |
| OQ-N-25 | Who approves write-offs for lost items, and is there a value threshold? | Naveen | All write-offs need Owner approval (D-28). | OPEN |
| OQ-S-01 | Which stack do you already run for Acom and McGorganic, and can the inventory app share hosting and accounts with them or must it stand alone? (Sheldon Q1) | Siddharth | Unknown to this build. App stands alone in Madtown-owned accounts (A3). | OPEN |
| OQ-S-02 | Do you accept Option A (Supabase plus a Next.js or SvelteKit PWA), or do you propose Option C on your existing stack? Please give effort and running cost. | Siddharth | Option A accepted (A2). | OPEN |
| OQ-S-03 | Who owns the accounts, domain (for example a subdomain of madtown.in) and code repository? Recommendation: Madtown owns all of them, with you as collaborator. (Sheldon Q11) | Siddharth | Madtown owns all accounts; developer is collaborator (A3, NFR-007). | OPEN |
| OQ-S-04 | Can Google Drive be used reliably for photo storage from the app (service account or OAuth, quotas), or do you prefer Supabase Storage or Cloudflare R2 behind an adapter? | Siddharth | Drive via Workspace service account + shared drive, behind StorageAdapter; R2/Supabase Storage can replace it (A4). | OPEN |
| OQ-S-05 | What unit suffix scheme do you propose when a Counted item is split into tagged units (for example MTMH_141 into six batteries)? | Siddharth | MTMH_141-01 suffix (D-17), pending approval. | OPEN |
| OQ-S-06 | How will you implement the Sheets mirror (nightly job or on change), and how will you prevent edits to the mirror? | Siddharth | Nightly job + Owner manual sync; protected range on the mirror (ADR-13). | OPEN |
| OQ-S-07 | Which email sending service will you use for reminders from inventory@madtown.in, and what does it cost? | Siddharth | Resend (ADR-14). | OPEN |
| OQ-S-08 | How much of the offline queue can be delivered in Phase 1 rather than Phase 2? | Siddharth | Phase 1: cached lookup/scan + clear offline messages. Phase 2 queue also implemented, pending confirmation of which actions are allowed offline (A8). | OPEN |
| OQ-S-09 | Do you confirm the Phase 1 estimate of 3 to 4 weeks, and what would you cut first if it runs late? | Siddharth | Estimate in A7 (3-4 weeks) is not a guarantee; cut order per A7 (protect security, migration, catalog, QR, checkout/in, evidence, reminders, audit, backups). | OPEN |
| OQ-S-10 | How will row-level security be tested for the cost-hiding rule? | Siddharth | Automated tests: direct SQL as each role, HTTP API calls as Team member, CSV export and mirror checks (tests/integration/rls-finance.test.ts, tests/e2e). | OPEN |
| OQ-S-11 | What is your rollback plan for each phase? | Siddharth | Per phase: tagged release, DB backup before migration, down-migration notes per migration file, Vercel instant rollback (docs/DEPLOYMENT.md). | OPEN |
| OQ-S-12 | What staging environment and test data will you use, and who besides Naveen gets access? | Siddharth | Supabase staging project + Vercel staging, synthetic data (A3). Access: Naveen, Anand, Siddharth (A3). | OPEN |

## Part A8 open decisions

All A8 bullets are tracked in DECISIONS.md (D-01..D-34) and remain OPEN.
