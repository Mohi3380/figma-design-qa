'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import ThemeToggle from './ThemeToggle';

const NAV = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />,
  },
  {
    href: '/start-qa',
    label: 'Start QA',
    icon: <path d="M8 5v14l11-7z" />,
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  },
];

function initials(user: { name?: string | null; email: string }): string {
  const base = user.name?.trim() || user.email;
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U';
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  async function onLogout() {
    await logout();
    router.push('/');
  }

  return (
    <div className="app-shell">
      <aside className={`app-sidebar${navOpen ? ' open' : ''}`}>
        <Link className="app-brand" href="/dashboard" onClick={() => setNavOpen(false)}>
          <span className="logo">KL</span> <span>KODERLABS Design QA</span>
        </Link>
        <nav className="app-nav">
          {NAV.map((item) => {
            const active = pathname === item.href;
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
        <a className="app-back" href="/">← Back to site</a>
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
                    <Link href="/profile" onClick={() => setMenuOpen(false)}>Profile</Link>
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
