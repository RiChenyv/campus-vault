/**
 * 账号相关的**共享纯函数 + 服务端接口封装**。
 *
 * 这里只保留密码规则本身（前后端各跑一遍，规则文本一致）；
 * 真正的凭据校验、会话管理已经全部搬到服务端，
 * 前端再也拿不到任何密码或 token。
 *
 * 为什么前端也留一份规则：即时反馈。用户敲密码时立刻能看到哪条没过，
 * 不用等一次网络往返。但**它只是提示** —— 前端校验任何人都能绕过
 * （直接 curl 打接口），真正的闸门在服务端，那边必须重跑一遍。
 *
 * ⚠️ 旧版这里有 ADMIN_ACCOUNT / ADMIN_PASSWORD 明文常量，
 * 以及把账号密码写进 localStorage 的 login/register/readSession ——
 * 那些已经全部删除。管理员账号只存在于服务端数据库里（scrypt 哈希）。
 */

import { api, readSessionId, writeSessionId } from './api'

export interface PasswordCheck {
  ok: boolean
  /** 未通过的规则说明 */
  failed: string[]
}

export const PASSWORD_RULES: { id: string; label: string; test: (p: string) => boolean }[] = [
  { id: 'len', label: '至少 8 位', test: (p) => p.length >= 8 },
  { id: 'lower', label: '含小写字母', test: (p) => /[a-z]/.test(p) },
  { id: 'upper', label: '含大写字母', test: (p) => /[A-Z]/.test(p) },
  { id: 'digit', label: '含数字', test: (p) => /\d/.test(p) },
]

const SEQUENCES = ['012', '123', '234', '345', '456', '567', '678', '789', 'abc', 'bcd', 'cde', 'qwe', 'asd']

export function checkPassword(pw: string): PasswordCheck {
  const failed = PASSWORD_RULES.filter((r) => !r.test(pw)).map((r) => r.label)
  if (/(.)\1\1/.test(pw)) failed.push('不含连续 3 位重复字符')
  const lower = pw.toLowerCase()
  if (SEQUENCES.some((s) => lower.includes(s))) failed.push('不含 012 / abc / qwe 这类顺序字符')
  return { ok: failed.length === 0, failed }
}

/* --------------------------- 服务端账号接口 --------------------------- */

export interface SessionUser {
  id: number
  account: string
  isAdmin: boolean
  username: string
  avatarFileId: string | null
  github: string
  /** 以下为在校信息，由油猴脚本从学校网站导入（见 server/src/routes/import.ts） */
  realName: string
  studentId: string
  college: string
  major: string
  grade: string
  className: string
  /** 上次导入时间；null 表示还没导入过 */
  importedAt: number | null
}

export interface AuthResult {
  ok: boolean
  error?: string
  account?: string
  user?: SessionUser
}

const fail = (e: unknown): AuthResult => ({
  ok: false,
  error: e instanceof Error ? e.message : '操作失败',
})

export async function login(account: string, password: string): Promise<AuthResult> {
  try {
    const d = await api.post<{ user: SessionUser; sessionToken?: string }>('/auth/login', {
      account: account.trim(),
      password,
    })
    // 存进 sessionStorage（每标签页独立），实现"一个浏览器同时登两个账号"
    writeSessionId(d.sessionToken)
    return { ok: true, account: d.user.account, user: d.user }
  } catch (e) {
    return fail(e)
  }
}

export async function register(password: string, confirm: string): Promise<AuthResult> {
  try {
    const d = await api.post<{ account: string; user: SessionUser; sessionToken?: string }>('/auth/register', {
      password,
      confirm,
    })
    writeSessionId(d.sessionToken)
    return { ok: true, account: d.account, user: d.user }
  } catch (e) {
    return fail(e)
  }
}

export async function changePassword(oldPassword: string, next: string, confirm: string): Promise<AuthResult> {
  try {
    await api.patch('/auth/password', { oldPassword, next, confirm })
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function logout(): Promise<void> {
  // 先清本标签页的令牌，再通知服务端 —— 顺序反了的话，
  // 若请求失败会留下一个仍能用的本地令牌
  writeSessionId(null)
  try {
    await api.post('/auth/logout')
  } catch {
    /* 退出失败也要清掉本地状态，不能把用户卡在登录态里 */
  }
}

/** 启动时向服务端确认当前登录态；未登录返回 null（不是错误） */
export async function fetchMe(): Promise<SessionUser | null> {
  try {
    const d = await api.get<{ user: SessionUser; sessionToken?: string | null }>('/auth/me')
    /* 新开标签页时 sessionStorage 是空的，但 cookie 里还有会话 —— 继承进来。
       这样每个窗口各自持有一份会话副本：之后在任一窗口登录别的账号，
       都不会再影响另一个已经打开的窗口。 */
    if (!readSessionId() && d.sessionToken) writeSessionId(d.sessionToken)
    return d.user
  } catch {
    return null
  }
}

export async function updateProfile(patch: {
  username?: string
  github?: string
  avatarFileId?: string | null
  /** 在校信息。允许用户自己填 —— 学校门户页只给姓名和学院，
      学号/专业/年级/班级那边没有，只能手填。 */
  realName?: string
  studentId?: string
  college?: string
  major?: string
  grade?: string
  className?: string
}): Promise<SessionUser> {
  const d = await api.patch<{ user: SessionUser }>('/auth/profile', patch)
  return d.user
}
