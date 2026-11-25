import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db.js';
import type { UserRow, AuthUser, JwtPayload } from './types.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

export interface RegisterBody {
  username: string;
  password: string;
  email?: string;
}

export interface LoginBody {
  username: string;
  password: string;
}

function toAuthUser(u: UserRow): AuthUser {
  return { id: u.id, username: u.username, email: u.email };
}

function signHmac(data: string): string {
  return createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
}

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** 注册：用户名唯一，密码 bcrypt 哈希 */
export async function registerUser(body: RegisterBody): Promise<{ user: AuthUser; token: string }> {
  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  if (!username || password.length < 4) {
    const err = new Error('用户名不能为空，密码至少 4 位') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db
      .prepare('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)')
      .run(username, hash, body.email ?? null);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as UserRow;
    const user = toAuthUser(row);
    return { user, token: signToken(user) };
  } catch (e: any) {
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const err = new Error('用户名已存在') as Error & { statusCode?: number };
      err.statusCode = 409;
      throw err;
    }
    throw e;
  }
}

export function loginUser(body: LoginBody): { user: AuthUser; token: string } {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(body.username ?? '') as
    | UserRow
    | undefined;
  if (!row || !bcrypt.compareSync(body.password ?? '', row.password_hash)) {
    const err = new Error('用户名或密码错误') as Error & { statusCode?: number };
    err.statusCode = 401;
    throw err;
  }
  const user = toAuthUser(row);
  return { user, token: signToken(user) };
}

export function signToken(user: AuthUser): string {
  const payload: JwtPayload = {
    sub: user.id,
    username: user.username,
    email: user.email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  };
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const data = `${header}.${body}`;
  return `${data}.${signHmac(data)}`;
}

export function verifyToken(token: string): AuthUser {
  const [header, body, sig] = token.split('.');
  if (!header || !body || !sig) throw new Error('无效 token');
  if (signHmac(`${header}.${body}`) !== sig) throw new Error('token 签名错误');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as JwtPayload;
  if (!payload.sub || !payload.exp || payload.exp * 1000 < Date.now()) throw new Error('token 已过期');
  return { id: payload.sub, username: payload.username, email: payload.email ?? null };
}

export function authHook(fastify: FastifyInstance) {
  fastify.decorateRequest('auth', undefined);
  const PUBLIC_PREFIXES = ['/api/auth/', '/api/public/', '/api/health'];
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url;
    // 公开/认证路由免鉴权
    if (PUBLIC_PREFIXES.some((p) => url.startsWith(p))) return;
    const authz = request.headers.authorization ?? '';
    if (!authz.startsWith('Bearer ')) {
      return reply.code(401).send({ error: '未登录' });
    }
    try {
      request.auth = verifyToken(authz.slice(7));
    } catch {
      return reply.code(401).send({ error: '登录已失效' });
    }
  });
}