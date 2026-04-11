import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Video Retrieval",
  description: "Search videos in multi-media database",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-slate-950 text-white min-h-screen flex flex-col`}>
        <nav className="border-b border-white/10 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center">
              <Link href="/" className="font-bold text-xl tracking-tight text-white hover:text-indigo-400 transition-colors">
                🎥 Video<span className="text-indigo-500"> Retrieval</span>
              </Link>
            </div>
            <div className="flex gap-4">
              <Link href="/" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">
                Search
              </Link>
              <Link href="/videos" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">
                Data
              </Link>
              <Link href="/ingest" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">
                Ingest
              </Link>
            </div>
          </div>
        </nav>

        <main className="flex-1 w-full mx-auto p-4 sm:p-6 lg:p-8 overflow-hidden">
          {children}
        </main>

        <footer className="border-t border-white/10 py-6 text-center text-slate-500 text-sm">
          <p>The Perfect Name</p>
        </footer>
      </body>
    </html>
  );
}
