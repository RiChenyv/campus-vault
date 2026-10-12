import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import ConfirmDialog from './ConfirmDialog'
import { IconFile, IconUpload } from './Icons'
import { errText } from '../lib/api'
import { kindRgb, type VaultItem } from '../lib/vault'
import { useCourses, DEFAULT_RGB } from '../lib/useCourses'
import * as store from '../lib/vaultStore'
import { setSpot } from '../lib/utils'

/**
 * 「笔记文件」—— 上传外部文件当笔记，做法和题库一致。
 *
 * 和题库共用一套文件基础设施（同一张 files 表，靠 scope 区分），
 * 所以不重复实现上传/校验/落盘，只是换个 scope、换一套展示。
 *
 * scope 用 'note' 而不是新表：
 *  · 附件、配额、磁盘清理、归属校验全都现成
 *  · 题库那边的"文件夹分组"「清空」将来也能直接复用
 */
const SCOPE = 'note' as const

/** 散装文件的一行。文件夹里的行结构略有不同，所以没共用 */
function FileChip({
  item,
  courses,
  onDelete,
}: {
  item: VaultItem
  courses: { id: string; name: string }[]
  onDelete: (id: string) => void
}) {
  return (
    <li>
      <div className="mat-clear spec flex items-center gap-2 rounded-2xl px-3 py-2.5">
        <IconFile className="h-4 w-4 shrink-0" style={{ color: `rgb(${kindRgb[item.kind]})` }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] text-white/92" title={item.name}>
            {item.name}
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-white/40">
            {courses.find((c) => c.id === item.courseId)?.name ?? '未归类'} · {item.size}
          </span>
        </span>
        <button
          onClick={() => onDelete(item.id)}
          aria-label={`删除笔记 ${item.name}`}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[13px] leading-none text-white/35 transition hover:bg-white/10 hover:text-white"
          title="删除"
        >
          ✕
        </button>
      </div>
    </li>
  )
}

/**
 * @param onChanged 上传/删除成功后回调。
 *   ⚠️ 必须有：同一页下面的「课程资料库」是**独立组件**、只在挂载时读一次，
 *   不通知它的话，用户传完文件往下看资料库还是空的（得手动刷新页面才发现）。
 */
export default function NoteFiles({ onChanged }: { onChanged?: () => void } = {}) {
  const [items, setItems] = useState<VaultItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [allowed, setAllowed] = useState<Set<string>>(() => new Set())

  /* 上传前必须**先选学科**。
     否则文件全落到"未归类"，以后想按课程找根本找不着 ——
     而"这份资料是哪门课的"只有上传的人知道，事后补很麻烦。 */
  const { courses } = useCourses()
  const [courseId, setCourseId] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const okUp = await store.available()
      if (!alive) return
      if (!okUp) {
        setErr('连接不到服务器，无法上传。请先启动后端后刷新页面')
        setLoading(false)
        return
      }
      try {
        const list = await store.loadAll(SCOPE)
        if (alive) setItems(list)
      } catch (e) {
        if (alive) setErr(errText(e))
      } finally {
        if (alive) setLoading(false)
      }
      // 允许的扩展名：和题库一样做前置过滤，避免选文件夹时发一堆注定被拒的请求
      try {
        const mod = await import('../lib/api')
        const d = await mod.api.get<{ extensions: Record<string, string> }>('/files/allowed')
        if (alive) setAllowed(new Set(Object.keys(d.extensions)))
      } catch {
        /* 拿不到就不拦，交给后端把关 */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  async function addFiles(list: FileList | File[] | null) {
    if (!list) return
    const all = Array.from(list)
    if (!all.length) return

    if (!courseId) {
      setErr('请先选择所属学科，再上传')
      if (fileRef.current) fileRef.current.value = ''
      if (dirRef.current) dirRef.current.value = ''
      return
    }

    const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\.gitkeep)$/i
    const arr: File[] = []
    let skipped = 0
    for (const f of all) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
      if (JUNK.test(rel)) continue
      const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase()
      if (allowed.size && !allowed.has(ext)) {
        skipped++
        continue
      }
      arr.push(f)
    }
    if (!arr.length) {
      setErr(skipped ? `选中的 ${skipped} 个文件都不支持` : '没有可上传的文件')
      if (fileRef.current) fileRef.current.value = ''
      if (dirRef.current) dirRef.current.value = ''
      return
    }

    setBusy(true)
    setErr(null)
    try {
      const got: VaultItem[] = []
      const failed: string[] = []
      /* 这一次用户动作的批次键：整批文件共用它，服务端只记一次 push
         （热力图口径 = 一次上传算一次，不按文件数算）。 */
      const batchKey = store.newBatchKey()
      for (const f of arr) {
        try {
          const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || ''
          const dir = rel && rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
          got.push(await store.upload(f, { scope: SCOPE, courseId, ...(dir ? { folder: dir } : {}), batchKey }))
        } catch (e) {
          failed.push(`${f.name}：${errText(e)}`)
        }
      }
      if (got.length) setItems((p) => [...got, ...p])
      if (got.length) onChanged?.()
      const msgs: string[] = []
      if (got.length) msgs.push(`已上传 ${got.length} 个文件`)
      if (skipped) msgs.push(`跳过 ${skipped} 个不支持的类型`)
      if (failed.length) msgs.push(failed.slice(0, 2).join('；') + (failed.length > 2 ? `…等 ${failed.length} 个失败` : ''))
      setErr(msgs.length > 1 || failed.length ? msgs.join(' · ') : null)
      if (got.length && !failed.length && !skipped) {
        setNotice(`已上传 ${got.length} 个文件`)
        setTimeout(() => setNotice(null), 3500)
      }
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
      if (dirRef.current) dirRef.current.value = ''
    }
  }

  function del(id: string) {
    const snapshot = items
    setItems((p) => p.filter((x) => x.id !== id))
    void store.remove(id)
      .then(() => onChanged?.())
      .catch((e) => {
        setItems(snapshot)
        setErr(`删除失败：${errText(e)}`)
      })
  }

  async function clearAll() {
    setClearOpen(false)
    setBusy(true)
    try {
      const d = await store.clearAll(SCOPE)
      setItems([])
      setNotice(`已清空，删除 ${d.removed} 个文件`)
      setTimeout(() => setNotice(null), 4000)
      onChanged?.()
    } catch (e) {
      setErr(`清空失败：${errText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 按**顶层文件夹**分组。
   * 传一个文件夹进来会带几十个文件，全摊开既占地方又看不出层次 ——
   * 用户的原话是"文件堆砌观感太差"。所以文件夹只显示成一行。
   */
  const grouped = useMemo(() => {
    const loose: VaultItem[] = []
    const map = new Map<string, VaultItem[]>()
    for (const it of items) {
      const root = (it.folder ?? '').split('/')[0] || ''
      if (!root) {
        loose.push(it)
        continue
      }
      const list = map.get(root)
      if (list) list.push(it)
      else map.set(root, [it])
    }
    return { loose, folders: [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh')) }
  }, [items])

  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set())
  const toggleFolder = (name: string) =>
    setOpenFolders((s) => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <section className="mb-5">
      {/* 上传区 */}
      <div
        className="mat-clear mb-3 rounded-2xl p-3 transition"
        style={{
          borderColor: dragging ? 'rgba(186,155,255,.7)' : undefined,
          background: dragging ? 'rgba(186,155,255,.12)' : undefined,
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void addFiles(e.dataTransfer.files)
        }}
      >
        {/* 学科选择。必须在选文件之前 —— 顺序上先想清楚"这是哪门课的"，
            再挑文件，比传完再补要自然。 */}
        <div className="mb-2 flex items-center gap-2">
          <span className="shrink-0 text-[11.5px] text-white/55">所属学科</span>
          <select
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            aria-label="选择所属学科"
            className="min-w-0 flex-1 rounded-xl px-2.5 py-1.5 text-[12px] text-white outline-none"
            style={{
              background: 'rgb(0 0 0 / .3)',
              border: courseId ? '1px solid rgb(255 255 255 / .14)' : '1px solid rgb(255 179 107 / .55)',
            }}
          >
            <option value="">— 请选择学科 —</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy || !courseId}
          aria-label="上传笔记文件"
          className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-white/22 px-3 py-3 text-left transition hover:border-white/40 hover:bg-white/6 disabled:opacity-50"
        >
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
            style={{ background: 'rgba(186,155,255,.2)', border: '1px solid rgba(186,155,255,.4)' }}
          >
            <IconUpload className="h-4 w-4 text-[rgb(186,155,255)]" />
          </span>
          <span className="min-w-0">
            <span className="block text-[12.5px] text-white">{busy ? '正在读取…' : '上传笔记文件'}</span>
            <span className="mt-0.5 block text-[10.5px] leading-snug text-white/55">
              {courseId ? '点这里选文件，或把文件（也可整个文件夹）拖进来' : '先在上面选好学科，才能上传'}
              <br />
              PDF / 图片 / Markdown / Word / 代码 / 文本可站内查看
            </span>
          </span>
        </button>

        <button
          onClick={() => dirRef.current?.click()}
          disabled={busy || !courseId}
          aria-label="上传整个笔记文件夹"
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-[11.5px] text-ink-dim transition hover:border-white/28 hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          选择整个文件夹
          <span className="text-white/35">（会跳过不支持的类型）</span>
        </button>

        {!!items.length && (
          <button
            onClick={() => setClearOpen(true)}
            disabled={busy}
            aria-label="清空笔记文件"
            className="mt-2 w-full rounded-xl px-3 py-1.5 text-[11px] text-rose-200/70 transition hover:bg-rose-400/10 hover:text-rose-100 disabled:opacity-40"
          >
            清空笔记文件（{items.length} 个）
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void addFiles(e.target.files)}
          aria-label="选择笔记文件"
        />
        <input
          ref={dirRef}
          type="file"
          multiple
          // @ts-expect-error webkitdirectory 不在 React 的 input 类型里
          webkitdirectory=""
          directory=""
          className="hidden"
          onChange={(e) => void addFiles(e.target.files)}
          aria-label="选择笔记文件夹"
        />
      </div>

      {err && (
        <div
          className="mb-3 rounded-xl px-3 py-2 text-[11.5px]"
          style={{ background: 'rgba(255,120,120,.16)', color: '#ffb3b3' }}
          role="alert"
        >
          {err}
        </div>
      )}
      {notice && (
        <div
          className="mb-3 rounded-xl px-3 py-2 text-[11.5px]"
          style={{ background: 'rgba(126,214,190,.16)', color: '#bfeee0' }}
          role="status"
        >
          {notice}
        </div>
      )}

      {loading && <div className="py-6 text-center text-[12px] text-ink-faint">正在读取…</div>}

      {!loading && !items.length && (
        <div className="mat-clear rounded-2xl px-4 py-8 text-center text-[12px] leading-relaxed text-white/55">
          还没有笔记文件
          <br />
          把课件、讲义、整理好的 Markdown 传进来
        </div>
      )}

      {/* 文件列表：散装文件平铺；文件夹只占一行，点开才看里面。
         传一个文件夹常带几十个文件，全摊开就没法看了。 */}
      {(!!grouped.loose.length || !!grouped.folders.length) && (
        <ul className="grid gap-2 @2xl:grid-cols-2">
          {grouped.loose.map((it) => (
            <FileChip key={it.id} item={it} courses={courses} onDelete={del} />
          ))}

          {grouped.folders.map(([name, list]) => {
            const open = openFolders.has(name)
            return (
              <li key={name} className={open ? '@2xl:col-span-2' : ''}>
                <div className="mat-clear spec overflow-hidden rounded-2xl">
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <button
                      onClick={() => toggleFolder(name)}
                      aria-label={`${open ? '收起' : '展开'}文件夹 ${name}`}
                      aria-expanded={open}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-[10px] text-white transition-transform"
                        style={{ background: 'rgb(186 155 255 / .28)', transform: open ? 'rotate(90deg)' : 'none' }}
                        aria-hidden
                      >
                        ▸
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-semibold text-white" title={name}>
                          {name}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-white/40">
                          {list.length} 个文件 · {courses.find((c) => c.id === list[0]?.courseId)?.name ?? '未归类'}
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        const snapshot = items
                        setItems((p) => p.filter((x) => !list.some((y) => y.id === x.id)))
                        void Promise.all(list.map((x) => store.remove(x.id)))
                          .then(() => onChanged?.())
                          .catch((e) => {
                            setItems(snapshot)
                            setErr(`删除失败：${errText(e)}`)
                          })
                      }}
                      aria-label={`删除文件夹 ${name}`}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[13px] leading-none text-white/35 transition hover:bg-white/10 hover:text-white"
                      title="删除整个文件夹"
                    >
                      ✕
                    </button>
                  </div>

                  {open && (
                    <ul className="ml-3 space-y-1 border-t border-white/8 px-2 py-2">
                      {list.map((it) => (
                        <li key={it.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/5">
                          <IconFile className="h-3.5 w-3.5 shrink-0" style={{ color: `rgb(${kindRgb[it.kind]})` }} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] text-white/88" title={it.name}>
                              {it.name}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-white/35">
                              {(it.folder ?? '').split('/').slice(1).join('/') || '（根目录）'} · {it.size}
                            </span>
                          </span>
                          <button
                            onClick={() => del(it.id)}
                            aria-label={`删除笔记 ${it.name}`}
                            className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[12px] leading-none text-white/30 transition hover:bg-white/10 hover:text-white"
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={clearOpen}
        title="清空笔记文件？"
        message={`将删除这里的全部 ${items.length} 个文件，包括它们在本机磁盘上的副本。`}
        detail="此操作不可撤销。手写的笔记不受影响。"
        confirmText={`删除全部 ${items.length} 个`}
        onConfirm={() => void clearAll()}
        onCancel={() => setClearOpen(false)}
      />
    </section>
  )
}
