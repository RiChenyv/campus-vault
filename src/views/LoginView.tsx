import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PASSWORD_RULES, checkPassword, type AuthResult } from '../lib/auth'
import { GlassX } from '../components/ImagePad'
import { IconCheck } from '../components/Icons'
import type { PendingAccount } from '../lib/useAuth'

const EASE = [0.22, 1, 0.36, 1] as const

/** 手写体：义启手写体（WPS 同款）→ 中文手写体回退 */
const HAND = "'义启手写体','YIQI Handwriting','华文行楷','STXingkai','楷体','KaiTi','STKaiti',serif"

type Tab = 'login' | 'register'

/**
 * 登录页。
 * 全屏玻璃卡：一行大字 + 账号密码。
 *
 * ⚠️ 纯前端原型：校验规则在前端跑一遍，
 * 账号密码存 localStorage。真实后端必须重做一遍校验 + 哈希存储。
 */
export default function LoginView({
  onSignIn,
  onSignUp,
  pending,
  onConfirmPending,
  onCancelPending,
}: {
  // 认证已经改成服务端接口，这两个回调变成异步的
  onSignIn: (account: string, password: string) => Promise<AuthResult>
  onSignUp: (password: string, confirm: string) => Promise<AuthResult>
  pending: PendingAccount | null
  onConfirmPending: () => void
  onCancelPending: () => void
}) {
  const [tab, setTab] = useState<Tab>('login')
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [showPw, setShowPw] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // 切换页签时清掉上一次的报错，避免误导
  useEffect(() => {
    setErr(null)
    setIssues([])
  }, [tab])

  const pwState = checkPassword(password)

  /**
   * 提交登录 / 注册。
   * 密码规则不通过时，服务端返回的 message 已经把所有未通过项拼好，
   * 这里额外用本地规则算一份，好在表单旁边逐条列出。
   */
  const submitLogin = async () => {
    if (submitting) return
    setSubmitting(true)
    setErr(null)
    setIssues([])
    try {
      const r = await onSignIn(account, password)
      if (!r.ok) setErr(r.error ?? '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  const submitRegister = async () => {
    if (submitting) return
    setSubmitting(true)
    setErr(null)
    setIssues([])
    try {
      const r = await onSignUp(password, confirm)
      if (!r.ok) {
        setErr(r.error ?? '注册失败')
        // 服务端的规则与本地这份一致，直接复用本地算出的未通过项
        setIssues(checkPassword(password).failed)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative grid h-full w-full place-items-center overflow-y-auto p-6">
      {/* 品牌大字 + 表单 */}
      <motion.div
        initial={{ opacity: 0, y: 26, filter: 'blur(16px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.8, ease: EASE }}
        className="w-full max-w-[940px]"
      >
        {/* ------------------------- 一行大字 -------------------------
            「创造，从此刻开始」共 8 字。字号 clamp 上限 62px + 字距 .08em
            时整行约 540px；容器给到 940px 保证**永远不折行**
            （之前 620px 会把最后一个「始」挤到第二行）。 */}
        <h1
          className="text-center whitespace-nowrap text-white"
          style={{
            fontFamily: HAND,
            fontSize: 'clamp(30px, 3.4vw, 62px)',
            lineHeight: 1.3,
            letterSpacing: '0.08em',
            textShadow: '0 6px 40px rgba(0,0,0,.6), 0 0 90px rgba(120,170,255,.28)',
          }}
        >
          创造，从此刻开始
        </h1>

        <div className="mx-auto mt-10 max-w-[560px]">
          <AnimatePresence mode="wait">
            {pending ? (
              /* ------------------- 注册成功：请保存账号 ------------------- */
              <motion.div
                key="pending"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="glass-clear spec relative rounded-[28px] p-7 text-center"
              >
                <h2 className="text-[16px] font-semibold text-white">账号已生成，请妥善保存</h2>
                <p className="mt-1.5 text-[12px] text-white/65">
                  系统账号为 11 位随机数，请务必自行保存
                </p>

                <div className="mt-5 rounded-2xl border border-white/18 bg-white/10 px-5 py-4">
                  <div className="text-[11px] tracking-[.2em] text-white/55">你的账号</div>
                  <div
                    className="mt-1.5 select-all text-white"
                    style={{ fontFamily: "'SFMono-Regular',Consolas,monospace", fontSize: 30, letterSpacing: '0.14em' }}
                    data-testid="pending-account"
                  >
                    {pending.account}
                  </div>
                  <div className="mt-3 text-[11px] tracking-[.2em] text-white/55">密码</div>
                  <div
                    className="mt-1 select-all text-white/90"
                    style={{ fontFamily: "'SFMono-Regular',Consolas,monospace", fontSize: 17, letterSpacing: '0.1em' }}
                  >
                    {pending.password}
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-center gap-2.5">
                  <button
                    onClick={onConfirmPending}
                    className="rounded-full px-5 py-2.5 text-[13px] font-medium transition hover:brightness-110"
                    style={{
                      background: 'rgba(126,224,160,.24)',
                      color: 'rgb(150,240,185)',
                      border: '1px solid rgba(126,224,160,.5)',
                    }}
                  >
                    我已保存，进入站点
                  </button>
                  <button
                    onClick={onCancelPending}
                    className="rounded-full bg-white/10 px-4 py-2.5 text-[12.5px] text-white/75 transition hover:bg-white/18 hover:text-white"
                  >
                    返回
                  </button>
                </div>
              </motion.div>
            ) : (
              /* ------------------------- 登录 / 注册 ------------------------- */
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="glass-clear spec relative rounded-[28px] p-7 sm:p-8"
              >
                {/* 页签 */}
                <div className="mb-6 flex gap-2">
                  {(['login', 'register'] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setTab(k)}
                      className="rounded-full px-5 py-2 text-[13px] transition"
                      style={{
                        background: tab === k ? 'rgba(143,178,255,.22)' : 'rgba(255,255,255,.07)',
                        color: tab === k ? 'rgb(165,192,255)' : 'rgba(255,255,255,.72)',
                        border: `1px solid ${tab === k ? 'rgba(143,178,255,.5)' : 'transparent'}`,
                      }}
                    >
                      {k === 'login' ? '账户登录' : '账号注册'}
                    </button>
                  ))}
                </div>

                <div className="space-y-4">
                  {tab === 'login' && (
                    <label className="block">
                      <span className="mb-1.5 block text-[11.5px] text-white/65">账户</span>
                      <input
                        value={account}
                        onChange={(e) => setAccount(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && submitLogin()}
                        placeholder="请输入账号"
                        autoComplete="username"
                        className="w-full rounded-2xl border border-white/22 bg-white/12 px-4 py-3 text-[14px] text-white outline-none transition placeholder:text-white/45 focus:border-white/50"
                        aria-label="账户"
                      />
                    </label>
                  )}

                  <label className="block">
                    <span className="mb-1.5 flex items-center gap-2 text-[11.5px] text-white/65">
                      密码
                      <button
                        onClick={() => setShowPw((v) => !v)}
                        className="ml-auto text-[10.5px] text-white/50 transition hover:text-white"
                        type="button"
                      >
                        {showPw ? '隐藏' : '显示'}
                      </button>
                    </span>
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (tab === 'login' ? submitLogin() : submitRegister())}
                      type={showPw ? 'text' : 'password'}
                      placeholder={tab === 'register' ? '设置一个密码' : '请输入密码'}
                      autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
                      className="w-full rounded-2xl border border-white/22 bg-white/12 px-4 py-3 text-[14px] text-white outline-none transition placeholder:text-white/45 focus:border-white/50"
                      aria-label="密码"
                    />
                  </label>

                  {tab === 'register' && (
                    <>
                      <label className="block">
                        <span className="mb-1.5 block text-[11.5px] text-white/65">确认密码</span>
                        <input
                          value={confirm}
                          onChange={(e) => setConfirm(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && submitRegister()}
                          type={showPw ? 'text' : 'password'}
                          placeholder="再输一次"
                          autoComplete="new-password"
                          className="w-full rounded-2xl border border-white/22 bg-white/12 px-4 py-3 text-[14px] text-white outline-none transition placeholder:text-white/45 focus:border-white/50"
                          aria-label="确认密码"
                        />
                      </label>

                      {/* 密码规则：实时反馈，避免提交后才知道不合格 */}
                      <ul className="space-y-1 rounded-2xl bg-white/6 px-3.5 py-2.5">
                        {PASSWORD_RULES.map((r) => {
                          const on = r.test(password)
                          return (
                            <li
                              key={r.id}
                              className="flex items-center gap-2 text-[11px]"
                              style={{ color: password ? (on ? 'rgba(150,240,185,.92)' : 'rgba(255,179,179,.9)') : 'rgba(255,255,255,.5)' }}
                            >
                              <span
                                className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full"
                                style={{
                                  background: password ? (on ? 'rgba(126,224,160,.3)' : 'rgba(255,140,140,.22)') : 'rgba(255,255,255,.1)',
                                }}
                              >
                                {password && on && <IconCheck className="h-2.5 w-2.5" style={{ color: '#7ee0a0' }} />}
                              </span>
                              {r.label}
                            </li>
                          )
                        })}
                      </ul>

                      <p className="text-[10.5px] leading-relaxed text-white/50">
                        注册后由系统生成 11 位随机账号。密码是否可存储由以上规则决定 ——
                        不满足会提示「请更改密码设置」。
                      </p>
                    </>
                  )}
                </div>

                {err && (
                  <div
                    className="mt-4 rounded-2xl px-3.5 py-2.5 text-[12px]"
                    style={{ background: 'rgba(255,120,120,.16)', color: '#ffb3b3' }}
                    role="alert"
                  >
                    <div>{err}</div>
                    {!!issues.length && (
                      <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[11px] text-red-200/85">
                        {issues.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="mt-5 flex items-center gap-2.5">
                  <button
                    onClick={tab === 'login' ? submitLogin : submitRegister}
                    className="flex-1 rounded-full px-6 py-3 text-[14px] font-medium transition hover:brightness-110"
                    style={{
                      background: 'rgba(143,178,255,.26)',
                      color: 'rgb(170,196,255)',
                      border: '1px solid rgba(143,178,255,.55)',
                    }}
                  >
                    {tab === 'login' ? '登录' : '注册并生成账号'}
                  </button>
                  <button
                    onClick={() => setTab(tab === 'login' ? 'register' : 'login')}
                    className="rounded-full bg-white/12 px-5 py-3 text-[13px] text-white/80 transition hover:bg-white/20 hover:text-white"
                  >
                    {tab === 'login' ? '无密码？账号注册' : '已有账号'}
                  </button>
                </div>

                {/* 页脚提示。
                    ⚠️ 这里**不要**写出管理员账号名、账号位数等规则 ——
                    登录页是未鉴权页面，暴露这些等于把攻击面直接送出去
                    （之前这里写了「管理员 admin；其他账号 11 位随机数」，
                    已按反馈移除）。 */}
                <div className="mt-4 border-t border-white/10 pt-4 text-[10.5px] leading-relaxed text-white/50">
                  还没有账号？点上方「账号注册」即可创建。
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* 右上角：清掉本地数据（开发用） */}
      <div className="absolute right-6 top-6">
        <GlassX
          onClick={() => {
            try {
              localStorage.removeItem('cv.accounts')
              localStorage.removeItem('cv.session')
            } catch {
              /* ignore */
            }
            location.reload()
          }}
          label="重置本地账号数据"
          size={30}
        />
      </div>
    </div>
  )
}
