/**
 * 课表文件导入 CLI。
 *
 * 用法：
 *   node tools/import-file.mjs <文件路径>            # 先预览（dry-run）
 *   node tools/import-file.mjs <文件路径> --apply    # 确认后真正写入
 *
 * 会**自动识别**文件格式：
 *   · 含 BEGIN:VCALENDAR        → ICS 日历（走 /api/import/ics）
 *   · 5 行以上且每行是 JSON      → WakeUp 备份（走 /api/import/wakeup）
 *   · 都认不出                   → 明确报错，不做猜测
 *
 * 认证：默认用内置管理员账号调 /api/auth/login 拿会话 cookie（本地工具）。
 * 也可以用环境变量覆盖：CV_ACCOUNT / CV_PASSWORD，或直接给 CV_TOKEN。
 */

import { readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const API = process.env.CV_API ?? 'http://127.0.0.1:5175/api'
const ACCOUNT = process.env.CV_ACCOUNT ?? 'admin'
const PASSWORD = process.env.CV_PASSWORD ?? 'Cv-Dev-Only-2026'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const fileArg = args.find((a) => !a.startsWith('--'))

if (!fileArg) {
  console.error('用法: node tools/import-file.mjs <文件路径> [--apply]')
  process.exit(1)
}

const path = resolve(fileArg)
let raw
try {
  const st = statSync(path)
  if (!st.isFile()) throw new Error('不是文件')
  raw = readFileSync(path, 'utf8')
} catch (e) {
  console.error(`读不到文件：${path}`)
  console.error(`  ${e.message}`)
  process.exit(1)
}

console.log(`文件：${basename(path)}  (${raw.length.toLocaleString()} 字符)`)

/* ---------------------------- 格式识别 ---------------------------- */

function detect(text) {
  const t = text.trim()
  if (/BEGIN:VCALENDAR/i.test(t)) return 'ics'
  const lines = t
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length >= 5) {
    // WakeUp 备份：至少 5 行，且前 5 行都能解析成 JSON
    let allJson = true
    for (let i = 0; i < 5; i++) {
      try {
        JSON.parse(lines[i].replace(/\\"/g, '"').replace(/\\\\/g, '\\'))
      } catch {
        allJson = false
        break
      }
    }
    if (allJson) return 'wakeup'
  }
  return null
}

const kind = detect(raw)
if (!kind) {
  console.error('')
  console.error('认不出这个文件的格式。预期是：')
  console.error('  · ICS 日历文件（含 BEGIN:VCALENDAR）')
  console.error('  · WakeUp 备份文件（5 行以上，每行一个 JSON）')
  console.error('')
  console.error('文件开头是：')
  console.error('  ' + raw.slice(0, 160).replace(/\n/g, ' ⏎ '))
  process.exit(1)
}
console.log(`识别为：${kind === 'ics' ? 'ICS 日历文件' : 'WakeUp 备份文件'}`)

/* ---------------------------- 登录 ---------------------------- */

let cookie = ''
if (!process.env.CV_TOKEN) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: ACCOUNT, password: PASSWORD }),
  }).catch(() => null)
  if (!r || !r.ok) {
    console.error(`登录失败（${r?.status ?? '连不上'}）。请确认后端在跑：${API}`)
    process.exit(1)
  }
  const sc = r.headers.getSetCookie?.() ?? []
  cookie = sc.map((c) => c.split(';')[0]).join('; ')
  console.log(`已登录：${ACCOUNT}`)
}

/* ---------------------------- 导入 ---------------------------- */

const url = `${API}/import/${kind === 'ics' ? 'ics' : 'wakeup'}`
const headers = { 'Content-Type': 'application/json' }
if (cookie) headers.Cookie = cookie
if (process.env.CV_TOKEN) headers.Authorization = `Bearer ${process.env.CV_TOKEN}`

const res = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify({ content: raw, dryRun: !apply, source: `cli:${basename(path)}` }),
})
const body = await res.json().catch(() => null)

if (!res.ok || !body?.ok) {
  console.error('')
  console.error(`导入失败（HTTP ${res.status}）：${body?.error?.message ?? '未知错误'}`)
  process.exit(1)
}

const d = body.data

if (!apply) {
  console.log('')
  console.log('══ 预览（还没写入）══')
  if (d.tableName) console.log(`课表名称：${d.tableName}`)
  if (d.termStart) console.log(`起始日期：${d.termStart}`)
  console.log(`课程：${d.courses} 门 · 时间段：${d.slots} 条`)
  if (d.notes?.length) {
    console.log('提示：')
    for (const n of d.notes) console.log(`  · ${n}`)
  }
  console.log('')
  const preview = d.preview ?? []
  for (const c of preview) {
    const times = (c.times ?? []).join(' / ')
    const extra = [c.teacher, c.room].filter(Boolean).join(' · ')
    console.log(`  ${c.name}`)
    console.log(`    ${times}${extra ? '   [' + extra + ']' : ''}`)
  }
  console.log('')
  console.log('确认无误后加 --apply 真正写入。')
} else {
  console.log('')
  console.log('══ 已写入 ══')
  const a = d.applied ?? {}
  console.log(`课程：新增 ${a.created ?? 0} 门 · 更新 ${a.updated ?? 0} 门`)
  console.log(`时间段：${a.slots ?? 0} 条`)
  if (d.notes?.length) {
    console.log('提示：')
    for (const n of d.notes) console.log(`  · ${n}`)
  }
}
