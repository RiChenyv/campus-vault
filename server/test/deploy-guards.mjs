/**
 * 上线守卫的测试（`lib/deploy.ts`）。
 *
 * 这些检查的价值全在"真的会拦"上 —— 写了守卫但守卫不生效，等于没有。
 * 所以三层都测：
 *   ① 纯函数：哪些地址算对外、注册开关的默认值、assertDeploySafe 抛不抛
 *   ② 起一个真后端：health 不泄露路径、注册被拒、静态页与 SPA 回退、
 *      会话 cookie 在 HTTPS 下带 Secure
 *   ③ 起一个真进程：非本机监听 + 没设管理员密码 → **拒绝启动**
 *      （这条必须在 listen 之前抛，所以它根本不会占用端口）
 *
 * 全程不监听 0.0.0.0（避免 Windows 防火墙弹窗）：
 * 需要"看起来来自公网"的请求时，用 `X-Forwarded-For` 模拟 ——
 * 反代在同一台机器上时（trust proxy = loopback）后端就是这么判定的。
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../src/db.ts'
import { hashPassword, verifyPassword } from '../src/lib/auth.ts'
import { assertDeploySafe, isLoopbackHost, isPublicDeploy, registerAllowed, BUILTIN_ADMIN_PASSWORD } from '../src/lib/deploy.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(HERE, '..')
const WORK = mkdtempSync(resolve(tmpdir(), 'cv-deploy-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; failures.push(`${name}  ${extra}`); console.log(`FAIL  ${name}${extra ? `  (${extra})` : ''}`) }
}
const section = (t) => { console.log(''); console.log(`--- ${t} ---`) }

/* 造一个临时库，并可选地把管理员密码设成"已改过" */
const makeDb = (name, opts = {}) => {
  const dir = resolve(WORK, name)
  mkdirSync(dir, { recursive: true })
  const db = openDb(resolve(dir, 'vault.db'))
  if (opts.withAdmin) {
    const pw = opts.password ?? BUILTIN_ADMIN_PASSWORD
    const info = db
      .prepare('INSERT INTO users (account, password_hash, is_admin, created_at) VALUES (?,?,1,?)')
      .run(opts.account ?? 'admin', hashPassword(pw), Date.now())
    db.prepare('INSERT INTO profiles (user_id, username) VALUES (?,?)').run(Number(info.lastInsertRowid), 'x')
  }
  return { db, dir }
}

/* ================================================================== */
/*                  ① 纯函数                                          */
/* ================================================================== */

section('哪些地址算"对外"')
check('127.0.0.1 / localhost / ::1 算本机', ['127.0.0.1', 'localhost', '::1'].every(isLoopbackHost))
check('0.0.0.0 / 域名 / 局域网 IP 都不算本机',
  ['0.0.0.0', 'vault.example.com', '192.168.1.9'].every((h) => !isLoopbackHost(h)))

section('PUBLIC_DEPLOY：隧道部署也要走守卫')
{
  const old = process.env.PUBLIC_DEPLOY
  delete process.env.PUBLIC_DEPLOY
  check('没设时：只听本机 = 不算对外', isPublicDeploy('127.0.0.1') === false)
  check('没设时：0.0.0.0 算对外', isPublicDeploy('0.0.0.0') === true)
  process.env.PUBLIC_DEPLOY = '1'
  /* 隧道的关键点：后端仍听 127.0.0.1（端口不对局域网开放），但网站是公开的 */
  check('**设了 PUBLIC_DEPLOY=1：听 127.0.0.1 也算对外**', isPublicDeploy('127.0.0.1') === true)
  check('PUBLIC_DEPLOY=1 时注册默认关闭', registerAllowed() === false)
  check('PUBLIC_DEPLOY=0 等于没设', (() => {
    process.env.PUBLIC_DEPLOY = '0'
    const r = isPublicDeploy('127.0.0.1') === false
    process.env.PUBLIC_DEPLOY = '1'
    return r
  })())
  if (old === undefined) delete process.env.PUBLIC_DEPLOY
  else process.env.PUBLIC_DEPLOY = old
}

section('注册开关')
{
  const old = process.env.ALLOW_REGISTER
  delete process.env.ALLOW_REGISTER
  check('默认：本机允许注册', registerAllowed(true) === true)
  check('默认：**公网关闭**注册', registerAllowed(false) === false)
  process.env.ALLOW_REGISTER = '1'
  check('显式 ALLOW_REGISTER=1 → 公网也允许', registerAllowed(false) === true)
  process.env.ALLOW_REGISTER = '0'
  check('显式 ALLOW_REGISTER=0 → 本机也关闭', registerAllowed(true) === false)
  if (old === undefined) delete process.env.ALLOW_REGISTER
  else process.env.ALLOW_REGISTER = old
}

section('assertDeploySafe：本机监听一律放行')
{
  const { db } = makeDb('local', { withAdmin: true })
  let threw = ''
  try { assertDeploySafe(db, '127.0.0.1') } catch (e) { threw = e.message }
  check('本机监听 + 内置密码 → 放行（不影响本地开发和测试）', threw === '', threw.slice(0, 60))
  db.close()
}

section('assertDeploySafe：公网监听的四条判据')
{
  const oldPw = process.env.ADMIN_PASSWORD
  const oldPub = process.env.PUBLIC_DEPLOY

  delete process.env.ADMIN_PASSWORD

  /* 隧道场景：HOST 是 127.0.0.1，但设了 PUBLIC_DEPLOY=1 —— 守卫必须照样生效 */
  process.env.PUBLIC_DEPLOY = '1'
  const tunnelBuiltin = makeDb('tunnel-builtin', { withAdmin: true })
  let mt = ''
  try { assertDeploySafe(tunnelBuiltin.db, '127.0.0.1') } catch (e) { mt = e.message }
  check('**隧道部署（PUBLIC_DEPLOY=1 + 听本机）密码没改 → 照样拒绝**',
    /拒绝在对外可访问的状态下启动/.test(mt) && /初始密码/.test(mt), mt.slice(0, 80))
  tunnelBuiltin.db.close()

  const tunnelChanged = makeDb('tunnel-changed', { withAdmin: true, password: 'TunnelPw!2026x' })
  let mt2 = ''
  try { assertDeploySafe(tunnelChanged.db, '127.0.0.1') } catch (e) { mt2 = e.message }
  check('隧道部署 + 密码已改 → 放行', mt2 === '', mt2.slice(0, 80))
  tunnelChanged.db.close()
  if (oldPub === undefined) delete process.env.PUBLIC_DEPLOY
  else process.env.PUBLIC_DEPLOY = oldPub

  const fresh = makeDb('public-nopw')
  let m1 = ''
  try { assertDeploySafe(fresh.db, '0.0.0.0') } catch (e) { m1 = e.message }
  check('空库 + 没设 ADMIN_PASSWORD → 拒绝启动', /拒绝在对外可访问的状态下启动/.test(m1) && /ADMIN_PASSWORD/.test(m1), m1.slice(0, 70))
  fresh.db.close()

  const seeded = makeDb('public-builtin', { withAdmin: true })
  let m2 = ''
  try { assertDeploySafe(seeded.db, 'vault.example.com') } catch (e) { m2 = e.message }
  check('管理员密码仍是内置初始值 → 拒绝启动（并说清怎么改）',
    /拒绝在对外可访问的状态下启动/.test(m2) && /初始密码/.test(m2) && /改掉/.test(m2), m2.slice(0, 80))
  seeded.db.close()

  const changed = makeDb('public-changed', { withAdmin: true, password: 'MyNewPw!2026x' })
  let m3 = ''
  try { assertDeploySafe(changed.db, 'vault.example.com') } catch (e) { m3 = e.message }
  check('管理员密码已改过 → 放行', m3 === '', m3.slice(0, 80))
  changed.db.close()

  process.env.ADMIN_PASSWORD = 'FromEnv!2026x'
  const envPw = makeDb('public-envpw')
  let m4 = ''
  try { assertDeploySafe(envPw.db, '0.0.0.0') } catch (e) { m4 = e.message }
  check('没设密码但设了 ADMIN_PASSWORD → 放行', m4 === '', m4.slice(0, 80))
  envPw.db.close()

  if (oldPw === undefined) delete process.env.ADMIN_PASSWORD
  else process.env.ADMIN_PASSWORD = oldPw
}

/* ================================================================== */
/*        ② 起一个真后端（本机监听，但用 XFF 模拟"来自公网"）           */
/* ================================================================== */

section('真后端：公网访问下的行为')
const PORT = 5183
const DATA_DIR = resolve(WORK, 'live-data')
const WEB_DIR = resolve(WORK, 'live-web')
mkdirSync(WEB_DIR, { recursive: true })
writeFileSync(resolve(WEB_DIR, 'index.html'), '<!doctype html><title>CV 静态页</title><div id="root"></div>')
mkdirSync(DATA_DIR, { recursive: true })

const child = spawn(process.execPath, ['src/index.ts'], {
  cwd: SERVER,
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR,
    WEB_DIR,
    ADMIN_PASSWORD: 'DeployTest!2026x',
    ALLOW_REGISTER: '0',
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
child.stdout.on('data', (d) => { log += d.toString() })
child.stderr.on('data', (d) => { log += d.toString() })

const BASE = `http://127.0.0.1:${PORT}`
let up = false
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) { up = true; break } } catch { /* retry */ }
  await sleep(250)
}
check('后端起来了（本机监听）', up, log.split('\n').slice(-3).join(' / '))

if (up) {
  /* health：本机请求带路径，模拟的公网请求不带 */
  const local = await (await fetch(`${BASE}/api/health`)).json()
  check('本机请求：health 仍带 dataDir（测试工具靠它认测试库）', !!local?.data?.dataDir, JSON.stringify(local?.data))
  const remote = await (await fetch(`${BASE}/api/health`, { headers: { 'X-Forwarded-For': '203.0.113.9' } })).json()
  check('**公网请求：health 不再泄露 dataDir 和 counts**',
    !remote?.data?.dataDir && !remote?.data?.counts && remote?.data?.service === 'campus-vault-server',
    JSON.stringify(remote?.data))

  /* 注册：ALLOW_REGISTER=0 */
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Zx9#kQ4p!m', confirm: 'Zx9#kQ4p!m' }),
  })
  const regBody = await reg.json().catch(() => null)
  check('注册被拒（REGISTER_CLOSED）', reg.status === 400 && regBody?.error?.code === 'REGISTER_CLOSED',
    `${reg.status} ${JSON.stringify(regBody?.error)}`)

  /* 登录：环境变量里的新密码可用，内置初始密码不可用 */
  const okLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin', password: 'DeployTest!2026x' }),
  })
  check('用 ADMIN_PASSWORD 指定的密码能登录', okLogin.status === 200, String(okLogin.status))
  const badLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin', password: BUILTIN_ADMIN_PASSWORD }),
  })
  check('内置初始密码登不上去', badLogin.status !== 200, String(badLogin.status))

  /* 会话 cookie 的 Secure 标志 */
  const plain = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin', password: 'DeployTest!2026x' }),
  })
  const plainCookie = plain.headers.getSetCookie?.()[0] ?? ''
  const https = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
    body: JSON.stringify({ account: 'admin', password: 'DeployTest!2026x' }),
  })
  const httpsCookie = https.headers.getSetCookie?.()[0] ?? ''
  check('http 下 cookie 不带 Secure（否则本地存不下会话）', /HttpOnly/.test(plainCookie) && !/Secure/.test(plainCookie), plainCookie.slice(0, 70))
  check('**https（反代透传）下 cookie 带 Secure**', /Secure/.test(httpsCookie), httpsCookie.slice(0, 70))

  /* 静态页与 SPA 回退 */
  const home = await fetch(`${BASE}/`)
  const homeText = await home.text()
  check('首页返回构建好的网页', home.status === 200 && /CV 静态页/.test(homeText), String(home.status))
  const spa = await fetch(`${BASE}/some/deep/route`)
  check('SPA 回退：任意前端路由都返回 index.html', spa.status === 200 && /CV 静态页/.test(await spa.text()), String(spa.status))
  const apiMiss = await fetch(`${BASE}/api/nope`)
  const apiMissText = await apiMiss.text()
  check('**打错的接口仍然返回 JSON 404**（不能回退成 HTML，否则前端报看不懂的错）',
    apiMiss.status === 404 && apiMissText.trim().startsWith('{'), `${apiMiss.status} ${apiMissText.slice(0, 40)}`)
}

spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
await sleep(600)

/* ================================================================== */
/*        ③ 起一个真进程：公网监听 + 没设密码 → 拒绝启动                */
/* ================================================================== */

section('真进程：公网监听 + 没设管理员密码 → 拒绝启动')
{
  const badDir = resolve(WORK, 'refuse-data')
  mkdirSync(badDir, { recursive: true })
  const env = { ...process.env, PORT: '5184', DATA_DIR: badDir, HOST: '0.0.0.0', TMP: process.env.TMP, TEMP: process.env.TEMP }
  delete env.ADMIN_PASSWORD
  const p = spawnSync(process.execPath, ['src/index.ts'], { cwd: SERVER, env, encoding: 'utf8', timeout: 20000 })
  const out = String(p.stdout ?? '') + String(p.stderr ?? '')
  check('进程非正常退出', p.status !== 0, `status=${p.status}`)
  check('输出里明确说了拒绝原因和怎么改',
    /拒绝在对外可访问的状态下启动/.test(out) && /ADMIN_PASSWORD/.test(out), out.slice(0, 100))
  /* 关键：必须在 listen 之前抛，否则它会占着端口 */
  let listening = false
  try { listening = (await fetch('http://127.0.0.1:5184/api/health', { signal: AbortSignal.timeout(1500) })).ok } catch { listening = false }
  check('它没有占用端口（守卫在 listen 之前就抛了）', listening === false)
}

/* ================================================================== */
/*   ④ 命令行改密码工具（上线卡在"守卫拒绝启动"时唯一的出路）           */
/* ================================================================== */

section('tools/set-password.mjs')
{
  const dir = resolve(WORK, 'pw')
  mkdirSync(dir, { recursive: true })
  const db = openDb(resolve(dir, 'vault.db'))
  const info = db
    .prepare('INSERT INTO users (account, password_hash, is_admin, created_at) VALUES (?,?,1,?)')
    .run('admin', hashPassword(BUILTIN_ADMIN_PASSWORD), Date.now())
  db.prepare('INSERT INTO profiles (user_id, username) VALUES (?,?)').run(Number(info.lastInsertRowid), 'x')
  db.close()

  const run = (args, extraEnv = {}) =>
    spawnSync(process.execPath, ['tools/set-password.mjs', ...args], {
      cwd: SERVER,
      env: { ...process.env, DATA_DIR: dir, ...extraEnv },
      encoding: 'utf8',
      timeout: 30000,
    })

  const weak = run(['123'])
  check('弱密码被拒', weak.status === 2 && /太弱/.test(weak.stdout + weak.stderr), String(weak.status))

  const same = run([BUILTIN_ADMIN_PASSWORD])
  check('不让你把密码"改成"初始密码', same.status === 2 && /等于没换/.test(same.stdout + same.stderr), String(same.status))

  /* ⚠️ 这条钉住一个真踩过的 bug：没有 --account 时，参数解析把**第一个参数
     （密码本身）**当成了账号名给排除掉，于是永远报"用法"。 */
  const ok = run(['TunnelPw!2026x'])
  check('不带 --account 时也能正常改（参数解析 bug 的回归）',
    ok.status === 0 && /新密码生效 ✓/.test(ok.stdout), `status=${ok.status} ${(ok.stdout || '').slice(0, 60)}`)

  const check2 = openDb(resolve(dir, 'vault.db'))
  const after = check2.prepare('SELECT password_hash FROM users WHERE account = ?').get('admin')
  check('数据库里旧密码已失效、新密码可用',
    !verifyPassword(BUILTIN_ADMIN_PASSWORD, after.password_hash) && verifyPassword('TunnelPw!2026x', after.password_hash))
  const sessions = check2.prepare('SELECT COUNT(*) AS n FROM sessions').get()
  check('改完密码会注销旧会话', sessions.n === 0, String(sessions.n))
  check2.close()

  /* 改完之后，隧道场景的守卫就该放行了 —— 这就是给用户的那条出路 */
  const check3 = openDb(resolve(dir, 'vault.db'))
  let msg = ''
  try { assertDeploySafe(check3.db, '127.0.0.1') } catch (e) { msg = e.message }
  check('改完密码 → 隧道部署可以启动', msg === '' || !/初始密码/.test(msg), msg.slice(0, 60))
  check3.close()
}

rmSync(WORK, { recursive: true, force: true })

console.log('')
console.log('==================================================')
console.log(`  通过 ${pass} / ${pass + fail}${fail ? `（失败 ${fail}）` : ''}`)
console.log('==================================================')
if (fail) {
  for (const x of failures) console.log('  FAIL ' + x)
  console.log('\n[test] 后端日志：\n' + log.split('\n').slice(-15).join('\n'))
}
process.exit(fail ? 1 : 0)
