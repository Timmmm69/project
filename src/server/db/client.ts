import { PrismaClient, type Prisma } from "@prisma/client";

type PrismaLogOption = NonNullable<Prisma.PrismaClientOptions["log"]>[number];

export const SAFE_PRISMA_ERROR_MESSAGE = "Database operation failed.";

export const PRISMA_LOG_OPTIONS = Object.freeze([
  "warn",
  Object.freeze({
    emit: "event",
    level: "error"
  })
] as const satisfies readonly PrismaLogOption[]);

export function emitSafePrismaError(event: unknown) {
  void event;
  console.error(SAFE_PRISMA_ERROR_MESSAGE);
}

type PrismaErrorEventRegistrar = (
  event: "error",
  listener: (event: unknown) => void
) => void;

export function registerSafePrismaErrorHandler(register: PrismaErrorEventRegistrar) {
  register("error", emitSafePrismaError);
}

export function reuseOrCreatePrismaClient<T>(existing: T | undefined, createClient: () => T) {
  return existing ?? createClient();
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  const client = new PrismaClient({
    log: [...PRISMA_LOG_OPTIONS]
  });
  registerSafePrismaErrorHandler((event, listener) => {
    client.$on(event, listener);
  });
  return client;
}

export const prisma = reuseOrCreatePrismaClient(
  globalForPrisma.prisma,
  createPrismaClient
);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
