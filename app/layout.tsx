import type { Metadata } from 'next';
import './globals.css';
import { getPlatformContext } from '@/core/session/context';
import { AppShell } from '@/core/ui';

export const metadata: Metadata = {
  title: 'TEAL Enterprise',
  description: 'Modular business operating platform for the Taylor group of companies.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPlatformContext();
  return (
    <html lang="en">
      <body>
        <AppShell ctx={ctx}>{children}</AppShell>
      </body>
    </html>
  );
}
