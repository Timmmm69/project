import { prisma } from "@/server/db/client";
import {
  migrationManifest,
  type MigrationManifestEntry
} from "@/server/runtime-readiness/migration-manifest";

export type MigrationCompatibilityProbe = () => boolean | Promise<boolean>;

export type MigrationMetadataRow = Readonly<{
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  applied_steps_count: number;
}>;

function isSuccessful(row: MigrationMetadataRow) {
  return row.finished_at !== null
    && row.rolled_back_at === null
    && row.applied_steps_count > 0;
}

export function isMigrationStateCompatible(
  rows: readonly MigrationMetadataRow[],
  manifest: readonly MigrationManifestEntry[] = migrationManifest
) {
  const expectedByName = new Map(
    manifest.map((entry) => [entry.migrationName, entry] as const)
  );
  const successfulByName = new Map<string, MigrationMetadataRow>();

  for (const row of rows) {
    const expected = expectedByName.get(row.migration_name);

    if (row.finished_at === null && row.rolled_back_at === null) {
      return false;
    }

    if (row.rolled_back_at !== null) {
      if (!expected) {
        return false;
      }
      continue;
    }

    if (!isSuccessful(row) || !expected || row.checksum !== expected.checksum) {
      return false;
    }

    if (successfulByName.has(row.migration_name)) {
      return false;
    }

    successfulByName.set(row.migration_name, row);
  }

  if (successfulByName.size !== manifest.length) {
    return false;
  }

  return manifest.every((entry) => successfulByName.has(entry.migrationName));
}

export async function probeMigrationCompatibility() {
  try {
    const rows = await prisma.$queryRaw<MigrationMetadataRow[]>`
      SELECT
        "migration_name",
        "checksum",
        "finished_at",
        "rolled_back_at",
        "applied_steps_count"
      FROM "_prisma_migrations"
    `;

    return isMigrationStateCompatible(rows);
  } catch {
    return false;
  }
}
