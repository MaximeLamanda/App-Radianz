import { afterEach, describe, expect, it } from "vitest";
import { getServerDatabaseUrl, getServerDatabaseUrlEnvHint } from "./server-database-url";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe("getServerDatabaseUrl", () => {
  it("sans flag : première variable non vide gagne (ordre KEYS)", () => {
    for (const k of [
      "LOCAL_DATABASE_URL",
      "RADIANZ_DATABASE_URL",
      "Radianz_DATABASE_URL",
      "RADIANZ_POSTGRES_URL",
      "Radianz_POSTGRES_URL",
      "POSTGRES_URL",
      "DATABASE_URL",
      "RADIANZ_DATABASE_URL_UNPOOLED",
      "Radianz_DATABASE_URL_UNPOOLED",
      "DATABASE_URL_UNPOOLED",
      "RADIANZ_POSTGRES_URL_NON_POOLING",
      "Radianz_POSTGRES_URL_NON_POOLING",
      "POSTGRES_URL_NON_POOLING",
    ] as const) {
      delete process.env[k];
    }
    process.env.DATABASE_URL = "postgresql://from-database-url";
    expect(getServerDatabaseUrl()).toBe("postgresql://from-database-url");
  });
});

describe("getServerDatabaseUrlEnvHint", () => {
  it("liste les clés essayées", () => {
    const hint = getServerDatabaseUrlEnvHint();
    expect(hint).toContain("LOCAL_DATABASE_URL");
    expect(hint).toContain("DATABASE_URL");
  });
});
