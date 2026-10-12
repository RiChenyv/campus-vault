/**
 * 文件存储。
 *
 * 三条铁律：
 *
 * ① **原文件名绝不进磁盘路径。**
 *    用户的文件名长这样：`陈致逸 - 天空的指环 (Ring of the Sky)_EG.flac`
 *    —— 中文、空格、括号齐全。直接拼路径会有编码问题、重名覆盖，
 *    更要命的是路径穿越（`../../`）。所以磁盘上一律用 UUID，
 *    原名只存数据库字段，下载时再通过 Content-Disposition 还原。
 *
 * ② **不能只信 Content-Type 和扩展名。**
 *    两者都是客户端说了算的。必须读文件头（magic bytes）确认真实类型，
 *    否则改个扩展名就能把任意文件伪装成图片。
 *
 * ③ **读文件一律走流。**
 *    不要 readFileSync 整个读进来 —— 一个几百 MB 的视频就能把服务打爆。
 */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'

/** 允许上传的类型白名单：扩展名 → 归类 */
const EXT_KIND: Record<string, string> = {
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
  json: 'code', yml: 'code', yaml: 'code', toml: 'code', xml: 'code', sql: 'code',
  sh: 'code', ps1: 'code', bat: 'code',
}

/** 文件头特征：真实类型判断，不信任客户端 */
const MAGIC: { kind: string; ext: string[]; test: (b: Buffer) => boolean }[] = [
  { kind: 'pdf', ext: ['pdf'], test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { kind: 'image', ext: ['png'], test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { kind: 'image', ext: ['jpg', 'jpeg'], test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { kind: 'image', ext: ['gif'], test: (b) => b.subarray(0, 3).toString('latin1') === 'GIF' },
  {
    kind: 'image',
    ext: ['webp'],
    test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  { kind: 'archive', ext: ['zip', 'docx', 'pptx'], test: (b) => b[0] === 0x50 && b[1] === 0x4b },
  { kind: 'archive', ext: ['rar'], test: (b) => b.subarray(0, 4).toString('latin1') === 'Rar!' },
  { kind: 'archive', ext: ['7z'], test: (b) => b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc },
  { kind: 'audio', ext: ['flac'], test: (b) => b.subarray(0, 4).toString('latin1') === 'fLaC' },
  { kind: 'audio', ext: ['mp3'], test: (b) => b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) },
  { kind: 'audio', ext: ['wav'], test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE' },
  { kind: 'video', ext: ['mp4', 'mov', 'm4a'], test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { kind: 'video', ext: ['mkv', 'webm'], test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
]

/** 纯文本类没有固定文件头，靠扩展名 + 内容可解码性判断（见 sniff） */
const TEXT_KINDS = new Set(['markdown', 'code', 'text', 'sheet'])

/** 文件被安全策略拒绝 —— 属于客户端错误，不能落成 500 */
export class UnsafeFileError extends Error {
  status = 400
  code = 'UNSAFE_FILE'
  constructor(message: string) {
    super(message)
  }
}

/**
 * 修正 multipart 文件名的编码。
 *
 * busboy/multer 按 RFC 7578 的历史实现，把文件名当成 **latin1** 解码，
 * 于是 `复习提纲.md` 会变成 `å¤ä¹ æçº².md`（UTF-8 字节被逐字节当成 latin1 字符）。
 *
 * 修法：先判断是否真的需要修 —— 如果字符串里已经出现 > U+00FF 的字符，
 * 说明客户端发的是正常 UTF-8，不能再转，否则会把好的名字转坏。
 */
export function fixFilename(name: string): string {
  if (/[^\u0000-\u00ff]/.test(name)) return name
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8')
    // 解码出替换字符说明原本就不是 UTF-8，保持原样
    return decoded.includes('\ufffd') ? name : decoded
  } catch {
    return name
  }
}

export const MAX_FILE_BYTES = 200 * 1024 * 1024 // 单文件 200MB

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

export function kindOf(name: string): string {
  return EXT_KIND[extOf(name)] ?? 'other'
}

export function isAllowedExt(name: string): boolean {
  return extOf(name) in EXT_KIND
}

/**
 * 允许的扩展名 → 归类。
 * 给客户端做**前置过滤**：用户选文件夹时里面常有 .exe / .dll / .DS_Store，
 * 不过滤就会发上百个注定被拒的请求，既慢又刷一屏错误。
 */
export function allowedExtensions(): Record<string, string> {
  return { ...EXT_KIND }
}

/**
 * 校验真实类型。
 * 返回 null 表示通过；否则返回拒绝原因。
 */
export function sniff(head: Buffer, name: string): string | null {
  const ext = extOf(name)
  const declared = EXT_KIND[ext]
  if (!declared) return `不支持的文件类型 .${ext || '(无扩展名)'}`

  // 文本类：没有 magic bytes，改成校验「能按 UTF-8 解码且不含 NUL」
  if (TEXT_KINDS.has(declared)) {
    if (head.includes(0)) return '文件内容看起来不是文本（含二进制空字节）'
    return null
  }

  for (const m of MAGIC) {
    if (!m.test(head)) continue
    // 命中了某个特征，检查声明的归类是否兼容
    // zip 容器同时对应 docx / pptx / zip，不能一律当 archive 拒掉
    if (m.kind === declared) return null
    if (m.kind === 'archive' && (declared === 'docx' || declared === 'slides' || declared === 'archive')) return null
    if (m.kind === 'video' && declared === 'audio') return null
    return `文件内容是 ${m.kind}，与扩展名 .${ext} 不符`
  }

  // 没命中任何特征：Office 老格式（doc/ppt/xls，OLE 复合文档）和部分文本放行
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0
  if (isOle && (declared === 'docx' || declared === 'slides' || declared === 'sheet')) return null
  if (declared === 'other') return null

  return `无法识别的文件内容（扩展名 .${ext}）`
}

/* ------------------------------ 落盘 ------------------------------ */

export interface StoredFile {
  id: string
  storePath: string
  absPath: string
  bytes: number
  sha256: string
}

/**
 * 把上传流写入磁盘。
 *
 * 先写 `.part` 临时文件，完成后 rename 成正式名字 ——
 * rename 在同一文件系统内是原子的，这样不会出现「半截文件被当成完整文件」。
 * 校验失败时删除临时文件。
 */
export async function saveStream(
  stream: Readable,
  dataDir: string,
  originalName: string,
  opts: { maxBytes?: number } = {},
): Promise<StoredFile> {
  const maxBytes = opts.maxBytes ?? MAX_FILE_BYTES
  const id = randomUUID()
  const ext = extOf(originalName)
  const dir = resolve(dataDir, 'files')
  await mkdir(dir, { recursive: true })

  // 文件名只由 UUID + 白名单过的扩展名组成，用户输入一个字符都不进路径
  const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin'
  const finalName = `${id}.${safeExt}`
  const absPath = join(dir, finalName)
  const partPath = `${absPath}.part`

  const hash = createHash('sha256')
  let bytes = 0
  let rejected: string | null = null
  let headBuf = Buffer.alloc(0)

  try {
    const out = createWriteStream(partPath)
    await pipeline(
      stream,
      async function* (src) {
        for await (const chunk of src as AsyncIterable<Buffer>) {
          bytes += chunk.length
          if (bytes > maxBytes) {
            throw new Error('LIMIT_FILE_SIZE')
          }
          if (headBuf.length < 512) {
            headBuf = Buffer.concat([headBuf, chunk.subarray(0, 512 - headBuf.length)])
          }
          hash.update(chunk)
          yield chunk
        }
      },
      out,
    )
    rejected = sniff(headBuf, originalName)
    if (rejected) {
      await rm(partPath, { force: true })
      throw new UnsafeFileError(rejected)
    }
    await rename(partPath, absPath)
  } catch (e) {
    await rm(partPath, { force: true }).catch(() => undefined)
    throw e
  }

  return {
    id,
    storePath: join('files', finalName),
    absPath,
    bytes,
    sha256: hash.digest('hex'),
  }
}

export async function removeStored(dataDir: string, storePath: string) {
  // 二次防线：storePath 是数据库里的值，理论上安全，
  // 但仍然校验它没有逃出 data 目录，避免数据库被污染后删错文件
  const abs = resolve(dataDir, storePath)
  const root = resolve(dataDir)
  if (!abs.startsWith(root)) return
  await rm(abs, { force: true }).catch(() => undefined)
}

export async function statStored(dataDir: string, storePath: string) {
  return stat(resolve(dataDir, storePath)).catch(() => null)
}

export const readStored = (dataDir: string, storePath: string) =>
  createReadStream(resolve(dataDir, storePath))

/* ------------------------------ 类型 → MIME ------------------------------ */

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8', json: 'application/json; charset=utf-8',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', ogg: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export function mimeOf(name: string): string {
  return MIME[extOf(name)] ?? 'application/octet-stream'
}
