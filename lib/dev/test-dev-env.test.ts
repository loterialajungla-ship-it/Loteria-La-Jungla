import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEV_TEST_PROD_COLLISION_MESSAGE,
  formatTestDevBanner,
  isPrivateIpv4,
  pickLanIpv4,
  prepareTestDevEnv,
  type NetworkInterfacesLike,
} from "@/lib/dev/test-dev-env";

describe("prepareTestDevEnv (dev:test)", () => {
  it("TEST_DATABASE_URL ausente → error", () => {
    const r = prepareTestDevEnv({
      DATABASE_URL: "postgresql://u:p@host/prod",
      DIRECT_URL: "postgresql://u:p@host/prod",
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /TEST_DATABASE_URL/);
      assert.doesNotMatch(r.reason, /:p@|password|postgresql:\/\//i);
    }
  });

  it("TEST_DATABASE_URL igual DATABASE_URL → error", () => {
    const url = "postgresql://u:secret@host/neondb";
    const r = prepareTestDevEnv({
      TEST_DATABASE_URL: url,
      DATABASE_URL: url,
      DIRECT_URL: "postgresql://u:p@host/other",
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_TEST_PROD_COLLISION_MESSAGE);
      assert.doesNotMatch(r.reason, /secret|neondb|postgresql:\/\//i);
    }
  });

  it("TEST_DATABASE_URL igual DIRECT_URL → error", () => {
    const url = "postgresql://u:secret@host/neondb";
    const r = prepareTestDevEnv({
      TEST_DATABASE_URL: url,
      DATABASE_URL: "postgresql://u:p@pooler/neondb",
      DIRECT_URL: url,
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_TEST_PROD_COLLISION_MESSAGE);
      assert.doesNotMatch(r.reason, /secret/);
    }
  });

  it("TEST_DATABASE_URL segura → inyecta en hijo sin mutar padre", () => {
    const parent = {
      TEST_DATABASE_URL: "postgresql://u:p@localhost:5432/llj_test",
      DATABASE_URL: "postgresql://u:p@neon-pooler/neondb",
      DIRECT_URL: "postgresql://u:p@neon/neondb",
      PATH: "/usr/bin",
    };
    const snapshotDb = parent.DATABASE_URL;
    const snapshotDirect = parent.DIRECT_URL;

    const r = prepareTestDevEnv(parent);
    assert.equal(r.ok, true);
    if (!r.ok) return;

    assert.equal(r.childEnv.DATABASE_URL, parent.TEST_DATABASE_URL);
    assert.equal(r.childEnv.DIRECT_URL, parent.TEST_DATABASE_URL);
    assert.equal(r.childEnv.TEST_DATABASE_URL, parent.TEST_DATABASE_URL);
    // Padre intacto
    assert.equal(parent.DATABASE_URL, snapshotDb);
    assert.equal(parent.DIRECT_URL, snapshotDirect);
  });

  it("banner y errores no exponen secretos", () => {
    const banner = formatTestDevBanner();
    assert.match(banner, /TEST DEVELOPMENT DATABASE/);
    assert.match(banner, /TEST_DATABASE_URL/);
    assert.doesNotMatch(banner, /postgresql:\/\//i);
    assert.doesNotMatch(banner, /password|token|secret/i);

    const bad = prepareTestDevEnv({
      TEST_DATABASE_URL: "postgresql://user:SuperSecret99@host/db",
      DATABASE_URL: "postgresql://user:SuperSecret99@host/db",
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.doesNotMatch(bad.reason, /SuperSecret99|user:/);
    }
  });
});

describe("LAN helpers (dev:test:lan)", () => {
  it("isPrivateIpv4 reconoce RFC1918 y rechaza públicas/loopback", () => {
    assert.equal(isPrivateIpv4("192.168.1.50"), true);
    assert.equal(isPrivateIpv4("10.0.0.5"), true);
    assert.equal(isPrivateIpv4("172.16.0.1"), true);
    assert.equal(isPrivateIpv4("172.31.255.255"), true);
    assert.equal(isPrivateIpv4("172.15.0.1"), false);
    assert.equal(isPrivateIpv4("8.8.8.8"), false);
    assert.equal(isPrivateIpv4("127.0.0.1"), false);
    assert.equal(isPrivateIpv4("not-an-ip"), false);
  });

  it("pickLanIpv4 prefiere 192.168 y omite internas/públicas", () => {
    const ifaces: NetworkInterfacesLike = {
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      eth0: [
        { address: "8.8.8.8", family: "IPv4", internal: false },
        { address: "10.0.0.2", family: "IPv4", internal: false },
      ],
      "Wi-Fi": [
        { address: "192.168.1.50", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
      ],
    };
    assert.equal(pickLanIpv4(ifaces), "192.168.1.50");
  });

  it("pickLanIpv4 acepta family numérico (compat Node) y 10.x si no hay 192.168", () => {
    const ifaces: NetworkInterfacesLike = {
      eth0: [{ address: "10.1.2.3", family: 4, internal: false }],
    };
    assert.equal(pickLanIpv4(ifaces), "10.1.2.3");
  });

  it("pickLanIpv4 → null si no hay candidata privada", () => {
    const ifaces: NetworkInterfacesLike = {
      eth0: [{ address: "203.0.113.10", family: "IPv4", internal: false }],
    };
    assert.equal(pickLanIpv4(ifaces), null);
  });

  it("banner LAN muestra Local/LAN sin secretos ni URLs de DB", () => {
    const banner = formatTestDevBanner({
      lan: true,
      port: 3000,
      lanIp: "192.168.1.50",
    });
    assert.match(banner, /TEST DEVELOPMENT DATABASE/);
    assert.match(banner, /Local:/);
    assert.match(banner, /http:\/\/localhost:3000/);
    assert.match(banner, /LAN:/);
    assert.match(banner, /http:\/\/192\.168\.1\.50:3000/);
    assert.match(banner, /confianza|Wi-Fi público/i);
    assert.match(banner, /No abras http:\/\/0\.0\.0\.0/);
    assert.doesNotMatch(banner, /postgresql:\/\//i);
    assert.doesNotMatch(banner, /DATABASE_URL=/);
    assert.doesNotMatch(banner, /TEST_DATABASE_URL=/);
    assert.doesNotMatch(banner, /password|token|secret/i);
  });

  it("banner LAN sin IP detectada no inventa host ni secretos", () => {
    const banner = formatTestDevBanner({
      lan: true,
      port: 3000,
      lanIp: null,
    });
    assert.match(banner, /no se detectó IPv4 privada/i);
    assert.match(banner, /http:\/\/localhost:3000/);
    assert.doesNotMatch(banner, /postgresql:\/\//i);
  });
});
