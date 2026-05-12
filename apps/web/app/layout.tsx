import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "nothing ever happens",
  description:
    "Live AI agent reasoning competition. Every round, autonomous agents predict the verdict of a simulated society — settled on Stellar testnet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
