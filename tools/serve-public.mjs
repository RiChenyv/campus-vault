/**
 * 一键上线：**起生产服务 + 开 Cloudflare 隧道**，把公网网址打印出来。
 *
 * 和 `tools/dev.mjs` 的区别：
 *   · dev.mjs 起的是**开发服务器**（vite，有热更新，只给本机用）
 *   · 这个起的是**生产形态**：后端直接托管 `dist/`（构建产物），一个进程一个端口，
 *     再用 cloudflared 的 quick tunnel 给它一个 https 网址
 *
 * 为什么自动设 `PUBLIC_DEPLOY=1`：
 *   隧道是"客户端在本机连后端"，所以后端仍然只听 127.0.0.1（**这是更安全的做法**，
 *   端口不对局域网开放）。但网站此刻**确实是公开的** —— 只看 HOST 会误判成"本地自用"，
 *   于是密码/注册这些检查全被跳过。所以由启动器显式告诉它："这是对外部署"。
 *   想强制什么，见 `server/src/lib/deploy.ts`。
 *
 * 用法：
 *   node tools/serve-public.mjs                 # 默认 5175，读 上线.env
 *   node tools/serve-public.mjs --port 5190     # 换端口
 *   node tools/serve-public.mjs --env 别的.env   # 换配置文件（测试用）
 *   node tools/serve-public.mjs --no-tunnel     # 只起服务，不开隧道
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TMP = resolve(ROOT, '.tmp')
if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true })

const argv = process.argv.slice(2)
const argOf = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : ''
}
const PORT = Number(argOf('--port') || process.env.PORT || 5175)
const NO_TUNNEL = argv.includes('--no-tunnel')
const ENV_FILE = resolve(ROOT, argOf('--env') || '上线.env')
const ENV_SAMPLE = resolve(ROOT, '上线.env.example')
const ENV_SAMPLE = resolve(ROOT, '上线.env.example')
const CLOUDFLARED = [
  resolve(ROOT, 'tools', 'cloudflared.exe'),
  resolve(ROOT, 'tools', 'cloudflared'),
].find((p) => existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const kids = []
let shuttingDown = false

const line = (s = '') => console.log(s)
const die = (msg) => {
  console.error('')
  console.error('  ✗ ' + msg)
  console.error('')
  shutdown(1)
}

function portBusy(port) {
  return new Promise((res) => {
    const sock = connect({ host: '127.0.0.1', port })
    const done = (v) => {
      sock.destroy()
      res(v)
    }
    sock.setTimeout(1200)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const k of kids) {
    try {
      if (k.pid) {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(k.pid), '/T', '/F'], { stdio: 'ignore' })
        else k.kill('SIGTERM')
      }
    } catch {
      /* 已经没了 */
    }
  }
  setTimeout(() => process.exit(code), 400)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

line('')
line('  Campus Vault · 上线启动（生产形态 + 公网隧道）')
line('  ────────────────────────────────────────────')

/* ---------------------------- 1. 检查构建产物 ---------------------------- */
if (!existsSync(resolve(ROOT, 'dist', 'index.html'))) {
  line('  [!] 没有找到 dist/，先构建前端（约 30 秒）…')
  const r = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['build'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (r.status !== 0 || !existsSync(resolve(ROOT, 'dist', 'index.html'))) {
    die('构建失败。先在项目根目录手动跑 `pnpm build`，看看报什么错。')
  }
}

/* ---------------------------- 2. 检查配置文件 ---------------------------- */
if (!existsSync(ENV_FILE)) {
  console.error('')
  console.error(`  ✗ 没有配置文件：${ENV_FILE}`)
  console.error('')
  console.error('    请先复制一份模板再改：')
  console.error(`      复制  ${ENV_SAMPLE}`)
  console.error(`      到    ${ENV_FILE}`)
  console.error('    至少把 ADMIN_PASSWORD 改成你自己的密码（其它项模板里有说明）。')
  console.error('')
  console.error('    想跳过这步、只在本机试：node tools/serve-public.mjs --no-tunnel')
  console.error('    （本机试的时候不会走对外检查；一旦开隧道就会被拦）')
  console.error('')
  shutdown(1)
}

/* ---------------------------- 3. 端口 ---------------------------------- */
if (await portBusy(PORT)) {
  die(
    `端口 ${PORT} 已被占用。多半是你的开发窗口（启动网站.bat）还开着 ——\n` +
      '     先关掉那个窗口再跑这个；或者换个端口：node tools/serve-public.mjs --port 5190',
  )
}

/* ---------------------------- 4. 起后端 --------------------------------- */
const serverEnv = {
  ...process.env,
  TMP,
  TEMP: TMP,
  PORT: String(PORT),
  /* 关键：告诉后端"这是对外部署"，于是密码/注册那些守卫会生效 */
  PUBLIC_DEPLOY: '1',
}
line(`  [1/2] 启动服务  http://127.0.0.1:${PORT}   （配置：上线.env）`)
const backend = spawn(process.execPath, [`--env-file=${ENV_FILE}`, 'src/index.ts'], {
  cwd: resolve(ROOT, 'server'),
  env: serverEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
})
kids.push(backend)

/* 后端如果被守卫拦下，会直接退出并打印中文原因 —— 原样转出来，别吞掉 */
let refused = ''
backend.stdout.on('data', (d) => {
  const s = d.toString()
  refused += s
  process.stdout.write(s)
})
backend.stderr.on('data', (d) => {
  const s = d.toString()
  refused += s
  process.stderr.write(s)
})

let ready = false
for (let i = 0; i < 40; i++) {
  if (backend.exitCode !== null) break
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1200) })
    if (r.ok) {
      ready = true
      break
    }
  } catch {
    /* 还没起来 */
  }
  await sleep(400)
}

if (!ready) {
  if (backend.exitCode !== null) {
    console.error('')
    console.error('  ✗ 服务没能启动（已经退出）。上面的中文提示就是要你做的修改，常见两种：')
    console.error('      · 管理员密码还是初始值 → 在 server 目录跑：')
    console.error("          node tools/set-password.mjs '你的新密码'")
    console.error('      · 上线.env 里没设 ADMIN_PASSWORD')
    console.error('')
    if (/拒绝|ADMIN_PASSWORD|初始密码/.test(refused)) {
      console.error('    （后端明确说了是安全守卫拦下的，照着改就行，这是设计好的拦截。）')
    }
  } else {
    console.error(`  ✗ 服务在 16 秒内没就绪，端口 ${PORT}`)
  }
  shutdown(1)
}

line('  [2/2] 打开公网隧道…')
if (NO_TUNNEL) {
  line('')
  line(`  ✓ 服务已就绪（没开隧道）  →  http://127.0.0.1:${PORT}`)
  line('  ────────────────────────────────────────────')
  line('  关掉本窗口即停止服务')
  line('')
} else if (!CLOUDFLARED) {
  console.error('')
  console.error('  ✗ 没找到 cloudflared（隧道客户端）。')
  console.error('    下载：https://github.com/cloudflare/cloudflared/releases/latest')
  console.error(`    把 cloudflared-windows-amd64.exe 放到：${resolve(ROOT, 'tools', 'cloudflared.exe')}`)
  console.error('    然后重新运行本脚本。')
  console.error('')
  console.error(`    （服务本身是好的，本机可以先用：http://127.0.0.1:${PORT}）`)
  console.error('')
  shutdown(1)
} else {
  const tunnel = spawn(CLOUDFLARED, ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--no-autoupdate'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  kids.push(tunnel)

  /* quick tunnel 会把网址打印在 **stderr** 上，形如：
     |  https://random-words-here.trycloudflare.com    |
     两路都扫，扫到就把网址亮出来。 */
  let publicUrl = ''
  let tail = ''
  const scan = (buf) => {
    const s = buf.toString()
    tail = (tail + s).slice(-4000)
    const m = tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
    if (m && !publicUrl) {
      publicUrl = m[0]
      writeFileSync(resolve(TMP, 'public-url.txt'), publicUrl + '\n', 'utf8')
      line('')
      line('  ════════════════════════════════════════════')
      line('   ✓ 公网网址（在任何设备上都能打开）')
      line('')
      line('     ' + publicUrl)
      line('')
      line('  ════════════════════════════════════════════')
      line('   · 这个网址是 Cloudflare 临时分配的，**每次重启都会变**')
      line('   · 想要固定网址：注册 Cloudflare（免费）后 cloudflared tunnel login，')
      line('     建一个命名隧道，把 config.yml 指向 http://127.0.0.1:' + PORT)
      line('   · 登录用的是你自己的账号密码（改过初始密码才允许对外启动）')
      line('   · 关掉本窗口 = 网站下线')
      line('')
    }
  }
  tunnel.stdout.on('data', scan)
  tunnel.stderr.on('data', scan)
  tunnel.on('exit', (code) => {
    if (shuttingDown) return
    console.error(`\n  ✗ 隧道退出了（code ${code}）。服务还在本机跑着：http://127.0.0.1:${PORT}`)
    shutdown(code ?? 1)
  })

  for (let i = 0; i < 30; i++) {
    if (publicUrl || shuttingDown) break
    await sleep(1000)
  }
  if (!publicUrl && !shuttingDown) {
    console.error('')
    console.error('  ✗ 30 秒内没拿到隧道网址。可能的原因：')
    console.error('     · 网络不通（cloudflared 需要访问 Cloudflare）')
    console.error('     · 公司/校园网限制了出站连接')
    console.error('    下面是 cloudflared 的原始输出，看看它说了什么：')
    console.error('     ' + tail.split('\n').slice(-6).join('\n     '))
    console.error('')
    shutdown(1)
  }
}

/* 保持前台运行；Ctrl+C / 关窗口 → shutdown 会把两个子进程一起收掉 */
await new Promise(() => {})
