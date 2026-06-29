import Link from 'next/link';

/** Shared footer — used on every page via the root layout. */
export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="foot-accent" />
      <div className="wrap foot-main">
        <div className="foot-left">
          <h3 className="foot-title">Capabilities</h3>
          <div className="foot-cols">
            <div className="foot-col">
              <h4>Product</h4>
              <Link href="/#how">How it works</Link>
              <Link href="/#features">Checks</Link>
              <Link href="/process">Our Process</Link>
              <Link href="/team">Our Team</Link>
              <Link href="/#run">Start a QA</Link>
            </div>
            <div className="foot-col">
              <h4>Resources</h4>
              <a href="https://github.com/Mohi3380/figma-design-qa" target="_blank" rel="noopener noreferrer">GitHub</a>
              <Link href="/process">Workflow document</Link>
              <Link href="/#run">Run a check</Link>
              <Link href="/#how">Getting started</Link>
            </div>
          </div>
          <div className="foot-bottom">
            <span>Pixparity © 2026 · All Rights Reserved</span>
          </div>
        </div>
        <div className="foot-right">
          <div className="foot-brand"><span className="logo">Px</span> Pixparity</div>
          <h3 className="foot-cta-title">Get In Touch.</h3>
          <div className="foot-cta-btns">
            <a className="foot-btn outline" href="mailto:mohit.kumar@koderlabs.com">Contact Us</a>
            <Link className="foot-btn solid" href="/#run">Start a QA</Link>
          </div>
          <div className="foot-contact">
            <a href="mailto:mohit.kumar@koderlabs.com"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" /></svg> mohit.kumar@koderlabs.com</a>
          </div>
          <div className="foot-social">
            <a href="#" aria-label="LinkedIn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM0 8h5v16H0V8zm7.5 0H12v2.2h.07c.63-1.2 2.17-2.47 4.46-2.47C21.4 7.73 24 10 24 14.6V24h-5v-8.4c0-2-.04-4.6-2.8-4.6-2.8 0-3.2 2.18-3.2 4.44V24h-5V8z" /></svg></a>
            <a href="#" aria-label="X"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg></a>
            <a href="https://github.com/Mohi3380/figma-design-qa" target="_blank" rel="noopener noreferrer" aria-label="GitHub"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.2c-3.34.73-4.04-1.6-4.04-1.6-.55-1.4-1.34-1.77-1.34-1.77-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.92 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" /></svg></a>
            <a href="#" aria-label="YouTube"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.51A3.02 3.02 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3.02 3.02 0 0 0 2.12 2.14c1.88.51 9.38.51 9.38.51s7.5 0 9.38-.51a3.02 3.02 0 0 0 2.12-2.14A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6z" /></svg></a>
          </div>
          <div className="foot-legal-right">
            <a href="#">Privacy Statement</a>
            <span aria-hidden="true">·</span>
            <a href="#">Terms of Use</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
