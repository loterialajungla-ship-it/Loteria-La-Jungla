import type { PrismaClient, RolUsuario } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit/audit";
import {
  UserConflictError,
  UserNotFoundError,
  UserStateConflictError,
  UserValidationError,
} from "@/lib/auth/errors";
import {
  assertPasswordPolicy,
  hashPassword,
  PasswordValidationError,
} from "@/lib/auth/password";
import {
  isValidUsuarioFormat,
  NOMBRE_MAX_LENGTH,
  NOMBRE_MIN_LENGTH,
  normalizeUsuario,
} from "@/lib/auth/username";

type Db = Pick<
  PrismaClient,
  "usuario" | "usuarioSesion" | "auditoria" | "$transaction"
>;

export const ADMIN_USERS_PAGE_SIZE_DEFAULT = 20;
export const ADMIN_USERS_PAGE_SIZE_MAX = 100;

export type AdminUserPublic = {
  id: string;
  nombre: string;
  usuario: string;
  rol: RolUsuario;
  activo: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type ListAdminUsersQuery = {
  activo?: string | null;
  rol?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
};

export type ListAdminUsersResult = {
  items: AdminUserPublic[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

function toPublic(u: {
  id: string;
  nombre: string;
  usuario: string;
  rol: RolUsuario;
  activo: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}): AdminUserPublic {
  return {
    id: u.id,
    nombre: u.nombre,
    usuario: u.usuario,
    rol: u.rol,
    activo: u.activo,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

function parsePositiveInt(
  raw: string | number | null | undefined,
  fallback: number,
): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new UserValidationError("Parámetro de paginación inválido.");
  }
  return n;
}

export function parseListAdminUsersQuery(
  query: ListAdminUsersQuery,
): {
  activo: boolean | undefined;
  rol: RolUsuario | undefined;
  page: number;
  pageSize: number;
} {
  let activo: boolean | undefined;
  const activoRaw =
    typeof query.activo === "string" ? query.activo.trim().toLowerCase() : "";
  if (activoRaw === "true" || activoRaw === "1" || activoRaw === "activos") {
    activo = true;
  } else if (
    activoRaw === "false" ||
    activoRaw === "0" ||
    activoRaw === "inactivos"
  ) {
    activo = false;
  } else if (activoRaw && activoRaw !== "todos" && activoRaw !== "all") {
    throw new UserValidationError("Filtro activo inválido.");
  }

  let rol: RolUsuario | undefined;
  const rolRaw =
    typeof query.rol === "string" ? query.rol.trim().toUpperCase() : "";
  if (rolRaw === "ADMIN" || rolRaw === "VENDEDOR") {
    rol = rolRaw;
  } else if (rolRaw) {
    throw new UserValidationError("Filtro rol inválido.");
  }

  const page = parsePositiveInt(query.page, 1);
  let pageSize = parsePositiveInt(
    query.pageSize,
    ADMIN_USERS_PAGE_SIZE_DEFAULT,
  );
  if (pageSize > ADMIN_USERS_PAGE_SIZE_MAX) {
    pageSize = ADMIN_USERS_PAGE_SIZE_MAX;
  }

  return { activo, rol, page, pageSize };
}

export async function listAdminUsers(
  db: Db,
  query: ListAdminUsersQuery,
): Promise<ListAdminUsersResult> {
  const filters = parseListAdminUsersQuery(query);
  const where = {
    ...(filters.activo === undefined ? {} : { activo: filters.activo }),
    ...(filters.rol ? { rol: filters.rol } : {}),
  };

  const skip = (filters.page - 1) * filters.pageSize;
  const [total, rows] = await Promise.all([
    db.usuario.count({ where }),
    db.usuario.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: filters.pageSize,
      select: {
        id: true,
        nombre: true,
        usuario: true,
        rol: true,
        activo: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
  ]);

  const totalPages = total === 0 ? 0 : Math.ceil(total / filters.pageSize);

  return {
    items: rows.map(toPublic),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages,
  };
}

export function parseCreateVendorBody(raw: unknown): {
  nombre: string;
  usuario: string;
  password: string;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new UserValidationError("JSON inválido.");
  }
  const body = raw as Record<string, unknown>;

  // Rechazar intento de crear ADMIN u otro rol.
  if ("rol" in body && body.rol != null) {
    const rol = String(body.rol).trim().toUpperCase();
    if (rol && rol !== "VENDEDOR") {
      throw new UserValidationError(
        "Desde esta API solo se pueden crear vendedores.",
        "ROLE_NOT_ALLOWED",
      );
    }
  }

  if (typeof body.nombre !== "string") {
    throw new UserValidationError("El nombre es obligatorio.");
  }
  const nombre = body.nombre.trim();
  if (
    nombre.length < NOMBRE_MIN_LENGTH ||
    nombre.length > NOMBRE_MAX_LENGTH
  ) {
    throw new UserValidationError(
      `El nombre debe tener entre ${NOMBRE_MIN_LENGTH} y ${NOMBRE_MAX_LENGTH} caracteres.`,
    );
  }

  if (typeof body.usuario !== "string") {
    throw new UserValidationError("El usuario es obligatorio.");
  }
  const usuario = normalizeUsuario(body.usuario);
  if (!usuario) {
    throw new UserValidationError("El usuario es obligatorio.");
  }
  if (!isValidUsuarioFormat(usuario)) {
    throw new UserValidationError(
      "Usuario inválido. Use 3–32 caracteres: letras, números, . _ -",
    );
  }

  if (typeof body.password !== "string") {
    throw new UserValidationError("La contraseña es obligatoria.");
  }
  try {
    assertPasswordPolicy(body.password);
  } catch (e) {
    if (e instanceof PasswordValidationError) {
      throw new UserValidationError(e.message, "INVALID_PASSWORD");
    }
    throw e;
  }

  return { nombre, usuario, password: body.password };
}

export async function createVendor(
  db: Db,
  rawBody: unknown,
  args?: { actorUserId?: string | null },
): Promise<AdminUserPublic> {
  const { nombre, usuario, password } = parseCreateVendorBody(rawBody);
  const passwordHash = await hashPassword(password);
  const actorUserId = args?.actorUserId?.trim() || null;

  try {
    const created = await db.$transaction(async (tx) => {
      const row = await tx.usuario.create({
        data: {
          nombre,
          usuario,
          passwordHash,
          rol: "VENDEDOR",
          activo: true,
        },
        select: {
          id: true,
          nombre: true,
          usuario: true,
          rol: true,
          activo: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });

      if (actorUserId) {
        await recordAuditEvent(tx, {
          usuarioId: actorUserId,
          accion: "CREAR_VENDEDOR",
          entidad: "USUARIO",
          entidadId: row.id,
          detalle: {
            nombre: row.nombre,
            usuario: row.usuario,
            rol: row.rol,
          },
        });
      }

      return row;
    });
    return toPublic(created);
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      throw new UserConflictError();
    }
    throw e;
  }
}

export async function desactivarUsuario(
  db: Db,
  args: { id: string; actorUserId: string | null },
): Promise<AdminUserPublic> {
  const id = args.id.trim();
  if (!id) throw new UserNotFoundError();

  if (args.actorUserId && args.actorUserId === id) {
    throw new UserValidationError(
      "No puedes desactivar tu propia cuenta.",
      "SELF_DEACTIVATE",
    );
  }

  const existing = await db.usuario.findUnique({
    where: { id },
    select: {
      id: true,
      nombre: true,
      usuario: true,
      rol: true,
      activo: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
  if (!existing) throw new UserNotFoundError();

  if (existing.rol === "ADMIN") {
    throw new UserValidationError(
      "No se puede desactivar un administrador desde esta pantalla.",
      "ADMIN_LOCKED",
    );
  }

  if (!existing.activo) {
    throw new UserStateConflictError("El usuario ya está inactivo.");
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.usuario.update({
      where: { id },
      data: { activo: false },
      select: {
        id: true,
        nombre: true,
        usuario: true,
        rol: true,
        activo: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    await tx.usuarioSesion.deleteMany({ where: { usuarioId: id } });

    if (args.actorUserId) {
      await recordAuditEvent(tx, {
        usuarioId: args.actorUserId,
        accion: "DESACTIVAR_VENDEDOR",
        entidad: "USUARIO",
        entidadId: row.id,
        detalle: {
          usuario: row.usuario,
          nombre: row.nombre,
          estadoAnterior: true,
          estadoNuevo: false,
        },
      });
    }

    return row;
  });

  return toPublic(updated);
}

export async function activarUsuario(
  db: Db,
  args: { id: string; actorUserId?: string | null },
): Promise<AdminUserPublic> {
  const id = args.id.trim();
  if (!id) throw new UserNotFoundError();

  const existing = await db.usuario.findUnique({
    where: { id },
    select: {
      id: true,
      nombre: true,
      usuario: true,
      rol: true,
      activo: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
  if (!existing) throw new UserNotFoundError();

  if (existing.rol === "ADMIN") {
    throw new UserValidationError(
      "No se gestiona la activación de administradores desde esta pantalla.",
      "ADMIN_LOCKED",
    );
  }

  if (existing.activo) {
    throw new UserStateConflictError("El usuario ya está activo.");
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.usuario.update({
      where: { id },
      data: { activo: true },
      select: {
        id: true,
        nombre: true,
        usuario: true,
        rol: true,
        activo: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    if (args.actorUserId) {
      await recordAuditEvent(tx, {
        usuarioId: args.actorUserId,
        accion: "ACTIVAR_VENDEDOR",
        entidad: "USUARIO",
        entidadId: row.id,
        detalle: {
          usuario: row.usuario,
          nombre: row.nombre,
          estadoAnterior: false,
          estadoNuevo: true,
        },
      });
    }

    return row;
  });

  return toPublic(updated);
}
