/**
 * 轻量 Markdown 渲染器（原型阶段零依赖）。
 * 后端接入后建议换成 markdown-it + 插件，此文件可整体替换。
 * 支持：# 标题 / **粗体** / *斜体* / `行内代码` / ~~删除~~ / 链接
 *       - 无序 · 1. 有序 · - [ ] 任务
 *       > 引用 · ``` 代码块 · | 表格 | · --- 分割线
 */

import katex from 'katex'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/* ─────────────────────────── 数学公式 ───────────────────────────
   课程笔记里大量用 LaTeX（`$e - 127$`、`$$...$$`）。不处理的话，
   公式会原样显示成一串 `\times` `\sim`，完全没法读。

   做法：**先把公式抽成占位符**，再走原来的行内规则，最后把渲染结果换回去。
   不能直接替换成 HTML —— 下面的 esc() 会把标签转义掉，斜体规则
   （`*`）也会去啃公式里的星号。 */
function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      // 公式写错时不要把整篇笔记搞崩：让 KaTeX 把错误渲染成红色提示
      throwOnError: false,
      errorColor: '#ff9a9a',
    })
  } catch {
    // 真抛异常了（比如版本不兼容）就退回原文，至少内容还在
    return display ? `$$${esc(tex)}$$` : `$${esc(tex)}$`
  }
}

/** 占位符用纯字母数字，保证能安然穿过 esc() 和后续的正则替换 */
const PH = (n: number) => `@@MATH${n}@@`

function extractMath(s: string): { text: string; parts: string[] } {
  const parts: string[] = []
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s[i] === '$') {
      const display = s[i + 1] === '$'
      const open = display ? '$$' : '$'
      const end = s.indexOf(open, i + open.length)
      // 行内公式不允许跨行；`$` 后面紧跟空格通常是金额（`$ 5`），不当公式
      const tex = end > 0 ? s.slice(i + open.length, end) : ''
      if (tex && (display || (!tex.includes('\n') && !/^\s/.test(tex) && !/\s$/.test(tex)))) {
        out += PH(parts.length)
        parts.push(renderMath(tex, display))
        i = end + open.length
        continue
      }
    }
    out += s[i]
    i++
  }
  return { text: out, parts }
}

function restoreMath(html: string, parts: string[]): string {
  if (!parts.length) return html
  return html.replace(/@@MATH(\d+)@@/g, (_, n: string) => parts[Number(n)] ?? '')
}

const inlineRaw = (s: string) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')

const inline = (s: string) => {
  const { text, parts } = extractMath(s)
  return restoreMath(inlineRaw(text), parts)
}

/** 整行公式（`$$ ... $$` 独占一行） */
export function isMathBlockStart(line: string): boolean {
  const t = line.trim()
  return t.startsWith('$$') && t !== '$$'
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())

export function mdToHtml(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    /* 代码块 */
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || 'text'
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++])
      i++
      out.push(
        `<div class="code" data-lang="${esc(lang)}"><div class="code-head"><span class="code-dot"></span><span>${esc(lang)}</span></div><pre>${buf
          .map(esc)
          .join('\n')}</pre></div>`,
      )
      continue
    }

    /* 整行公式：``` $$ ... $$ ``` 独占一段。
       必须放在其它规则**之前** —— 否则 $$ 会被当成普通段落，
       里面的 `\\` `*` `_` 会被转义和斜体规则啃坏。 */
    if (/^\s*\$\$/.test(line)) {
      const t = line.trim()
      // ① 单行闭合：$$ ... $$
      if (t.length > 4 && t.endsWith('$$')) {
        out.push(`<div class="math-block">${renderMath(t.slice(2, -2), true)}</div>`)
        i++
        continue
      }
      // ② 跨行：从 $$ 开始，收到下一个 $$
      const buf: string[] = [t.slice(2)]
      i++
      let closed = false
      while (i < lines.length) {
        const cur = lines[i]
        if (/^\s*\$\$\s*$/.test(cur)) {
          closed = true
          i++
          break
        }
        buf.push(cur)
        i++
      }
      const tex = buf.join('\n').trim()
      out.push(
        closed
          ? `<div class="math-block">${renderMath(tex, true)}</div>`
          : // 没有收尾的 $$ ：当普通段落，别把后面整篇都吞掉
            `<p>${inline(`$$${tex}`)}</p>`,
      )
      continue
    }

    /* 表格 */
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]))
      out.push(
        `<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      )
      continue
    }

    /* 引用 */
    if (/^>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''))
      out.push(`<blockquote>${buf.map(inline).join('<br/>')}</blockquote>`)
      continue
    }

    /* 标题 */
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const lv = h[1].length
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`)
      i++
      continue
    }

    /* 分割线 */
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push('<hr/>')
      i++
      continue
    }

    /* 列表（含任务清单） */
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        let text = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '')
        const task = /^\[([ xX])\]\s*(.*)$/.exec(text)
        if (task) {
          const on = task[1].toLowerCase() === 'x'
          items.push(
            `<li class="task"><span class="box${on ? ' on' : ''}"></span>${inline(task[2])}</li>`,
          )
        } else {
          items.push(`<li>${inline(text)}</li>`)
        }
        i++
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`)
      continue
    }

    /* 空行 */
    if (!line.trim()) {
      i++
      continue
    }

    /* 段落 */
    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|>|\s*([-*+]|\d+\.)\s|```|\s*\|)/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i])
    ) {
      buf.push(lines[i++])
    }
    out.push(`<p>${buf.map(inline).join('<br/>')}</p>`)
  }

  return out.join('\n')
}

/* --------------------------- 语法着色 --------------------------- */

const KEYWORDS: Record<string, string[]> = {
  javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'extends', 'new', 'this', 'import', 'from', 'export', 'default', 'await', 'async', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'of', 'in', 'null', 'undefined', 'true', 'false', 'switch', 'case', 'break', 'continue'],
  typescript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'extends', 'interface', 'type', 'enum', 'implements', 'public', 'private', 'readonly', 'new', 'this', 'import', 'from', 'export', 'default', 'await', 'async', 'try', 'catch', 'finally', 'throw', 'typeof', 'as', 'null', 'undefined', 'true', 'false'],
  python: ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'class', 'import', 'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'lambda', 'yield', 'global', 'nonlocal', 'assert', 'pass', 'break', 'continue', 'and', 'or', 'not', 'in', 'is', 'None', 'True', 'False', 'self'],
  java: ['public', 'private', 'protected', 'class', 'interface', 'extends', 'implements', 'static', 'final', 'void', 'int', 'long', 'double', 'float', 'boolean', 'char', 'String', 'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'this', 'super', 'null', 'true', 'false', 'import', 'package', 'abstract'],
  cpp: ['include', 'define', 'int', 'long', 'double', 'float', 'char', 'bool', 'void', 'struct', 'class', 'public', 'private', 'protected', 'const', 'static', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'delete', 'using', 'namespace', 'std', 'vector', 'string', 'auto', 'nullptr', 'true', 'false', 'template', 'typename', 'sizeof'],
  sql: ['select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'index', 'view', 'join', 'left', 'right', 'inner', 'outer', 'on', 'group', 'by', 'order', 'having', 'limit', 'offset', 'primary', 'key', 'foreign', 'references', 'not', 'null', 'default', 'begin', 'commit', 'rollback', 'transaction', 'isolation', 'level', 'as', 'and', 'or', 'distinct', 'count', 'sum', 'avg'],
}

const TYPE_WORDS = ['int', 'long', 'double', 'float', 'char', 'bool', 'void', 'String', 'size_t', 'uint32_t', 'vector', 'string']

/**
 * 极简语法高亮。
 *
 * ⚠️ 实现要点：**单趟切词，最后一次性拼 HTML**。
 *
 * 之前的写法是「用占位符抽离字符串/注释 → 依次跑数字/关键字/函数正则 → 还原占位符」，
 * 有两个致命缺陷（实测输出 `<span <span class="tok-key">class</span>="tok-num">0</span>`）：
 *   A. 占位符形如 `\u0000序号\u0000`，NUL 是非单词字符，所以 `\b\d+\b`
 *      会匹配到**序号本身**，占位符被破坏、被抽离的内容直接丢失。
 *   B. 着色正则跑在自己刚生成的 HTML 上 —— C++/Java 的 `class` 是关键字，
 *      于是 `class="tok-num"` 被再包一层，`<span` 标签当场损坏、HTML 泄漏成文本。
 * 只要不在已生成的 HTML 上再跑正则，这两类问题就都不存在。
 */
export function highlight(code: string, lang: string): string {
  const kws = new Set(KEYWORDS[lang.toLowerCase()] ?? KEYWORDS.javascript)
  const typeSet = new Set(TYPE_WORDS)

  /** 优先级即备选顺序：注释 > 字符串 > 数字 > 标识符 > 空白 > 其它 */
  const RE = new RegExp(
    [
      '(\\/\\/[^\\n]*|#[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)', // 1 注释
      '("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)', // 2 字符串
      '(\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b|\\b0[xX][0-9a-fA-F]+\\b)', // 3 数字
      '([A-Za-z_]\\w*)', // 4 标识符
      '(\\s+)', // 5 空白
      '([\\s\\S])', // 6 其它（含单个字符，保证不丢内容）
    ].join('|'),
    'g',
  )

  type Tok = { k: 'com' | 'str' | 'num' | 'id' | 'ws' | 'punct'; v: string }
  const toks: Tok[] = []

  for (const m of code.matchAll(RE)) {
    if (m[1] != null) toks.push({ k: 'com', v: m[1] })
    else if (m[2] != null) toks.push({ k: 'str', v: m[2] })
    else if (m[3] != null) toks.push({ k: 'num', v: m[3] })
    else if (m[4] != null) toks.push({ k: 'id', v: m[4] })
    else if (m[5] != null) toks.push({ k: 'ws', v: m[5] })
    else toks.push({ k: 'punct', v: m[6] ?? '' })
  }

  // 函数名判定：标识符后面（跳过空白）紧跟 `(`
  const isFn = (i: number) => {
    for (let j = i + 1; j < toks.length; j++) {
      if (toks[j].k === 'ws') continue
      return toks[j].v === '('
    }
    return false
  }

  return toks
    .map((t, i) => {
      const text = esc(t.v)
      if (t.k === 'com') return `<span class="tok-com">${text}</span>`
      if (t.k === 'str') return `<span class="tok-str">${text}</span>`
      if (t.k === 'num') return `<span class="tok-num">${text}</span>`
      if (t.k === 'id') {
        if (kws.has(t.v) || kws.has(t.v.toLowerCase())) return `<span class="tok-key">${text}</span>`
        if (typeSet.has(t.v)) return `<span class="tok-type">${text}</span>`
        // 关键字优先于函数名：`if (` 不该被当成函数调用
        if (isFn(i)) return `<span class="tok-fn">${text}</span>`
      }
      return text
    })
    .join('')
}
