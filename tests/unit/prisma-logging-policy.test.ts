import { describe, expect, it, vi } from "vitest";
import {
  emitSafePrismaError,
  PRISMA_LOG_OPTIONS,
  registerSafePrismaErrorHandler,
  reuseOrCreatePrismaClient,
  SAFE_PRISMA_ERROR_MESSAGE
} from "@/server/db/client";

describe("safe Prisma logging policy", () => {
  it("keeps warnings and configures errors as events instead of raw stdout", () => {
    expect(PRISMA_LOG_OPTIONS).toEqual([
      "warn",
      { emit: "event", level: "error" }
    ]);
    expect(PRISMA_LOG_OPTIONS).toContain("warn");
    expect(PRISMA_LOG_OPTIONS).not.toContain("error");
    expect(Object.isFrozen(PRISMA_LOG_OPTIONS)).toBe(true);
    expect(Object.isFrozen(PRISMA_LOG_OPTIONS[1])).toBe(true);
  });

  it("emits only the fixed safe signal and discards the raw event payload", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const syntheticEvent = Object.freeze({
      message: "Can't reach database server at private-database.internal:5432",
      target: "quaint::connector::postgres",
      code: "P1001",
      clientVersion: "synthetic-client-version",
      databaseUrl: "postgresql://private-user:private-password@private-database.internal/private",
      schema: "private_schema",
      query: "SELECT private_value FROM private_table",
      parameters: "private-parameters",
      stack: "private-stack",
      cause: "private-cause"
    });

    emitSafePrismaError(syntheticEvent);

    expect(SAFE_PRISMA_ERROR_MESSAGE).toBe("Database operation failed.");
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("Database operation failed.");
    expect(consoleError.mock.calls[0]).toEqual(["Database operation failed."]);
    expect(consoleError.mock.calls[0]).not.toContain(syntheticEvent);
    const output = JSON.stringify(consoleError.mock.calls);
    for (const diagnostic of Object.values(syntheticEvent)) {
      expect(output).not.toContain(diagnostic);
    }

    consoleError.mockRestore();
  });

  it("registers the closed handler once through the event registrar", () => {
    const register = vi.fn();

    registerSafePrismaErrorHandler(register);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith("error", emitSafePrismaError);
  });

  it("reuses the singleton without invoking creation or registering another handler", () => {
    type SyntheticClient = Readonly<{ client: string }>;
    const existing: SyntheticClient = Object.freeze({ client: "existing" });
    const register = vi.fn();
    const createClient = vi.fn<() => SyntheticClient>(() => {
      registerSafePrismaErrorHandler(register);
      return Object.freeze({ client: "created" });
    });

    const reused = reuseOrCreatePrismaClient(existing, createClient);

    expect(reused).toBe(existing);
    expect(createClient).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();

    const created = reuseOrCreatePrismaClient(undefined, createClient);
    expect(created).toEqual({ client: "created" });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(1);
  });
});
