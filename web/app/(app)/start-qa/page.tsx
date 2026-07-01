'use client';

import Link from 'next/link';
import QAForm from '@/components/QAForm';

export default function StartQaPage() {
  return (
    <div className="app-page">
      <div className="dash-head">
        <h1>Start a QA</h1>
      </div>
      <p className="dash-sub">
        Paste a Figma frame URL and your live app URL. Progress streams live and the report renders below.
        Make sure your <Link href="/integrations" style={{ color: 'var(--blue)', fontWeight: 600 }}>integrations</Link> are connected first.
      </p>
      <QAForm />
    </div>
  );
}
