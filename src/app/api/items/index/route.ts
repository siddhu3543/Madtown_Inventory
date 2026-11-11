import { api } from "@/lib/api";
import { itemIndex } from "@/lib/services/items";
/** Compact index cached by the service worker for offline lookup (NFR-013). No financial fields. */
export const GET = api(async (u) => ({ items: await itemIndex(u), at: new Date().toISOString() }));
