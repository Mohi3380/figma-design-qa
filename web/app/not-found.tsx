'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import AppShell from '@/components/AppShell';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

function NotFoundBody({ home, homeLabel }: { home: string; homeLabel: string }) {
  return (
    <div className="nf">
      <div className="nf-card">
        <div className="nf-code">404</div>
        <h1 className="nf-title">This page could not be found</h1>
        <p className="nf-text">
          The page you&apos;re looking for doesn&apos;t exist or may have moved. Check the URL, or head back to a familiar place.
        </p>
        <div className="nf-actions">
          <Link className="btn btn-primary" href={home}>{homeLabel}</Link>
          <Link className="btn btn-ghost" href="/">Back to home</Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Global 404. Auth-aware so the navigation stays available: signed-in users
 * keep the app/admin side menu (AppShell); visitors get the marketing chrome.
 * Both inherit the theme (data-theme) from the root layout.
 */
export default function NotFound() {
  const { user, loading } = useAuth();

  if (loading) {
    return <NotFoundBody home="/" homeLabel="Back to home" />;
  }

  if (user) {
    const isAdmin = user.role === 'ADMIN';
    return (
      <AppShell variant={isAdmin ? 'admin' : 'app'}>
        <NotFoundBody home={isAdmin ? '/admin' : '/dashboard'} homeLabel="Back to dashboard" />
      </AppShell>
    );
  }

  return (
    <>
      <Nav />
      <NotFoundBody home="/" homeLabel="Back to home" />
      <Footer />
    </>
  );
}
