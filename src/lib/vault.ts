/**
 * 题库文件库：真实文件接收与识别。
 *
 * 与旧版「假预览」的区别：这里是**按真实文件类型分派**，
 * 文本类读出内容、二进制类建 blob URL，查看器直接渲染真东西。
 *
 * ⚠️ 纯前端阶段文件只活在内存里：
 *  · 文本类：内容存在 `text` 字段
 *  · 二进制类：`url` 是 `URL.createObjectURL` 生成的 blob URL
 *    —— 它只在当前页面会话有效，刷新即失效，且**必须在删除时 revoke**，否则内存泄漏。
 * 接后端后这两条都要换成「上传到 /api/files，返回持久 URL」。
 */

export type VaultKind =
  | 'pdf'
  | 'image'
  | 'markdown'
  | 'code'
  | 'text'
  | 'sheet'
  | 'docx'
  | 'slides'
  | 'archive'
  | 'audio'
  | 'video'
  | 'other'

export interface VaultItem {
  id: string
  name: string
  kind: VaultKind
  /** 原始字节数 */
  bytes: number
  /** 人类可读体积 */
  size: string
  /** 上传时间标签 */
  at: string
  /**
   * 上传时间的**原始毫秒时间戳**。
   *
   * 为什么除了 `at` 还要它：`at` 是给人看的字符串（`10-08 15:20`），
   * 排序、"最近 7 天"、"本周新增"这类计算都做不了。
   * 个人中心的笔记列表就按它倒序，本周计数也用它。
   */
  createdAt: number
  /** 归属课程 id（空 = 未归类） */
  courseId: string
  /** 用户备注 */
  note: string
  /** 所属文件夹（相对根目录）。空串 = 散装文件，不归任何文件夹 */
  folder: string
  /** 文本类文件的内容（markdown / code / text / csv） */
  text?: string
  /** 二进制文件的 blob URL（image / pdf / 其它） */
  url?: string
  /** 图片宽高比，用于占位避免跳动 */
  ratio?: number
  /** 代码高亮用的语言（从扩展名推断） */
  lang?: string
  /** 是否可站内查看 */
  viewable: boolean
}

/* ------------------------------ 类型识别 ------------------------------ */

const EXT_KIND: Record<string, VaultKind> = {
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image', avif: 'image',
  md: 'markdown', markdown: 'markdown',
  txt: 'text', log: 'text', ini: 'text', conf: 'text',
  csv: 'sheet', tsv: 'sheet',
  doc: 'docx', docx: 'docx',
  ppt: 'slides', pptx: 'slides',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  mp3: 'audio', wav: 'audio', flac: 'audio', m4a: 'audio', ogg: 'audio',
  mp4: 'video', mkv: 'video', mov: 'video', webm: 'video', avi: 'video',
  js: 'code', mjs: 'code', cjs: 'code', ts: 'code', tsx: 'code', jsx: 'code',
  py: 'code', java: 'code', c: 'code', h: 'code', cpp: 'code', cc: 'code', hpp: 'code',
  cs: 'code', go: 'code', rs: 'code', rb: 'code', php: 'code', swift: 'code', kt: 'code',
  html: 'code', htm: 'code', css: 'code', scss: 'code', less: 'code',
  json: 'code', yml: 'code', yaml: 'code', toml: 'code', xml: 'code', sql: 'code', sh: 'code', ps1: 'code', bat: 'code',
}

/** 扩展名 → 高亮语言（highlight() 用） */
const EXT_LANG: Record<string, string> = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js',
  ts: 'ts', tsx: 'ts',
  py: 'py', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  cs: 'cs', go: 'go', rs: 'rs', rb: 'rb', php: 'php', swift: 'swift', kt: 'kt',
  html: 'html', htm: 'html', css: 'css', scss: 'css', less: 'css',
  json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml',
  sql: 'sql', sh: 'sh', ps1: 'sh', bat: 'sh',
}

const extOf = (name: string) => {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

export function detectKind(file: File): VaultKind {
  const ext = extOf(file.name)
  if (EXT_KIND[ext]) return EXT_KIND[ext]
  const m = file.type || ''
  if (m === 'application/pdf') return 'pdf'
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('text/')) return 'text'
  if (m.includes('word')) return 'docx'
  if (m.includes('presentation')) return 'slides'
  if (m.includes('spreadsheet') || m.includes('excel')) return 'sheet'
  if (m.includes('zip') || m.includes('compressed')) return 'archive'
  return 'other'
}

/** 能在站内直接读出来的类型 */
/* docx 现在能站内看了（mammoth 转 HTML，见 FileViewer）。
   注意只有 **.docx** 行 —— .doc 是老二进制格式，mammoth 不支持，
   那个仍然只能下载。所以「能不能看」还要看扩展名，光看 kind 不够。 */
export const VIEWABLE: VaultKind[] = ['pdf', 'image', 'markdown', 'code', 'text', 'sheet', 'docx']

const MAX_TEXT = 2 * 1024 * 1024 // 超过 2MB 的文本不内联，避免卡死

export const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`

export const nowLabel = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export const kindLabel: Record<VaultKind, string> = {
  pdf: 'PDF', image: '图片', markdown: 'Markdown', code: '代码', text: '文本',
  sheet: '表格', docx: 'Word', slides: 'PPT', archive: '压缩包',
  audio: '音频', video: '视频', other: '文件',
}

/** 类型徽标配色 */
export const kindRgb: Record<VaultKind, string> = {
  pdf: '255 143 177', image: '142 224 106', markdown: '143 178 255',
  code: '92 214 190', text: '160 170 200', sheet: '126 224 160',
  docx: '196 148 255', slides: '255 179 107', archive: '160 170 200',
  audio: '255 214 107', video: '111 156 255', other: '160 170 200',
}

/* ------------------------------ 接收文件 ------------------------------ */

const readText = (f: File) =>
  new Promise<string>((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result))
    fr.onerror = () => rej(new Error('读取失败'))
    fr.readAsText(f, 'utf-8')
  })

const imgRatio = (url: string) =>
  new Promise<number>((res) => {
    const img = new Image()
    img.onload = () => res(img.naturalWidth / Math.max(1, img.naturalHeight))
    img.onerror = () => res(1)
    img.src = url
  })

let seq = 0
const nextId = () => `v${Date.now().toString(36)}${(seq++).toString(36)}`

/** 把一个 File 转成可查看的 VaultItem */
export async function intake(file: File, courseId = ''): Promise<VaultItem> {
  const kind = detectKind(file)
  const base: VaultItem = {
    id: nextId(),
    name: file.name,
    kind,
    // 本地临时文件不属于任何文件夹；上传后由服务端决定归属
    folder: '',
    bytes: file.size,
    size: fmtBytes(file.size),
    at: nowLabel(),
    // 刚从本地选中的文件，"现在"就是它的时间
    createdAt: Date.now(),
    courseId,
    note: '',
    lang: EXT_LANG[extOf(file.name)],
    viewable: VIEWABLE.includes(kind),
  }

  // 文本类：读成字符串
  if (kind === 'markdown' || kind === 'code' || kind === 'text' || kind === 'sheet') {
    if (file.size > MAX_TEXT) return { ...base, viewable: false }
    try {
      return { ...base, text: await readText(file) }
    } catch {
      return { ...base, viewable: false }
    }
  }

  // 二进制类：建 blob URL
  const url = URL.createObjectURL(file)
  if (kind === 'image') {
    return { ...base, url, ratio: await imgRatio(url) }
  }
  return { ...base, url }
}

/**
 * 从 IndexedDB 记录还原成可查看的 VaultItem。
 *
 * 关键点：**blob URL 不能持久化**（它只在创建它的那次页面会话里有效），
 * 所以存的是原始 Blob，每次进页面时重新 `createObjectURL` 生成新 URL。
 * 这也是必须在卸载时 revoke 的原因 —— 否则每次进出页面都会漏一个 URL。
 */
export async function revive(rec: {
  id: string
  name: string
  kind: string
  bytes: number
  size: string
  at: string
  createdAt?: number
  courseId: string
  note: string
  lang?: string
  ratio?: number
  viewable: boolean
  text?: string
  blob?: Blob
}): Promise<VaultItem> {
  const base: VaultItem = {
    id: rec.id,
    name: rec.name,
    kind: rec.kind as VaultKind,
    folder: '',
    bytes: rec.bytes,
    size: rec.size,
    at: rec.at,
    /* 旧记录里没有这个字段（那时列表只显示格式化时间），
       回落到 0 —— 排序时自然沉到最后，不会假装是"刚刚上传的" */
    createdAt: rec.createdAt ?? 0,
    courseId: rec.courseId,
    note: rec.note,
    lang: rec.lang,
    viewable: rec.viewable,
  }
  if (rec.text != null) return { ...base, text: rec.text }
  if (rec.blob) {
    const url = URL.createObjectURL(rec.blob)
    // 旧的记录可能没存宽高比，补算一次，避免布局跳动
    const ratio = rec.ratio ?? (base.kind === 'image' ? await imgRatio(url) : undefined)
    return { ...base, url, ratio }
  }
  return { ...base, viewable: false }
}

/** 把 VaultItem + 原始文件打包成可入库的记录 */
export function toRecord(item: VaultItem, file?: File) {
  const isText = item.text != null
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    bytes: item.bytes,
    size: item.size,
    at: item.at,
    createdAt: item.createdAt,
    courseId: item.courseId,
    note: item.note,
    lang: item.lang,
    ratio: item.ratio,
    viewable: item.viewable,
    text: item.text,
    // 文本类的原文已在 text 里，不必再存一份 Blob
    blob: isText ? undefined : file,
    savedAt: Date.now(),
  }
}

/** 删除时释放 blob URL，否则内存会一直涨 */
export function release(item: VaultItem) {
  if (item.url?.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(item.url)
    } catch {
      /* ignore */
    }
  }
}

/** 触发浏览器下载（原型阶段就是"另存为"） */
export function download(item: VaultItem) {
  const a = document.createElement('a')
  a.href = item.url ?? `data:text/plain;charset=utf-8,${encodeURIComponent(item.text ?? '')}`
  a.download = item.name
  document.body.appendChild(a)
  a.click()
  a.remove()
}
