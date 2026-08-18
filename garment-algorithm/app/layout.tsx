import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Garment Algorithm",
  description:
    "Upload a fashion photograph, select a garment, and apply an algorithmic treatment inside it — the rest of the image stays untouched."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
