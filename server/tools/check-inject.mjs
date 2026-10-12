/**
 * 拼接产物的自检。
 *
 * 存在的原因是一类**静默**故障：产物语法合法、装上去也不报错，
 * 但就是"点了没反应"。已经踩过三次：
 *
 *  ① `String.replace()` 的**替换串里 `$$` 表示一个字面 `$`**，
 *     用脚本改代码时任何 `$$(...)` 会被改成 `$(...)`，语法仍合法，
 *     运行时才炸（`$$ is not defined`）。踩过两次。
 *  ② （历史）书签脚本的产物原来被**压成一行**，于是两个斜杠的行注释把后面
 *     整份脚本注释掉了 —— 点书签毫无反应。书签脚本 2026-10 已整体移除。
 *  ③ （历史）同一个压平过程还会让"独占一行的 return"和下一行粘成
 *     `return var x = ...`（ASI 不再成立），也是语法错。
 *
 * 所以这里检查的不是"字符串好不好看"，而是**产物能不能跑**：
 * 整份编译一遍（只编译不执行）。
 *
 * 两个入口都试：
 *   · 后端在跑 → 检查**它真正发出去的那份**（用户拿到的就是这份）
 *   · 后端没跑 → 就地构建一份来检查（免得为了跑自检还得先起服务）
 */

import { buildUserscript, userscriptVersion } from '../src/lib/inject.ts'

const API = process.env.CV_API ?? 'http://127.0.0.1:5175'

const problems = []
const note = (ok, what, hint) => {
  console.log(`  ${ok ? 'OK  ' : '**缺**'} ${what}`)
  if (!ok) problems.push(`${what} —— ${hint}`)
}

/** 能不能编译（只编译不执行）。语法错会在这里暴露 */
function parses(code) {
  try {
    new Function(code)
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

function scanUserscript(name, code) {
  console.log(`\n=== ${name}（${code.length} 字符）===`)
  note(/var\s+\$\$\s*=\s*function/.test(code), '定义了 $$', 'var $$ = function (s) 被改写成了 var $ = ...')
  note(!/(^|[^$\w])\$\(/.test(code), '没有裸的 $(', '出现了 $(...) 调用，说明 $$ 被替换成了 $')
  note(code.includes('function cvParse'), '定义了 cvParse', '解析函数缺失')
  /* 书签脚本已删，自动翻页采集循环（cvGradePages）随之移除 ——
     它还在的话说明拼接带上了过期的 parse.js。 */
  note(!code.includes('function cvGradePages'), '没有残留的 cvGradePages（自动翻页已移除）',
    '自动翻页采集循环应该已经删掉了，产物里不该再有它')
  note(code.includes('gradesPage'), '仍然导出分页信息 gradesPage', '面板就不知道"还有下一页，请自己翻页"')
  note(!code.includes('__CV_HEADER__'), '没有裸露的 __CV_HEADER__ 占位', '拼接时占位符没被替换掉')
  note(!code.includes('__CV_API_BASE__'), '后端地址占位符已替换', '脚本会去请求 __CV_API_BASE__，全都连不上')
  const err = parses(code)
  note(!err, '整份脚本能通过语法检查', err)
  const ver = userscriptVersion()
  note(code.includes(ver), `版本号是 ${ver}（来自 inject/VERSION）`,
    '版本号没跟着改的话 Tampermonkey 不会提示更新 —— 但版本号现在每次请求都读文件，不用重启后端')

  const bad = code.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter((x) => /(^|[^$\w])\$\(/.test(x.line))
  if (bad.length) {
    console.log('  可疑行:')
    for (const b of bad.slice(0, 6)) console.log(`    ${b.n}: ${b.line.trim().slice(0, 100)}`)
  }
}

/* ---------------------------- 取产物 ---------------------------- */

/**
 * ⚠️ 全程**不能调 `process.exit()`**。
 *
 * 这个工具会 fetch（拉后端产物）。fetch 留下未关闭的 socket 时，
 * `process.exit()` 会撞 libuv 断言
 * （`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`）——
 * 在 Windows 上表现为进程崩掉、退出码乱掉。这个坑项目里踩过（见交接文档坑 5）。
 * 所以用带标签的块 + `process.exitCode`：正常走完流程，让 Node 自己退出。
 */
main: {
  let usCode = ''
  let source = ''

  try {
    const res = await fetch(`${API}/api/import/userscript.user.js`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    usCode = await res.text()
    source = `后端 ${API} 发出来的`
  } catch (e) {
    console.log(`（后端没在跑：${e instanceof Error ? e.message : e}）`)
    console.log('（改为就地构建一份来检查 —— 检查的是同一份源码）')
    usCode = buildUserscript(`${API}/api`)
    source = '就地构建的'
  }

  console.log(`\n产物来源：${source}`)
  if (source.startsWith('后端')) {
    /* 从后端拉的时候多提一句：**它发的是运行中的那份**。
       改了 inject.ts 却没重启后端时，版本号还是旧的 ——
       Tampermonkey 会因此拒绝更新，用户看到的还是老脚本。 */
    console.log('（注意：这是**运行中的后端**发出来的。改完 inject/*.js 或版本号，记得重启后端。）')
  }
  scanUserscript('油猴脚本', usCode)

  console.log('')
  console.log('==================================================')
  if (problems.length) {
    console.log(`  **发现 ${problems.length} 个问题**`)
    for (const p of problems) console.log('   · ' + p)
    process.exitCode = 1
    break main
  }
  console.log('  产物自检通过')
  console.log('==================================================')
}
