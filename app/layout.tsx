import type { Metadata } from "next";
import { DM_Mono, Manrope, Newsreader } from "next/font/google";
import "./globals.css";

const sans = Manrope({ variable: "--font-sans", subsets: ["latin"] });
const serif = Newsreader({ variable: "--font-serif", subsets: ["latin"], style: ["normal", "italic"] });
const mono = DM_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "RoleFit Studio — local LaTeX resume builder",
  description: "Edit, version, tailor, and compile a complete LaTeX resume project locally.",
  applicationName: "RoleFit Studio",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "RoleFit", statusBarStyle: "black-translucent" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body suppressHydrationWarning className={`${sans.variable} ${serif.variable} ${mono.variable}`}>{children}</body></html>;
}
