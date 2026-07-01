import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";

export type LogEventInput = {
  eventType: string;
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  payload?: Prisma.InputJsonValue;
};

export async function logEvent(input: LogEventInput) {
  return prisma.eventLog.create({
    data: {
      eventType: input.eventType,
      actorUserId: input.actorUserId,
      entityType: input.entityType,
      entityId: input.entityId,
      payload: input.payload
    }
  });
}
