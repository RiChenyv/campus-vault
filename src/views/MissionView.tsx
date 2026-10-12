import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COURSES } from '../data/mock'
import ConfirmDialog from '../components/ConfirmDialog'
import { AttachedImageBox, GlassX } from '../components/ImagePad'
import { IconCheck, IconFile, IconFlame, IconImage, IconTrash } from '../components/Icons'
import { bytesOfDataUrl, fileToImage, imageFromClipboard, type AttachedImage } from '../lib/image'
import { setSpot } from '../lib/utils'
import * as dataApi from '../lib/dataApi'
import { errText } from '../lib/api'
import type { Todo, TodoAttachment } from '../types'

const EASE = [0.22, 1, 0.36, 1] as const

/** 非图片附件的分类：只影响徽标文字，不解析内容 */
const KIND_OF = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['pdf'].includes(ext)) return 'PDF'
  if (['md', 'txt'].includes(ext)) return 'MD'
  if (['doc', 'docx'].includes(ext)) return 'DOC'
  if (['ppt', 'pptx'].includes(ext)) return 'PPT'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'XLS'
  if (['py', 'js', 'ts', 'java', 'cpp', 'c', 'html', 'css', 'json'].includes(ext)) return 'CODE'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'ZIP'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) return 'IMG'
  return 'FILE'
}

const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`

const toneOf = (t: Todo['dueTone']) =>
  t === 'danger' ? '#ff8f8f' : t === 'warn' ? '#ffc07a' : '#9aa1c2'

/* ------------------------------------------------------------------ */
/*                              任务卡片                               */
/* ------------------------------------------------------------------ */
function TodoCard({
  t,
  onToggle,
  onDelete,
  onZoom,
  done,
}: {
  t: Todo
  onToggle: () => void
  onDelete: () => void
  onZoom: (a: { dataUrl: string; name: string }) => void
  done: boolean
}) {
  const c = COURSES.find((x) => x.id === t.courseId)
  const [confirm, setConfirm] = useState(false)
  const images = (t.attachments ?? []).filter((a) => a.kind === 'image')
  const files = (t.attachments ?? []).filter((a) => a.kind === 'file')

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      transition={{ duration: 0.34, ease: EASE }}
      onMouseMove={setSpot}
      className="mat-clear spec group relative rounded-3xl p-4"
      style={{ borderColor: done ? 'rgba(126,224,160,.28)' : `rgb(${c?.rgb ?? '143 178 255'} / .3)` }}
    >
      {/* 删除：两步确认 */}
      <div className="absolute right-3 top-3 z-10">
        {confirm ? (
          <div className="flex items-center gap-1.5 rounded-full border border-red-300/40 bg-[#1b0f14]/85 px-2 py-1 backdrop-blur-sm">
            <span className="text-[10.5px] text-red-200">删除？</span>
            <button
              onClick={onDelete}
              className="rounded-full bg-red-400/25 px-2 py-0.5 text-[10.5px] text-red-100 transition hover:bg-red-400/40"
              aria-label="确认删除这个任务"
            >
              确认
            </button>
            <button
              onClick={() => setConfirm(false)}
              className="rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] text-white/80 transition hover:bg-white/20"
              aria-label="取消删除"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            aria-label={`删除任务：${t.title.slice(0, 12)}`}
            title="删除"
            className="grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-[#0b0d18]/60 text-white/70 opacity-0 backdrop-blur-sm transition hover:border-red-300/50 hover:bg-[#1b0f14]/85 hover:text-red-200 focus:opacity-100 group-hover:opacity-100"
          >
            <IconTrash className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          aria-label={done ? `把「${t.title}」标记为未完成` : `把「${t.title}」标记为已完成`}
          className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition"
          style={{
            borderColor: done ? 'transparent' : 'rgba(255,255,255,.35)',
            background: done ? 'linear-gradient(140deg,#5cd6be,#8fb2ff)' : 'transparent',
          }}
        >
          {done && <IconCheck className="h-3.5 w-3.5" style={{ color: '#08111a' }} />}
        </button>

        <div className="min-w-0 flex-1 pr-7">
          <p
            className="text-[13.5px] leading-snug"
            style={{ color: done ? '#9aa1c2' : '#fff', textDecoration: done ? 'line-through' : 'none' }}
          >
            {t.title}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-white/60">
            {c && (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: `rgb(${c.rgb})` }} />
                {c.name}
              </span>
            )}
            <span style={{ color: done ? '#9aa1c2' : toneOf(t.dueTone) }}>{t.due}</span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[9.5px]"
              style={{
                background: t.priority === '高' ? 'rgba(255,120,120,.18)' : 'rgba(255,255,255,.07)',
                color: t.priority === '高' ? '#ff9c9c' : '#9aa1c2',
              }}
            >
              {t.priority}优先
            </span>
            {done && <span className="text-[10.5px] text-[#7ee0a0]">已完成</span>}
          </div>
        </div>
      </div>

      {/* 图片附件：直接内嵌可见 */}
      {images.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {images.map((a, i) =>
            a.kind === 'image' ? (
              <button
                key={i}
                onClick={() => onZoom({ dataUrl: a.dataUrl, name: a.name })}
                className="overflow-hidden rounded-2xl border border-white/15 transition hover:border-white/35"
                style={{ width: images.length === 1 ? '100%' : 148, aspectRatio: String(a.ratio) }}
                aria-label={`查看大图：${a.name}`}
              >
                <img src={a.dataUrl} alt={a.name} className="h-full w-full object-cover" draggable={false} />
              </button>
            ) : null,
          )}
        </div>
      )}

      {/* 文件附件：胶囊 */}
      {files.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {files.map((a, i) =>
            a.kind === 'file' ? (
              <li
                key={i}
                className="flex max-w-full items-center gap-2 rounded-xl border border-white/12 bg-white/6 px-2.5 py-1.5"
                title={a.name}
              >
                <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] text-white/70">
                  {KIND_OF(a.name)}
                </span>
                <span className="min-w-0 max-w-[180px] truncate text-[11.5px] text-white/85">{a.name}</span>
                <span className="shrink-0 text-[10px] text-white/45">{fmtBytes(a.bytes)}</span>
              </li>
            ) : null,
          )}
        </ul>
      )}
    </motion.li>
  )
}

/* ------------------------------------------------------------------ */
/*                              主视图                                 */
/* ------------------------------------------------------------------ */
export default function MissionView() {
  const [items, setItems] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [draftImgs, setDraftImgs] = useState<AttachedImage[]>([])
  // 存原始 File 而不是 {name,bytes} —— 上传需要真实字节，只留元数据传不上去
  const [draftFiles, setDraftFiles] = useState<File[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState<{ dataUrl: string; name: string } | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const imgRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const pending = items.filter((t) => !t.done)
  const completed = items.filter((t) => t.done)

  /* 进页面时从服务端拉取。原来是 useState(TODOS) —— 假数据在内存里，刷新即丢。 */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const rows = await dataApi.todos.list()
        if (alive) setItems(rows)
      } catch (e) {
        if (alive) setErr(errText(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const attachImage = async (f?: File | Blob | null) => {
    if (!f) return
    setBusy(true)
    setErr(null)
    try {
      const img = await fileToImage(f)
      setDraftImgs((p) => [...p, img])
    } catch (e) {
      setErr(e instanceof Error ? e.message : '处理图片失败')
    } finally {
      setBusy(false)
      if (imgRef.current) imgRef.current.value = ''
    }
  }

  const attachFiles = (list?: FileList | null) => {
    if (!list?.length) return
    setDraftFiles((p) => [...p, ...Array.from(list)])
    if (fileRef.current) fileRef.current.value = ''
  }

  const add = async () => {
    const title = text.trim()
    if (!title) return
    setBusy(true)
    setErr(null)
    try {
      // 图片与文件都先上传成服务器文件，再连同标题建待办
      const uploads: { blob: Blob; name: string }[] = []
      for (const i of draftImgs) {
        uploads.push({ blob: await (await fetch(i.dataUrl)).blob(), name: i.name })
      }
      for (const f of draftFiles) uploads.push({ blob: f, name: f.name })

      const created = await dataApi.todos.create(title, uploads)
      setItems((p) => [created, ...p])
      setText('')
      setDraftImgs([])
      setDraftFiles([])
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (id: string) => {
    const cur = items.find((t) => t.id === id)
    if (!cur) return
    const next = !cur.done
    // 乐观更新：先翻转，失败再翻回来
    setItems((p) => p.map((t) => (t.id === id ? { ...t, done: next } : t)))
    try {
      await dataApi.todos.setDone(id, next)
    } catch (e) {
      setItems((p) => p.map((t) => (t.id === id ? { ...t, done: cur.done } : t)))
      setErr(`更新失败：${errText(e)}`)
    }
  }

  const remove = async (id: string) => {
    const snapshot = items
    setItems((p) => p.filter((t) => t.id !== id))
    try {
      await dataApi.todos.remove(id)
    } catch (e) {
      setItems(snapshot)
      setErr(`删除失败：${errText(e)}`)
    }
  }

  /** 清空全部待办。服务端会连带回退"完成待办"产生的 push 并回收附件 */
  const clearAll = async () => {
    const snapshot = items
    setClearOpen(false)
    setItems([])
    try {
      await dataApi.todos.clearAll()
    } catch (e) {
      setItems(snapshot)
      setErr(`清空失败：${errText(e)}`)
    }
  }

  const attachmentCount = items.reduce((n, t) => n + (t.attachments?.length ?? 0), 0)

  const totalBytes = draftImgs.reduce((n, i) => n + i.bytes, 0)

  return (
    <div className="grid h-full min-h-0 gap-6 lg:grid-cols-[minmax(0,880px)_minmax(0,520px)]">
      {/* ========================= 左：待办内容 ========================= */}
      <section className="flex min-h-0 flex-col" aria-label="待办内容">
        <div className="mb-3 flex items-baseline gap-2.5">
          <h3 className="font-cn-title flex items-center gap-2 text-[15px] font-semibold text-white">
            <IconCheck className="h-4 w-4 text-[rgb(255,179,107)]" />
            待办内容
          </h3>
          <span className="text-[11.5px] text-ink-faint">还没完成的 · {pending.length} 项</span>

          {/* 清空全部：空列表时不显示，避免摆一个没用的删除按钮 */}
          {items.length > 0 && (
            <button
              onClick={() => setClearOpen(true)}
              className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-white/14 bg-white/6 px-3 py-1.5 text-[11.5px] text-white/70 transition hover:border-red-300/50 hover:bg-red-400/12 hover:text-red-200"
              aria-label="清空全部待办"
              title={`清空全部 ${items.length} 项待办`}
            >
              <IconTrash className="h-3.5 w-3.5" />
              清空
            </button>
          )}
        </div>

        {/* 新建任务：文本 + 图片 + 文件 */}
        <div
          className="mat-clear mb-4 rounded-3xl p-3"
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={(e) => {
            e.preventDefault()
            const img = imageFromClipboard(e.dataTransfer)
            if (img) void attachImage(img)
            else attachFiles(e.dataTransfer.files)
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
            onPaste={(e) => {
              const f = imageFromClipboard(e.clipboardData)
              if (f) {
                e.preventDefault()
                void attachImage(f)
              }
            }}
            placeholder="要完成什么？回车添加 · 可粘贴或拖入图片 / 文件"
            className="w-full bg-transparent px-2 py-1.5 text-[13.5px] text-white outline-none placeholder:text-[#e8ecf7]/85"
            aria-label="新建任务"
          />

          {(draftImgs.length > 0 || draftFiles.length > 0) && (
            <div className="mt-2 space-y-2">
              {draftImgs.map((im, i) => (
                <AttachedImageBox
                  key={i}
                  dataUrl={im.dataUrl}
                  ratio={im.ratio}
                  name={im.name}
                  bytes={im.bytes}
                  onRemove={() => setDraftImgs((p) => p.filter((_, k) => k !== i))}
                />
              ))}
              {draftFiles.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {draftFiles.map((f, i) => (
                    <li
                      key={i}
                      className="flex max-w-full items-center gap-2 rounded-xl border border-white/12 bg-white/6 px-2.5 py-1.5"
                    >
                      <IconFile className="h-3.5 w-3.5 shrink-0 text-white/60" />
                      <span className="min-w-0 max-w-[170px] truncate text-[11.5px] text-white/85">{f.name}</span>
                      <span className="shrink-0 text-[10px] text-white/45">{fmtBytes(f.size)}</span>
                      <GlassX
                        onClick={() => setDraftFiles((p) => p.filter((_, k) => k !== i))}
                        label="移除文件"
                        size={18}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2 px-2">
            <button
              onClick={() => imgRef.current?.click()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-[11.5px] text-white/80 transition hover:bg-white/14 hover:text-white disabled:opacity-50"
            >
              <IconImage className="h-3.5 w-3.5" />
              {busy ? '处理中…' : '添加图片'}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-[11.5px] text-white/80 transition hover:bg-white/14 hover:text-white"
            >
              <IconFile className="h-3.5 w-3.5" />
              添加文件
            </button>

            <button
              onClick={add}
              disabled={!text.trim()}
              className="ml-auto flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-medium transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
              style={{
                background: 'rgba(255,179,107,.2)',
                color: 'rgb(255,179,107)',
                border: '1px solid rgba(255,179,107,.4)',
              }}
            >
              <IconCheck className="h-4 w-4" />
              加入待办
            </button>
          </div>

          <div className="mt-1.5 px-2 text-[10.5px] leading-snug text-[#dfe3f0]/90">
            数据保存在服务器 · 换设备也能看到
            {totalBytes > 0 ? ` · 图片共 ${fmtBytes(totalBytes)}` : ''}
          </div>

          <input
            ref={imgRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => {
              for (const f of Array.from(e.target.files ?? [])) void attachImage(f)
            }}
          />
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => attachFiles(e.target.files)} />

          {err && (
            <div
              className="mt-2 rounded-xl px-3 py-2 text-[11.5px]"
              style={{ background: 'rgba(255,120,120,.16)', color: '#ffb3b3' }}
              role="alert"
            >
              {err}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          <ul className="space-y-3">
            <AnimatePresence initial={false}>
              {pending.map((t) => (
                <TodoCard
                  key={t.id}
                  t={t}
                  done={false}
                  onToggle={() => toggle(t.id)}
                  onDelete={() => remove(t.id)}
                  onZoom={setZoom}
                />
              ))}
            </AnimatePresence>
          </ul>
          {!pending.length && (
            <div className="mat-clear rounded-3xl px-6 py-12 text-center text-[13px] text-white/70">
              待办清空了 —— 去右侧看看已经登顶的
            </div>
          )}
        </div>
      </section>

      {/* ========================= 右：攀升之路 ========================= */}
      <section className="flex min-h-0 flex-col" aria-label="攀升之路">
        <div className="mb-3 flex items-baseline gap-2.5">
          <h3 className="font-cn-title flex items-center gap-2 text-[15px] font-semibold text-white">
            <IconFlame className="h-4 w-4 text-[rgb(126,224,160)]" />
            攀升之路
          </h3>
          <span className="text-[11.5px] text-ink-faint">
            已完成 · {completed.length} 项
            {items.length ? ` · 完成率 ${Math.round((completed.length / items.length) * 100)}%` : ''}
          </span>
        </div>

        {/* 攀升进度条：视觉上把"已完成"当成功绩 */}
        <div className="mat-clear mb-4 rounded-3xl p-4">
          <div className="mb-2 flex items-baseline justify-between text-[11.5px]">
            <span className="text-white/70">已登顶 {completed.length} / {items.length}</span>
            <span className="text-[#7ee0a0]">
              {items.length ? Math.round((completed.length / items.length) * 100) : 0}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/12">
            <motion.div
              className="h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${items.length ? (completed.length / items.length) * 100 : 0}%` }}
              transition={{ duration: 0.8, ease: EASE }}
              style={{ background: 'linear-gradient(90deg, rgba(126,224,160,.55), rgb(126,224,160))' }}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          <ul className="space-y-3">
            <AnimatePresence initial={false}>
              {completed.map((t) => (
                <TodoCard
                  key={t.id}
                  t={t}
                  done
                  onToggle={() => toggle(t.id)}
                  onDelete={() => remove(t.id)}
                  onZoom={setZoom}
                />
              ))}
            </AnimatePresence>
          </ul>
          {!completed.length && (
            <div className="mat-clear rounded-3xl px-6 py-12 text-center text-[13px] text-white/70">
              还没有完成的任务 —— 勾掉左边一项试试
            </div>
          )}
        </div>
      </section>

      {/* 大图查看 */}
      <AnimatePresence>
        {zoom && (
          <motion.div
            className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setZoom(null)}
            role="dialog"
            aria-modal="true"
            aria-label="查看大图"
          >
            <img
              src={zoom.dataUrl}
              alt={zoom.name}
              className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="absolute right-6 top-6">
              <GlassX onClick={() => setZoom(null)} label="关闭大图" size={34} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 清空确认：说清"删多少项、其中多少带附件、热力图会回退"再让用户决定 */}
      <ConfirmDialog
        open={clearOpen}
        title="清空全部待办？"
        message={`将删除 ${items.length} 项待办（含已完成 ${completed.length} 项），此操作无法撤销。`}
        detail={
          attachmentCount > 0
            ? `其中 ${attachmentCount} 个附件会一并删除；已完成待办在热力图上产生的记录也会同步回退。`
            : '已完成待办在热力图上产生的记录也会同步回退。'
        }
        confirmText={`清空 ${items.length} 项`}
        onConfirm={() => void clearAll()}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  )
}
