import { createHash, randomBytes } from "node:crypto";

function getCodePepper() {
  return process.env.ACCESS_CODE_HASH_PEPPER || process.env.SESSION_SECRET || "dev_only_access_code_pepper";
}

export function normalizeAccessCode(code: string) {
  return code.trim().toUpperCase().replace(/[\s-]+/g, "");
}

export function hashAccessCode(code: string) {
  return createHash("sha256")
    .update(`${normalizeAccessCode(code)}:${getCodePepper()}`)
    .digest("hex");
}

export function generateAccessCode() {
  const raw = randomBytes(8).toString("hex").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}
