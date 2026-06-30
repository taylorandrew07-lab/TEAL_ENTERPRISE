import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { getPlatformContext } from '@/core/session/context';
import { AppShell } from '@/core/ui';
import { ServiceWorkerRegister } from '@/core/ui/ServiceWorkerRegister';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TEAL Enterprise',
  description: 'Modular business operating platform for the Taylor Engineering Agencies group.',
  applicationName: 'TEAL Enterprise',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'TEAL' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#4f46e5',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPlatformContext();
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <ServiceWorkerRegister />
        <AppShell ctx={ctx}>{children}</AppShell>
      </body>
    </html>
  );
}
