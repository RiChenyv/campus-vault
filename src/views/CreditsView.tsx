import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { SectionTitle } from '../components/Bits'
import { IconBack } from '../components/Icons'
import PieChart, { type Slice } from '../components/PieChart'
import { GRADE_RGB, isDone, termRank, useGrades, type Grade } from '../lib/useGrades'

/**
 * 学分总览。
 * 扇形图按学期聚合（一眼看出各学期学分占比），下方明细表按学期分组。
 *
 * 这一页原来是 `src/data/credits.ts` 里的假数据。现在接的是 `grades` 表：
 * 教务系统「成绩查询」页导入的真实成绩。
 *
 * 用户明确要求的两件事，在这里落实：
 *   · **不自动翻页**（脚本只抓当前页，翻页由用户自己在页面上点 ——
 *     `cvGradePages` 那个采集循环 2026-10 已删除）；也可以直接上传
 *     教务系统导出的 `.xlsx` 成绩表格，见 lib/gradesXlsx.ts
 *   · **学分和绩点可以手动改** —— 每条明细右边有「改」，改完存服务端，
 *     并且标记成"已手改"，之后的导入不会把它顶回去
 *
 * 另外（2026-10）：表格里没有的列 / 空单元格显示灰色的「未收集」，
 * 让用户能发现并**逐条**手动补 —— 见下面 MISSING_FIELDS 那一段的注释。
 *
 * 从「我的课程」点进来，所以顶部给一个明确的返回入口 ——
 * Shell 那个返回键是回首页的，不是回课程列表。
 */

/* ---------------------- 「未收集」------------------------------

   需求（用户第 2 条）：表格里没有的列、或者空单元格，网站上要**明确显示**
   灰色的「未收集」，让用户能发现并逐条手动补。

   为什么必须显式写出来：空着一片空白时，"学校没给这一列"和"导入漏了"
   看起来一模一样 —— 用户不会想到去补。写「未收集」才是一个可行动的提示。

   口径（和任务约定一致）：
     · 课程类别 / 课程性质 / 修读方式 / 考试日期 / 重修重考 —— 显示但**不可就地编辑**
       （这几项要改得走后端 PATCH，界面上目前只放成绩/学分/绩点三个输入框）
     · 学分 / 绩点 —— 同样显示「未收集」，但**保持可编辑**（点右边「改」）
   -------------------------------------------------------------- */

/** 这些字段为空就显示「未收集」。顺序 = 界面上 chips 的顺序 */
const MISSING_FIELDS: { key: keyof Grade; label: string }[] = [
  { key: 'category', label: '课程类别' },
  { key: 'nature', label: '课程性质' },
  { key: 'mode', label: '修读方式' },
  { key: 'examDate', label: '考试日期' },
  { key: 'retake', label: '重修重考' },
]

const textMissing = (v: unknown) => String(v ?? '').trim() === ''
const creditMissing = (g: Grade) => !(Number(g.credit) > 0)
const gpaMissing = (g: Grade) => g.gpa === null || g.gpa === undefined

/** 这一行缺哪些字段（中文名），用来打灰标 + 列出 chips */
function missingOf(g: Grade): string[] {
  const out = MISSING_FIELDS.filter((f) => textMissing(g[f.key])).map((f) => f.label)
  if (creditMissing(g)) out.push('学分')
  if (gpaMissing(g)) out.push('绩点')
  return out
}

/**
 * 毕业要求总学分。
 *
 * ⚠️ 这是个**预设值**：学校各专业的要求不一样，本地没有权威来源。
 * 界面上标成「预设」，不假装是从学校拿到的。要改就改这里。
 */
const CREDIT_REQUIREMENT = 160

/** 成绩颜色：90 以上绿、80 以上橙、其余红。非数字成绩（优秀/及格）不套这个。 */
const scoreColor = (n: number) => (n >= 90 ? '#7ee0a0' : n >= 80 ? '#ffc07a' : '#ff9c9c')

export default function CreditsView({ onBack, onOpenImport }: { onBack: () => void; onOpenImport?: () => void }) {
  const { grades, summary: s, byTerm, loading, busy, error, add, update, remove } = useGrades()
  const [group, setGroup] = useState<'term' | 'course'>('term')
  /** 正在编辑的行 id。一行一行改，不做批量编辑 —— 改的是个别数字，不是表格 */
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState({ score: '', credit: '', gpa: '' })
  const [adding, setAdding] = useState(false)
  const [draftNew, setDraftNew] = useState({ name: '', term: '', score: '', credit: '', gpa: '' })

  /* 配色：优先用关联课程的配色，没有就按顺序取预设色 */
  const rgbOf = useMemo(() => {
    const m = new Map<number, string>()
    grades.forEach((g, i) => m.set(g.id, g.courseRgb || GRADE_RGB[i % GRADE_RGB.length]!))
    return m
  }, [grades])

  /* ------------------------- 扇形图数据 ------------------------- */
  const slices: Slice[] = useMemo(() => {
    if (group === 'term') {
      return byTerm
        .map(([term, rows], i) => ({
          label: term,
          value: rows.reduce((n, r) => n + (Number(r.credit) || 0), 0),
          rgb: ['143 178 255', '92 214 190', '196 148 255', '255 179 107'][i % 4]!,
        }))
        .filter((x) => x.value > 0)
    }
    const sorted = [...grades].filter((g) => g.credit > 0).sort((a, b) => b.credit - a.credit)
    const top = sorted.slice(0, 8).map((g) => ({ label: g.courseName, value: g.credit, rgb: rgbOf.get(g.id)! }))
    const rest = sorted.slice(8).reduce((n, g) => n + g.credit, 0)
    return rest > 0 ? [...top, { label: '其他课程', value: rest, rgb: '126 133 166' }] : top
  }, [group, byTerm, grades, rgbOf])

  const totalCredit = slices.reduce((n, x) => n + x.value, 0)

  /**
   * 「已修学分」的口径。
   *
   * 两条规则：
   *   ① **缺学分的行（credit 为 0/空）不算进去** —— 加进去是 0，看起来无害，
   *      但"这门课几个学分还没收集到"这件事就被抹掉了，用户会以为已经算全。
   *      所以旁边还要写「还有 N 条缺学分」。
   *   ② **还没出分的行也不算** —— 在读课程的学分不能算进已修学分，
   *      否则"还差多少学分毕业"会凭空少一截（服务端 summarize 也是这个口径）。
   *
   * ⚠️ 这里踩过一次：第一版写成"所有行的 credit 求和"，
   * 于是**未出分那门课的 2 学分也被算进来了**，页面上「已修学分」变成 36，
   * 而旁边「返回我的课程」的副标题（用服务端的 s.credit）写的是 34 ——
   * 同一屏两个数字，用户会以为哪个坏了。而且那条"缺学分"的提示压根不出现。
   * 所以：**分母（算进去的门数）要跟着这个口径一起算**，别混用服务端的 s.count。
   */
  const counted = useMemo(() => grades.filter((g) => isDone(g) && !creditMissing(g)), [grades])
  const shownCredit = useMemo(
    () => Math.round(counted.reduce((n, g) => n + (Number(g.credit) || 0), 0) * 100) / 100,
    [counted],
  )
  /** 出分**但**缺学分的条数 —— 只有这些会让上面的数字不完整 */
  const missingCreditCount = useMemo(
    () => grades.filter((g) => isDone(g) && creditMissing(g)).length,
    [grades],
  )
  const countedCount = counted.length
  const reqProgress = Math.min(1, shownCredit / CREDIT_REQUIREMENT)

  /* ------------------------- 编辑 ------------------------- */
  const startEdit = (g: Grade) => {
    setEditing(g.id)
    setDraft({
      score: g.score,
      credit: g.credit ? String(g.credit) : '',
      gpa: g.gpa === null ? '' : String(g.gpa),
    })
  }

  const saveEdit = async (g: Grade) => {
    if (busy) return
    const credit = draft.credit.trim() === '' ? 0 : Number(draft.credit)
    const gpa = draft.gpa.trim() === '' ? null : Number(draft.gpa)
    if (!Number.isFinite(credit) || credit < 0 || credit > 30) return
    if (gpa !== null && (!Number.isFinite(gpa) || gpa < 0 || gpa > 10)) return
    const okDone = await update(g.id, {
      score: draft.score.trim(),
      /* 重新按成绩推一次数字分：把"优秀"改成"91"时，平均分要跟着算对。
         非数字成绩会得到 null，服务端也是这么做的。 */
      scoreNum: /^-?\d+(\.\d+)?$/.test(draft.score.trim()) ? Number(draft.score.trim()) : null,
      credit,
      gpa,
    })
    if (okDone) setEditing(null)
  }

  const submitNew = async () => {
    if (busy || !draftNew.name.trim()) return
    const okDone = await add({
      name: draftNew.name.trim(),
      term: draftNew.term.trim(),
      score: draftNew.score.trim(),
      credit: draftNew.credit.trim() === '' ? 0 : Number(draftNew.credit),
      gpa: draftNew.gpa.trim() === '' ? null : Number(draftNew.gpa),
    })
    if (okDone) {
      setDraftNew({ name: '', term: '', score: '', credit: '', gpa: '' })
      setAdding(false)
    }
  }

  const inputCls = 'w-full rounded-xl px-2.5 py-1.5 text-[12px] text-white outline-none placeholder:text-white/30'
  const inputStyle = { background: 'rgb(0 0 0 / .28)', border: '1px solid rgb(255 255 255 / .14)' }

  return (
    <div>
      {/* ------------------------- 返回课程列表 ------------------------- */}
      <button
        onClick={onBack}
        className="group mb-4 flex items-center gap-2 rounded-full border border-white/14 bg-white/7 py-2 pl-2.5 pr-4 text-[12.5px] text-ink-dim transition hover:border-white/30 hover:bg-white/14 hover:text-white"
        aria-label="返回我的课程"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-white/10 transition group-hover:bg-white/18">
          <IconBack className="h-3.5 w-3.5 transition group-hover:-translate-x-0.5" />
        </span>
        返回我的课程
        <span className="text-ink-faint">
          · {s.count} 门已出分 · {s.credit} 学分
        </span>
      </button>

      {error && (
        <div className="mb-3 rounded-xl px-3 py-2 text-[11.5px]" style={{ background: 'rgba(255,120,120,.16)', color: '#ffb3b3' }} role="alert">
          {error}
        </div>
      )}

      {/* ------------------------- 顶部统计 ------------------------- */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [
            '已修学分',
            `${shownCredit}`,
            `共 ${countedCount} 门` + (missingCreditCount ? ` · 还有 ${missingCreditCount} 条缺学分` : ''),
            '92 214 190',
          ],
          ['未出分', `${s.pendingCredit}`, `${s.pendingCount} 门 · 待出分`, '143 178 255'],
          [
            '平均绩点',
            s.avgGpa === null ? '—' : s.avgGpa.toFixed(2),
            s.avgScore === null ? '暂无加权平均分' : `加权平均分 ${s.avgScore.toFixed(1)}`,
            '255 179 107',
          ],
          ['毕业要求', `${CREDIT_REQUIREMENT}`, `预设值 · 已完成 ${Math.round(reqProgress * 100)}%`, '196 148 255'],
        ].map(([k, v, sub, rgb]) => (
          <div key={k} className="deco rounded-2xl px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-ink-faint">{k}</div>
            <div className="mt-1.5 text-[22px] font-semibold leading-none text-white">{v}</div>
            <div className="mt-1.5 text-[11px]" style={{ color: `rgb(${rgb})` }}>
              {sub}
            </div>
          </div>
        ))}
      </div>

      {/* 毕业学分进度条 */}
      <div className="deco mb-5 rounded-3xl p-4">
        <div className="mb-2 flex items-baseline justify-between text-[12px]">
          <span className="text-ink-dim">
            毕业学分进度 <b className="text-white">{shownCredit}</b> / {CREDIT_REQUIREMENT}
            <span className="ml-1.5 text-[10.5px] text-ink-faint">（要求是预设值）</span>
          </span>
          <span className="text-ink-faint">
            {/* 缺学分的行没算进左边这个数，所以这里必须说出来 ——
                不说的话用户会以为进度是完整的（假数字比空白更糟） */}
            {missingCreditCount > 0 && (
              <span className="mr-2 text-amber-200/80">还有 {missingCreditCount} 条缺学分，未计入</span>
            )}
            还差 <b className="text-white">{Math.max(0, CREDIT_REQUIREMENT - shownCredit)}</b> 学分
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/8">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${reqProgress * 100}%` }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(90deg, rgba(92,214,190,.5), rgb(92,214,190))' }}
          />
        </div>
      </div>

      {/* ------------------------- 空状态 ------------------------- */}
      {!loading && !grades.length && (
        <div className="deco mb-5 rounded-3xl px-5 py-8 text-center">
          <p className="text-[13px] text-white">还没有成绩数据</p>
          <p className="mx-auto mt-2 max-w-[460px] text-[12px] leading-relaxed text-ink-dim">
            去「导入」页装上油猴脚本，然后在教务系统的<strong className="text-white">成绩查询</strong>页点一下
            「导入成绩」—— 那一页是分页的，脚本只导当前页 —— 还有下一页时，自己翻页后再点一次「导入成绩」就行。重复导入不会产生重复记录。
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            {onOpenImport && (
              <button
                onClick={onOpenImport}
                className="rounded-xl px-4 py-2 text-[12px] font-semibold text-white transition"
                style={{ background: 'linear-gradient(135deg, rgb(123 140 255 / .9), rgb(155 107 255 / .9))' }}
              >
                去导入页
              </button>
            )}
            <button
              onClick={() => setAdding(true)}
              className="rounded-xl border border-white/16 bg-white/7 px-4 py-2 text-[12px] text-white transition hover:bg-white/14"
            >
              手动补一条
            </button>
          </div>
        </div>
      )}

      {/* ------------------------- 手动补一条 ------------------------- */}
      {adding && (
        <div className="deco mb-5 rounded-3xl p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[12.5px] font-semibold text-white">手动补一条成绩</span>
            <span className="ml-auto text-[10.5px] text-ink-faint">自己填的不会被导入覆盖</span>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            {(
              [
                ['name', '课程名 *', '例如：基础示例课程二'],
                ['term', '学期', '例如：2025-2026第1学期'],
                ['score', '成绩', '91 / 优秀'],
                ['credit', '学分', '3'],
                ['gpa', '绩点', '3.85'],
              ] as const
            ).map(([key, label, ph]) => (
              <label key={key} className={key === 'name' ? 'col-span-2 lg:col-span-1' : ''}>
                <span className="mb-1 block text-[10.5px] text-white/45">{label}</span>
                <input
                  value={draftNew[key]}
                  onChange={(e) => setDraftNew((d) => ({ ...d, [key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitNew()
                  }}
                  placeholder={ph}
                  aria-label={`新成绩 ${label}`}
                  className={inputCls}
                  style={inputStyle}
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setAdding(false)}
              className="rounded-xl border border-white/16 bg-white/7 px-3 py-1.5 text-[12px] text-white/80 transition hover:bg-white/14"
            >
              取消
            </button>
            <button
              disabled={busy || !draftNew.name.trim()}
              onClick={() => void submitNew()}
              className="rounded-xl px-3.5 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, rgb(92 214 190 / .9), rgb(63 191 144 / .9))' }}
            >
              添加
            </button>
          </div>
        </div>
      )}

      {loading && <div className="deco mb-5 rounded-3xl px-4 py-6 text-center text-[12px] text-ink-dim">正在读取成绩…</div>}

      {/* ------------------------- 扇形图 + 明细 ------------------------- */}
      {grades.length > 0 && (
        <div className="grid gap-5 @5xl:grid-cols-[auto_1fr]">
          <div className="min-w-0">
            <SectionTitle kicker="distribution" title="学分占比" rgb="196 148 255" />
            <div className="deco rounded-3xl p-4">
              <div className="mb-3 flex gap-1.5">
                {(['term', 'course'] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGroup(g)}
                    className="rounded-full px-3 py-1.5 text-[11.5px] transition"
                    style={{
                      background: group === g ? 'rgba(196,148,255,.18)' : 'rgba(255,255,255,.05)',
                      color: group === g ? 'rgb(196,148,255)' : '#9aa1c2',
                      border: `1px solid ${group === g ? 'rgba(196,148,255,.4)' : 'transparent'}`,
                    }}
                  >
                    {g === 'term' ? '按学期' : '按课程'}
                  </button>
                ))}
              </div>

              <div className="flex justify-center">
                <PieChart
                  slices={slices}
                  size={228}
                  thickness={44}
                  centerTitle={group === 'term' ? '总学分' : '学分合计'}
                  centerValue={String(Math.round(totalCredit * 10) / 10)}
                />
              </div>

              <ul className="mt-4 space-y-2">
                {slices.map((x) => (
                  <li key={x.label} className="flex items-center gap-2.5 text-[12px]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: `rgb(${x.rgb})` }} />
                    <span className="min-w-0 flex-1 truncate text-ink-dim">{x.label}</span>
                    <span className="shrink-0 text-white">{x.value}</span>
                    <span className="w-11 shrink-0 text-right text-[11px] text-ink-faint">
                      {totalCredit ? ((x.value / totalCredit) * 100).toFixed(1) : '0.0'}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 明细表：按学期分组 */}
          <div className="min-w-0">
            <SectionTitle kicker="transcript" title="成绩明细" rgb="92 214 190" />
            <p className="mb-2 text-[11px] text-ink-faint">
              学分和绩点都可以改 —— 点每条右边的「改」。改过的值不会被下一次导入覆盖。
            </p>
            <div className="space-y-4">
              {[...byTerm]
                .sort((a, b) => termRank(b[0]) - termRank(a[0]))
                .map(([term, rows]) => {
                  const termCredit = rows.reduce((n, r) => n + (Number(r.credit) || 0), 0)
                  const pending = rows.some((r) => !isDone(r))
                  /* 这一学期有几条缺字段 —— 学期标题上给一个总数，
                     不然得逐条翻才知道"这一学期还没收集全"。 */
                  const needFill = rows.filter((r) => missingOf(r).length > 0).length
                  return (
                    <div key={term} className="deco overflow-hidden rounded-3xl">
                      <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
                        <span className="text-[13px] font-medium text-white">{term || '未标学期'}</span>
                        {pending && <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10.5px] text-ink-dim">有未出分</span>}
                        {needFill > 0 && (
                          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10.5px] text-ink-dim">
                            {needFill} 条有未收集项
                          </span>
                        )}
                        <span className="ml-auto text-[11.5px] text-ink-faint">{Math.round(termCredit * 100) / 100} 学分</span>
                      </div>
                      <ul>
                        {rows.map((r) => {
                          const rgb = rgbOf.get(r.id) ?? GRADE_RGB[0]!
                          const editingThis = editing === r.id
                          const missing = missingOf(r)
                          return (
                            <li key={r.id} className="border-b border-white/5 last:border-0">
                              <div className="flex items-center gap-3 px-4 py-2.5">
                                <span className="h-6 w-[3px] shrink-0 rounded-full" style={{ background: `rgb(${rgb})` }} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[12.5px] text-white">
                                    {r.courseName}
                                    {r.edited && (
                                      <span
                                        className="ml-1.5 rounded-full px-1.5 py-0.5 align-middle text-[9.5px]"
                                        style={{ background: 'rgb(255 179 107 / .16)', color: 'rgb(255 179 107)' }}
                                        title="这条你手动改过，导入不会覆盖"
                                      >
                                        已手改
                                      </span>
                                    )}
                                    {!r.courseId && (
                                      <span className="ml-1.5 text-[9.5px] text-ink-faint" title="课程号对不上「我的课程」里的任何一门">
                                        仅成绩
                                      </span>
                                    )}
                                    {/* 缺字段的灰标 —— 扫一眼列表就能看出哪几条需要补。
                                        样式沿用页面现有的 badge 类（bg-white/8 rounded-full）。 */}
                                    {missing.length > 0 && (
                                      <span
                                        className="ml-1.5 rounded-full bg-white/8 px-2 py-0.5 align-middle text-[9.5px] text-ink-dim"
                                        title={`缺这些字段：${missing.join('、')} —— 可以逐条补`}
                                      >
                                        缺 {missing.length} 项 · 未收集
                                      </span>
                                    )}
                                  </span>
                                  {/* 每项要么给值，要么明确写「未收集」。
                                      全空时原来什么都不显示 —— 那和"学校没这一列"分不清。 */}
                                  <span className="mt-1 flex flex-wrap items-center gap-1">
                                    {r.courseCode && (
                                      <span className="rounded-full bg-white/6 px-1.5 py-0.5 text-[9.5px] text-ink-faint">
                                        {r.courseCode}
                                      </span>
                                    )}
                                    {MISSING_FIELDS.map((f) => {
                                      const v = String(r[f.key] ?? '').trim()
                                      return v ? (
                                        <span key={f.key} className="rounded-full bg-white/6 px-1.5 py-0.5 text-[9.5px] text-ink-dim">
                                          {v}
                                        </span>
                                      ) : (
                                        <span
                                          key={f.key}
                                          className="rounded-full bg-white/6 px-1.5 py-0.5 text-[9.5px] text-ink-faint"
                                          title={`「${f.label}」没有收集到 —— 导入的表格里没有这一列或这一格是空的`}
                                        >
                                          {f.label} 未收集
                                        </span>
                                      )
                                    })}
                                  </span>
                                </span>
                                {/* 学分 / 绩点的「未收集」用点右边「改」补 —— 这两个保持可编辑 */}
                                <span
                                  className="w-16 shrink-0 text-right text-[11.5px]"
                                  style={{ color: creditMissing(r) ? 'rgb(255 255 255 / .28)' : undefined }}
                                >
                                  {creditMissing(r) ? '学分 未收集' : `${r.credit} 学分`}
                                </span>
                                <span
                                  className="w-14 shrink-0 text-right text-[12.5px] font-medium"
                                  style={{ color: r.scoreNum !== null ? scoreColor(r.scoreNum) : '#9aa1c2' }}
                                >
                                  {r.score || '—'}
                                </span>
                                <span
                                  className="w-16 shrink-0 text-right text-[11.5px]"
                                  style={{ color: gpaMissing(r) ? 'rgb(255 255 255 / .28)' : undefined }}
                                >
                                  {gpaMissing(r) ? '绩点 未收集' : r.gpa!.toFixed(2)}
                                </span>
                                <button
                                  onClick={() => (editingThis ? setEditing(null) : startEdit(r))}
                                  aria-label={`修改 ${r.courseName} 的学分与绩点`}
                                  className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-white/45 transition hover:bg-white/10 hover:text-white"
                                >
                                  改
                                </button>
                              </div>

                              {editingThis && (
                                <div className="grid grid-cols-2 gap-2 px-4 pb-3 lg:grid-cols-4">
                                  <label>
                                    <span className="mb-1 block text-[10.5px] text-white/45">成绩</span>
                                    <input
                                      value={draft.score}
                                      onChange={(e) => setDraft((d) => ({ ...d, score: e.target.value }))}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') void saveEdit(r)
                                        if (e.key === 'Escape') setEditing(null)
                                      }}
                                      autoFocus
                                      placeholder="91 / 优秀"
                                      aria-label="成绩"
                                      className={inputCls}
                                      style={inputStyle}
                                    />
                                  </label>
                                  <label>
                                    <span className="mb-1 block text-[10.5px] text-white/45">学分</span>
                                    <input
                                      value={draft.credit}
                                      onChange={(e) => setDraft((d) => ({ ...d, credit: e.target.value }))}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') void saveEdit(r)
                                        if (e.key === 'Escape') setEditing(null)
                                      }}
                                      inputMode="decimal"
                                      placeholder="3"
                                      aria-label="学分"
                                      className={inputCls}
                                      style={inputStyle}
                                    />
                                  </label>
                                  <label>
                                    <span className="mb-1 block text-[10.5px] text-white/45">绩点（留空 = 无）</span>
                                    <input
                                      value={draft.gpa}
                                      onChange={(e) => setDraft((d) => ({ ...d, gpa: e.target.value }))}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') void saveEdit(r)
                                        if (e.key === 'Escape') setEditing(null)
                                      }}
                                      inputMode="decimal"
                                      placeholder="3.85"
                                      aria-label="绩点"
                                      className={inputCls}
                                      style={inputStyle}
                                    />
                                  </label>
                                  <div className="flex items-end gap-2">
                                    <button
                                      disabled={busy}
                                      onClick={() => void saveEdit(r)}
                                      className="flex-1 rounded-xl px-3 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-40"
                                      style={{ background: 'linear-gradient(135deg, rgb(92 214 190 / .9), rgb(63 191 144 / .9))' }}
                                    >
                                      保存
                                    </button>
                                    <button
                                      onClick={() => setEditing(null)}
                                      className="rounded-xl border border-white/16 bg-white/7 px-3 py-1.5 text-[12px] text-white/80 transition hover:bg-white/14"
                                    >
                                      取消
                                    </button>
                                    <button
                                      disabled={busy}
                                      onClick={async () => {
                                        if (await remove(r.id)) setEditing(null)
                                      }}
                                      aria-label={`删除 ${r.courseName}`}
                                      title="删除这一条"
                                      className="rounded-xl px-2.5 py-1.5 text-[12px] transition disabled:opacity-40"
                                      style={{ background: 'rgb(255 120 120 / .16)', color: '#ffb3b3' }}
                                    >
                                      删除
                                    </button>
                                  </div>
                                </div>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                })}
            </div>

            {!adding && (
              <button
                onClick={() => setAdding(true)}
                className="mt-3 rounded-xl border border-white/16 bg-white/7 px-3.5 py-1.5 text-[12px] text-white/80 transition hover:bg-white/14"
              >
                + 手动补一条
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
