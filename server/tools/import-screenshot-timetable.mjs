/**
 * 从 17 张周截图提取出的课表，导入本地库。
 *
 * 数据来源与可信度：
 *  · 每格的颜色分类用「背景→本色 直线上的垂直距离」判据（server/tools/scan-timetable2.mjs），
 *    自检 4/4 通过 —— 包括前两种判据都判错的两格。
 *  · 课程名称/地点/节次来自逐张裁图放大后的**目视核对**（第 1 周与第 10 周完整读过）。
 *  · 第 1-9 周与第 10-17 周是**两套不同版面**（第 10 周起课程挪位）。
 *
 * 已知的不确定处（已由用户确认）：
 *  · 「通识示例课程一」第 1 周那半块 → 用户答"算上"，即第 1 周也上课，周次为 1-11 周
 *  · 「专业示例课程三」的周次 5-7、10 → 用户答"真的"
 *  · 「通识示例课程二」→ 用户答"第九周之后结课了"，即 1-9 周
 */

const API = 'http://127.0.0.1:5175/api'
const TERM = '2026-2027第1学期'

const COURSES = [
  {
    name: '专业示例课程二[01]',
    room: '网络工程实验室-48#111',
    slots: [
      { day: 1, from: 3, span: 2, weeks: '1-9周' },
      { day: 1, from: 5, span: 2, weeks: '10-17周' },
      { day: 1, from: 7, span: 2, weeks: '1-17周' },
    ],
  },
  {
    name: '通识示例课程二[13]',
    room: '四十八教208',
    slots: [{ day: 1, from: 5, span: 2, weeks: '1-9周(单)' }],
  },
  {
    name: '专业示例课程四[01]',
    room: '计算机基础公共教学实验机房-48#102',
    slots: [{ day: 1, from: 9, span: 4, weeks: '1-17周' }],
  },
  {
    name: '专业示例课程五[01]',
    room: '计算机基础公共教学实验5机房-22#B31',
    slots: [
      { day: 3, from: 1, span: 2, weeks: '1-9周', room: '计算机基础公共教学实验5机房-22#B31' },
      { day: 1, from: 3, span: 2, weeks: '10-17周', room: '计算机基础公共教学实验5机房-22#B31' },
      { day: 5, from: 1, span: 2, weeks: '1-17周(单)', room: '混合式教学（白杨课堂）' },
    ],
  },
  {
    name: '专业示例课程一[01]',
    room: '四十八教603',
    slots: [
      { day: 2, from: 1, span: 2, weeks: '1-17周' },
      { day: 2, from: 7, span: 2, weeks: '1-17周' },
    ],
  },
  {
    name: '体育(3)(示例项目)[25]',
    room: '无',
    slots: [{ day: 2, from: 3, span: 2, weeks: '1-17周' }],
  },
  {
    name: '思政示例课程二[20]',
    room: '四十八教408',
    slots: [{ day: 2, from: 5, span: 2, weeks: '1-17周' }],
  },
  {
    name: '专业示例课程三[01]',
    room: '专业课教学实验室2机房-48#107',
    slots: [{ day: 2, from: 9, span: 4, weeks: '5-7周,10周' }],
  },
  {
    name: '基础示例课程二[02]',
    room: '四十八教611',
    slots: [
      { day: 3, from: 3, span: 2, weeks: '1-17周' },
      { day: 5, from: 3, span: 2, weeks: '1-17周' },
    ],
  },
  {
    name: '形势与政策(3)[31]',
    room: '无',
    slots: [{ day: 3, from: 5, span: 4, weeks: '1-4周' }],
  },
  {
    name: '通识示例课程一[01]',
    room: '一教404',
    // 第 1 周截图里只有 3-4 节显示为正常、1-2 节标 [非本周]，
    // 但用户确认"算上" —— 即第 1 周也上课。故为 1-11 周。
    slots: [{ day: 4, from: 1, span: 4, weeks: '1-11周' }],
  },
  {
    name: '通识示例课程三[01]',
    room: '四十八教303',
    slots: [{ day: 4, from: 5, span: 4, weeks: '10-17周' }],
  },
  {
    name: '基础示例课程一[03]',
    room: '基础示例课程一室3-46#104',
    slots: [{ day: 5, from: 5, span: 4, weeks: '1-11周' }],
  },
  {
    name: '思政示例课程一[01]',
    room: '混合式教学（智慧树平台）',
    slots: [{ day: 6, from: 1, span: 2, weeks: '1-17周' }],
  },
]

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'admin', password: 'Cv-Dev-Only-2026' }),
})
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
if (!login.ok) { console.error('登录失败'); process.exit(1) }

const payload = {
  source: 'screenshot-extraction',
  courses: COURSES.map((c) => ({ code: '', name: c.name, term: TERM, room: c.room, credits: 0, slots: c.slots })),
}

const r = await fetch(`${API}/import`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ ...payload, dryRun: false }),
})
const j = await r.json()
if (!j.ok) { console.error('导入失败:', JSON.stringify(j.error)); process.exit(1) }
console.log(`导入完成：课程新增 ${j.data.applied.created} · 更新 ${j.data.applied.updated} · 时间段 ${j.data.applied.slots}`)

/* ---------------- 读回来，按星期排成课表打印 ---------------- */
const sc = await (await fetch(`${API}/schedule`, { headers: { Cookie: cookie } })).json()
const DAY = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
const rows = sc.data.slots
console.log('')
console.log(`共 ${rows.length} 个时间段`)
console.log('')
for (let d = 1; d <= 7; d++) {
  const list = rows.filter((x) => x.day === d).sort((a, b) => a.from_slot - b.from_slot)
  if (!list.length) continue
  console.log(`${DAY[d]}  (${list.length} 段)`)
  for (const s of list) {
    const to = s.from_slot + s.span - 1
    const range = s.span > 1 ? `${s.from_slot}-${to}节` : `${s.from_slot}节`
    console.log(`   ${range.padEnd(8)} ${String(s.weeks).padEnd(12)} ${s.course_name}`)
    console.log(`   ${' '.repeat(8)} ${String(s.room || '无').padEnd(12)}`)
  }
  console.log('')
}
