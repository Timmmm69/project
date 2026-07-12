import { randomUUID } from "node:crypto";

export function createCheckoutFlowId() {
  return randomUUID();
}

export function checkoutStartedProperties(input: {
  checkoutFlowId: string;
  productId: string;
  testId: string;
  examMode: string;
}) {
  return {
    checkout_flow_id: input.checkoutFlowId,
    product_id: input.productId,
    test_id: input.testId,
    exam_mode: input.examMode.toLowerCase()
  };
}

export function orderCreatedProperties(input: {
  checkoutFlowId: string;
  orderPublicIdHash: string;
  productId: string;
  testId: string;
  amount: number;
  currency: string;
}) {
  return {
    checkout_flow_id: input.checkoutFlowId,
    order_public_id_hash: input.orderPublicIdHash,
    product_id: input.productId,
    test_id: input.testId,
    amount: input.amount,
    currency: input.currency
  };
}
