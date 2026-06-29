'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import ThemeToggle from './ThemeToggle';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const APP_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" /> },
  { href: '/start-qa', label: 'Start QA', icon: <path d="M8 5v14l11-7z" /> },
  { href: '/runs', label: 'QA Runs', icon: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></> },
  { href: '/integrations', label: 'Integrations', icon: <path d="M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0zM12 17v5" /> },
  { href: '/profile', label: 'Profile', icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></> },
];

const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" /> },
  {
    href: '/admin/users',
    label: 'User Management',
    icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2 21a7 7 0 0 1 14 0M17 11a3 3 0 0 0 0-6M23 21a6 6 0 0 0-7-5.9" /></>,
  },
  {
    href: '/admin/team',
    label: 'Team Page',
    icon: <><circle cx="12" cy="7" r="4" /><path d="M5.5 21a6.5 6.5 0 0 1 13 0" /></>,
  },
];

function initials(user: { name?: string | null; email: string }): string {
  const base = user.name?.trim() || user.email;
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U';
}

export default function AppShell({
  children,
  variant = 'app',
}: {
  children: React.ReactNode;
  variant?: 'app' | 'admin';
}) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function onLogout() {
    setLoggingOut(true);
    await logout();
    router.push('/');
  }

  const isAdminArea = variant === 'admin';
  const nav: NavItem[] = isAdminArea ? ADMIN_NAV : APP_NAV;
  const brandHref = isAdminArea ? '/admin' : '/dashboard';

  return (
    <div className="app-shell">
      <aside className={`app-sidebar${navOpen ? ' open' : ''}`}>
        <Link className="app-brand" href={brandHref} onClick={() => setNavOpen(false)}>
          <span className="logo">KL</span> <span>KODERLABS Design QA</span>
        </Link>
        {isAdminArea && <div className="app-nav-label">Admin</div>}
        <nav className="app-nav">
          {nav.map((item) => {
            const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={active ? 'active' : ''} onClick={() => setNavOpen(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {item.icon}
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="app-foot">
          <button type="button" className="app-logout" onClick={() => { setNavOpen(false); setLogoutOpen(true); }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            Log out
          </button>
        </div>
      </aside>

      {navOpen && <div className="app-scrim" onClick={() => setNavOpen(false)} />}

      <div className="app-main">
        <header className="app-topbar">
          <button className="app-burger" type="button" aria-label="Menu" onClick={() => setNavOpen((v) => !v)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
          <div style={{ flex: 1 }} />
          <ThemeToggle />
          {user && (
            <div className="app-user">
              <button type="button" className="app-user-btn" onClick={() => setMenuOpen((v) => !v)}>
                <span className="avatar-sm">
                  {user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.avatarUrl} alt="" />
                  ) : (
                    initials(user)
                  )}
                </span>
                <span className="app-user-name">{user.name || user.email}</span>
              </button>
              {menuOpen && (
                <>
                  <div className="app-menu-scrim" onClick={() => setMenuOpen(false)} />
                  <div className="app-menu">
                    {!isAdminArea && <Link href="/profile" onClick={() => setMenuOpen(false)}>Profile</Link>}
                    {!isAdminArea && <Link href="/how-it-works" onClick={() => setMenuOpen(false)}>How it works</Link>}
                    <button type="button" onClick={() => { setMenuOpen(false); setLogoutOpen(true); }}>Log out</button>
                  </div>
                </>
              )}
            </div>
          )}
        </header>
        <main className="app-content">{children}</main>
      </div>

      {logoutOpen && (
        <div className="modal-scrim" onClick={() => !loggingOut && setLogoutOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="logout-title" onClick={(e) => e.stopPropagation()}>
            <div className="modal-ic">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </div>
            <h3 id="logout-title">Log out?</h3>
            <p>You&apos;ll be signed out of KODERLABS Design QA on this device.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setLogoutOpen(false)} disabled={loggingOut}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={onLogout} disabled={loggingOut}>{loggingOut ? 'Logging out…' : 'Log out'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
