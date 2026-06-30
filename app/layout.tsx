import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
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
  viewportFit: 'cover', // extend under notches; paired with safe-area insets in globals.css
};

// Root layout is intentionally minimal: just <html>/<body> + the service worker.
// The internal app chrome (AppShell) lives in app/(internal)/layout.tsx so the
// customer portal at /portal can render its own shell with no internal navigation,
// company switcher, or platform-context resolution.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
