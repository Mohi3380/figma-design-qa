import RequireAuth from '@/components/RequireAuth';
import AppShell from '@/components/AppShell';

/** Authenticated app layout — sidebar shell, no marketing chrome. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
