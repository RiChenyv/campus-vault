import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { SectionTitle } from '../components/Bits'
import { IconCheck, IconClose, IconDownload, IconNotes, IconSchool, IconUpload } from '../components/Icons'
import { api, errText } from '../lib/api'

/**
 * 导入中心。
 *
 * 这一页存在的意义：把后端已有的导入路径搬到界面上。
 * 在此之前它们只能通过命令行调用 —— 那对任何别的用户都等于不存在。
 *
 * 各条路径的定位：
 *   · 学校网站（油猴脚本）—— 唯一能绕开 SSO 又不碰密码的办法
 *   · 成绩表格（.xlsx）—— 教务系统「成绩查询」页能直接导出，最省事、最不容易错
 *   · 上传文件（ICS / WakeUp 备份）—— 标准格式，最可靠
 *   · 手动添加 —— 兜底，也用来补录单门课
 *
 * 所有写入都先走 dry-run 预览再确认，并且导入前后会存快照，可以撤销。
 */

type Tab = 'web' | 'file' | 'manual'

interface TokenRow {
  token: string
  label: string
  created_at: number
  last_used_at: number | null
}

interface ImportLogRow {
  id: number
  source: string
  summary: string
  created_at: number
}

interface PreviewCourse {
  name: string
  teacher?: string
  room?: string
  times?: string[]
}

interface Preview {
  /** 因本机已有值而被跳过的在校信息字段 */
  skipped?: string[]
  courses?: number
  slots?: number
  createNames?: string[]
  updateNames?: string[]
  tableName?: string
  termStart?: string
  /** 教务导出的课表 xlsx 用的字段：标题原文 + 规范化后的学期 */
  title?: string
  term?: string
  deduped?: number
  notes?: string[]
  preview?: PreviewCourse[]
}

/* ---------------------- 成绩表格（xlsx）导入的形状 ---------------------- */

/** 表格里一条解析出来的成绩（字段名 = GradeValues） */
interface XlsxGrade {
  courseCode: string
  courseName: string
  term: string
  score: string
  credit: number
  gpa: number | null
  category?: string
  nature?: string
  retake?: string
}

/** 服务端返回的解析元信息。`ignoredCount` 是"已忽略 N 列"里的 N */
interface XlsxParse {
  fileName?: string
  sheetName?: string
  totalRows?: number
  headers?: string[]
  usedColumns?: string[]
  ignoredColumns?: string[]
  ignoredCount?: number
  /** 表里**没有的列** —— 这些字段在学分总览里会显示「未收集」 */
  missingFields?: string[]
  grades?: XlsxGrade[]
}

interface XlsxResult {
  total?: number
  create?: number
  update?: number
  /** 用户手改过、这次只补空字段的条数 */
  kept?: number
  linked?: number
  unlinked?: number
  notes?: string[]
  parse?: XlsxParse
  applied?: { created?: number; updated?: number; kept?: number }
}

const SOURCE_LABEL: Record<string, string> = {
  'screenshot-extraction': '截图提取',
  'wakeup-file': 'WakeUp 备份文件',
  'ics-file': 'ICS 日历文件',
  'grades-xlsx': '成绩表格 (.xlsx)',
  'timetable-xlsx': '教务课表表格 (.xlsx)',
  unknown: '未知来源',
}

const fmtTime = (t: number) =>
  new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

/** 按内容判断文件格式 —— 不能只看扩展名，用户常把文件存成 .txt */
function detectFormat(text: string): 'ics' | 'wakeup' | null {
  const t = text.trim()
  if (/BEGIN:VCALENDAR/i.test(t)) return 'ics'
  const lines = t.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length >= 5) {
    let allJson = true
    for (let i = 0; i < 5; i++) {
      try {
        JSON.parse(lines[i]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\'))
      } catch {
        allJson = false
        break
      }
    }
    if (allJson) return 'wakeup'
  }
  return null
}

/* ============================== 小组件 ============================== */

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mat-clear spec rounded-3xl p-5 ${className}`}>{children}</div>
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold text-white/80">
        {n}
      </span>
      <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink-dim">{children}</span>
    </li>
  )
}

function Btn({
  children,
  onClick,
  primary,
  disabled,
  tone = 'normal',
}: {
  children: React.ReactNode
  onClick?: () => void
  primary?: boolean
  disabled?: boolean
  tone?: 'normal' | 'danger'
}) {
  const base =
    'rounded-xl px-3.5 py-2 text-[12.5px] font-semibold transition disabled:opacity-40 disabled:cursor-default'
  const look = primary
    ? 'text-white'
    : tone === 'danger'
      ? 'text-rose-200 hover:bg-rose-400/12'
      : 'text-ink-dim hover:bg-white/8 hover:text-white'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${look}`}
      style={
        primary
          ? {
              background: 'linear-gradient(135deg, rgb(143 178 255 / .9), rgb(186 155 255 / .9))',
              boxShadow: '0 10px 26px -14px rgb(143 178 255 / .95)',
            }
          : { background: 'rgb(255 255 255 / .05)', border: '1px solid rgb(255 255 255 / .1)' }
      }
    >
      {children}
    </button>
  )
}

/* ============================== 主视图 ============================== */

export default function ImportView() {
  const [tab, setTab] = useState<Tab>('web')
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  /* 令牌 */
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [userscriptUrl, setUserscriptUrl] = useState('')
  /* 当前脚本版本。**必须显示出来** —— 用户装了旧版时，界面上没有任何线索，
     只能靠"怎么点了没反应"来猜（成绩功能就吃过这个亏）。 */
  const [userscriptVersion, setUserscriptVersion] = useState('')
  const [copied, setCopied] = useState<'token' | 'source' | null>(null)

  /* 成绩表格（.xlsx）—— 拖入 / 选择文件 → 预览 → 确认 */
  const [xDragging, setXDragging] = useState(false)
  const [xFile, setXFile] = useState<File | null>(null)
  const [xPreview, setXPreview] = useState<XlsxResult | null>(null)
  const [xBusy, setXBusy] = useState(false)
  const xInput = useRef<HTMLInputElement>(null)

  /* 文件 */
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  /* 'xlsx' = 教务系统导出的课表表格，二进制整份上传；另两种是文本内容 */
  const [fileKind, setFileKind] = useState<'ics' | 'wakeup' | 'xlsx' | null>(null)
  const [fileText, setFileText] = useState('')
  const [fileObj, setFileObj] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  /* 手动添加 */
  const [mName, setMName] = useState('')
  const [mDay, setMDay] = useState(1)
  const [mFrom, setMFrom] = useState(1)
  const [mSpan, setMSpan] = useState(2)
  const [mWeeks, setMWeeks] = useState('1-17周')
  const [mRoom, setMRoom] = useState('')

  /* 历史 */
  const [logs, setLogs] = useState<ImportLogRow[]>([])

  const flash = useCallback((msg: string) => {
    setOkMsg(msg)
    setTimeout(() => setOkMsg(null), 3200)
  }, [])

  const loadTokens = useCallback(async () => {
    try {
      const d = await api.get<{ tokens: TokenRow[] }>('/import/token')
      setTokens(d.tokens)
      return d.tokens
    } catch {
      return []
    }
  }, [])

  const loadLogs = useCallback(async () => {
    try {
      const d = await api.get<{ logs: ImportLogRow[] }>('/import/log')
      setLogs(d.logs)
    } catch {
      /* 历史拿不到不影响主流程 */
    }
  }, [])

  useEffect(() => {
    void (async () => {
      await loadTokens()
      await loadLogs()
      try {
        const d = await api.get<{ userscriptUrl: string; userscriptVersion?: string }>('/import/inject-info')
        setUserscriptUrl(d.userscriptUrl)
        setUserscriptVersion(d.userscriptVersion ?? '')
      } catch {
        /* 兜底：**按当前站点**拼地址，不要写死 127.0.0.1。
           写死的话，公网部署后这个"安装脚本"链接会指向**访问者自己的电脑**，
           点了当然装不上（而且会让人以为是脚本坏了）。 */
        setUserscriptUrl(`${location.origin}/api/import/userscript.user.js`)
      }
    })()
  }, [loadTokens, loadLogs])

  const createToken = async () => {
    setErr(null)
    try {
      await api.post('/import/token', { label: '导入中心' })
      await loadTokens()
      flash('已生成新的导入令牌')
    } catch (e) {
      setErr(errText(e))
    }
  }

  const revokeTokens = async () => {
    setErr(null)
    try {
      const d = await api.del<{ removed: number }>('/import/token')
      setTokens([])
      flash(`已作废 ${d.removed} 个令牌（装了旧令牌的油猴脚本会立刻失效，重新填一个新的即可）`)
    } catch (e) {
      setErr(errText(e))
    }
  }

  const copy = async (what: 'token' | 'source', text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 1800)
    } catch {
      setErr('复制失败，请手动选中复制')
    }
  }

  /**
   * 复制油猴脚本的**全文**。
   * 给一条兜底路：从 URL 安装偶尔会被浏览器拦（localhost、非 https、
   * 扩展权限等），而"复制全文 → 粘进 Tampermonkey 的编辑器"几乎总能成。
   */
  const copyUserscriptSource = async () => {
    setErr(null)
    try {
      const text = await fetch(userscriptUrl).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      })
      await copy('source', text)
    } catch (e) {
      setErr(`取脚本内容失败：${errText(e)}`)
    }
  }

  /* ---------------------------- 文件 ---------------------------- */

  const readFile = useCallback(async (f: File) => {
    setErr(null)
    setPreview(null)
    setFileName(f.name)

    /* .xlsx 走**另一条路**：它是二进制，读成文本没意义，
       得整份 multipart 传上去给服务端解（和成绩表格同一种做法）。 */
    if (/\.xlsx$/i.test(f.name)) {
      setFileKind('xlsx')
      setFileObj(f)
      setFileText('')
      return
    }
    if (/\.xls$/i.test(f.name)) {
      setFileKind(null)
      setFileObj(null)
      setFileText('')
      setErr(
        '这是老的 .xls 格式，读不了。\n' +
          '请在教务系统的课表页点「导出」拿到 .xlsx；已经有 .xls 的话，用 Excel / WPS 另存为 .xlsx 再传。',
      )
      return
    }

    setFileObj(null)
    const text = await f.text()
    const kind = detectFormat(text)
    setFileKind(kind)
    setFileText(text)
    if (!kind) {
      setErr(
        '认不出这个文件的格式。支持三种：\n' +
          '· 教务系统导出的课表 .xlsx（推荐）\n' +
          '· ICS 日历文件（含 BEGIN:VCALENDAR）\n' +
          '· WakeUp 备份文件（5 行以上，每行一个 JSON）\n\n' +
          '如果你导出的是「分享口令」，那条路已经不可用了 —— WakeUp 的分享接口不再对第三方开放。',
      )
    }
  }, [])

  const runFileImport = async (apply: boolean) => {
    if (!fileKind) return
    setBusy(true)
    setErr(null)
    try {
      /* xlsx 走 multipart 的独立接口；ics / wakeup 仍是 JSON 里的文本内容 */
      const d =
        fileKind === 'xlsx'
          ? await (() => {
              if (!fileObj) throw new Error('文件没了，请重新选择')
              const form = new FormData()
              form.append('files', fileObj, fileObj.name)
              /* multipart 里 dryRun 是字符串，服务端两种都认 */
              if (apply) form.append('dryRun', 'false')
              return api.upload<Preview>('/import/timetable-xlsx', form)
            })()
          : await (() => {
              if (!fileText) throw new Error('文件内容没了，请重新选择')
              const path = fileKind === 'ics' ? '/import/ics' : '/import/wakeup'
              return api.post<Preview>(path, { content: fileText, dryRun: !apply })
            })()
      if (apply) {
        const a = d as unknown as { applied?: { created?: number; updated?: number; slots?: number } }
        flash(
          `导入完成：新增 ${a.applied?.created ?? 0} 门 · 更新 ${a.applied?.updated ?? 0} 门 · 时间段 ${a.applied?.slots ?? 0} 条`,
        )
        setPreview(null)
        setFileText('')
        setFileName('')
        setFileKind(null)
        setFileObj(null)
        await loadLogs()
      } else {
        setPreview(d)
      }
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  /* ---------------------------- 成绩表格（.xlsx） ---------------------------- */

  /** 选中文件就立刻传上去拿预览（dryRun 默认 true，这一步**不写库**） */
  const readXlsx = useCallback(async (f: File) => {
    setErr(null)
    setXPreview(null)
    setXFile(f)
    setXBusy(true)
    try {
      const form = new FormData()
      /* 第三个参数是显式文件名 —— 不传的话 FormData 会用字段名当文件名 */
      form.append('files', f, f.name)
      const d = await api.upload<XlsxResult>('/import/grades-xlsx', form)
      setXPreview(d)
    } catch (e) {
      setErr(errText(e))
    } finally {
      setXBusy(false)
    }
  }, [])

  const confirmXlsx = async () => {
    if (!xFile || !xPreview) return
    setXBusy(true)
    setErr(null)
    try {
      const form = new FormData()
      form.append('files', xFile, xFile.name)
      form.append('dryRun', 'false')
      const d = await api.upload<XlsxResult>('/import/grades-xlsx', form)
      const a = d.applied ?? {}
      flash(
        `成绩导入完成：新增 ${a.created ?? 0} 条 · 更新 ${a.updated ?? 0} 条` +
          ((a.kept ?? 0) > 0 ? ` · 手改保留 ${a.kept} 条` : ''),
      )
      setXPreview(null)
      setXFile(null)
      await loadLogs()
      window.dispatchEvent(new Event('cv:grades-changed'))
    } catch (e) {
      setErr(errText(e))
    } finally {
      setXBusy(false)
    }
  }

  const resetXlsx = () => {
    setXFile(null)
    setXPreview(null)
    setErr(null)
  }

  /* ---------------------------- 手动添加 ---------------------------- */

  const addManual = async () => {
    if (!mName.trim()) {
      setErr('课程名不能为空')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await api.post('/import', {
        source: 'manual',
        courses: [
          {
            code: '',
            name: mName.trim(),
            term: '',
            room: mRoom.trim(),
            slots: [{ day: mDay, from: mFrom, span: mSpan, room: mRoom.trim(), weeks: mWeeks.trim() }],
          },
        ],
        dryRun: false,
      })
      flash(`已添加「${mName.trim()}」`)
      setMName('')
      setMRoom('')
      await loadLogs()
      window.dispatchEvent(new Event('cv:schedule-changed'))
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  /* ---------------------------- 撤销 ---------------------------- */

  const undo = async () => {
    setErr(null)
    try {
      const d = await api.post<{ restoredCourses: number; restoredSlots: number; fromSource: string }>('/import/undo')
      flash(
        `已撤销「${SOURCE_LABEL[d.fromSource] ?? d.fromSource}」，恢复到 ${d.restoredCourses} 门课 / ${d.restoredSlots} 条时间段`,
      )
      await loadLogs()
      window.dispatchEvent(new Event('cv:schedule-changed'))
    } catch (e) {
      setErr(errText(e))
    }
  }

  const previewList = useMemo(() => {
    if (!preview) return []
    if (preview.preview?.length) {
      return preview.preview.map((c) => ({ name: c.name, meta: (c.times ?? []).join(' / ') || c.room || '' }))
    }
    const names = [...(preview.createNames ?? []), ...(preview.updateNames ?? [])]
    return names.map((n) => ({ name: n, meta: '' }))
  }, [preview])

  const TABS: { id: Tab; label: string }[] = [
    { id: 'web', label: '从学校网站导入' },
    { id: 'file', label: '上传文件' },
    { id: 'manual', label: '手动添加' },
  ]

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id)
              setErr(null)
            }}
            className="rounded-full px-4 py-2 text-[12.5px] font-semibold transition"
            style={
              tab === t.id
                ? {
                    color: '#fff',
                    background: 'linear-gradient(135deg, rgb(143 178 255 / .26), rgb(186 155 255 / .18))',
                    border: '1px solid rgb(143 178 255 / .5)',
                  }
                : { color: 'rgb(255 255 255 / .6)', background: 'rgb(255 255 255 / .05)', border: '1px solid rgb(255 255 255 / .1)' }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {(err || okMsg) && (
        <div
          className="mb-4 whitespace-pre-line rounded-2xl px-4 py-3 text-[12.5px] leading-relaxed"
          style={
            err
              ? { background: 'rgb(255 143 177 / .12)', border: '1px solid rgb(255 143 177 / .3)', color: 'rgb(255 200 215)' }
              : { background: 'rgb(126 214 190 / .12)', border: '1px solid rgb(126 214 190 / .3)', color: 'rgb(190 240 225)' }
          }
        >
          {err ?? okMsg}
        </div>
      )}

      {/* ══════════════ 从学校网站导入 ══════════════ */}
      {tab === 'web' && (
        <div className="space-y-4">
          <SectionTitle kicker="userscript" title="油猴脚本（推荐）" rgb="143 178 255" />
          <Card>
            <div className="mb-4 flex items-start gap-3">
              <IconDownload className="mt-0.5 h-5 w-5 shrink-0 text-[rgb(143,178,255)]" />
              <p className="text-[12.5px] leading-relaxed text-ink-dim">
                装一次，之后打开学校网站右下角会**自动出现**导入按钮。
                不用记该在哪个页面点，也能在页面里看到识别结果再确认。
              </p>
            </div>
            <ol className="space-y-2.5">
              <Step n={1}>
                给浏览器装 <b className="text-white">Tampermonkey</b>（篡改猴）扩展 —— 去各自的扩展商店搜这个名字。
              </Step>
              <Step n={2}>
                点下面的按钮安装脚本。Tampermonkey 会弹出安装页，点「安装」即可。
              </Step>
              <Step n={3}>
                打开 <b className="text-white">courses.cuc.edu.cn</b> 或{' '}
                <b className="text-white">i.cuc.edu.cn</b>，右下角会有「导入到 Campus Vault」按钮。
              </Step>
              <Step n={4}>
                第一次点它会让你填<b className="text-white">导入令牌</b>（在下面那一栏复制），只填这一次。
              </Step>
              <Step n={5}>
                导入<b className="text-white">成绩</b>：打开教务系统的「成绩查询」页，
                右下角按钮会自己变成<b className="text-white">「导入成绩」</b> ——
                脚本只导当前页 —— 还有下一页时，自己翻页后再点一次「导入成绩」就行。重复导入不会产生重复记录，
                收完让你看一眼条数再确认。
              </Step>
            </ol>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <a
                href={userscriptUrl}
                className="rounded-xl px-3.5 py-2 text-[12.5px] font-semibold text-white"
                style={{
                  background: 'linear-gradient(135deg, rgb(143 178 255 / .9), rgb(186 155 255 / .9))',
                  boxShadow: '0 10px 26px -14px rgb(143 178 255 / .95)',
                }}
              >
                安装油猴脚本{userscriptVersion ? ` v${userscriptVersion}` : ''}
              </a>
              <Btn onClick={() => void copyUserscriptSource()}>
                {copied === 'source' ? '已复制全文' : '复制脚本内容'}
              </Btn>
              <a href={userscriptUrl} target="_blank" rel="noreferrer" className="text-[11.5px] text-white/45 underline">
                查看源码
              </a>
            </div>

            {/* 版本提示。装了旧版脚本时，用户在别处**看不出任何区别** ——
                只会觉得"这个功能怎么没有"。所以把版本号和"怎么升级"写在这儿。 */}
            <p className="mt-2 text-[11px] leading-relaxed text-white/45">
              装过旧版？<b className="text-white/70">再点一次上面这个按钮</b>即可更新
              （Tampermonkey 会弹安装页，点「安装」覆盖），然后回到学校页面按 F5。
              装完可在 Tampermonkey 面板里核对版本号
              {userscriptVersion ? `：应为 ${userscriptVersion}` : ''}。
              <br />
              重装后没变化？把网站窗口关掉、重新双击启动一次再装 ——
              脚本的版本号是后端启动时固定的，不重启的话 Tampermonkey 会认为"已经是最新"，不给更新。
            </p>

            <details className="mt-3 rounded-2xl bg-white/4 px-3.5 py-2.5">
              <summary className="cursor-pointer text-[11.5px] text-white/55">
                点「安装」没反应？（浏览器有时会拦 localhost 的安装页）
              </summary>
              <ol className="mt-2.5 space-y-2">
                <Step n={1}>
                  点上面的 <b className="text-white">复制脚本内容</b>。
                </Step>
                <Step n={2}>
                  点浏览器工具栏的 Tampermonkey 图标 → <b className="text-white">添加新脚本</b>
                  （或「管理面板」→ 左下角 <b className="text-white">+</b>）。
                </Step>
                <Step n={3}>
                  编辑器里**全选删掉**默认内容，粘贴刚复制的，然后 <b className="text-white">Ctrl+S</b> 保存。
                </Step>
                <Step n={4}>
                  回到学校页面按 F5 刷新，右下角就会出现按钮。
                </Step>
              </ol>
            </details>
          </Card>

          {/* ── 成绩表格（.xlsx）──────────────────────────────────────
              原来这里是「书签脚本」那一栏。书签脚本已经删掉（太麻烦），
              位置换成教务系统导出的成绩表格 —— 不用装扩展、不用管在哪个页面点，
              导出的文件本来就在本地。

              样式**照抄下面「上传课表文件」那一栏**（同一个拖拽区、同一套类名），
              不引入新的视觉风格。 */}
          <SectionTitle kicker="xlsx" title="上传表格文件（.xlsx）" rgb="186 155 255" />
          <Card>
            <p className="mb-4 text-[12.5px] leading-relaxed text-ink-dim">
              教务系统的<b className="text-white">「成绩查询」</b>页右上角有个「导出」，
              拿到 <code className="rounded bg-black/30 px-1">全部成绩查询.xlsx</code>，
              把文件拖进来即可 —— 只导**成绩**，不导课程。
            </p>

            <div
              onDragOver={(e) => {
                e.preventDefault()
                setXDragging(true)
              }}
              onDragLeave={() => setXDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setXDragging(false)
                const f = e.dataTransfer.files?.[0]
                if (f) void readXlsx(f)
              }}
              onClick={() => xInput.current?.click()}
              className="cursor-pointer rounded-2xl px-6 py-10 text-center transition"
              style={{
                border: `1.5px dashed ${xDragging ? 'rgb(186 155 255 / .7)' : 'rgb(255 255 255 / .18)'}`,
                background: xDragging ? 'rgb(186 155 255 / .08)' : 'rgb(255 255 255 / .03)',
              }}
            >
              <IconUpload className="mx-auto mb-3 h-7 w-7 text-white/45" />
              <div className="text-[13px] font-semibold text-white">
                {xBusy ? '正在读取表格…' : (xFile?.name || '把成绩表格拖到这里，或点击选择')}
              </div>
              <div className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">
                支持教务系统导出的 <b className="text-white/70">.xlsx</b> 成绩表格
                <br />
                上传后先给你看预览，确认了才写进库里
              </div>
              {xPreview && !xBusy && (
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11.5px] text-white/80">
                  <IconCheck className="h-3.5 w-3.5" />
                  识别到 {xPreview.total ?? 0} 条成绩
                </div>
              )}
            </div>
            <input
              ref={xInput}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void readXlsx(f)
                e.target.value = ''
              }}
            />

            {xFile && !xBusy && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn onClick={resetXlsx}>重新选择</Btn>
              </div>
            )}
          </Card>

          {/* 预览：识别到几条 / 新增几条 / 更新几条（其中几条是手改过的）/ 已忽略几列 */}
          {xPreview && !xBusy && (
            <Card>
              <div className="mb-3 flex flex-wrap items-baseline gap-3">
                <span className="text-[14px] font-semibold text-white">成绩导入预览</span>
                {xPreview.parse?.sheetName && (
                  <span className="text-[12px] text-ink-faint">工作表 {xPreview.parse.sheetName}</span>
                )}
                <span className="ml-auto text-[12px] text-ink-dim">
                  识别到 <b className="text-white">{xPreview.total ?? 0}</b> 条 · 新增{' '}
                  <b className="text-white">{xPreview.create ?? 0}</b> · 更新{' '}
                  <b className="text-white">{xPreview.update ?? 0}</b>
                  {(xPreview.kept ?? 0) > 0 && (
                    <>
                      {' '}
                      （其中 <b className="text-white">{xPreview.kept}</b> 条是你手改过的）
                    </>
                  )}
                </span>
              </div>

              {/* 「已忽略 N 列不需要的信息」—— 用户要求明确写出来 */}
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[11.5px]">
                <span className="rounded-full bg-white/8 px-2.5 py-1 text-ink-dim">
                  已忽略 {xPreview.parse?.ignoredCount ?? 0} 列不需要的信息
                </span>
                {(xPreview.parse?.ignoredColumns ?? []).length > 0 && (
                  <span className="min-w-0 flex-1 truncate text-ink-faint" title={(xPreview.parse?.ignoredColumns ?? []).join('、')}>
                    {(xPreview.parse?.ignoredColumns ?? []).join('、')}
                  </span>
                )}
              </div>

              {/* 表里没有的列（缺字段）—— 这些在学分总览里会显示成「未收集」 */}
              {(xPreview.parse?.missingFields ?? []).length > 0 && (
                <div className="mb-3 text-[11.5px] text-amber-200/80">
                  · 表格里没有这些列：
                  {(xPreview.parse?.missingFields ?? []).join('、')}
                  {' '}—— 导入后它们在「学分总览」里会显示成「未收集」，可以逐条手动补。
                </div>
              )}

              {(xPreview.notes ?? []).length > 0 && (
                <div className="mb-3 space-y-1">
                  {(xPreview.notes ?? []).map((n) => (
                    <div key={n} className="text-[11.5px] text-amber-200/80">
                      · {n}
                    </div>
                  ))}
                </div>
              )}

              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {(xPreview.parse?.grades ?? []).map((g, i) => (
                  <div key={`${g.courseName}-${i}`} className="flex items-baseline gap-3 rounded-xl bg-white/5 px-3.5 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-semibold text-white">{g.courseName}</div>
                      <div className="mt-0.5 truncate text-[11px] text-ink-faint">
                        {[g.term, g.courseCode, g.credit ? `${g.credit} 学分` : '学分未收集', g.gpa !== null ? `绩点 ${g.gpa}` : '绩点未收集']
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <span className="shrink-0 text-[12.5px] text-white/85">{g.score || '未出分'}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Btn primary disabled={xBusy} onClick={() => void confirmXlsx()}>
                  确认导入
                </Btn>
                <Btn onClick={resetXlsx}>取消</Btn>
                <span className="text-[11.5px] text-ink-faint">
                  重复导入不会产生重复记录 —— 认的是「学期 + 课程号」
                </span>
              </div>
            </Card>
          )}

          <SectionTitle kicker="token" title="导入令牌" rgb="126 214 190" />
          <Card>
            <p className="mb-3 text-[12.5px] leading-relaxed text-ink-dim">
              脚本靠它证明"这次导入是你本人发起的"。它**只能用于导入接口**，拿不到你的其它数据，
              随时可以作废重发。令牌存在你自己的浏览器里，我们不会碰你的学校账号密码。
            </p>
            {/* 这条必须显眼：令牌是浏览器级存储，换账号不会自动跟着变 */}
            <div
              className="mb-3 rounded-2xl px-3.5 py-2.5 text-[11.5px] leading-relaxed"
              style={{ background: 'rgb(240 186 120 / .1)', border: '1px solid rgb(240 186 120 / .26)', color: 'rgb(246 214 168)' }}
            >
              <b>令牌决定导入到哪个账号</b>，和你在本站当前登录谁无关。
              每个账号要各生成一份自己的令牌；换账号导入时，在脚本面板里点「换个令牌」换成那个账号的。
              <br />
              面板上会显示「将导入到：XXX」，导入前先看一眼。
            </div>
            {tokens.length ? (
              <div className="space-y-2">
                {tokens.map((t) => (
                  <div key={t.token} className="flex items-center gap-3 rounded-2xl bg-white/5 px-3.5 py-2.5">
                    <code className="min-w-0 flex-1 truncate text-[12px] text-white/85">{t.token}</code>
                    <span className="shrink-0 text-[10.5px] text-white/40">
                      {t.last_used_at ? `最近使用 ${fmtTime(t.last_used_at)}` : '尚未使用'}
                    </span>
                    <Btn onClick={() => copy('token', t.token)}>
                      {copied === 'token' ? '已复制' : '复制'}
                    </Btn>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Btn onClick={createToken}>再生成一个</Btn>
                  <Btn tone="danger" onClick={revokeTokens}>
                    全部作废
                  </Btn>
                </div>
              </div>
            ) : (
              <Btn primary onClick={createToken}>
                生成导入令牌
              </Btn>
            )}
          </Card>
        </div>
      )}

      {/* ══════════════ 上传文件 ══════════════ */}
      {tab === 'file' && (
        <div className="space-y-4">
          <SectionTitle kicker="file" title="上传课表文件" rgb="92 214 190" />
          <Card>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const f = e.dataTransfer.files?.[0]
                if (f) void readFile(f)
              }}
              onClick={() => fileInput.current?.click()}
              className="cursor-pointer rounded-2xl px-6 py-10 text-center transition"
              style={{
                border: `1.5px dashed ${dragging ? 'rgb(92 214 190 / .7)' : 'rgb(255 255 255 / .18)'}`,
                background: dragging ? 'rgb(92 214 190 / .08)' : 'rgb(255 255 255 / .03)',
              }}
            >
              <IconUpload className="mx-auto mb-3 h-7 w-7 text-white/45" />
              <div className="text-[13px] font-semibold text-white">
                {fileName || '把课表文件拖到这里，或点击选择'}
              </div>
              <div className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">
                推荐 <b className="text-white/70">.xlsx</b> —— 教务系统「课表查看」页点<b className="text-white/70">导出</b>拿到的那个文件，
                同一门课的不同周次 / 教室 / 线上线下安排都能一次导对
                <br />
                也支持 <b className="text-white/70">.ics</b> 日历文件、WakeUp 的 <b className="text-white/70">.wakeup_schedule</b> 备份
              </div>
              {fileKind && (
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11.5px] text-white/80">
                  <IconCheck className="h-3.5 w-3.5" />
                  识别为{' '}
                  {fileKind === 'xlsx' ? '教务课表表格 (.xlsx)' : fileKind === 'ics' ? 'ICS 日历文件' : 'WakeUp 备份文件'}
                </div>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.ics,.txt,.wakeup_schedule,text/calendar,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void readFile(f)
                e.target.value = ''
              }}
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <Btn
                primary
                disabled={!fileKind || busy}
                onClick={() => void runFileImport(false)}
              >
                预览会导入什么
              </Btn>
              {fileText && (
                <Btn
                  onClick={() => {
                    setFileText('')
                    setFileName('')
                    setFileKind(null)
                    setFileObj(null)
                    setPreview(null)
                  }}
                >
                  重新选择
                </Btn>
              )}
            </div>
          </Card>

          {preview && (
            <Card>
              <div className="mb-3 flex flex-wrap items-baseline gap-3">
                <span className="text-[14px] font-semibold text-white">预览</span>
                {(preview.tableName || preview.title) && (
                  <span className="text-[12px] text-ink-faint">{preview.tableName ?? preview.title}</span>
                )}
                {preview.termStart && <span className="text-[12px] text-ink-faint">起始 {preview.termStart}</span>}
                {preview.term && <span className="text-[12px] text-ink-faint">学期 {preview.term}</span>}
                <span className="ml-auto text-[12px] text-ink-dim">
                  课程 <b className="text-white">{preview.courses ?? 0}</b> 门 · 时间段{' '}
                  <b className="text-white">{preview.slots ?? 0}</b> 条
                </span>
              </div>

              {(preview.notes ?? []).length > 0 && (
                <div className="mb-3 space-y-1">
                  {(preview.notes ?? []).map((n) => (
                    <div key={n} className="text-[11.5px] text-amber-200/80">
                      · {n}
                    </div>
                  ))}
                </div>
              )}

              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {previewList.map((c, i) => (
                  <div key={`${c.name}-${i}`} className="rounded-xl bg-white/5 px-3.5 py-2">
                    <div className="truncate text-[12.5px] font-semibold text-white">{c.name}</div>
                    {c.meta && <div className="mt-0.5 truncate text-[11px] text-ink-faint">{c.meta}</div>}
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Btn primary disabled={busy} onClick={() => void runFileImport(true)}>
                  确认导入
                </Btn>
                <Btn onClick={() => setPreview(null)}>取消</Btn>
                <span className="text-[11.5px] text-ink-faint">重复导入不会产生重复课程</span>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ══════════════ 手动添加 ══════════════ */}
      {tab === 'manual' && (
        <div className="space-y-4">
          <SectionTitle kicker="manual" title="手动添加一门课" rgb="240 186 120" />
          <Card>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="mb-1 block text-[11.5px] text-ink-faint">课程名</span>
                <input
                  value={mName}
                  onChange={(e) => setMName(e.target.value)}
                  placeholder="例如：基础示例课程二"
                  aria-label="课程名"
                  className="w-full rounded-xl px-3 py-2 text-[12.5px] text-white outline-none"
                  style={{ background: 'rgb(0 0 0 / .25)', border: '1px solid rgb(255 255 255 / .14)' }}
                />
              </label>
              <label>
                <span className="mb-1 block text-[11.5px] text-ink-faint">星期</span>
                <select
                  value={mDay}
                  onChange={(e) => setMDay(Number(e.target.value))}
                  aria-label="星期"
                  className="w-full rounded-xl px-3 py-2 text-[12.5px] text-white outline-none"
                  style={{ background: 'rgb(0 0 0 / .25)', border: '1px solid rgb(255 255 255 / .14)' }}
                >
                  {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((d, i) => (
                    <option key={d} value={i + 1} style={{ background: '#1a1d32' }}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-[11.5px] text-ink-faint">地点</span>
                <input
                  value={mRoom}
                  onChange={(e) => setMRoom(e.target.value)}
                  placeholder="例如：四十八教611"
                  aria-label="地点"
                  className="w-full rounded-xl px-3 py-2 text-[12.5px] text-white outline-none"
                  style={{ background: 'rgb(0 0 0 / .25)', border: '1px solid rgb(255 255 255 / .14)' }}
                />
              </label>
              <label>
                <span className="mb-1 block text-[11.5px] text-ink-faint">起始节次</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={mFrom}
                  onChange={(e) => setMFrom(Number(e.target.value))}
                  aria-label="起始节次"
                  className="w-full rounded-xl px-3 py-2 text-[12.5px] text-white outline-none"
                  style={{ background: 'rgb(0 0 0 / .25)', border: '1px solid rgb(255 255 255 / .14)' }}
                />
              </label>
              <label>
                <span className="mb-1 block text-[11.5px] text-ink-faint">连上几节</span>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={mSpan}
                  onChange={(e) => setMSpan(Number(e.target.value))}
                  aria-label="连上几节"
                  className="w-full rounded-xl px-3 py-2 text-[12.5px] text-white outline-none"
                  style={{ background: 'rgb(0 0 0 / .25)', border: '1px solid rgb(255 255 255 / .14)' }}
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block text-[11.5px] text-ink-faint">
                  周次 —— 支持 <code className="text-white/70">1-17周</code>、
                  <code className="text-white/70">1-9周(单)</code>、<code className="text-white/70">5-7周,10周</code>
                </span>
                <input
                  value={mWeeks}
                  onChange={(e) => setMWeeks(e.target.value)}
                  aria-label="周次"
                  className="w-full rounded-xl px-3 py-2 text-[12.5px] text-white outline-none"
                  style={{ background: 'rgb(0 0 0 / .25)', border: '1px solid rgb(255 255 255 / .14)' }}
                />
              </label>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Btn primary disabled={busy} onClick={() => void addManual()}>
                添加
              </Btn>
              <span className="text-[11.5px] text-ink-faint">同一门课再加一段时间段，重复填课程名即可</span>
            </div>
          </Card>
        </div>
      )}

      {/* ══════════════ 导入历史 ══════════════ */}
      <div className="mt-8">
        <SectionTitle kicker="history" title="导入历史" rgb="196 148 255" />
        <Card>
          {logs.length === 0 ? (
            <div className="flex items-center gap-2 text-[12.5px] text-ink-faint">
              <IconNotes className="h-4 w-4" />
              还没有导入记录
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                {logs.slice(0, 8).map((l) => (
                  <div key={l.id} className="flex items-baseline gap-3 rounded-xl bg-white/5 px-3.5 py-2">
                    <span className="shrink-0 text-[11px] text-white/45">{fmtTime(l.created_at)}</span>
                    <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] text-white/70">
                      {SOURCE_LABEL[l.source] ?? l.source}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-dim">{l.summary}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Btn onClick={() => void undo()}>撤销上一次导入</Btn>
                <span className="text-[11.5px] text-ink-faint">
                  导入前会自动存一份课表快照，撤销即恢复到导入前的样子
                </span>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}

/* 让 motion 的存在感保留 —— 这一页目前没有动画需求，但保持导入一致性 */
void motion
void IconClose
void IconSchool
