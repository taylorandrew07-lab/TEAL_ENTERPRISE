import type { MetadataRoute } from 'next';

// Served at /manifest.webmanifest and auto-linked by Next. Makes the app installable
// (standalone) on Android/Chrome and iOS "Add to Home Screen".
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TEAL Enterprise',
    short_name: 'TEAL',
    description: 'Modular business operating platform for Taylor Engineering Agencies Limited.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#f8fafc',
    theme_color: '#4f46e5',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
