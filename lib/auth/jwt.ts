// Short-lived access tokens (JWT via jose) + opaque refresh token generation.
import { SignJWT, jwtVerify } from "jose";
import { randomBytes, createHash } from "node:crypto";

const enc = new TextEncoder();

function accessSecret(): Uint8Array {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s || s.length < 16) throw new Error("JWT_ACCESS_SECRET missing or too short");
  return enc.encode(s);
}

const ACCESS_TTL = Number(process.env.ACCESS_TOKEN_TTL ?? 900); // seconds

export interface AccessClaims {
  sub: string; // user id
  email: string;
  sa: boolean; // super admin
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ email: claims.email, sa: claims.sa })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL}s`)
    .sign(accessSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, accessSecret());
    return { sub: String(payload.sub), email: String(payload.email), sa: Boolean(payload.sa) };
  } catch {
    return null;
  }
}

// Opaque refresh token: random secret shown once to the client; only its hash is stored.
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const REFRESH_TTL = Number(process.env.REFRESH_TOKEN_TTL ?? 2592000); // seconds
