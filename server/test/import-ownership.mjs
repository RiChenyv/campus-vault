/**
 * 导入归属测试 —— 验证「导入到哪个账号由令牌决定，与浏览器登录态无关」。
 *
 * 背景：用户报告"用一个账号导入后，切到另一个账号、不用重填令牌也能导入"。
 * 根因是 GM_xmlhttpRequest 不受 SameSite 限制，会把 127.0.0.1 的会话 cookie
 * 一起发过去；而后端"先看 cookie 再看令牌"，于是令牌形同虚设。
 *
 * 所以这个测试必须**同时带上 cookie 和令牌**，构造出真实的冲突场景：
 *   cookie 指向账号 A，令牌属于账号 B —— 数据必须进 B。
 * 只测一种是不够的，那样永远发现不了"cookie 悄悄赢了"。
 */

import { DatabaseSync } from 'node:sqlite'

const API = 'http://127.0.0.1:5175/api'
const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

const db = new DatabaseSync('D:/MyWeb/server/data/vault.db')

const login = async (account, password) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  })
  const j = await r.json().catch(() => ({}))
  return {
    ok: j.ok,
    cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; '),
  }
}

const courseCount = (userId) =>
  db.prepare('SELECT COUNT(*) n FROM courses WHERE owner_id = ?').get(userId).n

/* ── 准备：两个账号的令牌 ── */
const tokenOf = (userId) =>
  db.prepare('SELECT token FROM import_tokens WHERE user_id = ? ORDER BY created_at LIMIT 1').get(userId)?.token

const users = db.prepare('SELECT id, account FROM users ORDER BY id').all()
console.log('账号:', users.map((u) => `${u.id}:${u.account}`).join('  '))
if (users.length < 2) {
  console.log('!! 需要至少两个账号才能测这个场景')
  process.exit(1)
}
const [A, B] = users

// 确保两个账号都有令牌
for (const u of [A, B]) {
  if (!tokenOf(u.id)) {
    const c = (await login(u.account, '')).cookie
    void c
  }
}
const tA = tokenOf(A.id)
const tB = tokenOf(B.id)
console.log(`令牌 A (${A.account}): ${tA?.slice(0, 14) ?? '(无)'}…`)
console.log(`令牌 B (${B.account}): ${tB?.slice(0, 14) ?? '(无)'}…`)

if (!tA || !tB) {
  console.log('')
  console.log('!! 两个账号都需要先各自生成一个导入令牌，请在各账号的导入中心点「生成导入令牌」')
  db.close()
  process.exit(1)
}

/* ── 场景 1：cookie 是 A，令牌是 B → 必须进 B ── */
console.log('')
console.log('=== 场景 1：cookie=A，令牌=B（这就是你遇到的冲突）===')
const beforeA = courseCount(A.id)
const beforeB = courseCount(B.id)

const r1 = await fetch(`${API}/import`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Cookie: (await login(A.account, 'Cv-Dev-Only-2026')).cookie || '',
    'X-Import-Token': tB,
  },
  body: JSON.stringify({
    source: '归属测试-令牌B', dryRun: false,
    courses: [{ code: '', name: '__隔离测试课__', term: '', room: '', slots: [{ day: 7, from: 1, span: 1, weeks: '1周', room: '' }] }],
  }),
}).then((r) => r.json())

const afterA = courseCount(A.id)
const afterB = courseCount(B.id)
console.log(`  响应: ${JSON.stringify(r1.data?.applied ?? r1.error)}`)
console.log(`  账号 A 课程数 ${beforeA} -> ${afterA}`)
console.log(`  账号 B 课程数 ${beforeB} -> ${afterB}`)

check('数据进了令牌所属的账号 B', afterB === beforeB + 1, `${beforeB} -> ${afterB}`)
check('**没有**进 cookie 指向的账号 A', afterA === beforeA, `${beforeA} -> ${afterA}`)

/* ── 场景 2：cookie 是 A，令牌是 A → 进 A ── */
console.log('')
console.log('=== 场景 2：cookie=A，令牌=A（对照组）===')
const beforeA2 = courseCount(A.id)
const r2 = await fetch(`${API}/import`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Cookie: (await login(A.account, 'Cv-Dev-Only-2026')).cookie || '',
    'X-Import-Token': tA,
  },
  body: JSON.stringify({
    source: '归属测试-令牌A', dryRun: false,
    courses: [{ code: '', name: '__隔离测试课A__', term: '', room: '', slots: [{ day: 7, from: 1, span: 1, weeks: '1周', room: '' }] }],
  }),
}).then((r) => r.json())
const afterA2 = courseCount(A.id)
console.log(`  响应: ${JSON.stringify(r2.data?.applied ?? r2.error)}`)
check('令牌 A 的导入进了账号 A', afterA2 === beforeA2 + 1, `${beforeA2} -> ${afterA2}`)

/* ── 场景 3：站外来源 + 只有 cookie（无令牌）→ 必须拒绝 ── */
console.log('')
console.log('=== 场景 3：站外来源 + 只有 cookie，无令牌 → 应拒绝 ===')
const r3 = await fetch(`${API}/import`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: 'https://bkjw.cuc.edu.cn',
    Cookie: (await login(A.account, 'Cv-Dev-Only-2026')).cookie || '',
  },
  body: JSON.stringify({ source: 'csrf-test', dryRun: false, courses: [{ code: '', name: '__不该存在__', term: '', slots: [] }] }),
})
const j3 = await r3.json().catch(() => ({}))
console.log(`  HTTP ${r3.status}  ${JSON.stringify(j3.error ?? j3.data)}`)
check('站外无令牌的导入被拒绝', r3.status === 401, `HTTP ${r3.status}`)

/* ── 场景 4：本机来源 + cookie（无令牌）→ 允许（前端自己用）── */
console.log('')
console.log('=== 场景 4：本机来源 + cookie，无令牌 → 应允许 ===')
const r4 = await fetch(`${API}/courses`, {
  headers: { Cookie: (await login(A.account, 'Cv-Dev-Only-2026')).cookie || '' },
})
check('本机前端的读接口仍用 cookie', r4.status === 200, `HTTP ${r4.status}`)
await r4.json().catch(() => null)

/* ── 场景 5：whoami 能报出令牌归属 ── */
console.log('')
console.log('=== 场景 5：令牌归属查询（面板靠它显示"将导入到 XXX"）===')
const w = await fetch(`${API}/import/whoami`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: tB }),
}).then((r) => r.json())
console.log('  ', JSON.stringify(w.data ?? w.error))
check('whoami 报出的账号 = 令牌 B 的账号', w.data?.account === B.account, String(w.data?.account))
check('whoami 报出的用户名非空', typeof w.data?.username === 'string', String(w.data?.username))

const wBad = await fetch(`${API}/import/whoami`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: 'cvi_不存在' }),
})
check('无效令牌的 whoami 被拒绝', wBad.status === 401, `HTTP ${wBad.status}`)

/* ── 清理 ── */
console.log('')
console.log('=== 清理测试数据 ===')
const names = ['__隔离测试课__', '__隔离测试课A__', '__不该存在__']
let removed = 0
for (const n of names) {
  const r = db.prepare('DELETE FROM courses WHERE name = ?').run(n)
  removed += Number(r.changes)
}
console.log(`  已删除 ${removed} 条测试课程`)
console.log(`  账号 A 课程数: ${courseCount(A.id)}   账号 B 课程数: ${courseCount(B.id)}`)

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

db.close()
process.exit(fails.length ? 1 : 0)
