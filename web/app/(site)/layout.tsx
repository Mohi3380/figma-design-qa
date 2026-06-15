import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

/** Public marketing layout — the original header + footer. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      {children}
      <Footer />
    </>
  );
}
