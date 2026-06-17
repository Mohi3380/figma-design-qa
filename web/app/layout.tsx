import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
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
    images: [{ url: '/hero.jpg', width: 1200, height: 800, alt: 'KODERLABS Design QA' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'KODERLABS Design QA',
    description: 'Compare a Figma design against your live app and get a severity-graded report with evidence.',
    images: ['/hero.jpg'],
  },
  robots: { index: true, follow: true },
};

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'KODERLABS Design QA',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web',
  description:
    'Compare a Figma design against your live app and report every visual mismatch — color, typography, spacing, icons, text and layout — severity-graded with evidence.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@type': 'Organization', name: 'KODERLABS', url: 'https://koderlabs.com' },
};

export const viewport: Viewport = {
  themeColor: '#1763E6',
};

/* Before first paint: apply saved/system theme (no flash) and mark that JS is
 * active, so scroll-reveal animations only hide content when they can reveal it
 * (no-JS users and crawlers see everything). */
const THEME_INIT = `(function(){try{document.documentElement.classList.add('js');var s=localStorage.getItem('kl-theme');var d=s?s==='dark':(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.setAttribute('data-theme','dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
