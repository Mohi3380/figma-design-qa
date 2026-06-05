/**
 * PDF report: report.html → report.pdf via Playwright's Chromium print
 * engine. The HTML is self-contained (evidence inlined as data URIs), so
 * the PDF needs no companion files either — one attachable document.
 *
 * Thin plumbing by design: everything interesting (layout, grouping,
 * escaping) is already tested at the HTML layer.
 */
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

export async function renderPdf(htmlPath: string, pdfPath: string): Promise<string> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).toString());
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true, // severity badges and evidence framing are backgrounds
      margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
    });
    return pdfPath;
  } finally {
    await browser.close();
  }
}
