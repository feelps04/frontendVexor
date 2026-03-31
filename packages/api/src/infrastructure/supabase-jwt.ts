import { createVerify } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://pbecklboewiowuoclmln.supabase.co';
const JWKS_URI = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;

// In-memory JWKS cache: refresh at most once per hour
type JWK = { kid: string; alg: string; crv: string; kty: string; x: string; y: string };
let jwksCache: JWK[] | null = null;
let jwksCachedAt = 0;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

// Fallback static key (used when fetch fails)
const STATIC_JWKS: JWK[] = [
  {
    kid: 'b6a1daad-4d42-4a64-947b-5b3dece655ce',
    alg: 'ES256',
    crv: 'P-256',
    kty: 'EC',
    x: 'YkpZJ3tO0PAz9L_mLxjbppRNn3bx15JOuzfN7eCkoac',
    y: 'piRM42Hh6ynaCZLJoV8XK4EQTpYKSf_7OFbvKYJtFG8',
  },
];

async function getJWKS(): Promise<JWK[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCachedAt < JWKS_TTL_MS) {
    return jwksCache;
  }
  try {
    const res = await fetch(JWKS_URI, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const body = await res.json() as { keys?: JWK[] };
    const keys = body?.keys;
    if (!Array.isArray(keys) || keys.length === 0) throw new Error('Empty JWKS');
    jwksCache = keys;
    jwksCachedAt = now;
    return keys;
  } catch (err) {
    console.error('JWKS fetch error, using static fallback:', err);
    return STATIC_JWKS;
  }
}

function base64UrlToBase64(base64url: string): string {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad) {
    base64 += '='.repeat(4 - pad);
  }
  return base64;
}

function base64UrlToBuffer(base64url: string): Buffer {
  return Buffer.from(base64UrlToBase64(base64url), 'base64');
}

function ecPublicKeyToPem(jwk: { x: string; y: string }): string {
  const x = base64UrlToBuffer(jwk.x);
  const y = base64UrlToBuffer(jwk.y);

  // EC P-256 SubjectPublicKeyInfo DER encoding
  const algorithmId = Buffer.from([
    0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
  ]);

  const point = Buffer.concat([Buffer.from([0x00, 0x04]), x, y]);
  const bitString = Buffer.concat([Buffer.from([0x03, 0x42]), point]);
  const sequence = Buffer.concat([Buffer.from([0x30, 0x59]), algorithmId, bitString]);

  return `-----BEGIN PUBLIC KEY-----\n${sequence.toString('base64')}\n-----END PUBLIC KEY-----`;
}

export interface SupabaseJWTPayload {
  aud: string;
  exp: number;
  iat: number;
  iss: string;
  sub: string;
  email?: string;
  phone?: string;
  role?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  session_id?: string;
}

export async function verifySupabaseJWT(token: string): Promise<SupabaseJWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const header = JSON.parse(Buffer.from(base64UrlToBase64(headerB64), 'base64').toString('utf8'));
    const payload = JSON.parse(Buffer.from(base64UrlToBase64(payloadB64), 'base64').toString('utf8'));

    if (header.alg !== 'ES256') return null;

    const keys = await getJWKS();
    const key = header.kid
      ? keys.find((k) => k.kid === header.kid)
      : keys.find((k) => k.alg === 'ES256');

    if (!key) {
      console.error('No matching JWKS key for kid:', header.kid);
      return null;
    }

    const publicKey = ecPublicKeyToPem(key);
    const verifier = createVerify('SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);

    const signature = base64UrlToBuffer(signatureB64);
    const valid = verifier.verify(publicKey, signature);

    if (!valid) {
      console.error('Supabase JWT: invalid signature');
      return null;
    }

    if (payload.exp && payload.exp * 1000 < Date.now()) {
      console.error('Supabase JWT: token expired');
      return null;
    }

    return payload as SupabaseJWTPayload;
  } catch (err) {
    console.error('Supabase JWT verification error:', err);
    return null;
  }
}
