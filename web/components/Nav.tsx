'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import { useAuth } from './AuthProvider';

/** Shared header. Auth-aware: Start QA / Dashboard appear only when logged in. */
export default function Nav() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  async function onLogout() {
    await logout();
    router.push('/');
  }

  return (
    <nav>
      <div className="wrap">
        <Link className="brand" href="/" style={{ textDecoration: 'none' }}>
          <span className="logo">KL</span> KODERLABS Design QA
        </Link>
        <span className="links">
          <Link href="/#how">How it works</Link>
          <Link href="/#features">Checks</Link>
          <Link href="/process">Our Process</Link>
          <Link href="/team">Our Team</Link>
          <a href="https://github.com/Mohi3380/figma-design-qa" target="_blank" rel="noopener noreferrer">GitHub</a>
          <ThemeToggle />
          {!loading && user ? (
            <>
              <Link href="/dashboard">Dashboard</Link>
              <button className="btn btn-ghost" type="button" onClick={onLogout}>Log out</button>
            </>
          ) : !loading ? (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/signup" className="btn btn-primary">Sign up</Link>
            </>
          ) : null}
        </span>
      </div>
    </nav>
  );
}
