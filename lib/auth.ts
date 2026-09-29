export const COOKIE_ADMIN_SESSION = "admin_session";

export function adminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? "";
}

export function adminSessionSecret(): string {
  return process.env.ADMIN_SESSION_SECRET ?? "";
}

export function isAdminSession(valor: string | undefined): boolean {
  const secreto = adminSessionSecret();
  return Boolean(secreto) && valor === secreto;
}
