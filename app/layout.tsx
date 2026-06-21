import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { getPlatformContext } from '@/core/session/context';
import { AppShell } from '@/core/ui';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TEAL Enterprise',
  description: 'Modular business operating platform for the Taylor Engineering Agencies group.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPlatformContext();
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <AppShell ctx={ctx}>{children}</AppShell>
      </body>
    </html>
  );
}
