import type { Metadata } from 'next';
import { API_BASE } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Our Team',
  description:
    'Meet the team behind KODERLABS Design QA — the engineers, designers and QA specialists building automated Figma-vs-live visual quality checks.',
  alternates: { canonical: '/team' },
};

interface Member {
  id: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
}

// Fallback roster used only if the backend is unreachable, so the page never
// renders empty. The live roster is managed by admins at /admin/team.
const FALLBACK: Member[] = [
  'Founder & CEO',
  'Head of Engineering',
  'Design Lead',
  'QA Lead',
  'Frontend Engineer',
  'ML / Vision Engineer',
  'Product Manager',
  'DevOps Engineer',
].map((role, i) => ({ id: `fallback-${i}`, name: 'Team Member', role, avatarUrl: null, linkedinUrl: null, xUrl: null }));

async function getTeam(): Promise<Member[]> {
  try {
    const res = await fetch(`${API_BASE}/team`, { cache: 'no-store' });
    if (!res.ok) return FALLBACK;
    const members = (await res.json()) as Member[];
    return members.length ? members : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#1763E6,#0B3FA8)',
  'linear-gradient(135deg,#4F93FF,#1763E6)',
  'linear-gradient(135deg,#0E8C80,#19C3B2)',
  'linear-gradient(135deg,#7A4FFF,#4F93FF)',
  'linear-gradient(135deg,#E0651A,#EA580C)',
  'linear-gradient(135deg,#06256B,#1763E6)',
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'KL';
}

const VALUES = [
  { h: 'Design is the source of truth', p: 'We hold the live product to the design, pixel for pixel — so what ships is what was approved.' },
  { h: 'Evidence over opinion', p: 'Every finding comes with side-by-side proof and a severity, not a vague "looks off".' },
  { h: 'Automate the tedious', p: 'No manual screenshot diffing. Two URLs in, a graded report out — every release.' },
];

const LINKEDIN_PATH = 'M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM0 8h5v16H0V8zm7.5 0H12v2.2h.07c.63-1.2 2.17-2.47 4.46-2.47C21.4 7.73 24 10 24 14.6V24h-5v-8.4c0-2-.04-4.6-2.8-4.6-2.8 0-3.2 2.18-3.2 4.44V24h-5V8z';
const X_PATH = 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';

function MemberSocial({ linkedinUrl, xUrl }: { linkedinUrl: string | null; xUrl: string | null }) {
  if (!linkedinUrl && !xUrl) return null;
  return (
    <div className="msocial">
      {linkedinUrl && (
        <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d={LINKEDIN_PATH} /></svg>
        </a>
      )}
      {xUrl && (
        <a href={xUrl} target="_blank" rel="noopener noreferrer" aria-label="X">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d={X_PATH} /></svg>
        </a>
      )}
    </div>
  );
}

export default async function TeamPage() {
  const team = await getTeam();

  return (
    <>
      <header className="page-hero">
        <div className="wrap">
          <div className="eyebrow">Our Team</div>
          <h1 className="page-title">The people behind Design QA</h1>
          <p className="page-lead">
            A small team of engineers, designers and QA specialists building automated
            Figma-vs-live visual quality checks — so design intent survives all the way to production.
          </p>
        </div>
      </header>

      <main className="team">
        <div className="wrap">
          <div className="team-grid">
            {team.map((m, i) => (
              <div className="member" key={m.id}>
                <div className="avatar" style={{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length] }}>
                  {m.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.avatarUrl} alt={m.name} />
                  ) : (
                    initials(m.name)
                  )}
                </div>
                <h3>{m.name}</h3>
                <p className="role">{m.role}</p>
                <MemberSocial linkedinUrl={m.linkedinUrl} xUrl={m.xUrl} />
              </div>
            ))}
          </div>

          <div className="team-values">
            {VALUES.map((v) => (
              <div className="value" key={v.h}>
                <h3>{v.h}</h3>
                <p>{v.p}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <section className="block">
        <div className="wrap">
          <div className="team-cta">
            <h2>Want to work with us?</h2>
            <p>We&apos;re always glad to talk to people who care about design quality. Say hello.</p>
            <a className="btn btn-primary" href="mailto:hello@koderlabs.com">Get in touch</a>
          </div>
        </div>
      </section>
    </>
  );
}
