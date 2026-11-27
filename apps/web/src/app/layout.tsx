import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Grant Ledger | Funding with clarity',
  description:
    'Connect startup accounting and grant oversight with clearer financial records and accountability.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
