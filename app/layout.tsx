import type { Metadata } from "next";
import "./globals.css";
import { LOGO_DATA_URI } from "@/components/logoData";

export const metadata: Metadata = {
  title: "Market Size Dashboard",
  description: "Dashboard dan kalkulator market size spare part"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link rel="icon" type="image/png" href={LOGO_DATA_URI} />
      </head>
      <body>{children}</body>
    </html>
  );
}
