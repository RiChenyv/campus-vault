/**
 * 书签脚本生成器。
 *
 * 把 import.js 的函数体与配置拼成一行 `javascript:` URL。
 * 之所以要"生成"而不是手写死：token 是每个用户一份的，
 * 而且换 token 后旧书签就该失效重生成。
 *
 * 用法：node build.mjs <token> [api]
 *       node build.mjs cvi_xxxx http://127.0.0.1:5175/api
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const token = process.argv[2]
const api = process.argv[3] ?? 'http://127.0.0.1:5175/api'

if (!token) {
  console.error('用法: node build.mjs <token> [api]')
  process.exit(1)
}

const src = readFileSync(resolve(HERE, 'import.js'), 'utf8')

// 只取函数体，去掉文件头注释，压成一行
const start = src.indexOf('function cvImport')
if (start < 0) {
  console.error('找不到 cvImport 函数')
  process.exit(1)
}
const fnSrc = src.slice(start).trim()

const cfg = JSON.stringify({
  api,
  token,
  source: 'bookmarklet@cuc',
})

// javascript: URL 里不能有裸换行；encodeURIComponent 会连函数体一起编码，
// 浏览器照样能执行，但可读性没了 —— 这里选择只压空白，保留可读性便于排查。
const oneLine = fnSrc.replace(/\n\s*/g, ' ').replace(/\s{2,}/g, ' ')
const bookmarklet = `javascript:(${oneLine})(${cfg});void 0`

const out = resolve(HERE, 'bookmarklet.txt')
writeFileSync(out, bookmarklet, 'utf8')

console.log(`已生成 ${out}`)
console.log(`长度 ${bookmarklet.length} 字符`)
console.log('')
console.log('安装方式：新建一个书签，名称随意（如「导入到 Campus Vault」），')
console.log('把下面整行粘到「网址 / URL」栏：')
console.log('')
console.log(bookmarklet)
