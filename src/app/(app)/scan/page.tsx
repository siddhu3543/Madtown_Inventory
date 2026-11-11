import { Scanner } from "@/components/Scanner";
import { PageHeader } from "@/components/ui";
export const metadata = { title: "Scan" };
export default function ScanPage() {
  return (
    <>
      <PageHeader title="Scan" sub="Point the camera at a Madtown QR label. Your phone's own camera app also opens item pages directly." />
      <Scanner />
    </>
  );
}
