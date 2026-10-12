/**
 * 账号与会话。
 *
 * 密码哈希用 Node 内置的 **scrypt**（node:crypto），不引第三方库：
 *  · argon2 需要原生编译，在这个环境里装起来容易踩坑；
 *  · scrypt 是经过充分审查的内存硬哈希，抗 GPU 暴力破解，OWASP 推荐；
 *  · 参数用 N=16384, r=8, p=1（约 16MB 内存/次），是常用平衡点。
 *
 * 存的是 `scrypt$N$r$p$salt$hash` 单字符串，参数内嵌，
 * 将来调参数时旧密码仍能校验（用存下来的参数算）。
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { Db } from '../db.ts'
import { AppError, forbidden, tooLarge, unauthorized } from './http.ts'

const N = 16384
const R = 8
const P = 1
const KEYLEN = 64

export const SESSION_COOKIE = 'cv_sid'
/** 会话有效期 30 天 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** 连续失败几次后锁定 */
const MAX_FAILED = 5
const LOCK_MS = 15 * 60 * 1000

/* ------------------------------ 密码 ------------------------------ */

export function hashPassword(pw: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(pw, salt, KEYLEN, { N, r: R, p: P })
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$')
}

export function verifyPassword(pw: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, hashB64] = parts
  try {
    const salt = Buffer.from(saltB64!, 'base64')
    const want = Buffer.from(hashB64!, 'base64')
    const got = scryptSync(pw, salt, want.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      // scrypt 的内存上限默认偏小，参数稍大就会抛错，显式放宽
      maxmem: 256 * 1024 * 1024,
    })
    // 必须用定时安全比较，普通 === 会因为提前返回而泄漏信息
    return got.length === want.length && timingSafeEqual(got, want)
  } catch {
    return false
  }
}

/* --------------------------- 密码规则（与前端同一份） ---------------------------
   前端 src/lib/auth.ts 里的规则是用户可见的提示，服务端这份才是真正的闸门 ——
   前端校验任何人都能绕过（直接 curl 打接口），规则必须在服务端重跑一遍。 */

export const PASSWORD_RULES: { id: string; label: string; test: (pw: string) => boolean }[] = [
  { id: 'len', label: '至少 8 位', test: (p) => p.length >= 8 },
  { id: 'lower', label: '含小写字母', test: (p) => /[a-z]/.test(p) },
  { id: 'upper', label: '含大写字母', test: (p) => /[A-Z]/.test(p) },
  { id: 'digit', label: '含数字', test: (p) => /\d/.test(p) },
]

const SEQUENCES = ['012', '123', '234', '345', '456', '567', '678', '789', 'abc', 'qwe', 'asd', 'zxc']

export function checkPassword(pw: string): { ok: boolean; failed: string[] } {
  const failed = PASSWORD_RULES.filter((r) => !r.test(pw)).map((r) => r.label)
  if (/(.)\1\1/.test(pw)) failed.push('不含连续 3 位重复字符')
  const lower = pw.toLowerCase()
  if (SEQUENCES.some((s) => lower.includes(s))) failed.push('不含 012 / abc / qwe 这类顺序字符')
  return { ok: failed.length === 0, failed }
}

/** 11 位随机账号，首位不为 0 */
export function genAccount(taken: Set<string>): string {
  for (let i = 0; i < 100; i++) {
    const first = String(1 + Math.floor(Math.random() * 9))
    let rest = ''
    for (let k = 0; k < 10; k++) rest += String(Math.floor(Math.random() * 10))
    const acc = first + rest
    if (!taken.has(acc)) return acc
  }
  throw new AppError(500, 'GEN_FAILED', '账号生成失败，请重试')
}

/* ------------------------------ 会话 ------------------------------ */

export interface SessionUser {
  id: number
  account: string
  isAdmin: boolean
}

export function createSession(db: Db, userId: number, userAgent: string, ip: string): string {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(token, userId, now, now + SESSION_TTL_MS, userAgent.slice(0, 300), ip)
  return token
}

export function dropSession(db: Db, token: string) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function dropUserSessions(db: Db, userId: number, exceptToken?: string) {
  if (exceptToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(userId, exceptToken)
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  }
}

/** 定期清理过期会话，避免表无限增长 */
export function purgeExpiredSessions(db: Db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
}

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}

/**
 * 写会话 cookie。
 *
 * ⚠️ `Secure` 是**上线必须**的一条：公网走 HTTPS 时，不带 Secure 的 cookie
 * 在 http 上也会被浏览器发出去，中间人就能拿到会话令牌。
 *
 * 但不能无脑加 —— 本地是 `http://127.0.0.1:5174`，加了 Secure 浏览器会
 * **拒绝保存**这个 cookie，于是"新开标签页自动继承会话"就失效了。
 * 所以由调用方判断（`req.secure`，反代走 X-Forwarded-Proto 也算）。
 */
export function setSessionCookie(res: Response, token: string, opts: { secure?: boolean } = {}) {
  // httpOnly：JS 读不到，XSS 偷不走
  // sameSite=lax：防 CSRF，同时不影响正常导航
  const maxAge = Math.floor(SESSION_TTL_MS / 1000)
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${opts.secure ? '; Secure' : ''}`,
  )
}

export function clearSessionCookie(res: Response, opts: { secure?: boolean } = {}) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${opts.secure ? '; Secure' : ''}`,
  )
}

/**
 * 取这次请求用的会话令牌。
 *
 * **优先 Authorization 头，其次 cookie。** 这个顺序是为了支持"同一浏览器
 * 开两个窗口登录两个账号"：
 *
 * cookie 名固定（cv_sid），一个域只有一份，两个标签页必然共用 ——
 * B 登录会把 A 的覆盖掉，A 的窗口一刷新就变成 B 的账号（用户遇到的就是这个）。
 * 而前端把会话存进 `sessionStorage`，那是**每标签页独立**的，
 * 于是每个窗口可以各用各的会话。
 *
 * cookie 仍然保留：新开标签页时 sessionStorage 是空的，靠它把当前会话
 * "继承"过来，否则每开一个标签页都要重新登录。
 */
export function sessionTokenOf(req: Request): string | null {
  const h = req.headers as Record<string, string | string[] | undefined>
  const auth = h.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim()
    if (t) return t
  }
  return readCookie(req, SESSION_COOKIE)
}

export function currentUser(db: Db, req: Request): SessionUser | null {
  const token = sessionTokenOf(req)
  if (!token) return null
  const row = db
    .prepare(
      `SELECT u.id, u.account, u.is_admin, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`,
    )
    .get(token) as { id: number; account: string; is_admin: number; expires_at: number } | undefined
  if (!row) return null
  if (row.expires_at < Date.now()) {
    dropSession(db, token)
    return null
  }
  return { id: row.id, account: row.account, isAdmin: row.is_admin === 1 }
}

/** 鉴权中间件工厂 —— 需要登录的接口统一挂这个 */
export function requireAuth(db: Db) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = currentUser(db, req)
    if (!user) return next(unauthorized())
    ;(req as AuthedRequest).user = user
    next()
  }
}

export interface AuthedRequest extends Request {
  user: SessionUser
}

export const getUser = (req: Request): SessionUser => {
  const u = (req as AuthedRequest).user
  if (!u) throw unauthorized()
  return u
}

/* --------------------------- 登录失败锁定 --------------------------- */

export function assertNotLocked(db: Db, account: string) {
  const row = db.prepare('SELECT locked_until FROM users WHERE account = ?').get(account) as
    | { locked_until: number }
    | undefined
  if (row && row.locked_until > Date.now()) {
    const mins = Math.ceil((row.locked_until - Date.now()) / 60000)
    throw new AppError(429, 'LOCKED', `尝试次数过多，请 ${mins} 分钟后再试`)
  }
}

export function noteLoginFailure(db: Db, account: string) {
  const row = db.prepare('SELECT id, failed_count FROM users WHERE account = ?').get(account) as
    | { id: number; failed_count: number }
    | undefined
  if (!row) return
  const next = row.failed_count + 1
  const lockedUntil = next >= MAX_FAILED ? Date.now() + LOCK_MS : 0
  db.prepare('UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?').run(
    lockedUntil ? 0 : next,
    lockedUntil,
    row.id,
  )
}

export function noteLoginSuccess(db: Db, userId: number) {
  db.prepare('UPDATE users SET failed_count = 0, locked_until = 0, last_login_at = ? WHERE id = ?').run(
    Date.now(),
    userId,
  )
}

/* ------------------------------ 限流 ------------------------------ */

/**
 * 极简滑动窗口限流，按 IP + 路由。
 * 单进程内存实现，够本地单用户用；要多实例部署时得换成 Redis。
 */
const buckets = new Map<string, number[]>()

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (arr.length >= limit) throw tooLarge('请求过于频繁，请稍后再试')
  arr.push(now)
  buckets.set(key, arr)
  // 顺手回收，避免 map 无限增长
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k)
  }
}

export { forbidden }
