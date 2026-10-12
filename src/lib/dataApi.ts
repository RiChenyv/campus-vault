/**
 * 灵感 / 待办 / 书签 的数据接口与**形状映射**。
 *
 * 为什么要单独一层映射：前端的展示类型（Idea / Todo / Bookmark）是原型期定下的，
 * 带了一些纯装饰字段（tags、color、priority、dueTone…），后端不该为了这些
 * 去建列。所以在这一层做双向转换 —— 视图代码几乎不用改，
 * 装饰字段用**确定性**的派生值（同样输入永远得到同样结果），
 * 而不是随机值，否则每次刷新颜色都会变。
 */

import { api } from './api'
import type { Bookmark, Idea, Todo, TodoAttachment } from '../types'

/* ------------------------------ 派生装饰值 ------------------------------ */

const PALETTE = ['143 178 255', '255 168 120', '92 214 190', '196 148 255', '255 179 107', '255 143 177']

/** 由字符串稳定地取一个下标（FNV-1a），保证同一内容每次拿到同样颜色 */
function hashIdx(s: string, mod: number): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return Math.abs(h) % mod
}

const relTime = (ms: number): string => {
  const diff = Date.now() - ms
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  const d = new Date(ms)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/* ================================ 灵感 ================================ */

interface ServerIdea {
  id: number
  text: string
  createdAt: number
  images: { id: string; name: string; kind: string; bytes: number; url: string }[]
}

const toIdea = (x: ServerIdea): Idea => ({
  id: String(x.id),
  text: x.text,
  at: relTime(x.createdAt),
  tags: ['收件箱'],
  color: PALETTE[hashIdx(String(x.id) + x.text, PALETTE.length)]!,
  image: x.images[0] ? { dataUrl: x.images[0].url, ratio: 16 / 9, name: x.images[0].name } : undefined,
})

export const ideas = {
  async list(): Promise<Idea[]> {
    const d = await api.get<{ ideas: ServerIdea[] }>('/ideas')
    return d.ideas.map(toIdea)
  },
  /**
   * 新建灵感。配图先传成文件（scope=idea）再挂到灵感上 ——
   * dataUrl 直接塞数据库会让行变得非常臃肿，且没法走 Range 与缓存。
   */
  async create(text: string, imageDataUrl?: string): Promise<Idea> {
    const fileIds: string[] = []
    if (imageDataUrl) {
      const blob = await (await fetch(imageDataUrl)).blob()
      const form = new FormData()
      form.append('files', blob, `idea-${Date.now()}.webp`)
      form.append('scope', 'idea')
      const up = await api.upload<{ files: { id: string }[] }>('/files', form)
      if (up.files[0]) fileIds.push(up.files[0].id)
    }
    const d = await api.post<{ idea: ServerIdea }>('/ideas', { text, fileIds })
    return toIdea(d.idea)
  },
  remove: (id: string) => api.del<{ done: boolean }>(`/ideas/${id}`),
  /** 清空全部灵感。服务端会一并回退热力图计数并回收配图文件 */
  clearAll: () => api.del<{ removed: number; files?: number }>('/ideas'),
}

/* ================================ 待办 ================================ */

interface ServerTodo {
  id: number
  title: string
  done: boolean
  doneAt: number | null
  createdAt: number
  attachments: { id: string; name: string; kind: string; bytes: number; url: string }[]
}

const toAttachment = (f: { id: string; name: string; kind: string; bytes: number; url: string }): TodoAttachment => {
  const isImg = f.kind === 'image'
  return isImg
    ? { kind: 'image', dataUrl: f.url, ratio: 16 / 9, name: f.name, bytes: f.bytes }
    : { kind: 'file', name: f.name, bytes: f.bytes }
}

const toTodo = (x: ServerTodo): Todo => ({
  id: String(x.id),
  title: x.title,
  // 后端没有课程/截止/优先级这几个展示字段，用中性默认值
  courseId: '',
  due: x.doneAt ? `完成于 ${relTime(x.doneAt)}` : '',
  dueTone: 'calm',
  priority: '中',
  done: x.done,
  attachments: x.attachments.map(toAttachment),
})

export const todos = {
  async list(): Promise<Todo[]> {
    const d = await api.get<{ todos: ServerTodo[] }>('/todos')
    return d.todos.map(toTodo)
  },
  /** 附件（图片 / 文件）先上传，再连同标题一起建待办 */
  async create(title: string, files: { blob: Blob; name: string }[] = []): Promise<Todo> {
    const fileIds: string[] = []
    for (const f of files) {
      const form = new FormData()
      form.append('files', f.blob, f.name)
      form.append('scope', 'todo')
      const up = await api.upload<{ files: { id: string }[] }>('/files', form)
      if (up.files[0]) fileIds.push(up.files[0].id)
    }
    const d = await api.post<{ todo: ServerTodo }>('/todos', { title, fileIds })
    return toTodo(d.todo)
  },
  setDone: (id: string, done: boolean) => api.patch<{ done: boolean }>(`/todos/${id}`, { done }),
  remove: (id: string) => api.del<{ done: boolean }>(`/todos/${id}`),
  /** 清空全部待办。服务端会一并回退"完成待办"产生的 push 并回收附件 */
  clearAll: () => api.del<{ removed: number; files?: number }>('/todos'),
}

/* ================================ 书签 ================================ */

interface ServerBookmark {
  id: number
  name: string
  url: string
  note: string
  category: string
  createdAt: number
}

const toBookmark = (x: ServerBookmark): Bookmark => ({
  id: String(x.id),
  title: x.name,
  url: x.url,
  desc: x.note,
  kind: x.category || '未分类',
  rgb: PALETTE[hashIdx(x.category || x.url, PALETTE.length)]!,
  at: relTime(x.createdAt),
})

export const bookmarks = {
  async list(): Promise<Bookmark[]> {
    const d = await api.get<{ bookmarks: ServerBookmark[] }>('/bookmarks')
    return d.bookmarks.map(toBookmark)
  },
  async create(input: { title: string; url: string; desc?: string; kind?: string }): Promise<Bookmark> {
    const d = await api.post<{ bookmark: ServerBookmark }>('/bookmarks', {
      name: input.title,
      url: input.url,
      note: input.desc ?? '',
      category: input.kind ?? '',
    })
    return toBookmark(d.bookmark)
  },
  update: (id: string, patch: { title?: string; url?: string; desc?: string; kind?: string }) =>
    api.patch<{ done: boolean }>(`/bookmarks/${id}`, {
      ...(patch.title !== undefined ? { name: patch.title } : {}),
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.desc !== undefined ? { note: patch.desc } : {}),
      ...(patch.kind !== undefined ? { category: patch.kind } : {}),
    }),
  remove: (id: string) => api.del<{ done: boolean }>(`/bookmarks/${id}`),
}

/* ============================== 活动 / 热力图 ============================== */

export const activity = {
  async heatmap(from?: number, to?: number): Promise<{ days: { date: string; count: number }[]; total: number }> {
    const qs = new URLSearchParams()
    if (from) qs.set('from', String(from))
    if (to) qs.set('to', String(to))
    const q = qs.toString()
    return api.get(`/activity${q ? '?' + q : ''}`)
  },
}
