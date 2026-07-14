import { createRecoveryHttpHandlers } from "@/server/recovery/http-handlers";

const handlers = createRecoveryHttpHandlers();

export const DELETE = handlers.invalidateSession;
