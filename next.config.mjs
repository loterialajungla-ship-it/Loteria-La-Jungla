import { ACTIVE_SECURITY_HEADERS } from "./lib/http/security-headers.mjs";

/**
 * Cabeceras de seguridad (B5.6-C) vía `headers()`.
 * CSP de bloqueo no activada — ver `CSP_CANDIDATE_DIRECTIVES` en
 * `lib/http/security-headers.mjs` / `.ts`.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: ACTIVE_SECURITY_HEADERS.map(({ key, value }) => ({
          key,
          value,
        })),
      },
    ];
  },
};

export default nextConfig;
