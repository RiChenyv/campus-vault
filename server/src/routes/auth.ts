import { Router } from 'express'
import type { Db } from '../db.ts'
import {
  checkPassword,
  clearSessionCookie,
  createSession,
  currentUser,
  dropSession,
  dropUserSessions,
  genAccount,
  getUser,
  hashPassword,
  noteLoginFailure,
  noteLoginSuccess,
  assertNotLocked,
  rateLimit,
  readCookie,
  requireAuth,
  SESSION_COOKIE,
  setSessionCookie,
  sessionTokenOf,
  verifyPassword,
} from '../lib/auth.ts'
import { badRequest, ok, unauthorized, wrap } from '../lib/http.ts'
import { adminAccount, adminPassword, cookieSecure, registerAllowed } from '../lib/deploy.ts'

/**
 * 种子管理员账号。
 *
 * 账号名 / 密码都来自 lib/deploy.ts（那里统一管上线相关的开关）：
 *  · 本地（只听 127.0.0.1）：没设 ADMIN_PASSWORD 就用内置初始值，图省事，也不影响测试
 *  · 公网（HOST=0.0.0.0 等）：没设密码 / 还是初始值 → **拒绝启动**，见 assertDeploySafe
 */
export function ensureSeed(db: Db) {
  const account = adminAccount()
  const row = db.prepare('SELECT id FROM users WHERE account = ?').get(account)
  if (row) return
  const now = Date.now()
  const info = db
    .prepare(
      'INSERT INTO users (account, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)',
    )
    .run(account, hashPassword(adminPassword()), now)
  const id = Number(info.lastInsertRowid)
  db.prepare('INSERT INTO profiles (user_id, username) VALUES (?, ?)').run(id, '管理员')
  console.log(
    `[auth] 已创建管理员账号 ${account}` +
      (process.env.ADMIN_PASSWORD ? '（密码来自 ADMIN_PASSWORD）' : '（用的是内置初始密码，仅限本机使用）'),
  )
}

export function authRoutes(db: Db): Router {
  const r = Router()

  const publicUser = (id: number) => {
    const u = db.prepare('SELECT id, account, is_admin, created_at, last_login_at FROM users WHERE id = ?').get(id) as
      | { id: number; account: string; is_admin: number; created_at: number; last_login_at: number | null }
      | undefined
    const p = db
      .prepare(
        `SELECT username, avatar_file_id, github,
                real_name, student_id, college, major, grade, class_name, imported_at
           FROM profiles WHERE user_id = ?`,
      )
      .get(id) as
      | {
          username: string
          avatar_file_id: string | null
          github: string
          real_name: string
          student_id: string
          college: string
          major: string
          grade: string
          class_name: string
          imported_at: number | null
        }
      | undefined
    if (!u) return null
    return {
      id: u.id,
      account: u.account,
      isAdmin: u.is_admin === 1,
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at,
      username: p?.username ?? '',
      avatarFileId: p?.avatar_file_id ?? null,
      github: p?.github ?? '',
      // 在校信息：由油猴脚本从学校网站导入，不在前端手填
      realName: p?.real_name ?? '',
      studentId: p?.student_id ?? '',
      college: p?.college ?? '',
      major: p?.major ?? '',
      grade: p?.grade ?? '',
      className: p?.class_name ?? '',
      importedAt: p?.imported_at ?? null,
    }
  }

  /* ------------------------------ 注册 ------------------------------ */
  r.post(
    '/register',
    wrap(async (req, res) => {
      rateLimit(`reg:${req.ip}`, 10, 60 * 60 * 1000)
      /* ⚠️ 公网默认**关闭注册**：这是个单人应用，开放注册等于让任何人
         往你的服务器上建账号、占磁盘。本地（只听 127.0.0.1）默认仍开着，
         方便你自己建第二个账号。要公网也开，显式设 ALLOW_REGISTER=1。 */
      if (!registerAllowed()) {
        throw badRequest('本站已关闭注册', 'REGISTER_CLOSED')
      }
      const { password, confirm } = req.body ?? {}
      if (typeof password !== 'string' || typeof confirm !== 'string') {
        throw badRequest('缺少密码字段')
      }
      if (password !== confirm) throw badRequest('两次输入的密码不一致', 'PWD_MISMATCH')
      const chk = checkPassword(password)
      if (!chk.ok) {
        throw badRequest(`请更改密码设置：${chk.failed.join('、')}`, 'PWD_WEAK')
      }

      const taken = new Set(
        (db.prepare('SELECT account FROM users').all() as { account: string }[]).map((x) => x.account),
      )
      const account = genAccount(taken)
      const now = Date.now()
      const info = db
        .prepare('INSERT INTO users (account, password_hash, is_admin, created_at) VALUES (?, ?, 0, ?)')
        .run(account, hashPassword(password), now)
      const id = Number(info.lastInsertRowid)
      db.prepare('INSERT INTO profiles (user_id, username) VALUES (?, ?)').run(id, account)

      const token = createSession(db, id, String(req.headers['user-agent'] ?? ''), String(req.ip ?? ''))
      setSessionCookie(res, token, { secure: cookieSecure(req) })
      // 一并返回会话令牌：前端存进 sessionStorage，实现按标签页独立登录
      ok(res, { account, user: publicUser(id), sessionToken: token })
    }),
  )

  /* ------------------------------ 登录 ------------------------------ */
  r.post(
    '/login',
    wrap(async (req, res) => {
      const account = typeof req.body?.account === 'string' ? req.body.account.trim() : ''
      const password = typeof req.body?.password === 'string' ? req.body.password : ''
      if (!account || !password) throw badRequest('请输入账号和密码')

      rateLimit(`login:${req.ip}`, 30, 10 * 60 * 1000)
      assertNotLocked(db, account)

      const u = db.prepare('SELECT id, password_hash FROM users WHERE account = ?').get(account) as
        | { id: number; password_hash: string }
        | undefined

      // 账号不存在与密码错误返回**完全相同**的提示，
      // 否则就成了账号枚举接口（能逐个试出哪些账号存在）
      if (!u || !verifyPassword(password, u.password_hash)) {
        noteLoginFailure(db, account)
        throw unauthorized('账号或密码不正确', 'AUTH_INVALID')
      }

      noteLoginSuccess(db, u.id)
      const token = createSession(db, u.id, String(req.headers['user-agent'] ?? ''), String(req.ip ?? ''))
      setSessionCookie(res, token, { secure: cookieSecure(req) })
      ok(res, { user: publicUser(u.id), sessionToken: token })
    }),
  )

  /* ------------------------------ 退出 ------------------------------ */
  r.post(
    '/logout',
    wrap(async (req, res) => {
      const token = readCookie(req, SESSION_COOKIE)
      if (token) dropSession(db, token)
      clearSessionCookie(res, { secure: cookieSecure(req) })
      ok(res, { done: true })
    }),
  )

  /* ---------------------------- 当前登录态 ---------------------------- */
  r.get(
    '/me',
    wrap(async (req, res) => {
      const u = currentUser(db, req)
      if (!u) throw unauthorized('未登录', 'NO_SESSION')
      // 带上令牌：新标签页 sessionStorage 为空时，靠它把当前会话继承过来
    ok(res, { user: publicUser(u.id), sessionToken: sessionTokenOf(req) })
    }),
  )

  /* ------------------------------ 改密码 ------------------------------ */
  r.patch(
    '/password',
    requireAuth(db),
    wrap(async (req, res) => {
      const me = getUser(req)
      const { oldPassword, next, confirm } = req.body ?? {}
      if (typeof oldPassword !== 'string' || typeof next !== 'string' || typeof confirm !== 'string') {
        throw badRequest('缺少字段')
      }
      if (next !== confirm) throw badRequest('两次输入的密码不一致', 'PWD_MISMATCH')
      const chk = checkPassword(next)
      if (!chk.ok) throw badRequest(`请更改密码设置：${chk.failed.join('、')}`, 'PWD_WEAK')

      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(me.id) as
        | { password_hash: string }
        | undefined
      if (!row || !verifyPassword(oldPassword, row.password_hash)) {
        throw unauthorized('原密码不正确', 'PWD_WRONG')
      }

      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), me.id)
      // 改密码后踢掉其它设备，但保留当前会话，免得自己被登出
      dropUserSessions(db, me.id, readCookie(req, SESSION_COOKIE) ?? undefined)
      ok(res, { done: true })
    }),
  )

  /* ---------------------------- 改个人资料 ---------------------------- */
  /**
   * 可改字段分两类：
   *  · 账号资料：username / github / avatarFileId
   *  · 在校信息：realName / studentId / college / major / grade / className
   *
   * 在校信息**允许用户自己填**：学校门户页只给姓名和学院，
   * 学号/专业/年级/班级那边根本没有，只能靠用户自己补。
   * 与导入不冲突 —— 导入侧对空值不做覆盖（见 lib/courseMatch.ts 的思路），
   * 所以手填的内容不会被后来的一次导入抹掉。
   */
  const SCHOOL_FIELDS: [string, string, number][] = [
    ['realName', 'real_name', 40],
    ['studentId', 'student_id', 32],
    ['college', 'college', 60],
    ['major', 'major', 60],
    ['grade', 'grade', 20],
    ['className', 'class_name', 40],
  ]

  r.patch(
    '/profile',
    requireAuth(db),
    wrap(async (req, res) => {
      const me = getUser(req)
      const body = (req.body ?? {}) as Record<string, unknown>
      const { username, github, avatarFileId } = body

      const cols = ['username', 'github', 'avatar_file_id', ...SCHOOL_FIELDS.map((f) => f[1])]
      const cur = db
        .prepare(`SELECT ${cols.join(', ')} FROM profiles WHERE user_id = ?`)
        .get(me.id) as Record<string, unknown> | undefined

      const next: Record<string, unknown> = {}
      next.username = typeof username === 'string' ? username.slice(0, 32) : (cur?.username ?? '')
      next.github = typeof github === 'string' ? github.trim().slice(0, 200) : (cur?.github ?? '')
      next.avatar_file_id =
        typeof avatarFileId === 'string' ? avatarFileId : avatarFileId === null ? null : (cur?.avatar_file_id ?? null)

      // 在校信息：只处理请求里**明确带了**的字段，没带的保持原值
      for (const [key, col, max] of SCHOOL_FIELDS) {
        if (key in body) next[col] = typeof body[key] === 'string' ? (body[key] as string).trim().slice(0, max) : (cur?.[col] ?? '')
        else next[col] = cur?.[col] ?? ''
      }

      // 头像必须是本人上传的文件，否则可以挂别人的图
      if (next.avatar_file_id) {
        const f = db.prepare('SELECT owner_id FROM files WHERE id = ?').get(next.avatar_file_id as string) as
          | { owner_id: number }
          | undefined
        if (!f || f.owner_id !== me.id) throw badRequest('头像文件不存在')
      }

      const fields = Object.keys(next)
      db.prepare(
        `INSERT INTO profiles (user_id, ${fields.join(', ')}) VALUES (?, ${fields.map(() => '?').join(', ')})
         ON CONFLICT(user_id) DO UPDATE SET ${fields.map((f) => `${f} = excluded.${f}`).join(', ')}`,
      ).run(me.id, ...fields.map((f) => next[f] as string | null))

      ok(res, { user: publicUser(me.id) })
    }),
  )

  return r
}
