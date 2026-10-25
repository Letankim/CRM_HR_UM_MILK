import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@umbm/shared';

export const ACCESS_COOKIE = 'umbm_at';
export const REFRESH_COOKIE = 'umbm_rt';
/**
 * Cookie đánh dấu "có phiên" (không chứa bí mật). Refresh cookie bị giới hạn path
 * /api/auth nên middleware Next.js không đọc được — dùng marker này để quyết định
 * có chuyển về trang đăng nhập hay không.
 */
export const SESSION_MARKER_COOKIE = 'umbm_s';
export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface TokenClaims {
  sub: string;
  role: Role;
  /** session_version — tăng lên khi Admin thu hồi phiên, làm mọi token cũ mất hiệu lực. */
  sv: number;
  app: 'backoffice' | 'employee';
}

export class TokenService {
  private readonly accessKey: Uint8Array;
  private readonly refreshKey: Uint8Array;

  constructor(accessSecret: string, refreshSecret: string) {
    this.accessKey = new TextEncoder().encode(accessSecret);
    this.refreshKey = new TextEncoder().encode(refreshSecret);
  }

  signAccess(claims: TokenClaims): Promise<string> {
    return this.sign(claims, this.accessKey, ACCESS_TTL_SECONDS, 'access');
  }

  signRefresh(claims: TokenClaims): Promise<string> {
    return this.sign(claims, this.refreshKey, REFRESH_TTL_SECONDS, 'refresh');
  }

  verifyAccess(token: string): Promise<TokenClaims> {
    return this.verify(token, this.accessKey, 'access');
  }

  verifyRefresh(token: string): Promise<TokenClaims> {
    return this.verify(token, this.refreshKey, 'refresh');
  }

  private async sign(claims: TokenClaims, key: Uint8Array, ttl: number, typ: string): Promise<string> {
    return new SignJWT({ role: claims.role, sv: claims.sv, app: claims.app, typ })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer('umbm-api')
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`)
      .sign(key);
  }

  private async verify(token: string, key: Uint8Array, typ: string): Promise<TokenClaims> {
    const { payload } = await jwtVerify(token, key, { issuer: 'umbm-api', algorithms: ['HS256'] });
    if (payload.typ !== typ || typeof payload.sub !== 'string') throw new Error('Token sai loại');
    return {
      sub: payload.sub,
      role: payload.role as Role,
      sv: Number(payload.sv),
      app: payload.app as TokenClaims['app'],
    };
  }
}
