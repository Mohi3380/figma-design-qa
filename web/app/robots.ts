import type { MetadataRoute } from 'next';

const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4200';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Keep private app + auth pages out of the index.
        disallow: ['/dashboard', '/login', '/signup', '/forgot-password', '/reset-password', '/verify-email'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
