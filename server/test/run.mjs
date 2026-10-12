/**
 * 测试运行器。
 *
 * 每次运行都：删掉测试数据目录 → 起一个独立端口的服务 → 等健康检查通过
 * → 跑 api.test.mjs → 关服务。
 *
 * 为什么要这么麻烦：测试里有若干"数量相等"的断言（灵感两条、搜索命中一条），
 * 在脏数据库上重跑会误报。让每次运行都从零开始，比把断言全改成相对判断更可靠 ——
 * 也顺带验证了"全新部署能否正常初始化"这条路径。
 */

import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(HERE, '..')
const DATA_DIR = resolve(SERVER, 'data-test')
const PORT = 5176
const BASE = `http://127.0.0.1:${PORT}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await rm(DATA_DIR, { recursive: true, force: true })
console.log(`[test] 已重置测试数据目录 ${DATA_DIR}`)

const child = spawn(process.execPath, ['src/index.ts'], {
  cwd: SERVER,
  env: { ...process.env, PORT: String(PORT), DATA_DIR, TMP: process.env.TMP, TEMP: process.env.TEMP },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverLog = ''
child.stdout.on('data', (d) => {
  serverLog += d.toString()
})
child.stderr.on('data', (d) => {
  serverLog += d.toString()
})

const stop = () => {
  if (!child.killed) child.kill('SIGKILL')
}

// 等服务起来
let up = false
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${BASE}/api/health`)
    if (r.ok) {
      up = true
      break
    }
  } catch {
    /* 还没起来 */
  }
  await sleep(250)
}

if (!up) {
  console.error('[test] 服务未能启动，日志：')
  console.error(serverLog)
  stop()
  process.exit(1)
}
console.log(`[test] 服务已就绪 ${BASE}`)

// 跑测试
const test = spawn(process.execPath, [resolve(HERE, 'api.test.mjs')], {
  cwd: SERVER,
  env: { ...process.env, TEST_BASE: BASE },
  stdio: 'inherit',
})

const code = await new Promise((res) => test.on('exit', (c) => res(c ?? 1)))
stop()
await sleep(300)

if (serverLog.trim()) {
  // 只在测试失败时把服务端日志打出来，便于定位
  if (code !== 0) {
    console.log('')
    console.log('[test] 服务端日志：')
    console.log(serverLog)
  }
}

process.exit(code)
