import RequireAdmin from '@/components/RequireAdmin';
import AppShell from '@/components/AppShell';

/** Admin area layout — gated to ADMIN users, admin-variant sidebar. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAdmin>
      <AppShell variant="admin">{children}</AppShell>
    </RequireAdmin>
  );
}
