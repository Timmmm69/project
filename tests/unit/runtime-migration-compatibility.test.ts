import { describe, expect, it } from "vitest";
import {
  isMigrationStateCompatible,
  type MigrationMetadataRow
} from "@/server/runtime-readiness/migration-compatibility";
import { migrationManifest } from "@/server/runtime-readiness/migration-manifest";

const finishedAt = new Date("2026-07-17T00:00:00.000Z");

function successfulRows(): MigrationMetadataRow[] {
  return migrationManifest.map((entry) => ({
    migration_name: entry.migrationName,
    checksum: entry.checksum,
    finished_at: finishedAt,
    rolled_back_at: null,
    applied_steps_count: 1
  }));
}

describe("migration compatibility rules", () => {
  it("accepts exactly one valid successful row for every expected migration", () => {
    expect(isMigrationStateCompatible(successfulRows())).toBe(true);
  });

  it("rejects a missing expected migration", () => {
    expect(isMigrationStateCompatible(successfulRows().slice(1))).toBe(false);
  });

  it("rejects an unknown successful migration", () => {
    const rows = successfulRows();
    rows.push({
      migration_name: "20990101000000_unknown",
      checksum: "f".repeat(64),
      finished_at: finishedAt,
      rolled_back_at: null,
      applied_steps_count: 1
    });

    expect(isMigrationStateCompatible(rows)).toBe(false);
  });

  it("rejects a checksum mismatch", () => {
    const rows = successfulRows();
    rows[0] = { ...rows[0], checksum: "0".repeat(64) };

    expect(isMigrationStateCompatible(rows)).toBe(false);
  });

  it("rejects an unfinished migration", () => {
    const rows = successfulRows();
    rows[0] = { ...rows[0], finished_at: null };

    expect(isMigrationStateCompatible(rows)).toBe(false);
  });

  it("rejects duplicate successful rows for one migration name", () => {
    const rows = successfulRows();
    rows.push({ ...rows[0] });

    expect(isMigrationStateCompatible(rows)).toBe(false);
  });

  it("accepts an expected historical rolled-back row with a separate valid success", () => {
    const rows = successfulRows();
    rows.unshift({
      ...rows[0],
      finished_at: null,
      rolled_back_at: new Date("2026-07-16T00:00:00.000Z"),
      applied_steps_count: 0
    });

    expect(isMigrationStateCompatible(rows)).toBe(true);
  });

  it("rejects a historical rolled-back row without a valid later success", () => {
    const rows = successfulRows();
    rows[0] = {
      ...rows[0],
      finished_at: null,
      rolled_back_at: new Date("2026-07-16T00:00:00.000Z"),
      applied_steps_count: 0
    };

    expect(isMigrationStateCompatible(rows)).toBe(false);
  });

  it("rejects a non-rolled-back row with no applied steps", () => {
    const rows = successfulRows();
    rows[0] = { ...rows[0], applied_steps_count: 0 };

    expect(isMigrationStateCompatible(rows)).toBe(false);
  });
});
