'use client';

import QAForm from '@/components/QAForm';
import FigmaConnect from '@/components/FigmaConnect';

export default function StartQaPage() {
  return (
    <div className="app-page">
      <div className="dash-head">
        <h1>Start a QA</h1>
      </div>
      <p className="dash-sub">
        Paste a Figma frame URL and your live app URL. Progress streams live and the report renders below.
      </p>
      <FigmaConnect />
      <QAForm />
    </div>
  );
}
