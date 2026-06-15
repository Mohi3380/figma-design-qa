import type { MetadataRoute } from 'next';

const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4200';

// Public, indexable routes only (private/app + auth pages are excluded).
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ['', '/process', '/team'];
  return routes.map((path) => ({
    url: `${base}${path}`,
    changeFrequency: 'weekly',
    priority: path === '' ? 1 : 0.7,
  }));
}
