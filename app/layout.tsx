import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CreditBook — Qarz daftari",
  description: "Do'kon qarzlari va to'lovlarini oson yuriting.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
