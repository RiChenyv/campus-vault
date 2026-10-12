import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGrades } from '../lib/useGrades'
import { useCourses } from '../lib/useCourses'
import { useNotes } from '../lib/useNotes'
import { todos as todosApi, activity as activityApi } from '../lib/dataApi'
import * as store from '../lib/vaultStore'
import { activityStreak, startOfWeek } from '../lib/stats'
import type { VaultItem } from '../lib/vault'
import type { Todo } from '../types'
import AvatarFace from './AvatarFace'
import Heatmap from './Heatmap'
import { IconCheck, IconClose, IconFlame, IconGithub, IconLogout, IconNotes, IconSchool, IconUpload, IconUser } from './Icons'
import { parseGithubUser } from '../lib/github'

/** 待办条目（个人中心里只做勾选演示，不写回数据源） */
/**
 * 一条待办。
 *
 * 字段来自真实接口：后端只有 title / done / doneAt / attachments
 * （**没有课程、截止日、优先级** —— 那几个字段早先的假数据里有）。
 * 所以缺的部分不渲染，而不是写一个占位值假装有。
 */
function TodoRow({ t, done, onToggle }: { t: Todo; done: boolean; onToggle: () => void }) {
  const tone = t.dueTone === 'danger' ? '#ff8f8f' : t.dueTone === 'warn' ? '#ffc07a' : '#9aa1c2'
  return (
    <li className="mat flex items-center gap-3 rounded-2xl px-3.5 py-2.5">
      <button
        onClick={onToggle}
        aria-label={done ? `标记「${t.title}」为未完成` : `标记「${t.title}」为已完成`}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-md border transition"
        style={{
          borderColor: done ? 'transparent' : 'rgba(255,255,255,.3)',
          background: done ? 'linear-gradient(140deg,#5cd6be,#8fb2ff)' : 'transparent',
        }}
      >
        {done && (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="#08111a" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12.5 4.5 4.5L19 7" />
          </svg>
        )}
      </button>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[13px]"
          style={{ color: done ? '#7e85a6' : '#fff', textDecoration: done ? 'line-through' : 'none' }}
        >
          {t.title}
        </span>
        {!!t.attachments?.length && (
          <span className="mt-0.5 block text-[10.5px] text-ink-faint">
            {t.attachments.length} 个附件
          </span>
        )}
      </span>
      {!!t.due && (
        <span className="shrink-0 text-[11px]" style={{ color: tone }}>
          {t.due}
        </span>
      )}
    </li>
  )
}

/**
 * 个人中心。
 * 布局：左栏（头像 + 统计）/ 右栏（笔记 → 热力图 → 待办），两栏并排。
 *
 * 试过改成 GitHub 那种"热力图横跨两栏"的排布，但并排的两栏更紧凑、
 * 一屏能看到更多信息，所以保留这个版本。
 */
export default function ProfileCenter({
  onClose,
  avatarUrl,
  avatarBusy,
  avatarError,
  onPickAvatar,
  onResetAvatar,
  onAvatarFile,
  avatarInputRef,
  username,
  onUsername,
  github,
  onGithub,
  account,
  isAdmin,
  signOut,
  school,
  onSchoolSave,
}: {
  onClose: () => void
  avatarUrl?: string | null
  avatarBusy: boolean
  avatarError: string | null
  onPickAvatar: () => void
  onResetAvatar: () => void
  onAvatarFile: (f?: File | null) => void
  avatarInputRef: React.RefObject<HTMLInputElement | null>
  username: string
  onUsername: (v: string) => void
  /** GitHub 用户名 / 主页地址；空表示未绑定 */
  github: string
  onGithub: (v: string) => void
  /** 当前登录账号（未接入登录时可不传） */
  account?: string
  isAdmin?: boolean
  /** 退出登录：不传则不渲染退出按钮 */
  signOut?: () => void
  /** 在校信息。可手动填写，也可由导入功能自动填充 */
  school?: {
    realName: string
    studentId: string
    college: string
    major: string
    grade: string
    className: string
    importedAt: number | null
  }
  /** 保存手填的在校信息；不传则不显示「编辑」按钮 */
  onSchoolSave?: (v: {
    realName: string
    studentId: string
    college: string
    major: string
    grade: string
    className: string
  }) => void
}) {
  /* 已修学分接真实成绩单（原来是 data/credits.ts 里的假数字）。
     另外三格（连续记录 / 本周笔记 / 题库正确率）现在也都是真实数据或「—」，
     口径在下面「真实数据」那一段里写清楚了。 */
  const { summary: gradeSummary } = useGrades()
  const [editing, setEditing] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)
  const [draft, setDraft] = useState(username)
  /** GitHub 输入草稿：失焦或回车才写回，避免边打字边发请求 */
  const [ghDraft, setGhDraft] = useState(github)
  const [ghErr, setGhErr] = useState<string | null>(null)
  /** 在校信息：编辑态与草稿。与 username 一样，改完点保存才写回 */
  const [schoolEditing, setSchoolEditing] = useState(false)
  const EMPTY_SCHOOL = { realName: '', studentId: '', college: '', major: '', grade: '', className: '' }
  const [schoolDraft, setSchoolDraft] = useState(EMPTY_SCHOOL)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Esc 关闭：个人中心是整页浮层，必须能一键退出
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (editing) {
          setEditing(false)
          setDraft(username)
        } else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, editing, username])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = () => {
    const v = draft.trim().slice(0, 14)
    if (v) onUsername(v)
    else setDraft(username)
    setEditing(false)
  }

  /**
   * 勾选/取消一条待办 —— **写回后端**。
   * 乐观更新：先动界面，失败整体回滚（原来只改本地一个 doneIds 数组，
   * 关掉个人中心就白勾了）。
   */
  const toggleTodo = (t: Todo) => {
    const next = !t.done
    const snapshot = todos
    setTodos((p) => (p ? p.map((x) => (x.id === t.id ? { ...x, done: next } : x)) : p))
    void todosApi.setDone(t.id, next).catch(() => setTodos(snapshot))
  }

  /* ---------------------------- 真实数据 ----------------------------
     这里原来是 `data/mock.ts` 的 `RECENT_FILES / STATS / TODOS`（全写死）。
     · 笔记 = **上传的笔记文件**（scope=note）+ **手写笔记**，两边合并按时间倒序
     · 待办、活动都走真接口
     · 拿不到的数据**显示「—」**，不编一个好看的数字（见下面四项统计） */
  const { courses } = useCourses()
  const { notes: writtenNotes } = useNotes()
  const [todos, setTodos] = useState<Todo[] | null>(null)
  const [noteFiles, setNoteFiles] = useState<VaultItem[] | null>(null)
  const [actDays, setActDays] = useState<{ date: string; count: number }[] | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      /* 三份数据各拉各的（allSettled）：一个挂了不该把另外两个也变成空。
         活动多取 180 天 —— 连续记录要往回数，只取一周的话上个月连续过也会显示 0。 */
      const [t, f, a] = await Promise.allSettled([
        todosApi.list(),
        store.loadAll('note'),
        activityApi.heatmap(startOfWeek() - 180 * 86400_000, Date.now()),
      ])
      if (!alive) return
      if (t.status === 'fulfilled') setTodos(t.value)
      if (f.status === 'fulfilled') setNoteFiles(f.value)
      if (a.status === 'fulfilled') setActDays(a.value.days)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* 本周起点（周一 00:00）—— 和月历/课表的"周一起始"同一个口径 */
  const weekStart = useMemo(() => startOfWeek(), [])

  /** 我的笔记：两类合并，按时间**倒序** */
  const allNotes = useMemo(() => {
    const files = (noteFiles ?? []).map((f) => ({
      key: `f-${f.id}`,
      name: f.name,
      courseId: f.courseId,
      at: f.createdAt,
      label: f.at,
    }))
    const written = (writtenNotes ?? []).map((n) => ({
      key: `n-${n.id}`,
      name: n.title,
      courseId: n.courseId ?? '',
      at: n.createdAt,
      label: new Date(n.createdAt).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    }))
    return [...files, ...written].sort((a, b) => b.at - a.at)
  }, [noteFiles, writtenNotes])

  const recentNotes = allNotes.slice(0, 6)
  const weekNotes = allNotes.filter((n) => n.at >= weekStart).length
  /** 连续记录：还没拿到活动数据时是 null（界面显示「—」，不是 0） */
  const streak = useMemo(() => (actDays ? activityStreak(actDays) : null), [actDays])
  const openTodos = (todos ?? []).filter((t) => !t.done)
  const todoList = openTodos.slice(0, 5)
  return (
    <motion.div
      className="fixed inset-0 z-40 overflow-y-auto"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
    >
      <div
        className="fixed inset-0 bg-[#05050c]/55 backdrop-blur-[7px]"
        onClick={onClose}
        aria-hidden="true"
        data-backdrop="profile"
      />

      <motion.section
        initial={{ opacity: 0, y: 22, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.99 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        role="dialog"
        aria-modal="true"
        aria-label="个人中心"
        className="glass-clear spec relative mx-auto my-6 w-[min(1180px,92vw)] rounded-[30px] p-5"
      >
        {/* ---------------------------- 头部 ---------------------------- */}
        <header className="mb-5 flex items-start gap-3">
          <div className="min-w-0">
            <h2 className="text-[20px] font-semibold tracking-wide text-white">个人中心</h2>
            <p className="mt-1 text-[12px] text-ink-faint">
              {account ? (
                <>
                  当前账号 <b className="text-white/85">{account}</b>
                  {isAdmin && <span className="ml-1.5 text-[10.5px] text-[rgb(255,179,107)]">管理员</span>}
                  <span className="mx-1.5">·</span>
                </>
              ) : null}
              头像与资料保存在浏览器本地；接入后端后可同步到账号
            </p>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* 退出登录：两步确认，避免误点丢会话 */}
            {signOut &&
              (confirmOut ? (
                <div className="flex items-center gap-1.5 rounded-full border border-red-300/40 bg-[#1b0f14]/85 px-2.5 py-1.5">
                  <span className="text-[11px] text-red-200">退出登录？</span>
                  <button
                    onClick={() => {
                      setConfirmOut(false)
                      signOut()
                    }}
                    className="rounded-full bg-red-400/25 px-2.5 py-1 text-[11px] text-red-100 transition hover:bg-red-400/40"
                    aria-label="确认退出登录"
                  >
                    确认退出
                  </button>
                  <button
                    onClick={() => setConfirmOut(false)}
                    className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/80 transition hover:bg-white/20"
                    aria-label="取消退出登录"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmOut(true)}
                  className="flex items-center gap-1.5 rounded-full border border-white/14 bg-white/6 px-3.5 py-2 text-[12px] text-ink-dim transition hover:border-red-300/40 hover:bg-[#1b0f14]/70 hover:text-red-200"
                  aria-label="退出登录"
                >
                  <IconLogout className="h-3.5 w-3.5" />
                  退出登录
                </button>
              ))}

            <button
              onClick={onClose}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 bg-white/6 text-ink-faint transition hover:bg-white/14 hover:text-white"
              aria-label="关闭个人中心"
            >
              <IconClose className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* ⚠️ 用视口断点而不是容器查询：弹层里没有 @container 祖先，
            容器查询会静默失效并退化成单列（踩过）。 */}
        <div className="grid gap-4 lg:grid-cols-[264px_minmax(0,1fr)]">
          {/* ======================= 左列：头像 + 统计 ======================= */}
          <div className="min-w-0 space-y-4">
            <div
              className="mat-clear spec rounded-3xl p-4 text-center transition"
              style={{
                borderColor: dragOver ? 'rgba(143,178,255,.7)' : undefined,
                background: dragOver ? 'rgba(143,178,255,.12)' : undefined,
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                onAvatarFile(e.dataTransfer.files?.[0])
              }}
            >
              <div className="flex justify-center">
                <div className="relative">
                  <AvatarFace dataUrl={avatarUrl} name={username} size={148} />
                  {/* 悬停遮罩：明确"这里可以换头像" */}
                  <button
                    onClick={onPickAvatar}
                    disabled={avatarBusy}
                    className="absolute inset-0 grid place-items-center rounded-full bg-black/55 opacity-0 transition hover:opacity-100 disabled:opacity-100"
                    aria-label="更换头像"
                  >
                    <span className="flex flex-col items-center gap-1 text-white">
                      <IconUpload className="h-5 w-5" />
                      <span className="text-[11px]">{avatarBusy ? '处理中…' : '更换头像'}</span>
                    </span>
                  </button>
                </div>
              </div>

              {/* 用户名不在这里：按需求移到了左栏底部（与主页左上角同款 Gabriola 字体） */}

              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                <button
                  onClick={onPickAvatar}
                  disabled={avatarBusy}
                  className="rounded-full px-3 py-1.5 text-[11.5px] transition disabled:opacity-50"
                  style={{
                    background: 'rgba(143,178,255,.18)',
                    color: 'rgb(143,178,255)',
                    border: '1px solid rgba(143,178,255,.36)',
                  }}
                >
                  {avatarBusy ? '处理中…' : '选择图片'}
                </button>
                {avatarUrl && (
                  <button
                    onClick={onResetAvatar}
                    className="rounded-full bg-white/8 px-3 py-1.5 text-[11.5px] text-ink-dim transition hover:bg-white/14 hover:text-white"
                  >
                    恢复默认
                  </button>
                )}
              </div>

              {/* 不显示头像文件名 —— 那串系统命名（如「微信图片_2026…jpg」）
                  对用户没有意义，还占了卡片里最显眼的一行。 */}
              <p className="mt-2.5 text-[10.5px] text-ink-faint">
                拖图片到头像上，或点「选择图片」
              </p>

              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => onAvatarFile(e.target.files?.[0])}
              />

              {avatarError && (
                <div
                  className="mt-3 rounded-2xl px-3 py-2 text-[11.5px]"
                  style={{ background: 'rgba(255,120,120,.14)', color: '#ff9c9c' }}
                  role="alert"
                >
                  {avatarError}
                </div>
              )}
            </div>

            {/* 关键统计。四项口径：
                连续记录 = 从今天（今天还没记就从昨天）往回连续有 push 的天数
                本周笔记 = 本周一 00:00 起新增的笔记（上传的文件 + 手写）
                题库正确率 = **没有这个数据**（题库现在只是文件库，没有题目实体），显示「—」
                已修学分 = 真实成绩单；没导过成绩也显示「—」—— 0 学分和"还没数据"是两回事 */}
            <dl className="mat-clear grid grid-cols-2 gap-2 rounded-3xl p-3.5">
              {[
                ['连续记录', streak === null ? '—' : `${streak} 天`, '255 168 120'],
                ['本周笔记', noteFiles === null && writtenNotes === null ? '—' : `${weekNotes} 份`, '196 148 255'],
                ['题库正确率', '—', '255 179 107'],
                ['已修学分', gradeSummary.count ? `${gradeSummary.credit}` : '—', '92 214 190'],
              ].map(([k, v, rgb]) => (
                <div key={k} className="rounded-2xl bg-white/6 px-3 py-2.5">
                  <dt className="text-[11px] text-ink-faint">{k}</dt>
                  <dd className="mt-1 text-[15px] font-semibold leading-none" style={{ color: `rgb(${rgb})` }}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            {/* 「—」是什么意思，明写出来。用户看到破折号会以为是坏了 */}
            <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
              「—」= 这项还没有数据。题库现在只是文件库（没有题目实体），所以正确率暂时无法统计。
            </p>

            {/* ---------------------------- 用户名 ----------------------------
                放在左栏底部（而不是头像正下方）。
                材质用 .glass（透明液态玻璃）而不是 .deco —— 与右上角个人中心入口同款。
                字体与主页左上角完全一致。
                ⚠️ Gabriola 只有拉丁字形，中文会回退到系统字体 ——
                这是字体本身的限制，不是样式没生效，所以标签也用英文 username。 */}
            <div className="mat-clear spec rounded-3xl p-4">
              <div className="mb-3 flex items-baseline gap-2">
                <IconUser className="h-[18px] w-[18px] shrink-0 self-center text-[rgb(143,178,255)]" />
                <span
                  className="text-white"
                  style={{
                    fontFamily: "'Gabriola','Segoe Script','Brush Script MT',cursive",
                    fontSize: 22,
                    lineHeight: 1.2,
                    letterSpacing: '0.02em',
                  }}
                >
                  username
                </span>
                <span className="ml-auto text-[10.5px] text-ink-faint">点击文字即可修改</span>
              </div>

              {editing ? (
                <input
                  ref={inputRef}
                  value={draft}
                  maxLength={14}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit()
                    if (e.key === 'Escape') {
                      setEditing(false)
                      setDraft(username)
                    }
                  }}
                  className="w-full rounded-2xl border border-white/22 bg-white/8 px-3 py-2 text-white outline-none"
                  style={{
                    fontFamily: "'Gabriola','Segoe Script','Brush Script MT',cursive",
                    fontSize: 'clamp(34px, 2.8vw, 46px)',
                    lineHeight: 1.15,
                    letterSpacing: '0.02em',
                  }}
                  aria-label="修改用户名"
                />
              ) : (
                <button
                  onClick={() => {
                    setDraft(username)
                    setEditing(true)
                  }}
                  className="group flex w-full items-center gap-2 rounded-2xl px-1 py-1 text-left transition hover:bg-white/8"
                  aria-label={`用户名：${username}，点击修改`}
                >
                  <span
                    className="min-w-0 flex-1 truncate text-white"
                    style={{
                      fontFamily: "'Gabriola','Segoe Script','Brush Script MT',cursive",
                      // 名字调大：比顶栏那份还大一点，作为这一栏的视觉主体
                      fontSize: 'clamp(34px, 2.8vw, 46px)',
                      lineHeight: 1.15,
                      letterSpacing: '0.02em',
                      textShadow: '0 2px 16px rgba(0,0,0,.4)',
                    }}
                  >
                    {username}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-ink-faint opacity-0 transition group-hover:opacity-100">
                    修改
                  </span>
                </button>
              )}

              <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">
                回车保存 · Esc 取消 · 最多 14 个字符
              </p>
            </div>

            {/* ---------------------- 在校信息 ----------------------
                **可手动填写**。学校门户页只给姓名和学院，学号/专业/年级/班级
                那边根本没有，所以这几个字段只能靠用户自己补。
                与导入不冲突：导入只填补空字段，不会覆盖这里手填的内容。
                始终渲染（哪怕全空）—— 它是可编辑入口，藏起来用户就找不到。 */}
            {school && (
              <div className="mat-clear spec rounded-3xl p-4">
                <div className="mb-3 flex items-baseline gap-2">
                  <IconSchool className="h-[18px] w-[18px] shrink-0 self-center text-white/80" />
                  <span className="font-cn-title text-[15px] font-semibold text-white">在校信息</span>
                  <span className="ml-auto text-[10.5px] text-ink-faint">
                    {schoolEditing
                      ? '改完点保存'
                      : school.importedAt
                        ? `导入于 ${new Date(school.importedAt).toLocaleDateString('zh-CN')}`
                        : '可自己填'}
                  </span>
                </div>

                {schoolEditing ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {(
                        [
                          ['realName', '姓名'],
                          ['studentId', '学号'],
                          ['college', '学院'],
                          ['major', '专业'],
                          ['grade', '年级'],
                          ['className', '班级'],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key} className="min-w-0">
                          <span className="mb-1 block text-[10.5px] text-white/45">{label}</span>
                          <input
                            value={schoolDraft[key]}
                            onChange={(e) => setSchoolDraft((d) => ({ ...d, [key]: e.target.value }))}
                            aria-label={label}
                            maxLength={key === 'studentId' ? 32 : 60}
                            className="w-full rounded-xl px-3 py-2 text-[12.5px] text-white outline-none"
                            style={{ background: 'rgb(0 0 0 / .25)', border: '1px solid rgb(255 255 255 / .14)' }}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => {
                          onSchoolSave?.(schoolDraft)
                          setSchoolEditing(false)
                        }}
                        aria-label="保存在校信息"
                        className="rounded-xl px-3.5 py-2 text-[12.5px] font-semibold text-white"
                        style={{
                          background: 'linear-gradient(135deg, rgb(143 178 255 / .9), rgb(186 155 255 / .9))',
                          boxShadow: '0 10px 26px -14px rgb(143 178 255 / .95)',
                        }}
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setSchoolEditing(false)}
                        aria-label="取消编辑在校信息"
                        className="rounded-xl px-3.5 py-2 text-[12.5px] font-semibold text-ink-dim"
                        style={{ background: 'rgb(255 255 255 / .05)', border: '1px solid rgb(255 255 255 / .1)' }}
                      >
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-[12px]">
                      {(
                        [
                          ['姓名', school.realName],
                          ['学号', school.studentId],
                          ['学院', school.college],
                          ['专业', school.major],
                          ['年级', school.grade],
                          ['班级', school.className],
                        ] as const
                      ).map(([k, v]) => (
                        <div key={k} className="min-w-0">
                          <dt className="text-[10.5px] text-white/45">{k}</dt>
                          <dd
                            className={`mt-0.5 truncate ${v ? 'text-white/92' : 'text-white/25'}`}
                            title={v || undefined}
                          >
                            {v || '未填'}
                          </dd>
                        </div>
                      ))}
                    </dl>

                    {onSchoolSave && (
                      <button
                        onClick={() => {
                          setSchoolDraft({
                            realName: school.realName,
                            studentId: school.studentId,
                            college: school.college,
                            major: school.major,
                            grade: school.grade,
                            className: school.className,
                          })
                          setSchoolEditing(true)
                        }}
                        aria-label="编辑在校信息"
                        className="mt-3 rounded-xl px-3.5 py-2 text-[12.5px] font-semibold text-ink-dim transition hover:bg-white/8 hover:text-white"
                        style={{ background: 'rgb(255 255 255 / .05)', border: '1px solid rgb(255 255 255 / .1)' }}
                      >
                        编辑
                      </button>
                    )}
                  </>
                )}

                <p className="mt-3 text-[10.5px] leading-relaxed text-white/40">
                  可以自己填，也可以用导入功能从学校网站自动获取。
                  <b className="text-white/55">导入只填补空字段，不会覆盖你手填的内容。</b>
                  {' '}本站不保存你的学校账号密码。
                </p>
              </div>
            )}

            {/* ---------------------- GitHub 绑定 ----------------------
                主页第五屏（连接）靠这个字段拉取公开项目。
                失焦 / 回车才写回，避免边打字边触发请求。 */}
            <div className="mat-clear spec rounded-3xl p-4">
              <div className="mb-3 flex items-baseline gap-2">
                <IconGithub className="h-[18px] w-[18px] shrink-0 self-center text-white/80" />
                <span
                  className="text-white"
                  style={{
                    fontFamily: "'Gabriola','Segoe Script','Brush Script MT',cursive",
                    fontSize: 22,
                    lineHeight: 1.2,
                    letterSpacing: '0.02em',
                  }}
                >
                  github
                </span>
                <span className="ml-auto text-[10.5px] text-ink-faint">用于「连接」那一屏</span>
              </div>

              <input
                value={ghDraft}
                onChange={(e) => {
                  setGhDraft(e.target.value)
                  setGhErr(null)
                }}
                onBlur={() => {
                  const v = ghDraft.trim()
                  if (!v) {
                    onGithub('')
                    setGhErr(null)
                    return
                  }
                  const { login, error } = parseGithubUser(v)
                  if (error) {
                    setGhErr(error)
                    return
                  }
                  setGhDraft(login)
                  onGithub(login)
                  setGhErr(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                placeholder="github.com/yourname 或 yourname"
                className="w-full rounded-2xl border border-white/20 bg-white/8 px-3 py-2.5 text-[12.5px] text-white outline-none transition placeholder:text-white/40 focus:border-white/40"
                aria-label="GitHub 用户名或主页地址"
              />

              {ghErr && (
                <p className="mt-1.5 text-[10.5px]" style={{ color: '#ffb3b3' }}>
                  {ghErr}
                </p>
              )}

              <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint">
                {github ? (
                  <>
                    已绑定 <b className="text-white/85">@{github}</b> · 留空并失焦可解除绑定
                  </>
                ) : (
                  '填好后第五屏会自动拉取你的公开仓库'
                )}
              </p>
            </div>
          </div>

          {/* ======================= 右列：笔记 / 热力图 / 待办 ======================= */}
          <div className="min-w-0 space-y-5">
            {/* 我的笔记 */}
            <section>
              <div className="mb-3 flex items-baseline gap-3">
                <h3 className="font-cn-title flex items-center gap-2 text-[15px] font-semibold text-white">
                  <IconNotes className="h-4 w-4 text-[rgb(196,148,255)]" />
                  我的笔记
                </h3>
                <span className="text-[11.5px] text-ink-faint">
                  最近更新 · 共 {allNotes.length} 份
                </span>
              </div>
              {recentNotes.length === 0 ? (
                <div className="mat-clear rounded-2xl px-4 py-6 text-center text-[12px] leading-relaxed text-white/55">
                  {noteFiles === null && writtenNotes === null ? '正在读取…' : '还没有笔记 —— 在「我的笔记」里写一条，或上传文件'}
                </div>
              ) : (
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {recentNotes.map((n, i) => {
                  const c = courses.find((x) => x.id === n.courseId)
                  return (
                    <motion.li
                      key={n.key}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.3 }}
                      className="mat rounded-2xl px-3.5 py-3"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: `rgb(${c?.rgb ?? '143 178 255'})` }}
                        />
                        <span className="truncate text-[12.5px] text-white" title={n.name}>
                          {n.name}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-ink-faint">
                        <span className="truncate">{c?.name ?? '未归类'}</span>
                        <span className="ml-auto shrink-0">{n.label}</span>
                      </div>
                    </motion.li>
                  )
                })}
              </ul>
              )}
            </section>

            {/* 学习热力图 */}
            <section>
              <div className="mb-3 flex items-baseline gap-3">
                <h3 className="font-cn-title flex items-center gap-2 text-[15px] font-semibold text-white">
                  <IconFlame className="h-4 w-4 text-[rgb(92,214,190)]" />
                  学习热力图
                </h3>
                <span className="text-[11.5px] text-ink-faint">
                  近 26 周{streak === null ? '' : ` · 连续 ${streak} 天`}
                </span>
              </div>
              <div className="mat-clear overflow-x-auto rounded-3xl p-3.5">
                <Heatmap />
              </div>
            </section>

            {/* 待办事项 */}
            <section>
              <div className="mb-3 flex items-baseline gap-3">
                <h3 className="font-cn-title flex items-center gap-2 text-[15px] font-semibold text-white">
                  <IconCheck className="h-4 w-4 text-[rgb(255,179,107)]" />
                  待办事项
                </h3>
                <span className="text-[11.5px] text-ink-faint">
                  {todos === null ? '正在读取…' : `未完成 ${openTodos.length} 项`}
                </span>
              </div>
              {todoList.length === 0 ? (
                <div className="mat-clear rounded-2xl px-4 py-6 text-center text-[12px] leading-relaxed text-white/55">
                  {todos === null ? '正在读取…' : '没有未完成的待办 —— 去首页第三屏加一条'}
                </div>
              ) : (
                <ul className="space-y-2">
                  {todoList.map((t) => (
                    <TodoRow key={t.id} t={t} done={t.done} onToggle={() => toggleTodo(t)} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </motion.section>
    </motion.div>
  )
}
