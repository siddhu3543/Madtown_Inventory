import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Madtown Inventory", template: "%s · Madtown Inventory" },
  description: "Madtown equipment inventory",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: "Inventory", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2b3ea8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        {/* applies the saved theme and sidebar mode before first paint (no flash) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var d=document.documentElement,t=localStorage.getItem("mt-theme");if(t==="light"||t==="dark")d.dataset.theme=t;if(localStorage.getItem("mt-rail")==="1")d.dataset.rail="1"}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
