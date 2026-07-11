import type { CommercialOrderStatus, CommercialPaymentAttemptStatus } from "@prisma/client";

const orderTransitions: Record<CommercialOrderStatus, CommercialOrderStatus[]> = {
  CREATED: ["PENDING", "CANCELLED", "EXPIRED"],
  PENDING: ["PAID", "FAILED", "CANCELLED", "EXPIRED"],
  PAID: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: []
};

const paymentTransitions: Record<CommercialPaymentAttemptStatus, CommercialPaymentAttemptStatus[]> = {
  CREATED: ["PENDING"],
  PENDING: ["PAID", "FAILED", "CANCELLED", "EXPIRED"],
  PAID: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: []
};

export function canTransitionOrder(from: CommercialOrderStatus, to: CommercialOrderStatus) {
  return orderTransitions[from].includes(to);
}

export function canTransitionPaymentAttempt(from: CommercialPaymentAttemptStatus, to: CommercialPaymentAttemptStatus) {
  return paymentTransitions[from].includes(to);
}

export function isTerminalPaymentAttempt(status: CommercialPaymentAttemptStatus) {
  return status === "PAID" || status === "FAILED" || status === "CANCELLED" || status === "EXPIRED";
}

export function isActivePaymentAttempt(status: CommercialPaymentAttemptStatus) {
  return status === "CREATED" || status === "PENDING";
}
