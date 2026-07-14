import { createRecoveryHttpHandlers } from "@/server/recovery/http-handlers";

const handlers = createRecoveryHttpHandlers();

export const GET = handlers.resolveState;
