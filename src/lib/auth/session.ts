import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";

export const SESSION_COOKIE = "mt_session";
const MAX_AGE = 12 * 3600;

export type SessionClaims = { sub: string; sv: number };

const key = () => new TextEncoder().encode(env.sessionSecret);

export async function signSession(c: SessionClaims): Promise<string> {
  return new SignJWT({ sv: c.sv }).setProtectedHeader({ alg: "HS256" }).setSubject(c.sub).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).setIssuer("madtown-inventory").sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: "madtown-inventory" });
    if (!payload.sub) return null;
    return { sub: payload.sub, sv: Number(payload.sv ?? 0) };
  } catch {
    return null;
  }
}
export const sessionMaxAge = MAX_AGE;
