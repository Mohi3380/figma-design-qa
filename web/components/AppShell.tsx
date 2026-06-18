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
  { href: '/profile', label: 'Profile', icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></> },
];

const ADMIN_LINK: NavItem = {
  href: '/admin',
  label: 'Admin',
  icon: <path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z" />,
};

const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" /> },
  {
    href: '/admin/users',
    label: 'Users',
    icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2 21a7 7 0 0 1 14 0M17 11a3 3 0 0 0 0-6M23 21a6 6 0 0 0-7-5.9" /></>,
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

  async function onLogout() {
    await logout();
    router.push('/');
  }

  const isAdminArea = variant === 'admin';
  const nav: NavItem[] = isAdminArea
    ? ADMIN_NAV
    : user?.role === 'ADMIN'
      ? [...APP_NAV, ADMIN_LINK]
      : APP_NAV;
  const brandHref = isAdminArea ? '/admin' : '/dashboard';
  const back = isAdminArea ? { href: '/dashboard', label: '← Back to app' } : { href: '/', label: '← Back to site' };

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
        <a className="app-back" href={back.href}>{back.label}</a>
      </aside>

      {navOpen && <div className="app-scrim" onClick={() => setNavOpen(false)} />}

      <div className="app-main">
        <header className="app-topbar">
          <button className="app-burger" type="button" aria-label="Menu" onClick={() => setNavOpen((v) => !v)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
          {isAdminArea && <span className="app-area-tag">Admin panel</span>}
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
                    <Link href="/profile" onClick={() => setMenuOpen(false)}>Profile</Link>
                    {user.role === 'ADMIN' && !isAdminArea && (
                      <Link href="/admin" onClick={() => setMenuOpen(false)}>Admin panel</Link>
                    )}
                    <button type="button" onClick={onLogout}>Log out</button>
                  </div>
                </>
              )}
            </div>
          )}
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
