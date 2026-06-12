import Link from 'next/link';
import ThemeToggle from './ThemeToggle';

/** Shared header — used on every page via the root layout. */
export default function Nav() {
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
          <Link href="/#run" className="btn btn-primary">Start QA</Link>
        </span>
      </div>
    </nav>
  );
}
