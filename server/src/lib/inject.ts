/**
 * 把共享的解析逻辑与油猴脚本外壳拼成最终产物。
 *
 * 为什么在**服务端拼接**而不是各写一份：
 * 解析规则是跟着学校页面改版走的。抄成两份 = 改版时要记得改两处，
 * 早晚漏一处，然后一个入口能用、另一个静默失效 —— 这类 bug 最难发现。
 * 现在 parse.js 是唯一真相，油猴脚本外壳从它生成。
 *
 * 产物本身不缓存：文件很小（几十 KB），读盘成本可忽略，
 * 而开发时改了 parse.js 能立刻生效，不用重启。
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const INJECT_DIR = resolve(HERE, '../../inject')

const read = (name: string) => readFileSync(resolve(INJECT_DIR, name), 'utf8')

/** 去掉文件头部的块注释，拼进产物时不需要那些说明 */
const stripLeadingComments = (src: string) => src.replace(/^\s*(\/\*[\s\S]*?\*\/\s*)+/, '')

/**
 * 油猴脚本的版本号。**每次请求都从 `inject/VERSION` 读**，不是模块常量。
 *
 * 为什么非这样不可：模块常量在**进程启动那一刻**就固化了，而 Tampermonkey
 * 只看版本号决定要不要更新。于是"改了脚本、没重启后端"时，用户拿到的脚本
 * **内容是新、版本号是旧** —— Tampermonkey 认为"已经是最新"，**拒绝更新**，
 * 用户怎么点都是老脚本。这个坑真踩过两次，害用户白重启了两回。
 *
 * 版本历史（改这里没用，要改 `inject/VERSION`）：
 *   1.7.0  成绩导入：自动翻页 + 三步面板
 *   1.7.1  修「成绩页上按钮不变「导入成绩」」（只查两次、错过就不补）
 *   1.7.2  修「什么都没发就弹『导入完成』」（假的成功提示）
 *   1.7.3  修「认出了成绩页却一行都解析不出来」（固定表头拆成两张表）
 *   1.7.4  按用户真实页面的诊断信息再修：表头在表格外（div）、
 *          行里有隐藏克隆格、还有一张重复的数据表
 *   1.8.0  删除书签脚本（用户嫌麻烦）与 cvGradePages 自动翻页采集循环；
 *          面板文案不再声称"会自动翻页"
 *   1.9.0  课表不再由脚本导入：删掉教务课表页（bkjw）的整套解析与「调课信息」
 *          展示，改由「教务系统导出 xlsx → 导入页上传文件」（lib/timetableXlsx.ts）。
 *          脚本遇到课表页会给明确指引，而不是含糊的"没识别到内容"。
 */
export function userscriptVersion(): string {
  try {
    return read('VERSION').trim() || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * 产物必须还能解析 —— 这一条挡的是"生成一份点不动的脚本让用户去猜"。
 * `new Function` 只编译不执行，正好用来做语法检查。
 */
function assertParses(code: string, what: string) {
  try {
    new Function(code)
  } catch (e) {
    /* ⚠️ 这里刻意不用模板字符串：Node 的类型擦除遇到模板字符串里插类型断言
       （或注释里带反引号）会直接 ERR_INVALID_TYPESCRIPT_SYNTAX ——
       是**加载期**就挂，不是运行时错。普通拼接最稳。 */
    const why = e instanceof Error ? e.message : String(e)
    throw new Error(what + '拼接后语法不合法：' + why)
  }
}

/** 生成完整的油猴脚本（.user.js） */
export function buildUserscript(api: string): string {
  const parse = stripLeadingComments(read('parse.js')).trim()
  const shell = read('userscript.js').trim()

  /* ⚠️ 用 split/join 而不是 String.replace：替换串里的 `$` 有特殊含义
     （`$$` 表示一个字面 `$`），地址里万一带 `$` 就会被悄悄改写。
     这个坑在本项目里踩过两次，见交接文档「踩过的坑」第 1 条。 */
  const withApi = shell.split('__CV_API_BASE__').join(api.replace(/\\/g, '\\\\').replace(/'/g, "\\'"))

  /* @connect 必须跟着后端地址走：Tampermonkey 只放行这里列出的主机。
     写死 127.0.0.1 的话，公网部署后 GM_xmlhttpRequest 会被扩展自己拦掉，
     表现是"点了导入没反应"（请求根本没发出去）。 */
  const apiHost = (() => {
    try {
      return new URL(api).hostname
    } catch {
      return '127.0.0.1'
    }
  })()

  const header = `// ==UserScript==
// @name         Campus Vault 导入助手
// @namespace    ${api.replace(/\/api$/, '')}/
// @version      ${userscriptVersion()}
// @description  把学校网站的课程、个人信息一键导入本地课程知识库
// @author       Campus Vault
// @match        https://*.cuc.edu.cn/*
// @match        http://*.cuc.edu.cn/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      ${apiHost}
// @run-at       document-idle
// ==/UserScript==
`

  const out = `${header}\n${parse}\n\n${withApi.replace('/* __CV_HEADER__ */', '')}\n`
  /* 在**服务端**就编译一遍：坏法（`$$` 被改成 `$`、行注释吃掉后面的代码…）
     的共同点是语法仍然合法，装进浏览器之后只在运行时静默失效。
     这里挡一道，改坏了当场 500，而不是让用户去猜"怎么点了没反应"。 */
  assertParses(out.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/m, ''), '油猴脚本')
  return out
}

/**
 * 导入产物的指纹，用于"脚本是否已更新"的判断。
 * 改了 parse.js 之后版本号不变，但指纹会变 —— UI 据此提示用户重新安装。
 */
export function injectFingerprint(): string {
  const all = read('parse.js') + read('userscript.js')
  let h = 2166136261
  for (let i = 0; i < all.length; i++) {
    h ^= all.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}
