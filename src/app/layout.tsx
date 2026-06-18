import "~/styles/globals.css";

import { type Metadata, type Viewport } from "next";
import { Geist } from "next/font/google";

import { PwaRegister } from "~/app/_components/pwa-register";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
  title: "ThreadWise",
  description: "Read-only AI conversation viewer for Gmail threads",
  applicationName: "ThreadWise",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "ThreadWise",
    statusBarStyle: "black-translucent",
  },
  icons: [{ rel: "icon", url: "/threadwise-icon.svg", type: "image/svg+xml" }],
};

export const viewport: Viewport = {
  themeColor: "#0b0f0d",
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable}`}>
      <body className="bg-[#0b0f0d] text-stone-100 antialiased">
        <PwaRegister />
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </body>
    </html>
  );
}
