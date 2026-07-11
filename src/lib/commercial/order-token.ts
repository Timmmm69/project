import { cookies } from "next/headers";
import { getCommercialOrder, orderTokenCookieName } from "@/lib/commercial/commercial-service";
import { lookupTokenMatches } from "@/lib/commercial/security";

export async function requireCommercialOrderToken(publicId: string) {
  try {
    const order = await getCommercialOrder(publicId);
    const token = (await cookies()).get(orderTokenCookieName(publicId))?.value;
    return lookupTokenMatches(token, order.lookupTokenHash) ? order : null;
  } catch {
    return null;
  }
}

export async function setCommercialOrderToken(publicId: string, token: string) {
  (await cookies()).set(orderTokenCookieName(publicId), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 2
  });
}
