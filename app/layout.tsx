import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CreditBook — Simple credit tracking",
  description:
    "A simple digital credit ledger for small shops to track customer debts and payments.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
