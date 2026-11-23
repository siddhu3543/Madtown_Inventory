/**
 * Sheet migration planner (section 11, MIG-001..016). Pure functions: CSV text + mapping rules -> plan + per-row
 * warnings. No database access, so every rule is unit-tested (tests/unit/importer.test.ts).
 */
import Papa from "papaparse";

export type WishlistStatus = "To research" | "To buy" | "Approved" | "Ordered" | "Received" | "Rejected";
export type Warn = { tab: string; row: number | null; ref: string | null; level: "info" | "warning" | "error"; code: string; message: string };
export type Rules = Record<string, Record<string, unknown>>;

export const SHEET1_HEADERS = [
  "Item ID",
  "Item name",
  "Model Number",
  "Type",
  "Stock",
  "Links",
  "Updated links",
  "Notes",
  "Condition",
  "Posession",
  "Checked Out For",
  "Checked Out Date",
  "Checked In Date",
];
export const TOBUY_HEADERS = ["Item", "Reason", "Related item ID", "Replaces or adds", "Priority", "Status", "Notes"];
export const UNSORTED_HEADERS = ["Item", "What we know", "Question", "Who can answer", "Status"];
export const TYPES = ["Camera", "Lens", "Audio", "Light", "Light accessory", "Accessory", "Tripod", "Stand", "Reflector", "Backdrop", "SD Card", "Battery", "Drone"];
const BRANDS = [
  "Sony",
  "Godox",
  "NISI",
  "NiSi",
  "SmallRig",
  "DJI",
  "Lexar",
  "SanDisk",
  "Anker",
  "Ulanzi",
  "Fotopro",
  "Powerpak",
  "Harison",
  "E-Image",
  "K&F",
  "Kodak",
  "NEEWER",
  "Digitex",
  "First Power",
  "Magic line",
  "Smart Pro",
];

export type PhotoPlan = {
  kind: "Stock" | "Latest";
  link_kind: "file" | "folder" | "text";
  provider_file_id: string | null;
  provider_folder_id: string | null;
  original_url: string | null;
  legacy_text: string | null;
  /** the photo the item points at (stock image / latest photo); older links are kept as history */
  primary: boolean;
  note: string | null;
};
export type HoldingPlan = { holder: string | null; status: string; qty: number; legacy_loan?: boolean; to_verify?: boolean };
export type LoanPlan = {
  item_id: string;
  borrower: string;
  status: "Open" | "Returned";
  quantity: number;
  checked_in_at: string | null;
  condition_in?: string | null;
  note: string;
  to_verify: boolean;
};
export type ItemPlan = {
  id: string;
  sheet_row: number;
  raw: Record<string, string>;
  name: string;
  model_number: string | null;
  model_tbd: boolean;
  brand: string | null;
  type: string;
  subtype: string | null;
  quantity_mode: "Single" | "Counted";
  stock: number;
  stock_to_verify: boolean;
  stock_to_verify_reason: string | null;
  status: "Available" | "Checked out" | "In repair" | "Lost" | "Missing";
  condition: string | null;
  owner: string;
  holder: string | null;
  holdings: HoldingPlan[];
  parent: string | null;
  needs_case: boolean;
  notes: string | null;
  to_verify_reasons: string[];
  photos: PhotoPlan[];
  detached: { description: string; holder: string; reason: string | null }[];
};
export type Plan = {
  items: ItemPlan[];
  loans: LoanPlan[];
  maintenance: { item_id: string; type: string; state: string; issue: string; cause: string | null; event_date_text: string | null; year_to_verify: boolean; to_verify: boolean }[];
  incidents: {
    item_id: string;
    type: "Loss";
    quantity: number;
    description: string;
    history_known: boolean;
    last_seen_place: string | null;
    last_seen_at_text: string | null;
    responsible: string | null;
    last_known_holder: string | null;
  }[];
  missingParts: { item_id: string; description: string }[];
  financials: { item_id: string; purchase_date: string | null; vendor: string | null; order_ref: string | null; purchase_price: number | null; price_note: string | null }[];
  orders: { vendor: string; order_ref: string; order_date: string | null; status: "Delivered" | "Cancelled"; amount: number | null; item_id: string }[];
  wishlist: {
    sheet_row: number;
    raw: Record<string, string>;
    item_description: string;
    reason: string;
    related: string[];
    replaces_or_adds: "Replaces" | "Adds";
    replaces_or_adds_note: string | null;
    priority: "High" | "Medium" | "Low";
    status: WishlistStatus;
    sheet_status: string | null;
    verify_first: boolean;
    notes: string | null;
  }[];
  unsorted: {
    sheet_row: number;
    item: string;
    known: string;
    question: string;
    who: string;
    status: string;
    duplicate_of: string | null;
    converted_item_ids: string[];
    notes: string | null;
  }[];
  people: string[];
  /** item types used by the sheet that the catalog does not have yet; created by the import */
  newTypes: string[];
  warnings: Warn[];
};

export function parseCsv(text: string, expected: string[], tab: string, warnings: Warn[]): { row: number; cells: Record<string, string> }[] {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { header: false, skipEmptyLines: "greedy" });
  const [hdr, ...rest] = res.data;
  if (!hdr) {
    warnings.push({ tab, row: null, ref: null, level: "error", code: "EMPTY", message: `${tab}: no rows` });
    return [];
  }
  const norm = hdr.map((h) => h.trim());
  for (const e of expected) if (!norm.includes(e)) warnings.push({ tab, row: 1, ref: null, level: "error", code: "HEADER_MISSING", message: `${tab}: column "${e}" not found` });
  for (const h of norm)
    if (h && !expected.includes(h)) warnings.push({ tab, row: 1, ref: null, level: "warning", code: "HEADER_EXTRA", message: `${tab}: unexpected column "${h}" ignored` });
  return rest.map((cells, i) => ({ row: i + 2, cells: Object.fromEntries(norm.map((h, j) => [h, cells[j] ?? ""])) }));
}

export function driveLink(v: string): { kind: "file" | "folder" | "text" | "none"; id: string | null } {
  const t = v.trim();
  if (!t) return { kind: "none", id: null };
  let m = t.match(/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?)?folders\/([A-Za-z0-9_-]+)/);
  if (m) return { kind: "folder", id: m[1] };
  m = t.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/) ?? t.match(/[?&]id=([A-Za-z0-9_-]+)/) ?? t.match(/docs\.google\.com\/\w+\/d\/([A-Za-z0-9_-]+)/);
  if (m) return { kind: "file", id: m[1] };
  if (/^https?:\/\//i.test(t)) return { kind: "file", id: null };
  return { kind: "text", id: null };
}

export function proposeSubtype(name: string): string {
  const n = name.toLowerCase();
  if (/\b(bag|case|trolley|pouch|box)\b/.test(n)) return "Bag or case";
  if (/charger/.test(n)) return "Charger";
  if (/card reader/.test(n)) return "Card reader";
  if (/filter|\buv\b|cpl|nd\b/.test(n)) return "Filter";
  if (/cage|handle|mount|rig|grip/.test(n)) return "Rig part";
  if (/clamp/.test(n)) return "Clamp or mount";
  if (/gimbal/.test(n)) return "Gimbal";
  if (/monitor/.test(n)) return "Monitor";
  if (/cable/.test(n)) return "Cable";
  return "Other";
}

export function deriveBrand(name: string): string | null {
  for (const b of BRANDS) if (name.toLowerCase().startsWith(b.toLowerCase() + " ") || name.toLowerCase() === b.toLowerCase()) return b === "NiSi" ? "NISI" : b;
  return null;
}

/** "Friday, October 16, 2026" / "16 Oct 2026" -> ISO at 12:00 IST (date-only values) */
export function parseSheetDate(v: string): string | null {
  const t = v.trim().replace(/^[A-Za-z]+,\s*/, "");
  if (!t) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  let m = t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  let y: number, mo: number, d: number;
  if (m) {
    mo = months.indexOf(m[1].slice(0, 3).toLowerCase());
    d = +m[2];
    y = +m[3];
  } else if ((m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/))) {
    d = +m[1];
    mo = months.indexOf(m[2].slice(0, 3).toLowerCase());
    y = +m[3];
  } else if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/))) {
    // ISO, also "2026-10-16 00:00:00" as Google Sheets / Excel export it
    y = +m[1];
    mo = +m[2] - 1;
    d = +m[3];
  } else if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/))) {
    // Indian day-first 16/10/2026
    d = +m[1];
    mo = +m[2] - 1;
    y = +m[3];
  } else if ((m = t.match(/^(\d{5})(?:\.\d+)?$/))) {
    // Excel serial day number (days since 1899-12-30)
    const dt = new Date(Date.UTC(1899, 11, 30) + +m[1] * 86400000);
    y = dt.getUTCFullYear();
    mo = dt.getUTCMonth();
    d = dt.getUTCDate();
  } else return null;
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  return `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}T12:00:00+05:30`;
}

function expandIds(text: string): { explicit: string[]; ranges: string[] } {
  const explicit = new Set<string>();
  const ranges: string[] = [];
  const rangeRe = /MTMH_(\d{3})\s*(?:to|-|–)\s*(?:MTMH_)?(\d{3})/gi;
  const stripped = text.replace(rangeRe, (all, a, b) => {
    for (let i = +a; i <= +b; i++) ranges.push(`MTMH_${i}`);
    return " ";
  });
  for (const x of stripped.matchAll(/MTMH_(\d{3})/gi)) explicit.add(`MTMH_${x[1]}`);
  return { explicit: [...explicit], ranges };
}

/** "1", "1.0", "20.00", " 3 " -> integer; anything else -> null (Excel and Sheets exports write whole numbers as 1.0) */
export function parseStock(v: string): number | null {
  const t = v.trim().replace(/,/g, "");
  if (/^\d+$/.test(t)) return +t;
  if (/^\d+\.0+$/.test(t)) return Math.trunc(+t);
  return null;
}

/** Matches a sheet type to a catalog type: exact, case-insensitive, then singular/plural ("Backdrops" -> "Backdrop", "Hard Disks" -> "Hard Disk") */
export function matchType(v: string, known: string[]): string | null {
  const t = v.trim().replace(/\s{2,}/g, " ");
  if (!t) return null;
  const lower = new Map(known.map((k) => [k.toLowerCase(), k]));
  const l = t.toLowerCase();
  return lower.get(l) ?? lower.get(l.replace(/e?s$/, "")) ?? lower.get(l + "s") ?? null;
}

/** "Hard disk" -> "Hard Disk"; keeps existing capitals (SD Card) */
const titleCase = (s: string) =>
  s
    .trim()
    .replace(/\s{2,}/g, " ")
    .replace(/(^|\s)([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** One photo per link in the cell. Cells may hold several links on separate lines and labels like "Previous photo: <url>". */
export function linkPhotos(cell: string, kind: "Stock" | "Latest"): { photos: PhotoPlan[]; folder: boolean; text: string | null } {
  const lines = cell
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const photos: PhotoPlan[] = [];
  const texts: string[] = [];
  let folder = false;
  for (const line of lines) {
    const url = line.match(/https?:\/\/\S+/)?.[0] ?? null;
    const label = url
      ? line
          .slice(0, line.indexOf(url))
          .replace(/[:\-–\s]+$/, "")
          .trim()
      : "";
    const older = /previous|old|earlier/i.test(label);
    if (!url) {
      texts.push(line);
      continue;
    }
    const l = driveLink(url);
    if (l.kind === "folder") folder = true;
    photos.push({
      kind,
      link_kind: l.kind === "folder" ? "folder" : "file",
      provider_file_id: l.kind === "file" ? l.id : null,
      provider_folder_id: l.kind === "folder" ? l.id : null,
      original_url: url,
      legacy_text: null,
      primary: false,
      note: label ? `Imported from sheet (${label})` : null,
      ...(older ? { _older: true } : {}),
    } as PhotoPlan);
  }
  // the item points at the first current link; "Previous photo" links stay as history
  const current = photos.find((p) => !(p as { _older?: boolean })._older) ?? photos[0];
  if (current) current.primary = true;
  for (const p of photos) delete (p as { _older?: boolean })._older;
  const text = texts.join(" ").trim() || null;
  if (!photos.length && text)
    photos.push({ kind, link_kind: "text", provider_file_id: null, provider_folder_id: null, original_url: null, legacy_text: text, primary: false, note: null });
  return { photos, folder, text };
}

/** A Posession entry that names a person ("Anand", "Kittu") rather than describing a place or situation */
export function isPersonName(n: string): boolean {
  const t = n.trim();
  if (!t || t.length > 40) return false;
  if (/\b(office|home|lost|missing|unknown|not|checking|at|with|vendor|repair|shop)\b/i.test(t)) return false;
  return /^[A-Z][\p{L}.'-]*(?:\s+[A-Z][\p{L}.'-]*){0,2}$/u.test(t);
}

/** Free-text To buy status -> app status. Unknown text falls back to To research; the original text is kept. */
export function mapWishlistStatus(v: string): WishlistStatus {
  const t = v.trim().toLowerCase();
  if (!t) return "To research";
  if (/^(not needed|no longer needed|cancel|reject|drop|skip)/.test(t)) return "Rejected";
  if (/^(received|delivered|bought|purchased|done)/.test(t)) return "Received";
  if (/^ordered/.test(t)) return "Ordered";
  if (/^approved/.test(t)) return "Approved";
  if (/^to buy/.test(t)) return "To buy";
  return "To research";
}

const UNSORTED_OK = ["Undecided", "Missing: to locate", "To clarify", "To list", "To verify", "Converted", "Discarded"];
/** Free-text Not yet sorted status -> app status */
export function mapUnsortedStatus(v: string): string {
  const t = v.trim();
  const exact = UNSORTED_OK.find((s) => s.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  if (!t) return "Undecided";
  if (/^(partly|partially|part)\b/i.test(t)) return "To clarify";
  if (/^(added|resolved|matched|converted|done|listed|moved)\b/i.test(t)) return "Converted";
  if (/^(discard|not needed|duplicate|ignore)/i.test(t)) return "Discarded";
  if (/missing|locate/i.test(t)) return "Missing: to locate";
  if (/^to list/i.test(t)) return "To list";
  if (/^to verify|^verify/i.test(t)) return "To verify";
  return "To clarify";
}

export function buildPlan(sheet1: string, toBuy: string, unsorted: string, rules: Rules, knownPeople: string[] = [], knownTypes: string[] = TYPES): Plan {
  const W: Warn[] = [];
  const w = (tab: string, row: number | null, ref: string | null, level: Warn["level"], code: string, message: string) => W.push({ tab, row, ref, level, code, message });
  const plan: Plan = {
    items: [],
    loans: [],
    maintenance: [],
    incidents: [],
    missingParts: [],
    financials: [],
    orders: [],
    wishlist: [],
    unsorted: [],
    people: [],
    newTypes: [],
    warnings: W,
  };
  const types = [...knownTypes];
  const people = new Map<string, string>(knownPeople.map((p) => [p.toLowerCase(), p]));
  const person = (n: string, tab: string, row: number, ref: string) => {
    const k = n.trim().toLowerCase();
    if (!people.has(k)) {
      people.set(k, n.trim());
      plan.people.push(n.trim());
      w(tab, row, ref, "warning", "PERSON_CREATED", `"${n.trim()}" is not a known person; created as a Freelancer to verify (OQ-N-01)`);
    }
    return people.get(k)!;
  };
  const seen = new Set<string>();

  // ------------------------------------------------------------------ Sheet1
  for (const { row, cells } of parseCsv(sheet1, SHEET1_HEADERS, "Sheet1", W)) {
    const raw = cells;
    const t = Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, (v ?? "").trim()])); // MIG-001
    const id = t["Item ID"];
    if (raw["Item ID"] !== id) w("Sheet1", row, id, "info", "ID_TRIMMED", `Item ID "${raw["Item ID"]}" trimmed to "${id}"`);
    if (!/^MTMH_\d{3,}$/.test(id)) {
      w("Sheet1", row, id || null, "error", "BAD_ID", `Item ID "${id}" is not MTMH_NNN; row skipped`);
      continue;
    }
    if (seen.has(id)) {
      w("Sheet1", row, id, "error", "DUPLICATE_ID", `${id} appears twice; second row rejected (11.2)`);
      continue;
    }
    seen.add(id);
    const rule = (rules[id] ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const name = t["Item name"].replace(/\s{2,}/g, " ");
    if (name !== raw["Item name"]) w("Sheet1", row, id, "info", "NAME_TRIMMED", `Name cleaned from "${raw["Item name"]}"`);
    const reasons: string[] = [];
    const it: ItemPlan = {
      id,
      sheet_row: row,
      raw,
      name,
      model_number: null,
      model_tbd: false,
      brand: deriveBrand(name),
      type: "",
      subtype: null,
      quantity_mode: "Single",
      stock: 1,
      stock_to_verify: false,
      stock_to_verify_reason: null,
      status: "Available",
      condition: null,
      owner: "Madtown",
      holder: "Office",
      holdings: [],
      parent: (rule.parent as string) ?? null,
      needs_case: false,
      notes: t["Notes"] || null,
      to_verify_reasons: reasons,
      photos: [],
      detached: [],
    };
    if (it.parent) w("Sheet1", row, id, "info", "PARENT_LINK", `Linked to parent ${it.parent} (${rule.source ?? "mapping rule"})`);

    // Model (11.2)
    const model = t["Model Number"];
    if (/^tbd\b/i.test(model)) {
      it.model_tbd = true;
      reasons.push("Model TBD");
      w("Sheet1", row, id, "warning", "MODEL_TBD", `Model "${model}" -> blank, To verify`);
    } else it.model_number = model || null;

    // Type (11.2)
    const sheetType = t["Type"];
    let type = matchType(sheetType, types);
    if (type && type !== sheetType) w("Sheet1", row, id, "info", "TYPE_NORMALISED", `Type "${raw["Type"]}" -> ${type}`);
    if (!type && sheetType && sheetType.length <= 40) {
      // a type the catalog does not have yet (e.g. "Hard Disk"): created by the import so the sheet's grouping is kept
      type = titleCase(sheetType);
      types.push(type);
      plan.newTypes.push(type);
      w("Sheet1", row, id, "warning", "TYPE_CREATED", `Type "${type}" is new; it is added to the type list (review its loan days in Settings)`);
    }
    if (!type) {
      w("Sheet1", row, id, "error", "BAD_TYPE", `Type blank; set to Accessory, To verify`);
      type = "Accessory";
      reasons.push("Type blank in sheet");
    }
    it.type = type;
    if (type === "Accessory") {
      it.subtype = proposeSubtype(name);
      w("Sheet1", row, id, "info", "SUBTYPE_PROPOSED", `Proposed subtype "${it.subtype}" for review (FR-CAT-004)`);
    }

    // Stock -> quantity mode (11.2)
    const stockTxt = t["Stock"];
    if (!stockTxt.trim()) {
      it.stock = 0;
      it.stock_to_verify = true;
      it.stock_to_verify_reason = "Stock blank in sheet";
      w("Sheet1", row, id, "warning", "STOCK_BLANK", "Stock blank -> 0, To verify");
    } else if (parseStock(stockTxt) === null) {
      it.stock = 0;
      it.stock_to_verify = true;
      it.stock_to_verify_reason = `Stock "${stockTxt}" not a valid whole number`;
      w("Sheet1", row, id, "error", "STOCK_BAD", `Stock "${stockTxt}" not a valid whole number -> 0, To verify`);
    } else {
      it.stock = parseStock(stockTxt)!;
    }
    if (it.stock === 0 && !it.stock_to_verify) {
      it.stock_to_verify = true;
      it.stock_to_verify_reason = "Stock 0 in sheet";
    }
    it.quantity_mode = (rule.quantity_mode as "Single" | "Counted") ?? (it.stock > 1 ? "Counted" : "Single");
    if (it.quantity_mode === "Counted" && it.stock > 1) w("Sheet1", row, id, "info", "COUNTED", `Stock ${it.stock} -> Counted (unless per-unit tagging is decided, OQ-N-03)`);
    if (/TO VERIFY|confirm actual count|confirm count/i.test(t["Notes"])) {
      it.stock_to_verify = true;
      it.stock_to_verify_reason = it.stock_to_verify_reason ?? "Stock marked TO VERIFY / confirm count in sheet";
      w("Sheet1", row, id, "warning", "STOCK_TO_VERIFY", "Notes say the stock is unconfirmed");
    }

    // Photos (11.2, FR-PHO-006/007)
    const stock = linkPhotos(t["Links"], "Stock");
    if (!stock.photos.length) w("Sheet1", row, id, "warning", "NO_STOCK_IMAGE", "No stock image (Missing photos view)");
    if (stock.folder) w("Sheet1", row, id, "warning", "STOCK_LINK_FOLDER", "Stock link is a Drive folder; a Manager must pick the file (FR-PHO-007)");
    if (stock.text && stock.photos.some((p) => p.link_kind === "text")) w("Sheet1", row, id, "warning", "STOCK_LINK_TEXT", `Stock link holds text "${stock.text}"`);
    const latest = linkPhotos(t["Updated links"], "Latest");
    if (!latest.photos.length) w("Sheet1", row, id, "warning", "NO_LATEST", "No latest photo (Missing photos view)");
    else if (latest.photos.every((p) => p.link_kind === "text"))
      w(
        "Sheet1",
        row,
        id,
        "warning",
        "LATEST_TEXT",
        `Updated links holds text "${latest.text}" — no photo; ${/lost/i.test(t["Updated links"]) ? "supports Lost status" : "supports a to-buy link"}`,
      );
    if (latest.photos.filter((p) => p.link_kind !== "text").length > 1)
      w("Sheet1", row, id, "info", "PHOTO_HISTORY", `${latest.photos.length} photo links imported; the first current one is the latest photo`);
    it.photos.push(...stock.photos, ...latest.photos);

    // Condition -> condition + status (11.2)
    const cond = t["Condition"];
    if (cond === "Good" || cond === "Bad condition") it.condition = cond;
    else if (cond === "Repairing") {
      it.status = "In repair";
      it.condition = "Bad condition";
      w("Sheet1", row, id, "info", "CONDITION_STATUS_SPLIT", "Repairing -> status In repair, condition Bad condition, open Repair event");
    } else if (cond === "Lost") {
      it.status = "Lost";
      it.condition = null;
      w("Sheet1", row, id, "info", "CONDITION_STATUS_SPLIT", "Lost -> status Lost (condition blank)");
    } else if (!cond) {
      reasons.push("Condition blank in sheet");
      w("Sheet1", row, id, "warning", "CONDITION_BLANK", "Condition blank -> To verify");
    } else {
      reasons.push(`Condition "${cond}" unknown`);
      w("Sheet1", row, id, "error", "CONDITION_BAD", `Unknown condition "${cond}"`);
    }
    if (cond === "Good" && /lost/i.test(t["Updated links"])) {
      reasons.push("Condition Good but latest photo says lost (MIG-009)");
      w("Sheet1", row, id, "warning", "MIG009_REVIEW", "Condition Good but Updated links says lost: flagged for review, not auto-classified (OQ-N-22)");
    }

    // Ownership from notes (MIG-004)
    if (/belongs to anand|anand's card/i.test(t["Notes"])) {
      if (rule.owner && rule.owner_confirmed) {
        it.owner = person(rule.owner as string, "Sheet1", row, id);
        w("Sheet1", row, id, "info", "OWNER_FROM_NOTES", `Owner ${it.owner} (${rule.source ?? "mapping rule"})`);
      } else {
        reasons.push("Notes say Anand owns it — confirm owner (OQ-N-20)");
        w("Sheet1", row, id, "warning", "OWNER_TO_CONFIRM", "Notes name Anand as owner; kept Madtown until Naveen confirms (MIG-004)");
      }
    }

    // Posession -> holder / holdings / status (11.2, MIG-003)
    const pos = t["Posession"];
    let names = pos
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (pos && pos !== "Lost" && names.some((n) => n.toLowerCase() !== "madtown" && !isPersonName(n))) {
      // a description, not a holder ("Not at office, Anand checking at home"): keep the words, do not create people
      names = [];
      reasons.push(`Posession: "${pos}"`);
      if (/not at (the )?office|missing|unknown|cannot find|can't find|not found/i.test(pos) && it.status === "Available") {
        it.status = "Missing";
        w("Sheet1", row, id, "warning", "POSESSION_TEXT", `Posession "${pos}" -> status Missing, To verify`);
      } else w("Sheet1", row, id, "warning", "POSESSION_TEXT", `Posession "${pos}" is not a person; kept at the office, To verify`);
    }
    const holderName = (n: string) => (n.toLowerCase() === "madtown" ? "Office" : person(n, "Sheet1", row, id));
    if (!pos) {
      if (it.status === "Available") {
        reasons.push("Posession blank in sheet");
        w("Sheet1", row, id, "warning", "POSESSION_BLANK", "Posession blank -> To verify");
      }
      it.holder = "Office";
    } else if (pos === "Lost") {
      it.status = "Lost";
      it.holder = null;
    }
    if (it.status === "Lost" || it.status === "Missing") it.holder = null;

    const custodian = !!rule.custodian;
    if (it.quantity_mode === "Single" && names.length && pos !== "Lost") {
      const first = (rule.primary_holder as string) ?? names[0];
      if (names.length > 1)
        w(
          "Sheet1",
          row,
          id,
          "warning",
          "MULTI_HOLDER_SINGLE",
          `Single item lists several holders "${pos}"; holder ${first}${rule.detached ? ", rest recorded as detached accessories" : " — confirm"}`,
        );
      it.holder = holderName(first);
      const ownHolder = it.holder === it.owner; // a person holding their own item is its custodian, not a borrower (e.g. MTMH_115)
      if (it.holder !== "Office" && it.status === "Available" && !custodian && !ownHolder) {
        plan.loans.push({
          item_id: id,
          borrower: it.holder,
          status: "Open",
          quantity: 1,
          checked_in_at: null,
          note: `Held by ${it.holder} per sheet Posession; no loan record`,
          to_verify: true,
        });
        it.status = "Checked out";
        w("Sheet1", row, id, "warning", "LEGACY_LOAN", `Held by ${it.holder} with no loan: open legacy loan, due blank, To verify (MIG-003, OQ-N-19)`);
      } else if (it.holder !== "Office") w("Sheet1", row, id, "info", "CUSTODIAN", `${it.holder} recorded as custodian (no loan)`);
    }
    if (it.quantity_mode === "Counted") {
      const hs = rule.holdings as { holder?: string; status?: string; qty: number; legacy_loan?: boolean }[] | undefined;
      if (hs) {
        for (const h of hs)
          it.holdings.push({
            holder: h.holder ? holderName(h.holder) : null,
            status: h.status ?? "Available",
            qty: h.qty,
            legacy_loan: h.legacy_loan ?? (h.holder ? holderName(h.holder) !== "Office" : false),
            to_verify: true,
          });
        w("Sheet1", row, id, "info", "HOLDINGS_RULE", `Holdings from mapping rule (${rule.source ?? ""})`);
      } else if (pos === "Lost") it.holdings.push({ holder: null, status: "Lost", qty: it.stock });
      else if (names.length <= 1)
        it.holdings.push({ holder: names[0] ? holderName(names[0]) : "Office", status: "Available", qty: it.stock, legacy_loan: !!names[0] && holderName(names[0]) !== "Office" });
      else {
        // comma-separated holders: one unit per extra holder, rest with the first; quantities to confirm (11.2)
        const firstQty = Math.max(0, it.stock - (names.length - 1));
        names.forEach((n, i) =>
          it.holdings.push({ holder: holderName(n), status: "Available", qty: i === 0 ? firstQty : 1, legacy_loan: holderName(n) !== "Office", to_verify: true }),
        );
        if (it.stock < names.length) w("Sheet1", row, id, "error", "HOLDINGS_EXCEED_STOCK", `Stock ${it.stock} is less than the ${names.length} holders listed`);
        w("Sheet1", row, id, "warning", "MULTI_HOLDER", `"${pos}" -> holdings ${it.holdings.map((h) => `${h.holder} ${h.qty}`).join(", ")} (quantities to confirm)`);
      }
      const sum = it.holdings.reduce((a, h) => a + h.qty, 0);
      if (sum !== it.stock) {
        w("Sheet1", row, id, "error", "HOLDINGS_SUM", `Holdings total ${sum} but stock ${it.stock}; stock set to ${sum}, To verify`);
        it.stock = sum;
        it.stock_to_verify = true;
      }
      for (const h of it.holdings)
        if (h.legacy_loan && h.holder && h.holder !== "Office" && h.status === "Available" && !custodian) {
          plan.loans.push({
            item_id: id,
            borrower: h.holder,
            status: "Open",
            quantity: h.qty,
            checked_in_at: null,
            note: `${h.qty} unit(s) held by ${h.holder} per sheet; no loan record`,
            to_verify: true,
          });
          h.status = "Checked out";
          w("Sheet1", row, id, "warning", "LEGACY_LOAN", `${h.qty} unit(s) with ${h.holder}: open legacy loan, due blank, To verify (MIG-003)`);
        }
      const avail = it.holdings.some((h) => h.status === "Available" && h.qty > 0);
      if (it.status !== "In repair")
        it.status = avail
          ? "Available"
          : it.holdings.some((h) => h.status === "Checked out")
            ? "Checked out"
            : it.holdings.some((h) => h.status === "Missing")
              ? "Missing"
              : it.holdings.some((h) => h.status === "Lost")
                ? "Lost"
                : "Available";
      it.holder = null;
    }
    for (const d of (rule.detached as { description: string; holder: string; reason?: string }[] | undefined) ?? [])
      it.detached.push({ description: d.description, holder: person(d.holder, "Sheet1", row, id), reason: d.reason ?? null });

    // Notes -> structured records (11.3), marked legacy and To verify
    const notes = t["Notes"];
    if (/serviced on 14th july/i.test(notes)) {
      // MIG-005
      plan.maintenance.push({
        item_id: id,
        type: "Service",
        state: "Closed",
        issue: "Serviced (from sheet note 'Serviced on 14th July')",
        cause: null,
        event_date_text: "14 Jul (year to verify)",
        year_to_verify: true,
        to_verify: true,
      });
      w("Sheet1", row, id, "info", "SERVICE_EVENT", "Service event 14 July created, year To verify (MIG-005, OQ-N-21)");
    }
    if (cond === "Repairing") {
      const issue = (notes.match(/sent for repair:?\s*([^.(]+)/i)?.[1] ?? "Repair (from sheet)").trim();
      const cause = notes.match(/damaged in transit because ([^.]+)/i)?.[1] ?? null;
      plan.maintenance.push({
        item_id: id,
        type: "Repair",
        state: /sent for repair/i.test(notes) ? "Sent for repair" : "Reported",
        issue,
        cause: cause ? `${cause} (in transit)` : null,
        event_date_text: null,
        year_to_verify: false,
        to_verify: true,
      });
      w("Sheet1", row, id, "info", "REPAIR_EVENT", "Open Repair event created; vendor and dates unknown (To verify)");
    }
    for (const m of notes.matchAll(/(?:^|[.;]\s*)([A-Za-z][A-Za-z0-9 \-]*?)\s+missing\b/gi)) {
      // MIG-006
      const desc = m[1].trim().replace(/^(all|a few)\s+/i, (x) => x);
      if (/^(one|stock)\b/i.test(desc) || /is missing/i.test(m[0])) continue;
      for (const part of desc.split(/\s+and\s+/i)) {
        const pd = part.trim();
        if (!pd) continue;
        plan.missingParts.push({ item_id: id, description: pd.charAt(0).toUpperCase() + pd.slice(1) });
        w("Sheet1", row, id, "info", "MISSING_PART", `Missing part "${pd}" recorded (MIG-006, legacy, To verify)`);
      }
    }
    if (it.status === "Lost" || cond === "Lost") {
      // MIG-007
      const place = notes.match(/during the (.+? shoot)/i)?.[1] ?? notes.match(/\bat (?:the )?(.+?)(?:\.|,| by |\(|$)/i)?.[1]?.trim() ?? null;
      const unknown = /unknown|not sure/i.test(notes);
      plan.incidents.push({
        item_id: id,
        type: "Loss",
        quantity: it.quantity_mode === "Counted" ? it.stock : 1,
        description: notes || "Lost (from sheet)",
        history_known: !unknown && !!notes,
        last_seen_place: place,
        last_seen_at_text: notes.match(/(a couple of years ago|a long time ago)/i)?.[1] ?? null,
        responsible: null,
        last_known_holder: null,
      });
      w("Sheet1", row, id, "info", "INCIDENT", `Loss incident created${unknown ? " (history unknown, FR-LST-003)" : ""}`);
    }
    const partial = notes.match(/\b(one|two|three)\b(?:\s+\w+)?\s+lost\b/i);
    if (partial && it.status !== "Lost") {
      // MIG-007 partial losses (145, 138)
      const word = partial[1].toLowerCase();
      const qty = { one: 1, two: 2, three: 3 }[word as "one"] ?? 1;
      const place = notes.match(/lost at ([^.,]+?)(?: by |[.,])/i)?.[1]?.trim() ?? null;
      const who = notes.match(/lost at [^.,]+? by (\w+)/i)?.[1] ?? null;
      const isBatteries = /battery|batteries/i.test(notes) && it.type === "Drone";
      plan.incidents.push({
        item_id: id,
        type: "Loss",
        quantity: qty,
        description: isBatteries ? `${qty} of 3 batteries lost (from sheet notes)` : notes,
        history_known: true,
        last_seen_place: place,
        last_seen_at_text: null,
        responsible: who ? person(who, "Sheet1", row, id) : null,
        last_known_holder: who ? person(who, "Sheet1", row, id) : null,
      });
      w("Sheet1", row, id, "info", "PARTIAL_LOSS", `Partial loss: ${qty}${place ? ` at ${place}` : ""}${who ? `, responsible ${who}` : ""} (FR-LST-004)`);
    }
    const ln = notes.match(/loaned to (\w+)[^.]*?(?:;|\.)\s*returned by \1 on ([0-9]{1,2} [A-Za-z]{3} [0-9]{4})/i); // MIG-008 103
    if (ln) {
      plan.loans.push({
        item_id: id,
        borrower: person(ln[1], "Sheet1", row, id),
        status: "Returned",
        quantity: 1,
        checked_in_at: parseSheetDate(t["Checked In Date"]) ?? parseSheetDate(ln[2]),
        note: "Legacy loan from sheet notes; check-out date unknown",
        to_verify: true,
      });
      w("Sheet1", row, id, "info", "LEGACY_LOAN_RETURNED", `Returned legacy loan for ${ln[1]} (check-out date unknown)`);
    } else if (t["Checked In Date"]) w("Sheet1", row, id, "warning", "CHECKIN_WITHOUT_LOAN", `Checked In Date "${t["Checked In Date"]}" without a borrower in notes`);
    const ln2 = notes.match(/loaned to (\w+) for [^;.]*; not returned/i); // MIG-008 130 (open loan to holder)
    if (ln2 && !plan.loans.some((l) => l.item_id === id && l.status === "Open")) {
      plan.loans.push({
        item_id: id,
        borrower: person(ln2[1], "Sheet1", row, id),
        status: "Open",
        quantity: 1,
        checked_in_at: null,
        note: "Legacy open loan from sheet notes",
        to_verify: true,
      });
      if (it.quantity_mode === "Single") it.status = "Checked out";
    }
    if (rule.legacy_loan) {
      // MIG-008 138 (unknown borrower, returned damaged)
      const ll = rule.legacy_loan as { borrower: string; status: "Returned" | "Open"; condition_in?: string };
      plan.loans.push({
        item_id: id,
        borrower: person(ll.borrower, "Sheet1", row, id),
        status: ll.status,
        quantity: 1,
        checked_in_at: null,
        condition_in: ll.condition_in ?? null,
        note: "Legacy loan from sheet notes: borrower unknown",
        to_verify: true,
      });
      w("Sheet1", row, id, "info", "LEGACY_LOAN_RETURNED", "Returned legacy loan, borrower unknown, returned damaged (MIG-008)");
    }
    const buy = notes.match(/bought from ([A-Za-z ]+?) on ([0-9]{1,2} [A-Za-z]{3} [0-9]{4}), order ([A-Z0-9/\-]+), Rs ([0-9,]+)(?: (incl GST))?/i); // FR-CAT-012
    if (buy) {
      plan.financials.push({
        item_id: id,
        purchase_date: parseSheetDate(buy[2])?.slice(0, 10) ?? null,
        vendor: buy[1].trim(),
        order_ref: buy[3],
        purchase_price: +buy[4].replace(/,/g, ""),
        price_note: buy[5] ?? null,
      });
      plan.orders.push({
        vendor: buy[1].trim(),
        order_ref: buy[3],
        order_date: parseSheetDate(buy[2])?.slice(0, 10) ?? null,
        status: "Delivered",
        amount: +buy[4].replace(/,/g, ""),
        item_id: id,
      });
      const canc = notes.match(/order ([A-Z0-9/\-]+) cancelled/i);
      if (canc) plan.orders.push({ vendor: buy[1].trim(), order_ref: canc[1], order_date: null, status: "Cancelled", amount: null, item_id: id });
      w("Sheet1", row, id, "info", "PURCHASE_PARSED", `Purchase details parsed: ${buy[1].trim()}, ${buy[3]}${canc ? `; cancelled order ${canc[1]}` : ""} (price restricted)`);
    }
    if (/needs a (proper )?(carry bag|case)|no proper case|retail box/i.test(notes)) {
      it.needs_case = true;
      w("Sheet1", row, id, "info", "NEEDS_CASE", "Flagged: no proper case (FR-KIT-008)");
    }
    if (/details to come|need details/i.test(notes)) reasons.push("Details to come from Anand");
    if (t["Checked Out For"] || t["Checked Out Date"]) {
      plan.loans.push({
        item_id: id,
        borrower: person(t["Checked Out For"] || "Unknown borrower (legacy)", "Sheet1", row, id),
        status: "Open",
        quantity: 1,
        checked_in_at: null,
        note: `Checked out ${t["Checked Out Date"]} per sheet`,
        to_verify: true,
      });
      w("Sheet1", row, id, "warning", "CHECKED_OUT_COLUMNS", "Checked Out For/Date populated: loan created");
    }
    plan.items.push(it);
  }
  const ids = plan.items.map((i) => +i.id.slice(5)).sort((a, b) => a - b);
  for (let i = 1; i < ids.length; i++)
    if (ids[i] !== ids[i - 1] + 1) w("Sheet1", null, null, "info", "ID_GAP", `Gap between MTMH_${ids[i - 1]} and MTMH_${ids[i]} (gaps stay as gaps, MIG-002)`);
  for (const it of plan.items)
    if (it.parent && !seen.has(it.parent)) {
      w("Sheet1", it.sheet_row, it.id, "error", "PARENT_MISSING", `Parent ${it.parent} not in sheet`);
      it.parent = null;
    }

  // ------------------------------------------------------------------ To buy (MIG-011, 11.4)
  for (const { row, cells } of parseCsv(toBuy, TOBUY_HEADERS, "To buy", W)) {
    const t = Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, (v ?? "").trim()]));
    if (!t["Item"]) continue;
    const ref = `To buy:${row}`;
    const rule = (rules[ref] ?? {}) as { expand_ranges?: boolean };
    const { explicit, ranges } = expandIds(t["Related item ID"]);
    const related = [...new Set([...explicit, ...(rule.expand_ranges ? ranges : [])])].filter((x) => {
      if (!seen.has(x)) {
        w("To buy", row, ref, "warning", "RELATED_UNKNOWN", `${x} not in Sheet1`);
        return false;
      }
      return true;
    });
    if (ranges.length && !rule.expand_ranges)
      w(
        "To buy",
        row,
        ref,
        "warning",
        "RANGE_NOT_EXPANDED",
        `"${t["Related item ID"]}" mentions ${ranges[0]} to ${ranges[ranges.length - 1]}; expanded only after confirmation (MIG-011)`,
      );
    const roa = t["Replaces or adds"];
    const primary: "Replaces" | "Adds" = /^replaces/i.test(roa) ? "Replaces" : "Adds";
    const roaNote = roa.replace(/^(replaces|adds)\b/i, "").trim() || null;
    if (!/^(replaces|adds)/i.test(roa)) w("To buy", row, ref, "warning", "ROA_UNKNOWN", `Replaces or adds "${roa}" -> Adds`);
    const pri = (["High", "Medium", "Low"].includes(t["Priority"]) ? t["Priority"] : "Medium") as "High" | "Medium" | "Low";
    if (pri !== t["Priority"]) w("To buy", row, ref, "warning", "PRIORITY_DEFAULT", `Priority "${t["Priority"]}" -> Medium`);
    const st = mapWishlistStatus(t["Status"]);
    const sheetStatus = st !== t["Status"] ? t["Status"] || null : null;
    if (sheetStatus) w("To buy", row, ref, "warning", "STATUS_MAPPED", `Status "${t["Status"]}" -> ${st} (original text kept in notes)`);
    plan.wishlist.push({
      sheet_row: row,
      raw: cells,
      item_description: t["Item"],
      reason: t["Reason"],
      related,
      replaces_or_adds: primary,
      replaces_or_adds_note: roaNote,
      priority: pri,
      status: st,
      sheet_status: sheetStatus,
      verify_first: /confirm (count|with)|verify/i.test(`${t["Item"]} ${t["Notes"]}`),
      notes: [sheetStatus ? `Sheet status: ${sheetStatus}` : "", t["Notes"]].filter(Boolean).join("\n") || null,
    });
  }
  // link missing parts to matching to-buy lines (AC-KIT-03)
  const kw = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((x) => x.length > 3 && !["missing", "with", "from"].includes(x));
  for (const mp of plan.missingParts) {
    const hit = plan.wishlist.find((wl) => wl.related.includes(mp.item_id) && kw(mp.description).every((k) => wl.item_description.toLowerCase().includes(k.replace(/s$/, ""))));
    if (hit) (mp as { wishlist_row?: number }).wishlist_row = hit.sheet_row;
  }

  // ------------------------------------------------------------------ Not yet sorted (MIG-012, MIG-013)
  for (const { row, cells } of parseCsv(unsorted, UNSORTED_HEADERS, "Not yet sorted", W)) {
    const t = Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, (v ?? "").trim()]));
    if (!t["Item"]) continue;
    const status = mapUnsortedStatus(t["Status"]);
    const sheetStatus = status !== t["Status"] ? t["Status"] || null : null;
    if (sheetStatus)
      W.push({ tab: "Not yet sorted", row, ref: null, level: "info", code: "STATUS_MAPPED", message: `Status "${t["Status"]}" -> ${status} (original text kept in notes)` });
    const mentioned = expandIds(t["Status"]);
    const linked = [...new Set([...mentioned.explicit, ...mentioned.ranges])].filter((x) => seen.has(x));
    // rows the team already moved into Sheet1 name the item ids in Status; those are links, not duplicates
    const dup = linked.length
      ? undefined
      : plan.items.find(
          (i) => i.name.toLowerCase().includes(t["Item"].toLowerCase().replace(/ sd card$/, "")) || (t["Item"].toLowerCase().includes(i.name.toLowerCase()) && i.name.length > 8),
        );
    if (dup)
      W.push({
        tab: "Not yet sorted",
        row,
        ref: dup.id,
        level: "warning",
        code: "DUPLICATE_CANDIDATE",
        message: `Possible duplicate of ${dup.id} ${dup.name}; held for verification (MIG-013)`,
      });
    plan.unsorted.push({
      sheet_row: row,
      item: t["Item"],
      known: t["What we know"],
      question: t["Question"],
      who: t["Who can answer"],
      status,
      duplicate_of: dup?.id ?? null,
      converted_item_ids: linked,
      notes: sheetStatus ? `Sheet status: ${sheetStatus}` : null,
    });
  }
  for (const it of plan.items) if (it.to_verify_reasons.length) it.to_verify_reasons = [...new Set(it.to_verify_reasons)];
  return plan;
}

export function summarize(p: Plan) {
  const by = (k: string) => p.items.filter((i) => i.status === k).length;
  return {
    items: p.items.length,
    single: p.items.filter((i) => i.quantity_mode === "Single").length,
    counted: p.items.filter((i) => i.quantity_mode === "Counted").length,
    available: by("Available"),
    checked_out: by("Checked out"),
    in_repair: by("In repair"),
    lost: by("Lost"),
    missing: by("Missing"),
    to_verify: p.items.filter((i) => i.to_verify_reasons.length || i.stock_to_verify || i.model_tbd).length,
    legacy_loans: p.loans.length,
    maintenance: p.maintenance.length,
    incidents: p.incidents.length,
    missing_parts: p.missingParts.length,
    wishlist: p.wishlist.length,
    unsorted: p.unsorted.length,
    types_created: p.newTypes.length,
    people_created: p.people.length,
    orders: p.orders.length,
    errors: p.warnings.filter((w) => w.level === "error").length,
    warnings: p.warnings.filter((w) => w.level === "warning").length,
  };
}
