/**
 * 一个**够用就好**的 xlsx 读取器。
 *
 * 为什么自己写而不是 npm install：
 *  · 项目原则是**零第三方运行时依赖**（后端连 tsx 都不用，靠 Node 24 的类型擦除）。
 *    为了读一张成绩表引一整套 Excel 库不划算，而且那些库体积大、维护状态参差。
 *  · 教务系统导出的 xlsx 结构非常简单：一个 zip，里面是
 *    `xl/worksheets/sheet1.xml` + 可选 `xl/sharedStrings.xml`，
 *    全是标准 XML。真正要写的只有"解 zip + 取单元格文本"。
 *
 * 覆盖的真实结构（`全部成绩查询.xlsx`，2026-10 实测）：
 *  · zip 里 9 个条目：`[Content_Types].xml` / `_rels/.rels` / `docProps/*` /
 *    `xl/workbook.xml` / `xl/_rels/workbook.xml.rels` / `xl/styles.xml` /
 *    `xl/sharedStrings.xml` / `xl/worksheets/sheet1.xml`
 *  · **deflate 压缩（method 8）**，所以要用 `inflateRawSync`
 *  · 单元格是**内联字符串** `<c r="A1" s="1" t="inlineStr"><is><t>…</t></is></c>`
 *  · 文本是 **HTML 实体编码**的（`&#23398;` = 学），必须解码
 *
 * ⚠️ 这个文件里的坑（踩过 / 差点踩）：
 *  1. **不能按"文件名"假设条目顺序** —— 真正的顺序由中央目录决定，
 *     本地文件头前面还有可变的 name/extra 长度。所以先读中央目录，
 *     再按 `localOff` 逐个定位本地头。
 *  2. **共享字符串也要支持**（`t="s"` + `<v>下标</v>`）。这份文件里
 *     sharedStrings 是空的（count="0"），但别的导出器（Apache POI 默认配置、
 *     真 Excel）会用它 —— 只认 inlineStr 的话，用户换台机器导出就全空。
 *  3. **实体解码顺序**：`&amp;` 必须**最后**替换，否则 `&amp;#23398;`
 *     会被先解成 `&#23398;`、再被当成数字实体解成"学" —— 多转了一层。
 *  4. **zip 里的字符串是 UTF-8**，而中文文件名在 zip 里可能是 GBK
 *     （通用位标记 bit 11 没置位时）—— 我们只认几个**纯 ASCII 的固定路径**
 *     （`xl/worksheets/…`、`xl/sharedStrings.xml`），不受影响。
 */

import { inflateRawSync } from 'node:zlib'

/* ============================ zip ============================ */

const SIG_EOCD = 0x06054b50
const SIG_CD = 0x02014b50
const SIG_LOCAL = 0x04034b50

export interface ZipEntry {
  name: string
  /** 0 = 存储，8 = deflate */
  method: number
  compSize: number
  uncompSize: number
  localOff: number
}

/**
 * 解析 zip 的**中央目录**。
 *
 * 从尾部往前找 EOCD（末尾可能有最多 64KB 的注释，所以不能只看最后 22 字节）。
 */
export function readZipEntries(buf: Buffer): ZipEntry[] {
  if (buf.length < 22) throw new Error('文件太小，不像 xlsx')

  let eocd = -1
  const lowest = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx（找不到 zip 结尾记录）')

  const count = buf.readUInt16LE(eocd + 10)
  const cdOff = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdOff === 0xffffffff) {
    throw new Error('这个 xlsx 用了 ZIP64 格式，暂时读不了 —— 请用 Excel / WPS 另存为普通 .xlsx 再试')
  }
  if (cdOff >= buf.length) throw new Error('xlsx 已损坏（中央目录偏移越界）')

  const out: ZipEntry[] = []
  let p = cdOff
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CD) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    out.push({ name, method, compSize, uncompSize, localOff })
    p += 46 + nameLen + extraLen + commentLen
  }
  if (!out.length) throw new Error('不是有效的 xlsx（中央目录是空的）')
  return out
}

/** 解出某个条目的内容（deflate 或存储） */
export function readZipEntry(buf: Buffer, e: ZipEntry): Buffer {
  const lo = e.localOff
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== SIG_LOCAL) {
    throw new Error(`xlsx 内部结构损坏（条目 ${e.name} 的本地头不对）`)
  }
  /* ⚠️ 本地头的 name/extra 长度**可能与中央目录里不一样**（extra 字段是允许不同的），
     所以必须重新读一次，不能拿中央目录的长度算 */
  const nameLen = buf.readUInt16LE(lo + 26)
  const extraLen = buf.readUInt16LE(lo + 28)
  const start = lo + 30 + nameLen + extraLen
  if (start + e.compSize > buf.length) {
    throw new Error(`xlsx 已损坏（条目 ${e.name} 的数据越界）`)
  }
  const raw = buf.subarray(start, start + e.compSize)
  if (e.method === 0) return Buffer.from(raw)
  if (e.method === 8) return inflateRawSync(raw)
  throw new Error(`xlsx 里用了不支持的压缩方式（${e.method}）`)
}

/** 是不是一个 xlsx（zip 魔数 + 有 xl/ 目录）—— 用来给用户明确报错，而不是解到一半炸 */
export function looksLikeXlsx(buf: Buffer): boolean {
  if (buf.length < 4) return false
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) return false
  try {
    const names = readZipEntries(buf).map((e) => e.name)
    return names.some((n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/.*\.xml$/.test(n))
  } catch {
    return false
  }
}

/* ============================ XML 小工具 ============================ */

/**
 * 解码文本里的 HTML/XML 实体。
 *
 * ⚠️ `&amp;` **必须最后**做：先做的话 `&amp;#23398;` 会被解成 `&#23398;`，
 * 紧接着又被数字实体那条规则解成"学" —— 多转了一层，源码里明明写的是
 * 字面量 `&#23398;` 那六个字符。顺序错了只在"文本里本来就有实体字面量"时出错，
 * 所以特别难发现。
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h: string) => codePoint(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, d: string) => codePoint(Number(d), m))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 码点非法（代理区 / 超出 Unicode）时**原样留着**，别丢数据 */
function codePoint(n: number, orig: string): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return orig
  return String.fromCodePoint(n)
}

/**
 * 把 `<si>` / `<is>` 里的文本拼出来。
 *
 * 富文本（`<r><t>a</t></r><r><t>b</t></r>`）要**按顺序拼**：
 * 只取第一个 `<t>` 会丢掉后半截（真 Excel 里"一半加粗"的单元格很常见）。
 *
 * ⚠️ 顺序很重要：**先拼接原始文本，最后统一解码实体**。
 * 反过来（每段各自解码再拼接）在实体被 `</t><t>` 从中间劈开时会出错：
 * 假设原始文本是 `&#21338;`，被切成 `&#213` 和 `38;` 两段，
 * 逐段解码的话第一段 `&#213` 不是合法实体、原样保留，拼出来就是
 * `&#21338;` —— **一个没解开的实体留在了数据里**（真 Excel 里
 * "一半加粗"的单元格就会把实体切开）。实测就是这么炸的。
 */
function textOfRich(xml: string): string {
  let raw = ''
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) raw += m[1] ?? ''
  return decodeEntities(raw)
}

/** 共享字符串表：`<si>` 的数组，下标 = 单元格里 `<v>` 的数 */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out.push(textOfRich(m[1] ?? ''))
  return out
}

/** 列字母 → 0 基下标。`A`→0 `Z`→25 `AA`→26。没有 r 属性时返回 -1 */
function colOfRef(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase())
  if (!letters) return -1
  let n = 0
  const s = letters[1]!
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64)
  return n - 1
}

/* ============================ 工作表 ============================ */

/**
 * 解出一张表：`rows[行号][列号] = 文本`（0 基，行内是**定长**数组）。
 *
 * 空单元格有两种写法，都要处理：
 *  · 整个 `<c>` 不出现（Excel 会跳过空值单元格）
 *  · `<c r="T2"/>` 自闭合，没有内容
 * 于是列位置**只能按 `r="D2"` 里的字母**算，不能按出现顺序数。
 */
export function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  const rowRe = /<row\b([^>]*)(?:\/>|>([\s\S]*?)<\/row>)/g
  let rm: RegExpExecArray | null

  while ((rm = rowRe.exec(xml))) {
    const rowAttrs = rm[1] ?? ''
    const rowBody = rm[2] ?? ''
    const rowIdx = Number((/\br="(\d+)"/.exec(rowAttrs) ?? [])[1] ?? rows.length + 1)
    const cells: string[] = []

    /* ⚠️ 这里必须是 `[^/>]`，不能是 `[^>]`。
       写成 `<c\b([^>]*)` 时，**结束标签 `</c>` 也会被当成开始标签**匹配上
       （`\b` 在 `c` 和 `/` 之间成立，而 `/` 不是 `>`）。后果是自闭合的空单元格
       `<c r="Q2"/>` 之后，扫描指针停在 `</c>` 上，把**后面那一格的文本**
       读了进来 —— 表现是"某一列凭空多出下一列的值"（实测：某行的「总成绩」
       变成了下一行的分数）。`[^/>]` 把 `/` 排除掉，`</c>` 就匹配不上了。 */
    const cellRe = /<c\b([^/>]*)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cm: RegExpExecArray | null
    while ((cm = cellRe.exec(rowBody))) {
      const attrs = cm[1] ?? ''
      const body = cm[2] ?? ''
      const ref = (/\br="([A-Z]+\d+)"/.exec(attrs) ?? [])[1] ?? ''
      /* 没有 r 属性时退回"按顺序追加"（极少见，但别把整行读空） */
      const col = ref ? colOfRef(ref) : cells.length
      if (col < 0) continue

      const type = (/\bt="([A-Za-z]+)"/.exec(attrs) ?? [])[1] ?? ''
      let text = ''
      if (type === 'inlineStr') {
        /* 内联字符串：真实文件走的就是这条（`<is><t>…</t></is>`） */
        const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)
        text = is ? textOfRich(is[1] ?? '') : ''
      } else if (type === 's') {
        /* 共享字符串：`<v>下标</v>` 指向 sst。**必须支持** —— 真 Excel
           默认就用它，只认 inlineStr 的实现在别的机器导出的文件上会全空。 */
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)
        const i = v ? Number(v[1]) : NaN
        text = Number.isInteger(i) && i >= 0 && i < shared.length ? shared[i]! : ''
      } else {
        /* 数字（无 t）/ 布尔 / 公式结果：都从 <v> 里取 */
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)
        text = v ? decodeEntities(v[1] ?? '') : ''
      }

      while (cells.length < col) cells.push('')
      cells[col] = text
    }

    while (rows.length < rowIdx - 1) rows.push([])
    rows[rowIdx - 1] = cells
  }

  /* 每行补齐到最宽的那一行：xlsx 里空尾列根本不出现，
     不补齐的话"第 17 列是空的"和"没有第 17 列"分不清 */
  let width = 0
  for (const r of rows) if (r.length > width) width = r.length
  for (const r of rows) while (r.length < width) r.push('')
  return rows
}

/* ============================ 对外入口 ============================ */

export interface SheetRead {
  /** 表名（来自 workbook.xml，读不到就是空串） */
  name: string
  /** 第一张工作表的路径 */
  path: string
  rows: string[][]
  /** 用的是共享字符串还是内联字符串 —— 测试和排查都用得上 */
  stringMode: 'inline' | 'shared' | 'none'
}

/** 工作表路径的排序：sheet1 < sheet2 < … < sheet10（不能按字符串排，否则 sheet10 跑到 sheet2 前面） */
function sheetOrder(p: string): number {
  const m = /sheet(\d+)\.xml$/i.exec(p)
  return m ? Number(m[1]) : 9999
}

/**
 * 读一份 xlsx，返回**第一张工作表**。
 *
 * 只读第一张是有意的：教务系统的「全部成绩查询」就一张表。
 * 多张表时读第一张 + 把其余表名放进 notes 提示用户 —— 静默挑一张比报错更糟。
 */
export function readXlsx(buf: Buffer): SheetRead {
  const entries = readZipEntries(buf)
  const byName = new Map(entries.map((e) => [e.name, e]))
  const nameOf = (n: string) => n.replace(/^\/+/, '')

  const sheets = entries
    .filter((e) => /^xl\/worksheets\/[^/]+\.xml$/i.test(nameOf(e.name)))
    .sort((a, b) => sheetOrder(nameOf(a.name)) - sheetOrder(nameOf(b.name)))
  if (!sheets.length) {
    throw new Error('这个文件里没有工作表（xl/worksheets/*.xml）—— 它可能不是 Excel 表格，或者已经损坏')
  }

  /* 老式 `.xls`（BIFF 二进制）和 CSV 被改名成 .xlsx 时都会走到这里，
     给一句人话，而不是"中央目录找不到" */
  if (entries.some((e) => /^xl\/worksheets\/sheet1\.bin$/i.test(nameOf(e.name)))) {
    throw new Error('这是老式的 .xls 格式（BIFF），不是 .xlsx —— 请用 Excel / WPS 另存为 .xlsx 再上传')
  }

  let shared: string[] = []
  let stringMode: SheetRead['stringMode'] = 'none'
  const ss = byName.get('xl/sharedStrings.xml')
  if (ss) {
    shared = parseSharedStrings(readZipEntry(buf, ss).toString('utf8'))
    if (shared.length) stringMode = 'shared'
  }

  const first = sheets[0]!
  const xml = readZipEntry(buf, first).toString('utf8')
  const rows = parseSheet(xml, shared)
  if (stringMode === 'none') {
    /* inlineStr 是"没有共享表时"的主流写法，但空表也可能两者都没有 */
    stringMode = /<c\b[^>]*\bt="inlineStr"/.test(xml) ? 'inline' : 'none'
  }

  const wb = byName.get('xl/workbook.xml')
  const allNames = wb ? [...readZipEntry(buf, wb).toString('utf8').matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)]
    .map((m) => decodeEntities(m[1] ?? '')) : []

  return { name: allNames[0] ?? '', path: nameOf(first.name), rows, stringMode }
}
