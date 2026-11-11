import QRCode from "qrcode";
import { env } from "./env";
/** FR-QR-001: short stable URL inventory.madtown.in/i/MTMH_101 (domain configurable; path stable, A3) */
export const qrUrl = (kind: "item" | "kit", id: string) => `${env.qrBaseUrl}/${kind === "kit" ? "k" : "i"}/${id}`;
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}
/** "101-110, 115, MTMH_120" -> ids */
export function parseIdList(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(/[\s,]+/).filter(Boolean)) {
    const r = part
      .toUpperCase()
      .replace(/MTMH_/g, "")
      .match(/^(\d{3})-(\d{3})$/);
    if (r) {
      for (let i = +r[1]; i <= +r[2]; i++) out.push(`MTMH_${i}`);
      continue;
    }
    if (/^\d{3,}(-\d{2})?$/.test(part)) out.push(`MTMH_${part}`);
    else out.push(part.toUpperCase());
  }
  return [...new Set(out)];
}
