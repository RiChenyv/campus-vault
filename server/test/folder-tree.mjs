/**
 * 目录树构建（`buildFolderTree`）的纯函数测试。
 *
 * 为什么单独测它：资料库能不能"一层层点进子文件夹"全看这个函数；
 * 而它只吃 `folder` 字符串、吐树，不需要后端也不需要浏览器。
 *
 * 用真实数据的形状当输入（note 范围实测 1504 个文件 / 260 个目录 / 最深 11 层）。
 */

import { buildFolderTree, byName } from '../../src/lib/folderTree.ts'

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; failures.push(`${name}  ${extra}`); console.log(`FAIL  ${name}${extra ? '  (' + extra + ')' : ''}`) }
}
const section = (t) => { console.log(''); console.log(`--- ${t} ---`) }

/** 造一条文件（只用得到 id / name / folder） */
const f = (folder, name) => ({ id: `${folder}/${name}`, name, folder, kind: 'markdown', size: '1 KB', at: '', courseId: '7', note: '', folderPath: folder, url: '' })

section('嵌套：多层路径要长成树，而不是拍平')
const t1 = buildFolderTree([
  f('PythonProject', 'README.md'),
  f('PythonProject/01-print输出', '01_print基础使用.py'),
  f('PythonProject/01-print输出', 'README.md'),
  f('PythonProject/03-判断语句', 'README.md'),
  f('PythonProject/03-判断语句/if类型的使用', '01_if基础.py'),
  f('PythonProject/03-判断语句/布尔类型和比较运算符', '01_布尔类型.py'),
  f('', '散装笔记.md'),
])
check('散装文件进 loose', t1.loose.length === 1 && t1.loose[0].name === '散装笔记.md', JSON.stringify(t1.loose.map((x) => x.name)))
check('顶层只有一个目录（PythonProject）', t1.folders.length === 1, String(t1.folders.length))

const py = t1.folders[0]
check('顶层目录名与路径正确', py.name === 'PythonProject' && py.path === 'PythonProject', `${py.name} / ${py.path}`)
check('直属文件只算本层的（README.md）', py.files.length === 1 && py.files[0].name === 'README.md', JSON.stringify(py.files.map((x) => x.name)))
check('子目录被建出来了（2 个二层目录）', py.folders.length === 2, JSON.stringify(py.folders.map((n) => n.name)))

const judges = py.folders.find((n) => n.name === '03-判断语句')
check('三层目录存在', !!judges?.folders.find((n) => n.name === 'if类型的使用'), JSON.stringify(judges?.folders.map((n) => n.name)))
check('子目录的 path 是完整相对路径',
  judges?.folders[0]?.path === 'PythonProject/03-判断语句/布尔类型和比较运算符' ||
    judges?.folders[1]?.path === 'PythonProject/03-判断语句/if类型的使用',
  JSON.stringify(judges?.folders.map((n) => n.path)))

section('计数：折叠时要能看出"里面有多少东西"（含子目录）')
check('PythonProject 递归计数 = 6', py.total === 6, String(py.total))
check('03-判断语句 递归计数 = 3', judges?.total === 3, String(judges?.total))
check('空目录概念不存在（只有有文件的目录才会被建出来）',
  py.folders.every((n) => n.total > 0), JSON.stringify(py.folders.map((n) => [n.name, n.total])))

section('有序：目录在前、文件在后，各自按**自然序**')
const t2 = buildFolderTree([
  f('p', '10-系统级IO.md'),
  f('p', '02-信息的表示和处理.md'),
  f('p', '01-计算机系统漫游.md'),
  f('p', '知识点专项梳理.md'),
  f('p', '公式速查.md'),
  f('p/b目录', 'x.md'),
  f('p/a目录', 'x.md'),
])
const p = t2.folders[0]
check('目录排在文件前面', p.folders.length === 2 && p.files.length === 5, `${p.folders.length} 目录 / ${p.files.length} 文件`)
check('目录按名字排（a 在 b 前）', p.folders.map((n) => n.name).join(',') === 'a目录,b目录', p.folders.map((n) => n.name).join(','))
check('文件按**自然序**：01 → 02 → 10，而不是 01 → 10 → 02',
  p.files.map((x) => x.name).join(',') === '01-计算机系统漫游.md,02-信息的表示和处理.md,10-系统级IO.md,公式速查.md,知识点专项梳理.md',
  p.files.map((x) => x.name).join(','))
check('byName 就是自然序（10 排在 2 之后）', byName('2-xx', '10-xx') < 0, String(byName('2-xx', '10-xx')))

section('路径脏数据不能造出假目录')
const t3 = buildFolderTree([
  f('a//b', 'x.md'),
  f('a/b/', 'y.md'),
  f('  c  ', 'z.md'),
  f('/', 'root.md'),
  f('', 'plain.md'),
])
check('`a//b` 与 `a/b/` 归到同一个目录 a/b', t3.folders.length === 2, JSON.stringify(t3.folders.map((n) => n.name)))
const a = t3.folders.find((n) => n.name === 'a')
check('a/b 下有两个文件', a?.folders[0]?.files.length === 2, JSON.stringify(a?.folders[0]?.files.map((x) => x.name)))
check('没有造出名字为空的目录', t3.folders.every((n) => n.name.trim() !== ''), JSON.stringify(t3.folders.map((n) => n.name)))
check('`/` 与空串都算散装', t3.loose.length === 2, JSON.stringify(t3.loose.map((x) => x.name)))
check('首尾空格被去掉（`  c  ` → `c`）', !!t3.folders.find((n) => n.name === 'c'), JSON.stringify(t3.folders.map((n) => n.name)))

section('规模：真实数据的形状（1504 文件 / 260 目录 / 11 层）')
const big = []
for (let i = 0; i < 260; i++) {
  const depth = 1 + (i % 11)
  const parts = []
  for (let d = 0; d < depth; d++) parts.push(`d${i % 7}_${d}`)
  const folder = `root${i % 3}/${parts.join('/')}`
  for (let k = 0; k < 6; k++) big.push(f(folder, `f${k}.py`))
}
const t4 = buildFolderTree(big)
const count = (n) => n.files.length + n.folders.reduce((s, c) => s + count(c), 0)
check('1560 个文件一个不丢', t4.folders.reduce((s, n) => s + count(n), 0) + t4.loose.length === big.length,
  String(t4.folders.reduce((s, n) => s + count(n), 0)))
check('顶层只按第一段聚成 3 个目录', t4.folders.length === 3, JSON.stringify(t4.folders.map((n) => n.name)))
check('递归计数与文件总数一致', t4.folders.reduce((s, n) => s + n.total, 0) === big.length,
  `${t4.folders.reduce((s, n) => s + n.total, 0)} vs ${big.length}`)

console.log('')
console.log('==================================================')
console.log(`  通过 ${pass} / ${pass + fail}${fail ? `（失败 ${fail}）` : ''}`)
console.log('==================================================')
if (fail) for (const x of failures) console.log('  FAIL ' + x)
process.exit(fail ? 1 : 0)
