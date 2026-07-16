import {
  createCommercialClaimAccessHandler,
  type CommercialClaimAccessRouteDependencies
} from "../claim-access/route";

export type CommercialStartAttemptRouteDependencies = CommercialClaimAccessRouteDependencies;

export const createCommercialStartAttemptHandler = createCommercialClaimAccessHandler;

export const POST = createCommercialStartAttemptHandler();
