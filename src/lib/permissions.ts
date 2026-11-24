/**
 * Two roles (2026-11-24), mirrored for the UI so controls a role cannot use are hidden.
 *   Admin — sees and does everything.
 *   Staff — runs the check-out / check-in desk: find and scan items, check out to a borrower (adding a new
 *           borrower if needed), check in, report damage / loss / missing parts, take the photos those need.
 * The database (RLS + workflow checks) is authoritative (NFR-004); never rely on this alone.
 */
import type { CurrentUser } from "./auth";
type U = Pick<CurrentUser, "role" | "financeVisible" | "isDeveloper">;
const admin = (u: U) => u.role === "Admin";
const anyone = (u: U) => u.role === "Admin" || u.role === "Staff";

export const can = {
  // ---- the desk: Staff and Admin
  checkoutSelf: anyone,
  checkoutOthers: anyone,
  checkin: anyone,
  report: anyone,
  uploadPhotos: anyone,
  // ---- Admin only
  admin,
  editItems: admin,
  retireDirect: admin,
  deleteItem: admin,
  override: admin,
  repairs: admin,
  proposeBuy: admin,
  approveBuy: admin,
  orders: admin,
  viewOrders: admin,
  walkthrough: admin,
  walkthroughAssist: admin,
  applyCorrections: admin,
  globalAudit: admin,
  itemAudit: admin,
  settings: admin,
  labels: admin,
  kits: admin,
  reservations: admin,
  reports: admin,
  lostAndFound: admin,
  people: admin,
  importReview: (u: U) => admin(u) || u.isDeveloper,
  unsorted: (u: U) => admin(u) || u.isDeveloper,
  finance: (u: U) => admin(u) && u.financeVisible,
};
