/**
 * 文件库的持久化 —— **走后端**。
 *
 * 这一版把原来的 IndexedDB 实现整体换成了 API 调用。之所以能换得这么干净，
 * 是因为上层（QuestionBankView）只依赖这里的函数名与返回形状，
 * 不关心底下是浏览器本地存储还是服务端磁盘。
 *
 * 与 IndexedDB 版的本质差别：
 *  · 数据在**服务器磁盘**上，换浏览器、换设备、清浏览器数据都不丢。
 *  · 文件不再需要 blob URL —— 直接用 /api/files/:id/raw，
 *    浏览器原生支持 Range，PDF 能翻页预载、视频能拖进度条。
 *  · 因此也不再需要 revokeObjectURL 那套内存管理。
 */

import { api } from './api'
import { fmtBytes, kindLabel, type VaultItem, type VaultKind } from './vault'

/** 后端返回的文件行 */
export interface ServerFile {
  id: string
  name: string
  kind: string
  mime: string
  bytes: number
  scope: string
  courseId: string
  note: string
  /** 所属文件夹（相对根目录），空串 = 散装文件 */
  folder: string
  createdAt: number
  url: string
}

/* 'note' = 笔记文件。和题库共用一张 files 表，靠 scope 区分 ——
   附件、配额、磁盘清理、归属校验全都现成，不必另起一套。 */
export type Scope = 'qbank' | 'note' | 'todo' | 'idea' | 'avatar'

const toItem = (f: ServerFile): VaultItem => ({
  id: f.id,
  name: f.name,
  kind: (f.kind as VaultKind) ?? 'other',
  bytes: f.bytes,
  size: fmtBytes(f.bytes),
  at: new Date(f.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
  /* 原始时间戳也带上：排序 /"本周新增"这类计算要用（`at` 只是给人看的字符串） */
  createdAt: f.createdAt,
  courseId: f.courseId ?? '',
  note: f.note ?? '',
  folder: f.folder ?? '',
  url: f.url,
  /* .doc（老二进制格式）mammoth 解不了，别让它显示成"可预览"却打不开 ——
     所以 docx 这一类还要看扩展名 */
  viewable:
    ['pdf', 'image', 'markdown', 'code', 'text', 'sheet'].includes(f.kind) ||
    (f.kind === 'docx' && /\.docx$/i.test(f.name)),
})

/** 后端是否可用 —— 不可用时上层要给用户明确提示，而不是静默失败 */
export async function available(): Promise<boolean> {
  try {
    await api.get('/health')
    return true
  } catch {
    return false
  }
}

export async function loadAll(scope: Scope = 'qbank'): Promise<VaultItem[]> {
  const d = await api.get<{ files: ServerFile[] }>(`/files?scope=${encodeURIComponent(scope)}`)
  return d.files.map(toItem)
}

/**
 * 生成一个「一次上传动作」的批次键。
 *
 * 为什么需要它：上传是**逐个文件**发请求的（一个失败不影响其它，失败原因
 * 也能逐个报出来），所以服务端分不出"19 个文件一次传的"和"他传了 19 次"。
 * 在一次用户动作开始时调一次这个函数，同批的每个文件都带上同一个键，
 * 服务端就只记一次 push（热力图的"一次上传 = 一次 push"）。
 */
export const newBatchKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

/** 上传一个文件，返回可直接渲染的条目 */
export async function upload(
  file: File,
  opts: { scope?: Scope; courseId?: string; note?: string; folder?: string; batchKey?: string } = {},
): Promise<VaultItem> {
  const form = new FormData()
  // 第三个参数是**显式文件名**：不传的话 FormData 会用字段名 'files' 当文件名，
  // 扩展名就没了，后端按扩展名判类型会直接拒掉。
  form.append('files', file, file.name)
  form.append('scope', opts.scope ?? 'qbank')
  if (opts.courseId) form.append('courseId', opts.courseId)
  if (opts.note) form.append('note', opts.note)
  if (opts.folder) form.append('folder', opts.folder)
  if (opts.batchKey) form.append('batchKey', opts.batchKey)
  const d = await api.upload<{ files: ServerFile[] }>('/files', form)
  const first = d.files[0]
  if (!first) throw new Error('服务器没有返回上传结果')
  return toItem(first)
}

export const remove = (id: string) => api.del<{ done: boolean }>(`/files/${encodeURIComponent(id)}`)

/**
 * 清空某个范围的全部文件。
 * 服务端会**连磁盘文件一起删**，也会跳过被灵感/待办引用的那些 ——
 * 否则清一次题库，灵感里的配图就变成裂图。
 */
export const clearAll = (scope: Scope = 'qbank') =>
  api.del<{ removed: number; scope: string }>(`/files?scope=${encodeURIComponent(scope)}`)

export const updateMeta = (id: string, patch: { note?: string; courseId?: string }) =>
  api.patch<{ done: boolean }>(`/files/${encodeURIComponent(id)}`, patch)

export { kindLabel }
