"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import {
  isNavItemActive,
  navItemsForVariant,
  type NavVariant,
} from "@/components/nav/nav-config";

type Props = {
  variant: NavVariant;
};

export function AppNavLinks({ variant }: Props) {
  const pathname = usePathname() ?? "";
  const items = navItemsForVariant(variant);

  return (
    <nav
      aria-label={variant === "admin" ? "Administración" : "Punto de venta"}
      className="-mx-4 overflow-x-auto overscroll-x-contain px-4 sm:mx-0 sm:overflow-visible sm:px-0"
    >
      <ul className="flex w-max min-w-full gap-1.5 pb-0.5 sm:w-full sm:flex-wrap sm:gap-2">
        {items.map((item) => {
          const active = isNavItemActive(pathname, item);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 min-w-[2.75rem] items-center justify-center rounded-lj-md px-3 py-2 text-sm font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2",
                  active
                    ? "bg-brand-800 text-white"
                    : "text-ink-secondary hover:bg-surface-muted hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
