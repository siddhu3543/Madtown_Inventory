import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPlan, driveLink, proposeSubtype, deriveBrand, parseSheetDate, summarize } from "@/lib/importer/plan";

const S1 = "Item ID,Item name,Model Number,Type,Stock,Links,Updated links,Notes,Condition,Posession,Checked Out For,Checked Out Date,Checked In Date\n";
const TB = "Item,Reason,Related item ID,Replaces or adds,Priority,Status,Notes\n";
const NS = "Item,What we know,Question,Who can answer,Status\n";
const plan = (rows: string, rules = {}, tb = "", ns = "") => buildPlan(S1 + rows, TB + tb, NS + ns, rules, ["Kittu", "Anand", "Chiru", "Nagi", "Samuel", "Purushotham"]);

describe("11.2 column mapping", () => {
  it("MIG-001 trims; duplicate IDs rejected; bad IDs skipped", () => {
    const p = plan(`MTMH_145 ,"Card  name ",,SD Card,1,,,,Good,Madtown,,,\nMTMH_145,Dup,,SD Card,1,,,,Good,Madtown,,,\nXYZ,Bad,,Light,1,,,,Good,Madtown,,,\n`);
    expect(p.items.map((i) => i.id)).toEqual(["MTMH_145"]);
    expect(p.items[0].name).toBe("Card name");
    expect(p.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["ID_TRIMMED", "NAME_TRIMMED", "DUPLICATE_ID", "BAD_ID"]));
  });
  it("Model TBD -> blank + to verify; Backdrops -> Backdrop; 'Light accessory ' normalised; Accessory gets subtype", () => {
    const p = plan(
      `MTMH_202,Lighting Umbrella,"TBD, Naveen to provide",Light accessory ,,,,,,,,,\nMTMH_194,Backdrop A,,Backdrops,1,,,,Good,Madtown,,,\nMTMH_189,Magic line Photo Studio Trolley Case,,Accessory,1,,,,Good,Madtown,,,\n`,
    );
    const [a, b, c] = p.items;
    expect(a).toMatchObject({ model_number: null, model_tbd: true, type: "Light accessory", stock: 0, stock_to_verify: true });
    expect(a.to_verify_reasons).toEqual(expect.arrayContaining(["Model TBD", "Condition blank in sheet", "Posession blank in sheet"]));
    expect(b.type).toBe("Backdrop");
    expect(c.subtype).toBe("Bag or case");
  });
  it("Condition Repairing/Lost become statuses; blank -> to verify; Good + 'lost' photo -> MIG-009 review", () => {
    const p = plan(
      `MTMH_106,Lens,,Lens,1,,,"Sent for repair: issue with zoom. Damaged in transit because the lens cells shifted inside the carrier.",Repairing,Anand,,,\nMTMH_111,Tripod,,Tripod,1,,,"Lost a long time ago; how and when unknown.",Lost,Lost,,,\nMTMH_114,Reflector,,Reflector,1,,lost,,Good,Kittu,,,\n`,
      { MTMH_106: { custodian: true } },
    );
    expect(p.items[0]).toMatchObject({ status: "In repair", condition: "Bad condition", holder: "Anand" });
    expect(p.maintenance.find((m) => m.item_id === "MTMH_106")).toMatchObject({ type: "Repair", state: "Sent for repair" });
    expect(p.items[1]).toMatchObject({ status: "Lost", condition: null, holder: null });
    expect(p.incidents.find((i) => i.item_id === "MTMH_111")).toMatchObject({ history_known: false });
    expect(p.warnings.find((w) => w.code === "MIG009_REVIEW")?.ref).toBe("MTMH_114");
  });
  it("Stock 1 Single, >1 Counted; comma holders become holdings; persons become legacy loans (MIG-003)", () => {
    const p = plan(`MTMH_110,Tripod,,Tripod,2,,,,Good,"Madtown, Kittu",,,\nMTMH_148,Bag,,Accessory,1,,,,Good,Chiru,,,\n`);
    expect(p.items[0]).toMatchObject({ quantity_mode: "Counted", stock: 2 });
    expect(p.items[0].holdings).toEqual([
      expect.objectContaining({ holder: "Office", qty: 1, status: "Available" }),
      expect.objectContaining({ holder: "Kittu", qty: 1, status: "Checked out" }),
    ]);
    expect(p.items[1]).toMatchObject({ quantity_mode: "Single", status: "Checked out", holder: "Chiru" });
    expect(p.loans.map((l) => `${l.item_id}:${l.borrower}:${l.status}`)).toEqual(["MTMH_110:Kittu:Open", "MTMH_148:Chiru:Open"]);
  });
  it("an owner holding their own item is a custodian, not a borrower (MTMH_115)", () => {
    const p = plan(`MTMH_115,Godox V1S Flash,V1S,Light,1,,,"Belongs to Anand, not Madtown (per Naveen, 16 Oct 2026).",Good,Anand,,,\n`, {
      MTMH_115: { owner: "Anand", owner_confirmed: true },
    });
    expect(p.items[0]).toMatchObject({ owner: "Anand", holder: "Anand", status: "Available" });
    expect(p.loans).toHaveLength(0);
  });
  it("MIG-004 ownership waits for confirmation", () => {
    const p = plan(`MTMH_187,SanDisk Extreme 128GB,,SD Card,1,,,Anand's Card,Good,Madtown,,,\n`);
    expect(p.items[0].owner).toBe("Madtown");
    expect(p.items[0].to_verify_reasons.join()).toMatch(/confirm owner/);
  });
  it("Links: file, folder, text, blank (FR-PHO-006/007)", () => {
    expect(driveLink("https://drive.google.com/file/d/1AbC_x-9/view?usp=sharing")).toEqual({ kind: "file", id: "1AbC_x-9" });
    expect(driveLink("https://drive.google.com/drive/folders/1Fold")).toEqual({ kind: "folder", id: "1Fold" });
    expect(driveLink("https://drive.google.com/open?id=1Open")).toEqual({ kind: "file", id: "1Open" });
    expect(driveLink("Need replacement").kind).toBe("text");
    expect(driveLink("  ").kind).toBe("none");
  });
});

describe("11.3 notes parsing", () => {
  it("MIG-005 service, MIG-006 missing parts, MIG-008 loans, FR-CAT-012 purchase, partial loss", () => {
    const p = plan(
      [
        `MTMH_103,Sony A74,ILCE-7M4,Camera,1,,,"Serviced on 14th July. Was loaned to Chiru; returned by Chiru on 16 Oct 2026 (not 15 Oct).",Good,Madtown,,,"Friday, October 16, 2026"`,
        `MTMH_150,DJI Osmo Pocket 3,,Camera,1,,,Windscreen and charging cable missing.,Good,Madtown,,,`,
        `MTMH_145,Lexar card,X,SD Card,3,,,"One card lost at Shorefest by Samuel, who was responsible for it.",Good,"Nagi, Kittu",,,`,
        `MTMH_203,NEEWER X17 II,X17 II,Accessory,1,,,"Bought from Kamal Imaging on 19 Sep 2026, order KI/SO/30101, Rs 21,999 incl GST (order KI/SO/30093 cancelled).",Good,,,,`,
      ].join("\n") + "\n",
    );
    expect(p.maintenance.find((m) => m.item_id === "MTMH_103")).toMatchObject({ type: "Service", year_to_verify: true });
    expect(p.loans.find((l) => l.item_id === "MTMH_103")).toMatchObject({ borrower: "Chiru", status: "Returned", checked_in_at: "2026-10-16T12:00:00+05:30" });
    expect(p.missingParts.filter((m) => m.item_id === "MTMH_150").map((m) => m.description)).toEqual(["Windscreen", "Charging cable"]);
    expect(p.incidents.find((i) => i.item_id === "MTMH_145")).toMatchObject({ quantity: 1, last_seen_place: "Shorefest", responsible: "Samuel" });
    expect(p.financials[0]).toMatchObject({ vendor: "Kamal Imaging", order_ref: "KI/SO/30101", purchase_price: 21999, purchase_date: "2026-09-19", price_note: "incl GST" });
    expect(p.orders.map((o) => `${o.order_ref}:${o.status}`)).toEqual(["KI/SO/30101:Delivered", "KI/SO/30093:Cancelled"]);
  });
});

describe("11.4 To buy and Not yet sorted (MIG-011/012/013)", () => {
  it("parses related IDs, keeps ranges for confirmation, primary value + note", () => {
    const p = plan(
      `MTMH_106,Lens,,Lens,1,,,,Good,Madtown,,,\nMTMH_101,FX3,,Camera,1,,,,Good,Madtown,,,\n`,
      {},
      `Hard camera and lens case,Transit damage,MTMH_106 (and camera and lens items MTMH_101 to 108),Adds (replaces soft carrier for transport),High,To buy,\n`,
      `SanDisk Extreme 128GB SD card,maybe MTMH_187,dup?,Anand,To verify\n`,
    );
    expect(p.wishlist[0]).toMatchObject({
      related: ["MTMH_106"],
      replaces_or_adds: "Adds",
      replaces_or_adds_note: "(replaces soft carrier for transport)",
      priority: "High",
      status: "To buy",
    });
    expect(p.warnings.map((w) => w.code)).toContain("RANGE_NOT_EXPANDED");
    const p2 = plan(
      `MTMH_106,Lens,,Lens,1,,,,Good,Madtown,,,\nMTMH_101,FX3,,Camera,1,,,,Good,Madtown,,,\n`,
      { "To buy:2": { expand_ranges: true } },
      `Case,x,MTMH_106 (and MTMH_101 to 108),Adds,High,To buy,\n`,
    );
    expect(p2.wishlist[0].related.sort()).toEqual(["MTMH_101", "MTMH_106"]); // only ids that exist
  });
});

describe("full synthetic fixture", () => {
  it("summary matches the spec's counts", () => {
    const p = buildPlan(
      readFileSync("fixtures/sheet/Sheet1.csv", "utf8"),
      readFileSync("fixtures/sheet/To buy.csv", "utf8"),
      readFileSync("fixtures/sheet/Not yet sorted.csv", "utf8"),
      JSON.parse(readFileSync("fixtures/mapping-rules.json", "utf8")),
      ["Kittu", "Anand", "Chiru", "Nagi", "Samuel", "Purushotham"],
    );
    const s = summarize(p);
    expect(s).toMatchObject({ items: 103, lost: 5, in_repair: 1, wishlist: 25, unsorted: 10, errors: 0 });
    expect(p.warnings.filter((w) => w.code === "STOCK_LINK_FOLDER").map((w) => w.ref)).toEqual(["MTMH_101", "MTMH_102", "MTMH_103", "MTMH_110", "MTMH_112", "MTMH_119"]);
    expect(p.warnings.filter((w) => w.code === "LATEST_TEXT")).toHaveLength(11);
    expect(p.warnings.filter((w) => w.code === "NO_STOCK_IMAGE")).toHaveLength(10);
  });
  it("helpers", () => {
    expect(proposeSubtype("Sony BC-QZ1 Battery Charger")).toBe("Charger");
    expect(proposeSubtype("SmallRig Cage for FX3")).toBe("Rig part");
    expect(deriveBrand("NISI UV Filter 62mm")).toBe("NISI");
    expect(parseSheetDate("Friday, October 16, 2026")).toBe("2026-10-16T12:00:00+05:30");
  });
});
