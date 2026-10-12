/**
 * 改管理员密码（命令行）。
 *
 * 为什么需要它：上线守卫要求"管理员密码不能还是写在代码里的初始值"。
 * 正常做法是打开网站 → 个人中心 → 改密码；但如果你正卡在"起不来"那一步
 * （对外部署时守卫会拒绝启动），就去不了界面 —— 这个工具专门解决这件事。
 *
 * 用法（在 server 目录下）：
 *   node tools/set-password.mjs '你的新密码'
 *   node tools/set-password.mjs '你的新密码' --account 某个账号名
 *
 * 数据目录取 DATA_DIR 环境变量，默认 server/data（和服务器一致）。
 *
 * ⚠️ 本文件是 **.mjs（纯 JavaScript）**，不能写 TypeScript 的类型标注
 *    （`as` / `: string` 之类）—— 这里只做类型擦除，不做类型检查。
 *    踩过一次：写了 `as {...}` 直接 SyntaxError。
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { openDb } from '../src/db.ts'
import { checkPassword, hashPassword, verifyPassword } from '../src/lib/auth.ts'
import { BUILTIN_ADMIN_PASSWORD } from '../src/lib/deploy.ts'

const args = process.argv.slice(2)
const accountFlag = args.indexOf('--account')
const accountArg = accountFlag >= 0 ? args[accountFlag + 1] : ''
/* ⚠️ 排除"账号名"那个位置时要先判断有没有 --account：
   没有时 accountFlag 是 -1，`accountFlag + 1` 就成了 0，
   会把**第一个参数（也就是密码本身）**排除掉 → 一直报"用法"。
   踩过一次。 */
const skipIndex = accountFlag >= 0 ? accountFlag + 1 : -1
const password = args.find((a, i) => !a.startsWith('--') && i !== skipIndex) ?? ''

if (!password) {
  console.error("用法: node tools/set-password.mjs '新密码' [--account 账号名]")
  process.exit(2)
}

const chk = checkPassword(password)
if (!chk.ok) {
  console.error(`密码太弱：${chk.failed.join('、')}`)
  console.error('（和网站注册时用的是同一套规则）')
  process.exit(2)
}
if (password === BUILTIN_ADMIN_PASSWORD) {
  console.error('这个就是初始密码，换了等于没换。')
  process.exit(2)
}

const DATA_DIR = resolve(process.env.DATA_DIR ?? 'data')
const dbFile = resolve(DATA_DIR, 'vault.db')
if (!existsSync(dbFile)) {
  console.error(`找不到数据库：${dbFile}`)
  console.error('如果数据库在别处，先设 DATA_DIR 环境变量再跑本工具。')
  process.exit(1)
}

const db = openDb(dbFile)

/* 默认改管理员；给了 --account 就改那个账号 */
const row = accountArg
  ? db.prepare('SELECT id, account, is_admin FROM users WHERE account = ?').get(accountArg)
  : db.prepare('SELECT id, account, is_admin FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get()

if (!row) {
  console.error(accountArg ? `没有这个账号：${accountArg}` : '数据库里没有管理员账号。')
  const all = db.prepare('SELECT account, is_admin FROM users ORDER BY id').all()
  if (all.length) {
    console.error('现有账号：')
    for (const u of all) console.error(`  ${u.account}${u.is_admin ? '（管理员）' : ''}`)
  }
  db.close()
  process.exit(1)
}

db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.id)

/* 改完**立刻验一遍**：写进去了 ≠ 能验通过。这个项目的一贯做法是当场反向验证。 */
const after = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(row.id)
const okNew = verifyPassword(password, after.password_hash)
const okOld = verifyPassword(BUILTIN_ADMIN_PASSWORD, after.password_hash)

/* 顺手清掉这个账号的所有会话：改了密码就该让旧登录失效 */
const killed = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id)

console.log(`账号       ${row.account}${row.is_admin ? '（管理员）' : ''}`)
console.log(`新密码生效 ${okNew ? '✓' : '✗ 写入失败'}`)
console.log(`初始密码   ${okOld ? '✗ 仍然有效（不对劲）' : '✓ 已失效'}`)
console.log(`已注销会话 ${killed.changes} 个（其它设备上的登录会掉线）`)
console.log('')
console.log('现在可以起服务了：node --env-file=..\\上线.env src/index.ts')
db.close()
process.exit(okNew && !okOld ? 0 : 1)
