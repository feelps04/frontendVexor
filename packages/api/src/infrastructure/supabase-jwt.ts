import { createPublicKey, createVerify } from 'node:crypto';

// Supabase JWKS keys
const JWKS_KEYS = [
  {
    kid: '5f104b60-5953-4953-b18f-93b754ea82a0',
    alg: 'ES256',
    crv: 'P-256',
    kty: 'EC',
    x: 'pSsOZvjpOioDigvvUvjNyzntLNBTX1Oq_JieAftgdGc',
    y: 'gZmP9jtksH5VnFVRLQeOTawZq-sh8zbbvodeZGSWTzg',
  },
  {
    kid: '0e1818b4-e554-4a8e-aef4-c6eeab3d84cf',
    alg: 'ES256',
    crv: 'P-256',
    kty: 'EC',
    x: 'kfRxN88UVbapvvOuqQuaHP5sewMBPrUin0Pga7UWjE4',
    y: 'CH__zIb9vuUMc3jB2aZw9pm5ZNdZ91l6rEGPIAdrGT8',
  },
];

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

function getPublicKey(jwk: { x: string; y: string; crv: string }): string {
  const x = base64UrlToBuffer(jwk.x);
  const y = base64UrlToBuffer(jwk.y);
  
  // EC P-256 public key in DER format
  // 0x30 0x59 sequence
  // 0x30 0x13 algorithm identifier
  // 0x06 0x07 0x2a 0x86 0x48 0xce 0x3d 0x02 0x01 (OID for EC)
  // 0x06 0x08 0x2a 0x86 0x48 0xce 0x3d 0x03 0x01 0x07 (OID for P-256)
  // 0x03 0x42 0x00 0x04 + x + y (bit string with uncompressed point)
  
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

export function verifySupabaseJWT(token: string): SupabaseJWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    const [headerB64, payloadB64, signatureB64] = parts;
    const header = JSON.parse(Buffer.from(base64UrlToBase64(headerB64), 'base64').toString('utf8'));
    const payload = JSON.parse(Buffer.from(base64UrlToBase64(payloadB64), 'base64').toString('utf8'));
    
    // Find matching key
    const key = JWKS_KEYS.find(k => k.kid === header.kid);
    if (!key) {
      console.error('No matching key found for kid:', header.kid);
      return null;
    }
    
    // Verify signature
    const publicKey = getPublicKey(key);
    const verifier = createVerify('SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    
    const signature = base64UrlToBuffer(signatureB64);
    const valid = verifier.verify(publicKey, signature);
    
    if (!valid) {
      console.error('Invalid signature');
      return null;
    }
    
    // Check expiration
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      console.error('Token expired');
      return null;
    }
    
    return payload as SupabaseJWTPayload;
  } catch (err) {
    console.error('JWT verification error:', err);
    return null;
  }
}
