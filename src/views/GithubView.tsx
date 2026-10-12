import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { GlassX } from '../components/ImagePad'
import { IconExternal, IconGithub, IconRefresh, IconStar } from '../components/Icons'
import { fetchGithub, langRgb, parseGithubUser, sinceLabel, type GhData, type GhRepo } from '../lib/github'
import { setSpot } from '../lib/utils'

const EASE = [0.22, 1, 0.36, 1] as const

/** 新标签打开：真实 <a target="_blank"> 点击，避免 window.open 被拦 */
const openInNewTab = (url: string) => {
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/* ------------------------------------------------------------------ */
/*                              仓库卡片                               */
/* ------------------------------------------------------------------ */
function RepoCard({ r, onOpen }: { r: GhRepo; onOpen: (url: string) => void }) {
  const rgb = langRgb(r.language)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.34, ease: EASE }}
      onMouseMove={setSpot}
      className="mat-clear spec group relative flex flex-col rounded-3xl p-4"
      style={{ borderColor: `rgb(${rgb} / .3)` }}
    >
      <a
        href={r.html_url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
          e.preventDefault()
          onOpen(r.html_url)
        }}
        className="flex min-w-0 flex-1 flex-col outline-none"
        aria-label={`打开仓库 ${r.name}（新标签页）`}
      >
        <div className="flex items-start gap-2.5">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
            style={{
              background: `linear-gradient(150deg, rgb(${rgb} / .3), rgb(${rgb} / .1))`,
              border: '1px solid rgba(255,255,255,.14)',
            }}
          >
            <IconGithub className="h-4.5 w-4.5" style={{ color: `rgb(${rgb})`, width: 18, height: 18 }} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium text-white">{r.name}</span>
            <span className="mt-0.5 flex items-center gap-2 text-[10.5px] text-white/50">
              {r.language && (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: `rgb(${rgb})` }} />
                  {r.language}
                </span>
              )}
              <span>{sinceLabel(r.pushed_at)}更新</span>
            </span>
          </span>
        </div>

        {r.description && (
          <p className="mt-2.5 line-clamp-3 text-[12px] leading-[1.7] text-white/72">{r.description}</p>
        )}

        {!!r.topics?.length && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {r.topics.slice(0, 4).map((t) => (
              <span key={t} className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/70">
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center gap-2.5 pt-3 text-[10.5px] text-white/50">
          <span className="flex items-center gap-1">
            <IconStar className="h-3 w-3" />
            {r.stargazers_count}
          </span>
          <span>fork {r.forks_count}</span>
          {r.fork && <span className="rounded-full bg-white/8 px-1.5 py-0.5">fork 自他人</span>}
          {r.homepage && <span className="truncate">有在线演示</span>}
          <span className="ml-auto flex items-center gap-1 transition group-hover:text-white/85">
            <IconExternal className="h-3 w-3" />
            新标签打开
          </span>
        </div>
      </a>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*                              主视图                                 */
/* ------------------------------------------------------------------ */
export default function GithubView({
  login,
  onConfigure,
}: {
  /** 个人中心里填写的 GitHub 用户名；空表示未配置 */
  login: string
  /** 跳去个人中心填写 */
  onConfigure: () => void
}) {
  const [data, setData] = useState<GhData | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /** 待跳转确认的网址 */
  const [go, setGo] = useState<{ title: string; url: string } | null>(null)
  /** 语言筛选：null = 全部 */
  const [lang, setLang] = useState<string | null>(null)
  const cache = useRef<Map<string, GhData>>(new Map())

  const load = useCallback(
    async (name: string, force = false) => {
      if (!name) return
      if (!force) {
        const hit = cache.current.get(name)
        if (hit) {
          setData(hit)
          setErr(null)
          return
        }
      }
      setLoading(true)
      setErr(null)
      try {
        const d = await fetchGithub(name)
        cache.current.set(name, d)
        setData(d)
      } catch (e) {
        setErr(e instanceof Error ? e.message : '拉取失败')
        setData(null)
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!login) {
      setData(null)
      setErr(null)
      return
    }
    void load(login)
  }, [login, load])

  const langs = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of data?.repos ?? []) {
      if (r.language) m.set(r.language, (m.get(r.language) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [data])

  const repos = useMemo(
    () => (data?.repos ?? []).filter((r) => (lang ? r.language === lang : true)),
    [data, lang],
  )

  const parsed = login ? parseGithubUser(login) : null
  const profileUrl = parsed?.login ? `https://github.com/${parsed.login}` : ''

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ========================= 顶部：账号 ========================= */}
      <div className="mat-clear mb-4 shrink-0 rounded-3xl p-4">
        {!login ? (
          /* 未配置：给一条明确的引导，而不是空白 */
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/8">
              <IconGithub className="h-6 w-6 text-white/70" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-cn-title text-[15px] font-semibold text-white">还没绑定 GitHub 账号</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-white/65">
                在**个人中心**里填写你的 GitHub 主页地址（或用户名），这一页会自动拉取你的公开项目。
              </p>
            </div>
            <button
              onClick={onConfigure}
              className="flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-medium transition hover:brightness-110"
              style={{
                background: 'rgba(111,156,255,.22)',
                color: 'rgb(150,182,255)',
                border: '1px solid rgba(111,156,255,.45)',
              }}
            >
              <IconGithub className="h-4 w-4" />
              去个人中心填写
            </button>
          </div>
        ) : loading && !data ? (
          <div className="flex items-center gap-4">
            <span className="h-12 w-12 shrink-0 animate-pulse rounded-2xl bg-white/10" />
            <div className="flex-1 space-y-2">
              <span className="block h-3.5 w-40 animate-pulse rounded bg-white/10" />
              <span className="block h-3 w-64 animate-pulse rounded bg-white/8" />
            </div>
            <span className="text-[12px] text-white/60">正在从 GitHub 拉取…</span>
          </div>
        ) : err ? (
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-red-400/15">
              <IconGithub className="h-6 w-6 text-red-200" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-semibold text-white">拉取失败</h3>
              <p className="mt-1 text-[12px] text-red-200/90">{err}</p>
              <p className="mt-1 text-[11px] text-white/50">
                当前绑定：{login} · 可在个人中心改成完整主页地址
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => void load(login, true)}
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-[12px] text-white transition hover:bg-white/18"
              >
                <IconRefresh className="h-3.5 w-3.5" />
                重试
              </button>
              <button
                onClick={onConfigure}
                className="rounded-full bg-white/8 px-3.5 py-2 text-[12px] text-white/80 transition hover:bg-white/16 hover:text-white"
              >
                改绑定
              </button>
            </div>
          </div>
        ) : data ? (
          <div className="flex flex-wrap items-start gap-4">
            <img
              src={data.user.avatar_url}
              alt={`${data.user.login} 的头像`}
              className="h-14 w-14 shrink-0 rounded-2xl ring-1 ring-white/20"
              draggable={false}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="font-cn-title text-[16px] font-semibold text-white">
                  {data.user.name || data.user.login}
                </h3>
                <span className="text-[12px] text-white/55">@{data.user.login}</span>
              </div>
              {data.user.bio && (
                <p className="mt-1.5 max-w-[820px] text-[12.5px] leading-relaxed text-white/72">
                  {data.user.bio}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] text-white/60">
                <span>
                  公开仓库 <b className="text-white">{data.user.public_repos}</b>
                </span>
                <span>
                  关注者 <b className="text-white">{data.user.followers}</b>
                </span>
                <span>
                  正在关注 <b className="text-white">{data.user.following}</b>
                </span>
                {data.user.location && <span>{data.user.location}</span>}
                <span className="text-white/40">数据更新于 {sinceLabel(new Date(data.at).toISOString())}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                onClick={() => setGo({ title: `${data.user.login} 的 GitHub 主页`, url: data.user.html_url })}
                className="flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-medium transition hover:brightness-110"
                style={{
                  background: 'rgba(111,156,255,.22)',
                  color: 'rgb(150,182,255)',
                  border: '1px solid rgba(111,156,255,.45)',
                }}
              >
                <IconGithub className="h-4 w-4" />
                打开主页
              </button>
              <button
                onClick={() => void load(login, true)}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-full bg-white/8 px-3.5 py-2 text-[12px] text-white/80 transition hover:bg-white/16 hover:text-white disabled:opacity-50"
                aria-label="刷新 GitHub 数据"
              >
                <IconRefresh className="h-3.5 w-3.5" />
                {loading ? '刷新中…' : '刷新'}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* ========================= 语言筛选 ========================= */}
      {!!langs.length && (
        <div className="mb-3 flex shrink-0 flex-wrap items-center gap-1.5">
          <button
            onClick={() => setLang(null)}
            className="rounded-full px-3 py-1.5 text-[11.5px] transition"
            style={{
              background: lang === null ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.06)',
              color: lang === null ? '#fff' : 'rgba(255,255,255,.72)',
              border: `1px solid ${lang === null ? 'rgba(255,255,255,.3)' : 'transparent'}`,
            }}
          >
            全部 {data?.repos.length ?? 0}
          </button>
          {langs.map(([name, n]) => {
            const on = lang === name
            const rgb = langRgb(name)
            return (
              <button
                key={name}
                onClick={() => setLang(on ? null : name)}
                className="rounded-full px-3 py-1.5 text-[11.5px] transition"
                style={{
                  background: on ? `rgb(${rgb} / .24)` : 'rgba(255,255,255,.06)',
                  color: on ? `rgb(${rgb})` : 'rgba(255,255,255,.72)',
                  border: `1px solid ${on ? `rgb(${rgb} / .45)` : 'transparent'}`,
                }}
              >
                {name} {n}
              </button>
            )
          })}
        </div>
      )}

      {/* ========================= 仓库列表 ========================= */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        {!!repos.length && (
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            <AnimatePresence initial={false}>
              {repos.map((r) => (
                <RepoCard
                  key={r.id}
                  r={r}
                  onOpen={(url) => setGo({ title: r.name, url })}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

        {!repos.length && data && (
          <div className="mat-clear rounded-3xl px-6 py-12 text-center text-[13px] text-white/70">
            {lang ? '这个语言下没有仓库' : '这个账号还没有公开仓库'}
          </div>
        )}
      </div>

      {/* ========================= 跳转确认 ========================= */}
      <AnimatePresence>
        {go && (
          <motion.div
            className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setGo(null)}
            role="dialog"
            aria-modal="true"
            aria-label="确认打开网址"
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 340, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="glass w-[min(560px,92vw)] rounded-3xl p-6"
            >
              <div className="flex items-start gap-3">
                <span
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
                  style={{ background: 'rgba(111,156,255,.2)', border: '1px solid rgba(111,156,255,.4)' }}
                >
                  <IconGithub className="h-5 w-5 text-[rgb(150,182,255)]" />
                </span>
                <div className="min-w-0">
                  <h4 className="font-cn-title truncate text-[15px] font-semibold text-white">{go.title}</h4>
                  <p className="mt-1 break-all text-[11.5px] text-white/60">{go.url}</p>
                </div>
                <div className="ml-auto">
                  <GlassX onClick={() => setGo(null)} label="关闭" />
                </div>
              </div>
              <p className="mt-4 text-[12.5px] leading-relaxed text-white/75">
                将在新标签页打开 GitHub，当前页面保持不动。
              </p>
              <div className="mt-5 flex items-center gap-2">
                <button
                  onClick={() => {
                    openInNewTab(go.url)
                    setGo(null)
                  }}
                  className="flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-medium transition hover:brightness-110"
                  style={{
                    background: 'rgba(111,156,255,.24)',
                    color: 'rgb(150,182,255)',
                    border: '1px solid rgba(111,156,255,.5)',
                  }}
                >
                  <IconExternal className="h-4 w-4" />
                  新标签打开
                </button>
                <button
                  onClick={() => setGo(null)}
                  className="rounded-full bg-white/8 px-3.5 py-2 text-[12px] text-white/75 transition hover:bg-white/16 hover:text-white"
                >
                  取消
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
