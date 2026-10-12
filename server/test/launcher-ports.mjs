/**
 * 启动器（快捷方式）在"端口已被占用"时的行为。
 *
 * 用户报告「快捷方式又不能用了」。
 *
 * 实际情况是：**网站本来就在跑**，而启动器一看到端口被占就直接退出码 1 +
 * 一句「端口已被占用」—— 双击快捷方式的人看到窗口一闪、留下一句报错，
 * 自然认为"坏了"。
 *
 * 双击快捷方式的期望是**打开网站**。所以这里要区分两种情况：
 *  ① 占用者就是本站自己 → 直接开浏览器，退出码 0
 *  ② 占用者是别的程序，或只剩一个半死的残留 → 报错，并说清是哪种
 *
 * 只测 ① 是不够的：如果逻辑写成"端口被占就无脑开浏览器"，
 * 那么端口被别的程序占用时也会假装成功，反而更难排查。
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

const ROOT = 'D:\\MyWeb'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

/** 跑一次启动器，收集输出与退出码（5 秒内没退出就杀掉） */
function runLauncher(timeoutMs = 9000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['tools/dev.mjs'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TMP: `${ROOT}\\.tmp`, TEMP: `${ROOT}\\.tmp` },
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    let done = false
    const finish = (code, killed) => {
      if (done) return
      done = true
      resolve({ code, out, killed })
    }
    child.on('exit', (code) => finish(code, false))
    setTimeout(() => {
      /* 必须杀整棵树：child.kill() 只结束启动器自己，
         它拉起的后端和 vite 会变成孤儿继续占着 5174/5175，
         下一个场景就会误判成"端口被别的程序占用"。 */
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      } catch {
        child.kill('SIGKILL')
      }
      finish(null, true)
    }, timeoutMs)
  })
}

const portBusy = async (port) => {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(700) })
    return true
  } catch {
    return false
  }
}

/* ── 前置：两个端口都得是空的，否则结果不可信 ── */
console.log('=== 前置检查 ===')
for (const p of [5174, 5175]) {
  if (await portBusy(p)) {
    console.log(`  !! 端口 ${p} 已被占用，请先关掉服务器再跑这个测试`)
    process.exit(1)
  }
}
console.log('  5174 / 5175 都空闲 ✓')
console.log('')

/* ── 场景 A：端口空闲 → 应该真的把服务起起来 ── */
console.log('=== 场景 A：端口空闲时启动 ===')
const a = await runLauncher(9000)
console.log('  退出码:', a.code, a.killed ? '(仍在运行，已杀掉)' : '')
const startedApi = a.out.includes('启动后端')
check('识别为需要启动（不是"已在运行"）', startedApi)
check('确实拉起了服务（没退化成直接退出）', a.killed === true, a.killed ? '' : '竟然自己退出了')

/* 场景 A 结束后等端口真正释放，否则后面几个场景的"占位"前提都是错的 */
let freed = false
for (let i = 0; i < 20; i++) {
  if (!(await portBusy(5174)) && !(await portBusy(5175))) { freed = true; break }
  await sleep(500)
}
check('场景 A 结束后端口已释放', freed)

/* ── 场景 B：端口被"本站自己"占用 → 应该开浏览器并成功退出 ── */
console.log('')
console.log('=== 场景 B：占位者是本站自己 ===')

/* 用真实的服务器来占位，而不是随便起个 http 服务 ——
   启动器会去 /api/health 认 service 名，假的服务认不出来。 */
const real = spawn(process.execPath, ['tools/dev.mjs'], {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, TMP: `${ROOT}\\.tmp`, TEMP: `${ROOT}\\.tmp` },
})
/* **两个端口都要就绪**再往下走。
   只等后端是不够的：vite 比后端慢一拍，此时 5174 还没起来，
   启动器会判成"只剩一个半死的残留"而不是"网站已在运行" —— 上一版就栽在这。 */
let ready = false
for (let i = 0; i < 60; i++) {
  try {
    const [a, b] = await Promise.all([
      fetch('http://127.0.0.1:5175/api/health', { signal: AbortSignal.timeout(800) }),
      fetch('http://127.0.0.1:5174/', { signal: AbortSignal.timeout(800) }),
    ])
    if (a.ok && b.ok) { ready = true; break }
  } catch { /* 还没起来 */ }
  await sleep(500)
}
check('前后端都已就绪（用于占位）', ready)

/* 就绪之后再**单独确认一次两个端口都在听**。
   上一版只看 fetch 成功就往下走，而启动器判"已在运行"要求两个端口都忙 ——
   中间任何一点抖动都会让它走进报错分支，测试就假失败了。 */
let bothBusy = false
for (let i = 0; i < 20; i++) {
  if ((await portBusy(5174)) && (await portBusy(5175))) { bothBusy = true; break }
  await sleep(400)
}
check('两个端口确实都在监听（启动器判定的前提）', bothBusy)

const b = await runLauncher(9000)
console.log('  退出码:', b.code, b.killed ? '(仍在运行)' : '')
console.log('  输出:', b.out.split('\n').filter(Boolean).map((s) => s.trim()).join(' | ').slice(0, 170))
check('识别出"网站已经在运行"', b.out.includes('已经在运行'))
/* 退出码 3 = "网站本来就在运行，我只开了浏览器"。
   刻意不用 0：.bat 要靠它区分该说"已在运行"还是"服务器已停止"。
   用 0 的话两种情况混在一起，bat 会对着还在跑的网站说"服务器已停止"。 */
check('**退出码是 3（已在运行，不是报错也不是普通退出）**', b.code === 3, `code ${b.code}`)
check('没有再起一套服务', b.out.includes('启动后端') === false)
check('给出了可点击的地址', b.out.includes('5174'))

/* ── 场景 C：端口被"别的程序"占用 → 必须报错，不能假装成功 ── */
console.log('')
console.log('=== 场景 C：占位者是别的程序 ===')

// 先把真实服务器收掉
real.kill('SIGKILL')
await sleep(2500)

/* 起两个假服务占住端口。它们的 /api/health 不会返回本站的 service 名，
   前端页面的 HTML 里也没有 Campus Vault。 */
const fakes = []
for (const port of [5174, 5175]) {
  const srv = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<html><head><title>别的程序</title></head><body>not campus vault</body></html>')
  })
  await new Promise((r) => srv.listen(port, '127.0.0.1', r))
  fakes.push(srv)
}
console.log('  已用"别的程序"占住 5174 / 5175')

const c = await runLauncher(9000)
console.log('  退出码:', c.code, c.killed ? '(仍在运行)' : '')
console.log('  输出:', c.out.split('\n').filter(Boolean).map((s) => s.trim()).join(' | ').slice(0, 200))
check('**认出占位者不是本站**', c.out.includes('不像是本站自己'), c.out.slice(0, 80))
check('**报错退出（没有假装成功）**', c.code === 1, `code ${c.code}`)
check('提示里说明了怎么清理', c.out.includes('taskkill'))

for (const s of fakes) s.close()
await sleep(800)
console.log('')
console.log('已收掉假服务')

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')
process.exit(fails.length ? 1 : 0)
