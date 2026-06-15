import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import { AuthProvider } from '@/components/AuthProvider';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4200';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'KODERLABS Design QA — Figma vs. live app verification',
    template: '%s · KODERLABS Design QA',
  },
  description:
    'KODERLABS Design QA compares a Figma design against your live app and reports every visual mismatch — color, typography, spacing, icons, text and layout — severity-graded with evidence.',
  keywords: ['design QA', 'Figma', 'visual regression', 'design comparison', 'pixel diff', 'KODERLABS'],
  authors: [{ name: 'KODERLABS' }],
  openGraph: {
    type: 'website',
    siteName: 'KODERLABS Design QA',
    title: 'KODERLABS Design QA',
    description: 'Compare a Figma design against your live app and get a severity-graded report with evidence.',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: '#1763E6',
};

/* Apply saved/system theme before first paint to avoid a flash. */
const THEME_INIT = `(function(){try{var s=localStorage.getItem('kl-theme');var d=s?s==='dark':(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.setAttribute('data-theme','dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <AuthProvider>
          <Nav />
          {children}
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
