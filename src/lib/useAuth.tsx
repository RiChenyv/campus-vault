import { useCallback, useEffect, useState } from 'react'
import {
  changePassword as doChange,
  fetchMe,
  login as doLogin,
  logout as doLogout,
  register as doRegister,
  type AuthResult,
  type SessionUser,
} from './auth'

export interface PendingAccount {
  account: string
  password: string
  type: 'register'
}

export interface Session {
  account: string
  admin: boolean
  at: number
  user: SessionUser
}

const toSession = (u: SessionUser): Session => ({
  account: u.account,
  admin: u.isAdmin,
  at: Date.now(),
  user: u,
})

/**
 * 登录态。
 *
 * 与旧版的根本区别：**凭据完全不在前端**。
 *  · 密码在服务端用 scrypt 加盐哈希存储，前端拿不到、DevTools 也看不到。
 *  · 会话是 httpOnly cookie，JavaScript 读不到，XSS 也偷不走。
 *  · 启动时用 cookie 向 /api/auth/me 换取当前用户；未登录就是 null。
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  /** 首次加载中：还没问过服务端"我是谁"，此时不能急着渲染登录页 */
  const [booting, setBooting] = useState(true)
  const [pending, setPending] = useState<PendingAccount | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const u = await fetchMe()
      if (!alive) return
      setSession(u ? toSession(u) : null)
      setBooting(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  const signIn = useCallback(async (account: string, password: string): Promise<AuthResult> => {
    setBusy(true)
    const r = await doLogin(account, password)
    setBusy(false)
    if (r.ok && r.user) setSession(toSession(r.user))
    return r
  }, [])

  /** 注册后先停在「请保存账号」这一步，确认后才真正进入站点 */
  const signUp = useCallback(async (password: string, confirm: string): Promise<AuthResult> => {
    setBusy(true)
    const r = await doRegister(password, confirm)
    setBusy(false)
    if (r.ok && r.account) setPending({ account: r.account, password, type: 'register' })
    return r
  }, [])

  /**
   * 确认已保存账号 → 进入站点。
   * 注册接口其实已经建立了会话（cookie 已下发），这里只是把前端状态接上，
   * 不再需要像旧版那样"从前端账号表里把记录捞出来"。
   */
  const confirmPending = useCallback(async () => {
    if (!pending) return
    const u = await fetchMe()
    if (u) setSession(toSession(u))
    setPending(null)
  }, [pending])

  const changePassword = useCallback(
    async (oldPassword: string, next: string, confirm: string): Promise<AuthResult> => {
      if (!session) return { ok: false, error: '未登录' }
      return doChange(oldPassword, next, confirm)
    },
    [session],
  )

  const signOut = useCallback(async () => {
    await doLogout()
    setSession(null)
  }, [])

  /** 资料在别处改过之后（如个人中心），把最新用户信息同步回来 */
  const refreshUser = useCallback(async () => {
    const u = await fetchMe()
    if (u) setSession(toSession(u))
  }, [])

  return {
    session,
    /** 还在向服务端确认登录态 */
    booting,
    pending,
    busy,
    signIn,
    signUp,
    confirmPending,
    setPending,
    changePassword,
    signOut,
    refreshUser,
  }
}
