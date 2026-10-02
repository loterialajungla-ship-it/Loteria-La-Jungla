/**
 * Origen público del request para redirects absolutos.
 * Cuando Next escucha en 0.0.0.0, `request.url` puede ser
 * http://0.0.0.0:3000/... — inválido en el navegador.
 */

export type RequestLike = {
  url: string;
  headers: {
    get(name: string): string | null;
  };
};

/**
 * Resuelve el origen que el cliente usó (Host / X-Forwarded-*).
 * Nunca devuelve hostname 0.0.0.0.
 */
export function resolvePublicOrigin(request: RequestLike): string {
  const incoming = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const hostHeader = (forwardedHost ?? request.headers.get("host") ?? "")
    .split(",")[0]
    ?.trim();

  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const proto =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : incoming.protocol === "https:"
        ? "https"
        : "http";

  let hostname = "";
  let port = "";

  if (hostHeader) {
    // Host puede ser "192.168.1.22:3000" o "[::1]:3000"
    if (hostHeader.startsWith("[")) {
      const end = hostHeader.indexOf("]");
      hostname = hostHeader.slice(0, end + 1);
      const rest = hostHeader.slice(end + 1);
      if (rest.startsWith(":")) port = rest.slice(1);
    } else {
      const idx = hostHeader.lastIndexOf(":");
      if (idx > 0 && /^\d+$/.test(hostHeader.slice(idx + 1))) {
        hostname = hostHeader.slice(0, idx);
        port = hostHeader.slice(idx + 1);
      } else {
        hostname = hostHeader;
      }
    }
  } else {
    hostname = incoming.hostname;
    port = incoming.port;
  }

  if (hostname === "0.0.0.0") {
    hostname = "localhost";
  }

  const origin = new URL(`${proto}://placeholder`);
  // URL API: hostname sin brackets para IPv6 se setea vía hostname
  if (hostname.startsWith("[")) {
    origin.hostname = hostname.slice(1, -1);
  } else {
    origin.hostname = hostname;
  }
  origin.port = port;
  return origin.origin;
}

/** URL absoluta segura para Location / redirects. */
export function absoluteUrlFromRequest(
  request: RequestLike,
  path: string,
): URL {
  return new URL(path, resolvePublicOrigin(request));
}
