import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCourses } from '../lib/useCourses'
import { currentWeek, TERM_WEEKS } from '../lib/weeks'
import { kindLabel, type VaultItem } from '../lib/vault'
import * as store from '../lib/vaultStore'
import { api } from '../lib/api'
import { SectionTitle } from '../components/Bits'
import MiniSchedule from '../components/MiniSchedule'
import { IconBack, IconChevron, IconFolder, IconNotes } from '../components/Icons'
import type { RouteId } from '../types'

type Tab = 'notes' | 'questions' | 'info'

const FILE_KIND_RGB: Record<string, string> = {
  markdown: '143 178 255',
  code: '92 214 190',
  docx: '196 148 255',
  pdf: '255 143 177',
  slides: '255 179 107',
  image: '142 224 106',
  archive: '143 178 255',
}

/**
 * 单门课程详情。
 * 回答四个问题：这门课是谁教的、我存了什么笔记、我错了哪些题、它排在课表哪里。
 */
export default function CourseDetail({
  courseId,
  onBack,
  onNav,
  onOpenNotes,
}: {
  courseId: string
  onBack: () => void
  onNav: (r: RouteId) => void
  onOpenNotes: () => void
}) {
  const [tab, setTab] = useState<Tab>('notes')
  const { courses, loading } = useCourses()
  const c = courses.find((x) => x.id === courseId)

  /* 这门课程下的资料。从真实文件表读，按 courseId 过滤。
     渲染代码是按旧 mock 的字段写的（updated / tag），
     所以在这里**转一次**适配层，而不是去改十几处渲染 —— 改错一处就是白屏。 */
  /* 每周课时：从真实课表算（原来读 mock 的 SCHEDULE） */
  const [weekPeriods, setWeekPeriods] = useState(0)
  useEffect(() => {
    let alive = true
    /* ⚠️ 必须走 `api.get`，不能裸 fetch。
       裸 fetch 只会带上 cookie，而"按标签页独立"的会话令牌走
       `Authorization` 头（见 lib/api.ts 的说明）——
       后果：第二个标签页登录了别的账号时这里读的是**别人的课表**；
       会话只在 sessionStorage 里时直接 401，每周课时永远显示 0。
       UI 巡检在课程详情页抓到过两条 401 /api/schedule，就是这里。 */
    void api
      .get<{ slots: { course_id: number | null; span: number }[] }>('/schedule')
      .then((d) => {
        if (!alive) return
        const slots = (d.slots ?? []).filter((s) => String(s.course_id) === courseId)
        setWeekPeriods(slots.reduce((n, s) => n + (s.span || 0), 0))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [courseId])

  const [files, setFiles] = useState<
    { id: string; name: string; updated: string; tag: string; kind: string; size: string }[]
  >([])
  useEffect(() => {
    if (!c) return
    let alive = true
    void (async () => {
      const lists = await Promise.all(['qbank', 'note'].map((s) => store.loadAll(s as 'qbank' | 'note')))
      if (!alive) return
      setFiles(
        lists
          .flat()
          .filter((x) => x.courseId === courseId)
          .map((x: VaultItem) => ({
            id: x.id,
            name: x.name,
            updated: x.at,
            tag: kindLabel[x.kind] ?? x.kind,
            kind: x.kind,
            size: x.size,
          })),
      )
    })()
    return () => {
      alive = false
    }
  }, [courseId, c])

  if (!c) {
    return (
      <div className="deco rounded-3xl p-8 text-center text-[13px] text-ink-faint">
        找不到该课程
        <button onClick={onBack} className="ml-2 text-[13px] text-white underline">
          返回课程列表
        </button>
      </div>
    )
  }

  /* 题库现在是"文件库"，没有独立的题目实体（错题本早先已按用户要求删除）。
     保持空数组，下面的 UI 会走到"暂无"分支，而不是显示假数据。 */
  /* 字段定义成必填（不是可选）：数组恒为空，这段渲染永远不执行，
     但类型要能通过编译。用可选的话后面 q.options.map 就要到处加判空，
     反而把没用的分支搅进真正的代码里。 */
  const questions: {
    id: string
    accuracy: number
    type: string
    wrong: boolean
    stem: string
    options: string[]
    /* 是数组不是数字：多选题的答案是多个下标，渲染处用的是 answer.includes(oi) */
    answer: number[]
  }[] = []
  /* 课表格由 MiniSchedule 自己拉真实数据，这里不再需要 */
  /* 学期进度按"第几周 / 总周数"算 —— 原来每个课程各写一个数字，
     学期推进会一直显示旧值。 */
  const progress = Math.min(1, currentWeek() / TERM_WEEKS)
  const acc = questions.length
    ? questions.reduce((s, q) => s + q.accuracy, 0) / questions.length
    : null

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'notes', label: '笔记与作业', count: files.length },
    { id: 'questions', label: '题库', count: questions.length },
    { id: 'info', label: '课程信息', count: 0 },
  ]

  return (
    <div>
      {/* ------------------------- 课程头部 ------------------------- */}
      <div
        className="deco relative mb-4 overflow-hidden rounded-3xl p-5"
        style={{ borderColor: `rgb(${c.rgb} / .35)` }}
      >
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full"
          style={{ background: `radial-gradient(circle, rgb(${c.rgb} / .22), rgb(${c.rgb} / 0) 70%)` }}
        />
        <div className="relative flex flex-wrap items-start gap-4">
          <span
            className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-[20px] font-semibold"
            style={{
              background: `linear-gradient(150deg, rgb(${c.rgb} / .34), rgb(${c.rgb} / .1))`,
              border: '1px solid rgba(255,255,255,.16)',
              color: `rgb(${c.rgb})`,
            }}
          >
            {c.name.slice(0, 1)}
          </span>

          <div className="min-w-0 flex-1">
            <button
              onClick={onBack}
              className="mb-1.5 flex items-center gap-1 text-[11.5px] text-ink-faint transition hover:text-white"
            >
              <IconBack className="h-3.5 w-3.5" />
              我的课程
            </button>
            <h3 className="font-cn-title text-[20px] font-semibold tracking-wide text-white">{c.name}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-dim">
              <span>授课教师 <b className="text-white">{c.teacher}</b></span>
              <span className="text-ink-faint">·</span>
              <span>上课地点 <b className="text-white">{c.room}</b></span>
              <span className="text-ink-faint">·</span>
              <span>{c.term}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <div className="rounded-2xl bg-white/6 px-4 py-2.5 text-center">
              <div className="text-[10.5px] text-ink-faint">学分</div>
              <div className="text-[18px] font-semibold leading-tight text-white">{c.credit}</div>
            </div>
            <div className="rounded-2xl bg-white/6 px-4 py-2.5 text-center">
              <div className="text-[10.5px] text-ink-faint">每周</div>
              <div className="text-[18px] font-semibold leading-tight text-white">
                {weekPeriods}
                <span className="ml-0.5 text-[11px] font-normal text-ink-dim">节</span>
              </div>
            </div>
            {acc != null && (
              <div className="rounded-2xl bg-white/6 px-4 py-2.5 text-center">
                <div className="text-[10.5px] text-ink-faint">题库正确率</div>
                <div
                  className="text-[18px] font-semibold leading-tight"
                  style={{ color: acc >= 0.8 ? '#7ee0a0' : acc >= 0.6 ? '#ffc07a' : '#ff9c9c' }}
                >
                  {Math.round(acc * 100)}%
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 学期进度 */}
        <div className="relative mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress * 100}%` }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              className="h-full rounded-full"
              style={{ background: `linear-gradient(90deg, rgb(${c.rgb} / .45), rgb(${c.rgb}))` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[10.5px] text-ink-faint">
            <span>学期进度 {Math.round(progress * 100)}%</span>
            <span>{files.length} 份资料 · {c.notes} 份笔记</span>
          </div>
        </div>
      </div>

      {/* ------------------------- 分页签 ------------------------- */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="rounded-full px-3.5 py-1.5 text-[12px] transition"
            style={{
              background: tab === t.id ? `rgb(${c.rgb} / .18)` : 'rgba(255,255,255,.05)',
              color: tab === t.id ? `rgb(${c.rgb})` : '#9aa1c2',
              border: `1px solid ${tab === t.id ? `rgb(${c.rgb} / .42)` : 'transparent'}`,
            }}
          >
            {t.label}
            {t.count > 0 && <span className="ml-1.5 opacity-70">{t.count}</span>}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.28 }}
        >
          {/* ---------------------- 笔记与作业 ---------------------- */}
          {tab === 'notes' && (
            <div className="grid gap-4 @4xl:grid-cols-[1.15fr_1fr]">
              <div className="min-w-0">
                <SectionTitle kicker="library" title={`${c.name} · 资料`} rgb={c.rgb} />
                {files.length ? (
                  <ul className="space-y-2">
                    {files.map((f, i) => {
                      const krgb = FILE_KIND_RGB[f.kind] ?? '143 178 255'
                      return (
                        <motion.li
                          key={f.name}
                          initial={{ opacity: 0, x: 12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.04, duration: 0.3 }}
                        >
                          <button
                            onClick={onOpenNotes}
                            className="mat flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left"
                          >
                            <span
                              className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-medium uppercase"
                              style={{ background: `rgb(${krgb} / .16)`, color: `rgb(${krgb})` }}
                            >
                              {f.kind}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] text-white">{f.name}</span>
                              <span className="block text-[10.5px] text-ink-faint">
                                {f.size} · {f.updated}
                              </span>
                            </span>
                            <span className="shrink-0 rounded-full bg-white/7 px-2 py-0.5 text-[10px] text-ink-dim">
                              {f.tag}
                            </span>
                            <IconChevron className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                          </button>
                        </motion.li>
                      )
                    })}
                  </ul>
                ) : (
                  <div className="deco rounded-2xl px-5 py-10 text-center text-[12.5px] text-ink-faint">
                    这门课还没有资料，把文件拖进来即可
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <SectionTitle kicker="timeline" title="最近更新" rgb={c.rgb} />
                <ul className="deco space-y-2.5 rounded-3xl p-4">
                  {files.slice(0, 6).map((f) => (
                    <li key={f.name} className="flex items-center gap-3 text-[12px]">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `rgb(${c.rgb})` }} />
                      <span className="min-w-0 flex-1 truncate text-ink-dim">{f.name}</span>
                      <span className="shrink-0 text-[10.5px] text-ink-faint">{f.updated}</span>
                    </li>
                  ))}
                  {!files.length && <li className="text-[12px] text-ink-faint">暂无记录</li>}
                </ul>

                <div className="mt-3 flex items-center gap-2 rounded-2xl bg-white/5 px-3.5 py-2.5 text-[11.5px] text-ink-faint">
                  <IconFolder className="h-4 w-4" />
                  <span>{files.length} 份资料</span>
                  <span className="text-ink-faint">·</span>
                  <IconNotes className="h-4 w-4" />
                  <span>{c.notes} 份笔记</span>
                </div>
              </div>
            </div>
          )}

          {/* ---------------------- 题库 ---------------------- */}
          {tab === 'questions' && (
            <div>
              <SectionTitle kicker="practice" title={`${c.name} · 错题`} rgb={c.rgb} />
              {questions.length ? (
                <ul className="space-y-2.5">
                  {questions.map((q, i) => (
                    <motion.li
                      key={q.id}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05, duration: 0.32 }}
                      className="deco rounded-3xl p-4"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          className="rounded-lg px-2 py-0.5 text-[10.5px]"
                          style={{ background: `rgb(${c.rgb} / .16)`, color: `rgb(${c.rgb})` }}
                        >
                          {q.type}
                        </span>
                        <span className="text-[11px] text-ink-faint">错 {q.wrong} 次</span>
                        <span
                          className="ml-auto text-[11px]"
                          style={{
                            color: q.accuracy >= 0.8 ? '#7ee0a0' : q.accuracy >= 0.6 ? '#ffc07a' : '#ff9c9c',
                          }}
                        >
                          正确率 {Math.round(q.accuracy * 100)}%
                        </span>
                      </div>
                      <p className="text-[13px] leading-relaxed text-white">{q.stem}</p>
                      {q.options.length > 0 && (
                        <ul className="mt-2.5 space-y-1.5">
                          {q.options.map((o, oi) => {
                            const right = q.answer.includes(oi)
                            return (
                              <li
                                key={o}
                                className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12px]"
                                style={{
                                  background: right ? 'rgba(126,224,160,.1)' : 'rgba(255,255,255,.04)',
                                  border: `1px solid ${right ? 'rgba(126,224,160,.3)' : 'transparent'}`,
                                  color: right ? '#d6f5e0' : '#c2c8e6',
                                }}
                              >
                                <span className="shrink-0 text-[10.5px] opacity-70">
                                  {String.fromCharCode(65 + oi)}
                                </span>
                                {o}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <div className="deco rounded-2xl px-5 py-10 text-center text-[12.5px] text-ink-faint">
                  这门课还没有收录题目
                </div>
              )}
            </div>
          )}

          {/* ---------------------- 课程信息 + 课表位置 ---------------------- */}
          {tab === 'info' && (
            <div className="grid gap-4 @4xl:grid-cols-[300px_1fr]">
              <div className="min-w-0">
                <SectionTitle kicker="syllabus" title="课程信息" rgb={c.rgb} />
                <dl className="deco space-y-3 rounded-3xl p-4">
                  {[
                    ['课程名称', c.name],
                    ['授课教师', c.teacher],
                    ['上课地点', c.room],
                    ['开课学期', c.term],
                    ['学分', `${c.credit} 学分`],
                    ['每周课时', weekPeriods ? `${weekPeriods} 节` : '—'],
                    ['资料数量', `${files.length} 份`],
                    ['笔记数量', `${c.notes} 份`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                      <dt className="shrink-0 text-ink-faint">{k}</dt>
                      <dd className="min-w-0 truncate text-right text-white">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="min-w-0">
                <SectionTitle kicker="timetable" title="在课表中的位置" rgb={c.rgb} />
                <MiniSchedule courseId={c.id} rgb={c.rgb} room={c.room} teacher={c.teacher} />
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
