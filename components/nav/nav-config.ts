export type NavVariant = "admin" | "vendor";

export type NavItem = {
  href: string;
  label: string;
  /** exact: solo la ruta exacta; prefix: ruta o hijas */
  match: "exact" | "prefix";
};

/** Navegación del área administrativa (solo ADMIN). */
export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Resultados", match: "exact" },
  { href: "/admin/tickets", label: "Tickets", match: "prefix" },
  { href: "/admin/usuarios", label: "Usuarios", match: "prefix" },
  { href: "/admin/reportes", label: "Informes", match: "prefix" },
  { href: "/admin/auditoria", label: "Auditoría", match: "prefix" },
  { href: "/venta", label: "Venta", match: "prefix" },
  { href: "/perfil", label: "Mi cuenta", match: "exact" },
];

/** Navegación del vendedor (sin secciones admin). */
export const VENDOR_NAV: NavItem[] = [
  { href: "/venta", label: "Venta", match: "exact" },
  { href: "/venta/tickets", label: "Mis tickets", match: "prefix" },
  { href: "/perfil", label: "Mi cuenta", match: "exact" },
];

export function navItemsForVariant(variant: NavVariant): NavItem[] {
  return variant === "admin" ? ADMIN_NAV : VENDOR_NAV;
}

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.match === "exact") {
    return pathname === item.href;
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
