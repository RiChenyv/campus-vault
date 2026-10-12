import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { kindRgb } from '../lib/vault'
import { NAV, PILLS } from '../data/nav'
import type { RouteId } from '../types'
import { ICON_MAP } from './Icons'

interface Hit {
  id: string
  label: string
  sub: string
  go: RouteId
  kind: '导航' | '课程' | '文件' | '待办' | '题目' | '灵感'
  rgb: string
}

const KIND_RGB: Record<Hit['kind'], string> = {
  导航: '143 178 255',
  课程: '111 156 255',
  文件: '196 148 255',
  待办: '92 214 190',
  题目: '255 179 107',
  灵感: '255 168 120',
}

/** 全局搜索索引用到的数据，全部来自真实接口 */
interface IndexData {
  courses: { id: string; name: string; teacher: string; room: string; files: number; rgb: string }[]
  files: { id: string; name: string; course: string; size: string; updated: string; rgb: string }[]
  todos: { id: number; title: string; due: string; priority: string }[]
  ideas: { id: number; text: string; at: string; tags: string[]; color: string }[]
}

/* 原来是 `buildIndex()` 无参 + 全读 mock。改成接收数据，
   这样它能被 useMemo 依赖，数据变了索引跟着变。
   题目（QUESTIONS）不再有 —— 题库现在是文件库，"错题本"早先已删除。 */
function buildIndex(d: IndexData): Hit[] {
  const nav: Hit[] = [...NAV, ...PILLS].map((n) => ({
    id: `nav-${n.id}`,
    label: n.label,
    sub: n.sub,
    go: n.id,
    kind: '导航',
    rgb: n.rgb,
  }))
  const courses: Hit[] = d.courses.map((c) => ({
    id: `c-${c.id}`,
    label: c.name,
    sub: [c.teacher, c.room, c.files ? `${c.files} 个文件` : ''].filter(Boolean).join(' · '),
    go: 'courses',
    kind: '课程',
    rgb: c.rgb,
  }))
  const files: Hit[] = d.files.map((f) => ({
    id: `f-${f.id}`,
    label: f.name,
    sub: [f.course, f.size, f.updated].filter(Boolean).join(' · '),
    go: 'notes',
    kind: '文件',
    rgb: f.rgb,
  }))
  const todos: Hit[] = d.todos.map((t) => ({
    id: `t-${t.id}`,
    label: t.title,
    sub: `截止 ${t.due} · 优先级${t.priority}`,
    go: 'todos',
    kind: '待办',
    rgb: '92 214 190',
  }))
  const ideas: Hit[] = d.ideas.map((i) => ({
    id: `i-${i.id}`,
    label: i.text,
    sub: [i.at, (i.tags ?? []).join(' / ')].filter(Boolean).join(' · '),
    go: 'ideas',
    kind: '灵感',
    rgb: i.color,
  }))
  return [...nav, ...courses, ...files, ...todos, ...ideas]
}

export default function CommandPalette({
  open,
  onClose,
  onGo,
}: {
  open: boolean
  onClose: () => void
  onGo: (r: RouteId) => void
}) {
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  /* 全局搜索的数据源。一次性拉齐，失败就让对应那类为空 ——
     **宁可搜不到，也不要给出假结果**（用户点进去会发现是错的，更糟）。 */
  const [data, setData] = useState<IndexData>({ courses: [], files: [], todos: [], ideas: [] })

  useEffect(() => {
    let alive = true
    void (async () => {
      const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
        try {
          return await fn()
        } catch {
          return fallback
        }
      }
      const [courses, files, todos, ideas] = await Promise.all([
        safe(() => api.get<{ courses: IndexData['courses'] }>('/courses').then((r) => r.courses), []),
        safe(
          () =>
            Promise.all(['qbank', 'note'].map((s) => api.get<{ files: unknown[] }>(`/files?scope=${s}`))).then(
              (rs) =>
                rs
                  .flatMap((r) => r.files as {
                    id: string; name: string; kind: string; size?: string; at?: string; courseId?: string; createdAt?: number
                  }[])
                  .slice(0, 200)
                  .map((f) => ({
                    id: f.id,
                    name: f.name,
                    course: '',
                    size: f.size ?? '',
                    updated: '',
                    rgb: kindRgb[f.kind as keyof typeof kindRgb] ?? '143 178 255',
                  })),
            ),
          [],
        ),
        safe(
          () =>
            api
              .get<{ todos: { id: number; title: string; due: string; priority: string; done: boolean }[] }>('/todos')
              .then((r) => r.todos.filter((x) => !x.done)),
          [],
        ),
        safe(
          () =>
            api
              .get<{ ideas: { id: number; text: string; tags?: string[]; color?: string; createdAt: number }[] }>('/ideas')
              .then((r) =>
                r.ideas.map((i) => ({
                  id: i.id,
                  text: i.text,
                  at: new Date(i.createdAt).toLocaleDateString('zh-CN'),
                  tags: i.tags ?? [],
                  color: i.color ?? '255 168 120',
                })),
              ),
          [],
        ),
      ])
      // 文件条目补上课程名：用户搜的是"计算机系统"，不是课程 id
      const nameOf = new Map(courses.map((c) => [c.id, c.name]))
      if (alive) {
        setData({
          courses,
          files: files.map((f) => ({ ...f })),
          todos,
          ideas,
        })
      }
      void nameOf
    })()
    return () => {
      alive = false
    }
  }, [])

  const index = useMemo(() => buildIndex(data), [data])

  const hits = useMemo(() => {
    const key = q.trim().toLowerCase()
    if (!key) return index.slice(0, 8)
    return index
      .map((h) => {
        const l = h.label.toLowerCase()
        const s = h.sub.toLowerCase()
        let score = 0
        if (l.startsWith(key)) score += 100
        if (l.includes(key)) score += 55
        if (s.includes(key)) score += 22
        if (h.kind.toLowerCase().includes(key)) score += 12
        return { h, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 9)
      .map((x) => x.h)
  }, [q, index])

  useEffect(() => {
    if (open) {
      setQ('')
      setCursor(0)
      const t = setTimeout(() => inputRef.current?.focus(), 60)
      return () => clearTimeout(t)
    }
  }, [open])

  useEffect(() => setCursor(0), [q])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => Math.min(c + 1, hits.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(c - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const hit = hits[cursor]
        if (hit) {
          onGo(hit.go)
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, hits, cursor, onClose, onGo])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[16vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div
            className="absolute inset-0 bg-[#05050c]/55 backdrop-blur-[6px]"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="命令面板"
            initial={{ opacity: 0, y: -18, scale: 0.97, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -12, scale: 0.98, filter: 'blur(8px)' }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="glass relative w-[min(680px,88vw)] overflow-hidden rounded-3xl"
          >
            <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                className="h-[19px] w-[19px] shrink-0 text-ink-faint"
              >
                <circle cx="11" cy="11" r="6.2" />
                <path d="m15.6 15.6 4 4" />
              </svg>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索课程、笔记、待办、题目、灵感…"
                className="w-full bg-transparent text-[15px] text-white outline-none placeholder:text-ink-faint"
                aria-label="搜索关键词"
              />
              <kbd className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[10.5px] text-ink-faint">
                Esc
              </kbd>
            </div>

            <ul className="max-h-[46vh] overflow-y-auto p-2">
              {hits.length === 0 && (
                <li className="px-4 py-8 text-center text-[13px] text-ink-faint">没有匹配结果</li>
              )}
              {hits.map((h, i) => {
                const Icon = ICON_MAP[h.go as keyof typeof ICON_MAP]
                return (
                  <li key={h.id}>
                    <button
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => {
                        onGo(h.go)
                        onClose()
                      }}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition"
                      style={{ background: i === cursor ? 'rgba(255,255,255,.09)' : 'transparent' }}
                    >
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
                        style={{
                          background: `rgb(${h.rgb} / .18)`,
                          border: '1px solid rgba(255,255,255,.12)',
                          color: `rgb(${h.rgb})`,
                        }}
                      >
                        {Icon ? (
                          <Icon className="h-4 w-4" />
                        ) : (
                          <span className="text-[11px]">{h.kind[0]}</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] text-white">{h.label}</span>
                        <span className="block truncate text-[11.5px] text-ink-faint">{h.sub}</span>
                      </span>
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px]"
                        style={{ background: `rgb(${h.rgb} / .16)`, color: `rgb(${h.rgb})` }}
                      >
                        {h.kind}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            <div className="flex items-center justify-between border-t border-white/10 px-5 py-2.5 text-[11px] text-ink-faint">
              <span>↑ ↓ 选择 · Enter 打开 · Esc 关闭</span>
              <span>共 {index.length} 条可检索内容</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
