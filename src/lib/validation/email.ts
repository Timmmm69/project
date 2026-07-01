import { z } from "zod";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export const normalizedEmailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Email is invalid")
  .transform(normalizeEmail);
