/**
 * 开发环境启动器：**同时**拉起后端与前端，并保证一起退出。
 *
 * 为什么需要它：
 * `pnpm dev` 只跑 vite（前端 5174），后端（5175）不在里面。
 * 前端所有 /api 请求都代理到 5175，后端没起 → 登录失败 → 网站看起来"打不开"。
 * 而开两个窗口的话，用户关掉一个另一个还在跑，下次启动就撞端口。
 * 所以合成一个进程树：Ctrl+C 或关窗口，两个一起收掉。
 *
 * stdio 用 'inherit' 而不是 'pipe'：
 * 一是保留两个子进程各自的原色输出（vite 的进度、后端的日志都好看）；
 * 二是受限环境下管道 stdio 会 EPERM，inherit 不受影响。
 */

import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TMP = resolve(ROOT, '.tmp')
if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true })

const API = 'http://127.0.0.1:5175'
const WEB = 'http://127.0.0.1:5174'

const env = { ...process.env, TMP, TEMP: TMP }
const children = []
let shuttingDown = false

/* ------------------------------ 端口清理 ------------------------------ */

/**
 * 端口上有没有人在听。
 *
 * ⚠️ 用 **TCP 连接**判断，不要用 HTTP GET。
 * 原来用 `fetch('http://127.0.0.1:' + port + '/')` + 超时，结果：
 *   · 后端 5175 秒回 → 判为占用 ✓
 *   · vite 5174 冷启动后**首次请求要 2 秒以上** → 超时 → 被判成"端口空闲" ✗
 * 于是启动器以为前端没起，走进错误分支。
 * "有没有人在听"本来就是 TCP 层的问题，connect 一瞬就能答，也不必关心
 * 对端 HTTP 有多慢。
 */
function portBusy(port) {
  return new Promise((resolve) => {
    const sock = connect({ host: '127.0.0.1', port })
    const done = (v) => {
      sock.destroy()
      resolve(v)
    }
    sock.setTimeout(1500)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (r.status < 500) return true
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.error(`\n[启动器] ${label} 在 30 秒内没有就绪：${url}`)
  return false
}

/* ------------------------------ 子进程 ------------------------------ */

function start(name, cmd, args, cwd) {
  /* 不用 shell:true —— 它会把参数拼成字符串再交给 cmd，
     既触发 Node 的 DEP0190 警告，也会让含空格的路径出问题。
     直接调 .cmd / .exe 更干净。 */
  const child = spawn(cmd, args, { cwd, env, stdio: 'inherit' })
  child.on('error', (e) => {
    console.error(`\n[启动器] ${name} 起不来：${e.message}`)
    shutdown(1)
  })
  child.on('exit', (code) => {
    if (shuttingDown) return
    // 任何一个先挂掉，就把另一个也收掉 —— 否则会留下"半死"的环境，
    // 用户看到前端还在，但所有请求都 502，比直接退出更难判断
    console.error(`\n[启动器] ${name} 退出了（code ${code}），正在停止另一个…`)
    shutdown(code ?? 1)
  })
  children.push({ name, child })
  return child
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const { child } of children) {
    if (!child.killed) {
      try {
        // Windows 上 child.kill 杀不掉 pnpm 拉起的孙进程，用 taskkill 连树一起收
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        } else {
          child.kill('SIGTERM')
        }
      } catch { /* 已经没了 */ }
    }
  }
  setTimeout(() => process.exit(code), 500)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

/* 判断占用端口的是不是"已经在正常运行的自己"。
   用户双击快捷方式的期望是**打开网站**，而不是看到一句报错 ——
   如果网站本来就在跑，正确反应是把浏览器开过去。 */
async function ourBackendOn(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(6000) })
    if (!r.ok) return false
    const j = await r.json()
    return j?.data?.service === 'campus-vault-server'
  } catch {
    return false
  }
}

async function ourFrontendOn(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(6000) })
    if (!r.ok) return false
    const html = await r.text()
    return /Campus Vault/.test(html)
  } catch {
    return false
  }
}

function openInBrowser(url) {
  try {
    if (process.platform === 'win32') {
      // `cmd /c start "" <url>`：空引号是 start 的窗口标题位，不能省
      spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref()
    } else {
      spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
    }
  } catch { /* 打不开就算了，地址已经打印出来了 */ }
}

/* ------------------------------ 主流程 ------------------------------ */

console.log('')
console.log('  Campus Vault · 我的课程知识库')
console.log('  ────────────────────────────────────────────')

/* 主流程放进带标签的块。
   顶层 ESM 里不能 return，而 process.exitCode **不会中断执行** ——
   端口被占时若不跳出去，下面会继续把服务再起一套。 */
main: {
const apiBusy = await portBusy(5175)
const webBusy = await portBusy(5174)

if (apiBusy || webBusy) {
  /* 端口被占的两种情形要分开处理：
     ① 站点本来就在跑（前后端都在、都能认出是 Campus Vault）
        → 直接开浏览器，退出码 0。这才是用户双击快捷方式想要的结果。
     ② 别的程序占着，或只剩一个"半死"的残留
        → 报错，而且要说清是哪种，别让人以为是自己的问题。 */
  const oursApi = apiBusy ? await ourBackendOn(5175) : false
  /* 前端身份**不靠抓 HTML** 判断。
     vite 冷启动后的首次响应要十几秒（依赖预构建），抓 HTML 超时会被误判成
     "5174 被别的程序占用" —— 这一条卡了很久。
     而启动器永远是前后端一起管：后端确认是本站 + 5174 有人在听，
     就足以认定前端也是本站的。抓 HTML 只当补充证据（成功才加分）。 */
  const oursWeb = webBusy ? oursApi || (await ourFrontendOn(5174)) : false

  if (apiBusy && webBusy && oursApi && oursWeb) {
    console.log('  ✓ 网站已经在运行了，直接打开浏览器')
    console.log('  →  ' + WEB)
    console.log('  ────────────────────────────────────────────')
    console.log('  （不需要重复启动。要重启就先关掉原来那个窗口）')
    console.log('')
    openInBrowser(WEB)
    /* ⚠️ 用 exitCode，不要用 process.exit()：
       端口探测用的 fetch 会留下 undici 的 keep-alive socket，硬退会触发
       libuv 的 UV_HANDLE_CLOSING 断言、进程以 0xC0000409 崩溃，脚本没法判断成败。
       而 exitCode **不会中断执行** —— 必须自己 break 出去，否则下面会继续把服务
       再起一套。（这两个坑都踩过。）

       退出码用 **3** 而不是 0：这是"网站本来就在运行、我只开了浏览器"。
       .bat 靠它区分该说"网站已在运行"还是"服务器已停止" ——
       原来两种情况都是 0，bat 于是对着一个还在跑的网站说「服务器已停止」，
       用户以为挂了去刷新，反而看到拒绝连接。 */
    process.exitCode = 3
    break main
  }

  console.error('  ✗ 端口被占用，而且不像是本站自己在跑：')
  if (apiBusy) {
    console.error(`     · 5175（后端）${oursApi ? '是本站后端' : '**被其它程序占用**'}`)
  }
  if (webBusy) {
    console.error(`     · 5174（前端）${oursWeb ? '是本站前端' : '**被其它程序占用**'}`)
  }
  console.error('')
  console.error('    如果确实是自己上次没关干净，运行： taskkill /f /im node.exe')
  process.exitCode = 1
  break main
}

console.log('  [1/2] 启动后端  http://127.0.0.1:5175')
start('后端', process.execPath, ['src/index.ts'], resolve(ROOT, 'server'))

if (!(await waitFor(`${API}/api/health`, '后端'))) shutdown(1)

console.log('  [2/2] 启动前端  http://127.0.0.1:5174')
/* 直接跑 vite 的入口脚本，不经 pnpm：
   Windows 上 Node 20+ 为修 CVE-2024-27980 禁止不经 shell 直接 spawn `.cmd`，
   而绕回 shell:true 又会触发 DEP0190（参数不转义）。
   直接 `node vite.js` 两条都避开，效果与 `pnpm exec vite` 一致。 */
start('前端', process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js')], ROOT)

if (!(await waitFor(WEB, '前端'))) shutdown(1)

console.log('')
console.log('  ✓ 就绪  →  ' + WEB)
console.log('  ────────────────────────────────────────────')
console.log('  关闭本窗口（或按 Ctrl+C）即同时停止前后端')
console.log('')

// 自动开浏览器（只在就绪之后，避免打开一个报错的页面）
openInBrowser(WEB)

} /* main */
