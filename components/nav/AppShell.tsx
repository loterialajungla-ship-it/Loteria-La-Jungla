import type { ReactNode } from "react";
import type { AuthUser } from "@/lib/auth/session";
import { Button } from "@/components/ui";
import { AppNavLinks } from "@/components/nav/AppNavLinks";
import type { NavVariant } from "@/components/nav/nav-config";

export type AppShellProps = {
  user: AuthUser;
  variant: NavVariant;
  children: ReactNode;
};

/**
 * Shell de navegación compartido.
 * Logout: POST /api/admin/logout (mecanismo existente; no altera auth).
 */
export function AppShell({ user, variant, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background text-ink">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 shadow-surface backdrop-blur supports-[backdrop-filter]:bg-surface/90">
        <div className="mx-auto w-full max-w-5xl px-4 py-3 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-800">
                Lotería La Jungla
              </p>
              <p className="mt-0.5 truncate text-sm text-ink-secondary">
                <span className="font-semibold text-ink">{user.nombre}</span>
                <span className="text-ink-muted"> · </span>
                <span className="font-mono text-ink-muted">{user.usuario}</span>
                <span className="text-ink-muted"> · </span>
                <span className="font-medium text-ink-secondary">{user.rol}</span>
              </p>
            </div>

            <form action="/api/admin/logout" method="post" className="shrink-0">
              <Button type="submit" variant="secondary" size="sm">
                Cerrar sesión
              </Button>
            </form>
          </div>

          <div className="mt-3">
            <AppNavLinks variant={variant} />
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
