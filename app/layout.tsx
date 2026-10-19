import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "./components/AuthProvider";
import { getSessionUser } from "./lib/auth";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RetailERP",
  description: "Enterprise retail management",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getSessionUser().catch(() => null);
  const user = session && { id: session.id, name: session.name, email: session.email, role: session.role };

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider user={user}>{children}</AuthProvider>
      </body>
    </html>
  );
}
