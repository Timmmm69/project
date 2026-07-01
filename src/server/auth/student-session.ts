import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/server/db/client";

export const STUDENT_SESSION_COOKIE = "student_session";

const STUDENT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type StudentSession = {
  userId: string;
  email: string;
  role: "STUDENT";
  expiresAt: number;
};

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 24) {
    throw new Error("SESSION_SECRET must be set and contain at least 24 characters");
  }
  return secret;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createStudentSessionToken(input: Pick<StudentSession, "userId" | "email" | "role">) {
  const session: StudentSession = {
    ...input,
    expiresAt: Math.floor(Date.now() / 1000) + STUDENT_SESSION_TTL_SECONDS
  };
  const payload = base64UrlEncode(JSON.stringify(session));
  return `${payload}.${signPayload(payload)}`;
}

export function verifyStudentSessionToken(token: string): StudentSession | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return null;
  }
  if (!safeEqual(signature, signPayload(payload))) {
    return null;
  }

  try {
    const session = JSON.parse(base64UrlDecode(payload)) as StudentSession;
    if (session.role !== "STUDENT" || session.expiresAt <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function setStudentSessionCookie(session: Pick<StudentSession, "userId" | "email" | "role">) {
  const cookieStore = await cookies();
  cookieStore.set(STUDENT_SESSION_COOKIE, createStudentSessionToken(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STUDENT_SESSION_TTL_SECONDS
  });
}

export async function getStudentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(STUDENT_SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }
  return verifyStudentSessionToken(token);
}

export async function requireStudent() {
  const session = await getStudentSession();
  if (!session) {
    return null;
  }

  return prisma.user.findFirst({
    where: {
      id: session.userId,
      email: session.email,
      role: "STUDENT",
      deletedAt: null
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true
    }
  });
}
