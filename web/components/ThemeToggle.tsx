'use client';

/**
 * Light/dark toggle. Flips `data-theme` on <html> and persists to localStorage.
 * The no-flash initial application happens in a tiny inline script in the root
 * layout (runs before paint); this component only handles the click.
 */
export default function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const isDark = root.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    if (next === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    try {
      localStorage.setItem('kl-theme', next);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label="Toggle dark mode"
      title="Toggle light / dark theme"
      onClick={toggle}
    >
      <svg className="ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
      <svg className="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    </button>
  );
}
