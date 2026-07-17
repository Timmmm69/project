import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { migrationManifest } from "@/server/runtime-readiness/migration-manifest";

const migrationsDirectory = resolve(process.cwd(), "prisma", "migrations");

function repositoryMigrations() {
  return readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((migrationName) => {
      const bytes = readFileSync(resolve(
        migrationsDirectory,
        migrationName,
        "migration.sql"
      ));

      return {
        migrationName,
        checksum: createHash("sha256").update(bytes).digest("hex")
      };
    });
}

describe("canonical repository migration manifest", () => {
  it("exactly matches migration names, order, and SHA-256 file-byte checksums", () => {
    expect(migrationManifest).toEqual(repositoryMigrations());
  });

  it("contains unique names and closed lowercase hexadecimal checksums", () => {
    const names = migrationManifest.map((entry) => entry.migrationName);

    expect(new Set(names).size).toBe(names.length);
    for (const entry of migrationManifest) {
      expect(entry.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("is deeply immutable", () => {
    expect(Object.isFrozen(migrationManifest)).toBe(true);
    for (const entry of migrationManifest) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  it("detects a manifest checksum mismatch", () => {
    const mismatched = migrationManifest.map((entry, index) => ({
      ...entry,
      checksum: index === 0 ? "0".repeat(64) : entry.checksum
    }));

    expect(mismatched).not.toEqual(repositoryMigrations());
  });
});
