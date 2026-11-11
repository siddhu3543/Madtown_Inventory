import { describe, expect, it } from "vitest";
import { isAllowedEmail } from "@/lib/auth/domain";
import { fmtDate, fmtDateTime, fmtRs, istParts, fromIstInput, toIstInput } from "@/lib/format";
import { parseScan } from "@/components/Scanner";
import { parseIdList } from "@/lib/qr";
import { toAppError } from "@/lib/errors";

describe("NFR-003 / AC-NFR-01 domain rule", () => {
  it.each([
    ["naveen@madtown.in", true],
    ["Anand@MADTOWN.IN ", true],
    ["x@gmail.com", false],
    ["x@madtown.in.evil.com", false],
    ["x@evilmadtown.in", false],
    ["madtown.in", false],
    ["a@b@madtown.in", false],
    ["", false],
    [null, false],
  ])("%s -> %s", (e, ok) => expect(isAllowedEmail(e as string)).toBe(ok));
});

describe("NFR-020 IST formats", () => {
  it("dates like 16 Oct 2026 and times in IST", () => {
    expect(fmtDate("2026-10-16T12:00:00+05:30")).toBe("16 Oct 2026");
    expect(fmtDate("2026-10-15T20:00:00Z")).toBe("16 Oct 2026"); // 01:30 IST next day
    expect(fmtDate("2026-09-19")).toBe("19 Sep 2026");
    expect(fmtDateTime("2026-11-10T03:30:00Z")).toBe("10 Nov 2026, 09:00 IST");
    expect(fmtRs(21999)).toBe("Rs 21,999");
    expect(fmtRs("185000")).toBe("Rs 1,85,000");
  });
  it("round-trips datetime-local values as IST", () => {
    expect(fromIstInput("2026-11-12T18:00")).toBe("2026-11-12T12:30:00.000Z");
    expect(toIstInput("2026-11-12T12:30:00.000Z")).toBe("2026-11-12T18:00");
    expect(istParts(new Date("2026-11-09T03:30:00Z"))).toMatchObject({ hh: 9, dow: 1, dateKey: "2026-11-09" }); // Monday 09:00 IST
  });
});

describe("FR-QR-001/002/006 scan parsing and label ranges", () => {
  it("parses our QR URLs, bare IDs and kits", () => {
    expect(parseScan("https://inventory.madtown.in/i/MTMH_104")).toEqual({ kind: "item", id: "MTMH_104" });
    expect(parseScan("https://staging.example.com/i/MTMH_141-02?x=1")).toEqual({ kind: "item", id: "MTMH_141-02" });
    expect(parseScan("https://inventory.madtown.in/k/KIT_001")).toEqual({ kind: "kit", id: "KIT_001" });
    expect(parseScan("mtmh_101")).toEqual({ kind: "item", id: "MTMH_101" });
    expect(parseScan("hello")).toBeNull();
  });
  it("expands label id lists (AC-QR-01)", () => {
    expect(parseIdList("101-110")).toHaveLength(10);
    expect(parseIdList("MTMH_101, 115 MTMH_141-01")).toEqual(["MTMH_101", "MTMH_115", "MTMH_141-01"]);
  });
});

describe("workflow error mapping", () => {
  it("maps CODE: messages and constraint violations", () => {
    expect(toAppError({ message: "ALREADY_OUT: MTMH_103 is already checked out" })).toMatchObject({ code: "ALREADY_OUT", status: 400 });
    expect(toAppError({ message: "dup", code: "23505", constraint: "loan_lines_single_active" })).toMatchObject({ code: "ALREADY_OUT", status: 409 });
    expect(toAppError({ message: "NOT_ALLOWED: no" })).toMatchObject({ status: 403 });
  });
});
