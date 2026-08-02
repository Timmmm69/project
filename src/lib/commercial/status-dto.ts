import { z } from "zod";

export const commercialStatusCategorySchema = z.enum([
  "payment_pending",
  "payment_paid",
  "payment_failed",
  "payment_cancelled",
  "payment_expired",
  "payment_status_unknown",
  "paid_without_access"
]);

export const commercialStatusActionSchema = z.enum([
  "create_payment_session",
  "refresh_status",
  "retry_payment",
  "continue_access",
  "contact_support"
]);

export const commercialOrderStatusDtoSchema = z.object({
  orderReference: z.string().min(12).max(128),
  category: commercialStatusCategorySchema,
  timestamps: z.object({
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    paymentUpdatedAt: z.iso.datetime().nullable(),
    paidAt: z.iso.datetime().nullable()
  }).strict(),
  cooldown: z.object({
    refreshAfterSeconds: z.number().int().min(0).max(60).nullable(),
    supportAvailableAt: z.iso.datetime().nullable()
  }).strict(),
  allowedActions: z.array(commercialStatusActionSchema).max(3)
}).strict();

export type CommercialPaymentStatusProjection = "payment_status_unknown";
export type CommercialOrderStatusDto = z.infer<typeof commercialOrderStatusDtoSchema>;

type StatusSource = Readonly<{
  publicId: string;
  status: "CREATED" | "PENDING" | "PAID" | "FAILED" | "CANCELLED" | "EXPIRED";
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  paymentAttempts: ReadonlyArray<Readonly<{
    status: "CREATED" | "PENDING" | "PAID" | "FAILED" | "CANCELLED" | "EXPIRED";
    paidAt: Date | null;
    updatedAt: Date;
  }>>;
  access: unknown | null;
}>;

const FIVE_MINUTES_MS = 5 * 60 * 1_000;
const PAID_WITHOUT_ACCESS_SUPPORT_MS = 60 * 1_000;
const MANUAL_REFRESH_COOLDOWN_SECONDS = 10;

function addMilliseconds(value: Date, milliseconds: number) {
  return new Date(value.getTime() + milliseconds);
}

function categoryFor(
  order: StatusSource,
  projection?: CommercialPaymentStatusProjection
): z.infer<typeof commercialStatusCategorySchema> {
  if (projection === "payment_status_unknown") return projection;
  if (order.status === "PAID") return order.access ? "payment_paid" : "paid_without_access";
  if (order.status === "FAILED") return "payment_failed";
  if (order.status === "CANCELLED") return "payment_cancelled";
  if (order.status === "EXPIRED") return "payment_expired";
  return "payment_pending";
}

function supportAvailableAt(order: StatusSource, category: z.infer<typeof commercialStatusCategorySchema>) {
  const payment = order.paymentAttempts[0] ?? null;
  if (category === "paid_without_access") {
    return addMilliseconds(order.paidAt ?? payment?.paidAt ?? order.updatedAt, PAID_WITHOUT_ACCESS_SUPPORT_MS);
  }
  if (category === "payment_pending" || category === "payment_status_unknown") {
    return addMilliseconds(payment?.updatedAt ?? order.updatedAt, FIVE_MINUTES_MS);
  }
  return null;
}

function actionsFor(
  order: StatusSource,
  category: z.infer<typeof commercialStatusCategorySchema>,
  supportAt: Date | null,
  now: Date
): Array<z.infer<typeof commercialStatusActionSchema>> {
  if (category === "payment_paid") return ["continue_access"];
  if (category === "payment_failed" || category === "payment_cancelled" || category === "payment_expired") {
    return ["retry_payment", "contact_support"];
  }
  const actions: Array<z.infer<typeof commercialStatusActionSchema>> = [];
  if (order.status === "CREATED" && order.paymentAttempts.length === 0) {
    actions.push("create_payment_session");
  } else {
    actions.push("refresh_status");
  }
  if (supportAt && supportAt.getTime() <= now.getTime()) actions.push("contact_support");
  return actions;
}

export function serializeCommercialOrderStatus(
  order: StatusSource,
  projection?: CommercialPaymentStatusProjection,
  now = new Date()
): CommercialOrderStatusDto {
  const payment = order.paymentAttempts[0] ?? null;
  const category = categoryFor(order, projection);
  const supportAt = supportAvailableAt(order, category);
  const refreshAllowed = category === "payment_pending" ||
    category === "payment_status_unknown" || category === "paid_without_access";

  return commercialOrderStatusDtoSchema.parse({
    orderReference: order.publicId,
    category,
    timestamps: {
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      paymentUpdatedAt: payment?.updatedAt.toISOString() ?? null,
      paidAt: (order.paidAt ?? payment?.paidAt)?.toISOString() ?? null
    },
    cooldown: {
      refreshAfterSeconds: refreshAllowed ? MANUAL_REFRESH_COOLDOWN_SECONDS : null,
      supportAvailableAt: supportAt?.toISOString() ?? null
    },
    allowedActions: actionsFor(order, category, supportAt, now)
  });
}
