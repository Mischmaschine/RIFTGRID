import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "RIFTGRID — The operating system for game servers", description: "Deploy and operate game infrastructure through one desired-state control plane." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
