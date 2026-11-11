/**
 * Section 9 permission matrix, mirrored for the UI so controls a role cannot use are hidden.
 * The database (RLS + workflow checks) is authoritative (NFR-004); never rely on this alone.
 */
import type { CurrentUser } from "./auth";
type U = Pick<CurrentUser, "role" | "financeVisible" | "isDeveloper">;
export const can = {
  editItems: (u: U) => u.role === "Owner" || u.role === "Manager",
  retireDirect: (u: U) => u.role === "Owner",
  proposeRetire: (u: U) => u.role === "Manager",
  deleteItem: (u: U) => u.role === "Owner",
  checkoutSelf: (u: U) => u.role !== "Read-only",
  checkoutOthers: (u: U) => u.role === "Owner" || u.role === "Manager",
  checkin: (u: U) => u.role !== "Read-only",
  override: (u: U) => u.role === "Owner" || u.role === "Manager",
  report: (u: U) => u.role !== "Read-only",
  uploadPhotos: (u: U) => u.role !== "Read-only",
  repairs: (u: U) => u.role === "Owner" || u.role === "Manager",
  proposeBuy: (u: U) => u.role !== "Read-only",
  approveBuy: (u: U) => u.role === "Owner",
  orders: (u: U) => u.role === "Owner" || u.role === "Manager",
  viewOrders: (u: U) => u.role !== "Team member",
  walkthrough: (u: U) => u.role === "Owner" || u.role === "Manager",
  walkthroughAssist: (u: U) => u.role !== "Read-only",
  applyCorrections: (u: U) => u.role === "Owner" || u.role === "Manager",
  globalAudit: (u: U) => u.role === "Owner",
  itemAudit: (u: U) => u.role === "Owner" || u.role === "Manager",
  settings: (u: U) => u.role === "Owner",
  labels: (u: U) => u.role === "Owner" || u.role === "Manager",
  importReview: (u: U) => u.role === "Owner" || u.isDeveloper,
  unsorted: (u: U) => u.role === "Owner" || u.role === "Manager" || u.isDeveloper,
  finance: (u: U) => u.financeVisible,
  people: (u: U) => u.role === "Owner" || u.role === "Manager",
};
