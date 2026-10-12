/**
 * 成绩查询页解析测试（无头 Chrome + 仿造表格）。
 *
 * 为什么必须仿造：成绩页在教务系统里，开发机上打不开。
 * 解析器写完一直「语法通过、逻辑没跑过」—— 那等于没写。
 * 这里按截图里的真实表头和行内容造页面，每条断言都对着截图核。
 *
 * 覆盖六件事：
 *  ① 页面类型识别 —— 成绩页 URL 也在 bkjw.cuc.edu.cn 下，
 *     必须靠表头文字先认出 grades，不能被课表那条规则抢走
 *  ② 按表头文字定位列 —— **故意插一列**，写死下标就会整行错位
 *  ③ 多行分组表头要拼接后再找列
 *  ④ 翻页 —— 图标式（>）与文字式（下一页）两种控件都要认，
 *     禁用态要认出来（否则面板会一直催用户"请自己翻页"）；
 *     ⚠️ 脚本**不自动翻页**（用户明确不要），这里点的是页面自己的分页元素
 *  ⑤ 真实版面：表头在表格外、隐藏克隆格、重复表、jqxWidgets 63 列网格
 *  ⑥ 自动翻页采集循环（cvGradePages）已随书签脚本一起删除 —— 断言它真的没了
 *
 * 脚本产物在**进程内**构建（buildUserscript），不需要后端在跑。
 * 页面用 CDP Fetch 拦截伪造：只有这样才能让 location.href 真的是
 * bkjw.cuc.edu.cn（① 必须真的 URL 才测得出来）。
 */

import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { buildUserscript } from '../src/lib/inject.ts'

const TMP = process.env.TEMP
const port = 9259
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SCRIPT = buildUserscript('http://127.0.0.1:5175/api')
if (!SCRIPT.includes('function cvParse')) {
  console.error('产物里没有 cvParse —— 拼接坏了')
  process.exit(1)
}

/* 上一次跑剩的 Chrome 还占着调试端口时，connect() 会连到**旧浏览器**，
   于是在一个陈旧的页面上做断言，结果全是幻觉。先探一下，占了就直接报错。 */
try {
  const stale = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json())
  console.error(`端口 ${port} 已被占用（${stale?.Browser ?? '未知'}）。`)
  console.error('先跑：Get-Process chrome | Stop-Process -Force')
  process.exit(1)
} catch { /* 端口空闲，正常 */ }

/* ------------------------------ CDP 脚手架 ------------------------------ */

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const l = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      const p = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (p) return p.webSocketDebuggerUrl
    } catch { /* retry */ }
    await sleep(250)
  }
  throw new Error('CDP 超时')
}

// 每次都用干净的 profile 目录：残留的旧 profile 会让 Chrome 复用旧进程
await rm(`${TMP}\\cv-grades`, { recursive: true, force: true })

const proc = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run',
  `--user-data-dir=${TMP}\\cv-grades`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
  { stdio: 'ignore', windowsHide: true })

const ws = new WebSocket(await connect())
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
const errs = []
/** 当前要"发"给学校域名的页面内容（Fetch 拦截用） */
let serve = { html: '<html><body>空</body></html>' }

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') {
    errs.push(String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 220))
  }
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params
    const isDoc = /\.cuc\.edu\.cn\//.test(request.url)
    const opts = isDoc
      ? {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
          body: Buffer.from(serve.html, 'utf8').toString('base64'),
        }
      : { requestId }
    void send(isDoc ? 'Fetch.fulfillRequest' : 'Fetch.continueRequest', opts)
  }
})
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) {
    throw new Error(String(r.result.exceptionDetails.exception?.description || '').slice(0, 400))
  }
  return r.result?.result?.value
}

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })

/* ------------------------------ 造假页面 ------------------------------ */

/** 29 条成绩，字段与顺序都按截图。 */
const ROWS = [
  // 第一页（2025-2026 学年第一学期）
  ['2025-2026学年第一学期', '马克思主义基本原理', '2211010024', '91', '33', '通识教育基础课', '必修', '3', '64', '正常', '否', '2026-06-30', '3.85', '正常'],
  ['2025-2026学年第一学期', '专业示例课程一', '2121030179', '88', '01', '专业教育课', '必修', '3', '48', '正常', '是', '2026-06-28', '3.63', '正常'],
  ['2025-2026学年第一学期', '专业示例课程五', '2121030229', '优秀', '01', '专业教育课', '必修', '3', '48', '正常', '是', '2026-06-25', '', '正常'],
  ['2025-2026学年第一学期', '基础示例课程二', '2131010006', '76', '02', '学科基础课', '必修', '4', '64', '正常', '是', '2026-06-20', '2.85', '正常'],
  ['2025-2026学年第一学期', '计算机系统', '2121030194', '84', '01', '专业教育课', '必修', '3', '48', '正常', '是', '2026-06-18', '3.33', '正常'],
  ['2025-2026学年第一学期', '思政示例课程二', '2211010016', '90', '20', '通识教育基础课', '必修', '3', '48', '正常', '否', '2026-06-15', '3.70', '正常'],
  ['2025-2026学年第一学期', '通识示例课程二', '1131010002', '92', '13', '通识教育基础课', '选修', '2', '32', '正常', '否', '2026-06-10', '4.00', '正常'],
  ['2025-2026学年第一学期', '体育(3)(示例项目)', '2171010001', '85', '25', '通识教育基础课', '必修', '1', '32', '正常', '否', '2026-06-08', '3.50', '正常'],
  ['2025-2026学年第一学期', '形势与政策(3)', '2211010004', '及格', '31', '通识教育基础课', '必修', '2', '32', '正常', '否', '2026-06-05', '', '正常'],
  ['2025-2026学年第一学期', '通识示例课程一', '2031020016', '95', '01', '通识教育基础课', '选修', '2', '32', '正常', '否', '2026-06-01', '4.00', '正常'],
  // 第二页（2024-2025 学年第二学期）
  ['2024-2025学年第二学期', '高等数学A(下)', '2131010001', '86', '01', '学科基础课', '必修', '5', '80', '正常', '是', '2025-06-30', '3.70', '正常'],
  ['2024-2025学年第二学期', '离散数学', '2121030101', '82', '01', '学科基础课', '必修', '3', '48', '正常', '是', '2025-06-28', '3.30', '正常'],
  ['2024-2025学年第二学期', '大学物理(上)', '2131010005', '78', '01', '学科基础课', '必修', '3', '48', '正常', '是', '2025-06-25', '3.00', '正常'],
  ['2024-2025学年第二学期', '大学英语(二)', '2111010002', '85', '01', '通识教育基础课', '必修', '3', '48', '正常', '否', '2025-06-22', '3.50', '正常'],
  ['2024-2025学年第二学期', '体育(二)', '2171010002', '89', '01', '通识教育基础课', '必修', '1', '32', '正常', '否', '2025-06-20', '3.70', '正常'],
  ['2024-2025学年第二学期', '线性代数', '2131010002', '73', '01', '学科基础课', '必修', '3', '48', '正常', '是', '2025-06-18', '2.30', '重修'],
  ['2024-2025学年第二学期', '程序设计基础(C)', '2121030102', '94', '01', '专业教育课', '必修', '4', '64', '正常', '是', '2025-06-15', '4.00', '正常'],
  ['2024-2025学年第二学期', '概率论与数理统计', '2131010003', '81', '01', '学科基础课', '必修', '3', '48', '正常', '是', '2025-06-12', '3.10', '正常'],
  ['2024-2025学年第二学期', '思想道德与法治', '2211010001', '90', '01', '通识教育基础课', '必修', '3', '48', '正常', '否', '2025-06-10', '3.70', '正常'],
  ['2024-2025学年第二学期', '计算机导论', '2121030100', '92', '01', '专业教育课', '必修', '2', '32', '正常', '是', '2025-06-08', '4.00', '正常'],
  // 第三页（2024-2025 学年第一学期）
  ['2024-2025学年第一学期', '高等数学A(上)', '2131010000', '91', '01', '学科基础课', '必修', '5', '80', '正常', '是', '2025-01-10', '3.85', '正常'],
  ['2024-2025学年第一学期', '大学英语(一)', '2111010001', '88', '01', '通识教育基础课', '必修', '3', '48', '正常', '否', '2025-01-08', '3.63', '正常'],
  ['2024-2025学年第一学期', '体育(一)', '2171010000', '86', '01', '通识教育基础课', '必修', '1', '32', '正常', '否', '2025-01-06', '3.50', '正常'],
  ['2024-2025学年第一学期', '大学生心理健康', '2211010002', '87', '01', '通识教育基础课', '必修', '2', '32', '正常', '否', '2025-01-05', '3.60', '正常'],
  ['2024-2025学年第一学期', '军事理论', '2211010003', '83', '01', '通识教育基础课', '必修', '2', '32', '正常', '否', '2025-01-04', '3.20', '正常'],
  ['2024-2025学年第一学期', '大学计算机基础', '2121030103', '89', '01', '专业教育课', '必修', '2', '32', '正常', '是', '2025-01-03', '3.70', '正常'],
  ['2024-2025学年第一学期', '学术英语听说', '2111010003', '80', '02', '通识教育基础课', '选修', '2', '32', '正常', '否', '2025-01-02', '3.00', '正常'],
  ['2024-2025学年第一学期', '中国古代文学', '2211010005', '良好', '01', '通识教育基础课', '选修', '2', '32', '正常', '否', '2025-01-01', '', '正常'],
  ['2024-2025学年第一学期', '新生研讨课', '2121030104', '通过', '01', '专业教育课', '必修', '1', '16', '正常', '是', '', '', '正常'],
]

const PAGE_SIZE = 10

/** 表头。extra=true 时故意在「总成绩」后面插一列「绩点排名」 */
const HEAD = (extra) => `<tr>
  <th>操作</th><th>学年学期</th><th>课程名</th><th>课程号</th><th>总成绩</th>
  ${extra ? '<th>绩点排名</th>' : ''}
  <th>课序号</th><th>课程类别</th><th>课程性质</th><th>学分</th><th>学时</th>
  <th>修读方式</th><th>是否主修</th><th>考试日期</th><th>绩点</th><th>重修重考</th>
</tr>`

function pageHtml(opts = {}) {
  const { extraCol = false, groupedHead = false, pager = 'icon', splitHead = false, hiddenTable = false } = opts
  const groupRow = groupedHead ? '<tr><th colspan="15">成绩信息</th></tr>' : ''
  /* 隐藏的"假成绩表"：放在真表前面。用来验证解析器**不会**随便挑一张表 ——
     真实的成绩页有好几个 tab（GPA 查询 / 未提交成绩），隐藏面板里也有表格。 */
  const hidden = hiddenTable
    ? `<table id="hidden" style="display:none"><thead>${HEAD(false)}</thead><tbody><tr>
        <td>查看</td><td>1999-2000学年第一学期</td><td>隐藏的课</td><td>0000000000</td><td>60</td>
        <td>01</td><td>专业课</td><td>必修</td><td>1</td><td>16</td><td>正常</td><td>否</td>
        <td></td><td>1.0</td><td>正常</td></tr></tbody></table>`
    : ''
  /* 固定表头的版面（Ant Design 的 scroll.y）：**表头和数据是两张表**。
     只按"表头里有总成绩+课程号"找表的实现会命中只有表头的那张，
     然后一行数据都读不到 —— 真实页面上就是这么翻车的。 */
  const table = splitHead
    ? `<table class="ant-table-header"><thead>${groupRow}${HEAD(extraCol)}</thead></table>
  <table class="ant-table-body"><tbody id="tb"></tbody></table>`
    : `<table id="gt"><thead>${groupRow}${HEAD(extraCol)}</thead><tbody id="tb"></tbody></table>`

  return `<!doctype html><html><head><meta charset="utf-8"><title>成绩查询</title>
<style>body{font:13px/1.5 sans-serif}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}
.pager{margin-top:12px}.pager a{display:inline-block;padding:2px 8px;border:1px solid #bbb;margin-right:4px;cursor:pointer}
.pager a.disabled{opacity:.4;cursor:default}</style></head>
<body>
<div id="app">
  <div class="hd">学生成绩查询</div>
  ${hidden}
  ${table}
  <div class="pager">
    <span>每页 10 条</span>
    <span id="pginfo"></span>
    ${pager === 'icon'
      ? '<a id="first" class="disabled">|&lt;</a><a id="prev" class="disabled">&lt;</a><a id="next">&gt;</a><a id="last">&gt;|</a>'
      : '<a id="first" class="disabled">首页</a><a id="prev" class="disabled">上一页</a><a id="next">下一页</a><a id="last">末页</a>'}
  </div>
</div>
<script>
  var ROWS = ${JSON.stringify(ROWS)};
  var EXTRA = ${extraCol ? 'true' : 'false'};
  var PG = ${PAGE_SIZE};
  var page = 0;
  function render() {
    var start = page * PG, end = Math.min(start + PG, ROWS.length);
    var html = '';
    for (var i = start; i < end; i++) {
      var r = ROWS[i];
      html += '<tr><td><a>查看</a></td><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td>'
        + (EXTRA ? '<td>' + (i + 1) + '</td>' : '')
        + '<td>' + r[4] + '</td><td>' + r[5] + '</td><td>' + r[6] + '</td><td>' + r[7] + '</td><td>' + r[8] + '</td>'
        + '<td>' + r[9] + '</td><td>' + r[10] + '</td><td>' + r[11] + '</td><td>' + r[12] + '</td><td>' + r[13] + '</td></tr>';
    }
    document.getElementById('tb').innerHTML = html;
    var pages = Math.ceil(ROWS.length / PG);
    document.getElementById('pginfo').textContent =
      (start + 1) + '-' + end + ' 总记录数 ' + ROWS.length + ' 总页数 ' + pages;
    var last = page >= pages - 1;
    document.getElementById('prev').className = page === 0 ? 'disabled' : '';
    document.getElementById('first').className = page === 0 ? 'disabled' : '';
    document.getElementById('next').className = last ? 'disabled' : '';
    document.getElementById('last').className = last ? 'disabled' : '';
    /* 页面标记：用来验证"表格真的换了"，解析器看不到它 */
    document.getElementById('app').setAttribute('data-page', String(page));
  }
  document.getElementById('next').addEventListener('click', function () {
    if (page >= Math.ceil(ROWS.length / PG) - 1) return;
    page++; render();
  });
  document.getElementById('prev').addEventListener('click', function () {
    if (page === 0) return; page--; render();
  });
  document.getElementById('first').addEventListener('click', function () { page = 0; render(); });
  document.getElementById('last').addEventListener('click', function () { page = Math.ceil(ROWS.length / PG) - 1; render(); });
  render();
<\/script>
</body></html>`
}

const GRADES_URL = 'https://bkjw.cuc.edu.cn/dtjwapp/sys/jqcx/abc123/default/index.do'

/** 在指定 URL 上"发"出页面，注入脚本，返回 cvParse 的结果 */
async function parseOn(html, url = GRADES_URL) {
  errs.length = 0
  serve = { html }
  await send('Page.navigate', { url })
  await sleep(400)
  await ev(`window.GM_getValue=function(){return 'cvi_test'};window.GM_setValue=function(){};window.GM_xmlhttpRequest=function(){};1`)
  await ev(SCRIPT)
  await sleep(300)
  const href = await ev(`location.href`)
  return { parsed: JSON.parse(await ev(`JSON.stringify(cvParse())`)), href }
}

/* ================================================================== */
/*                          ① 基本解析                                */
/* ================================================================== */

console.log('--- 场景 A：截图里的表头 + 图标式分页 ---')
const aRun = await parseOn(pageHtml({ pager: 'icon' }))
const a = aRun.parsed

check('location 真的是教务系统域名', /^https:\/\/bkjw\.cuc\.edu\.cn\//.test(aRun.href), aRun.href)
check('识别为成绩页 (grades) —— 而不是被课表规则抢走', a.kind === 'grades', a.kind)
check('注入过程没有抛异常', errs.length === 0, JSON.stringify(errs).slice(0, 200))
check('解析出第一页 10 条', a.grades.length === 10, `${a.grades.length} 条`)
check('知道还有下一页', a.gradesPage?.hasNext === true, JSON.stringify(a.gradesPage))
/* ⚠️ 解析器**不再导出点击动作**：书签脚本删掉之后，自动翻页采集循环
   （cvGradePages）也没了 —— 用户明确不要自动翻页，脚本只读当前页。
   翻页这件事现在由**用户自己在页面上点**，所以这里也不再断言
   `_clickNextPage`；下面点分页按钮走的是页面自己的 DOM 元素，
   验的仍然是"翻页后解析结果对不对"。 */
check('不再导出点击动作（自动翻页已移除）',
  (await ev(`typeof cvParse()._clickNextPage === 'undefined'`)) === true)

const r0 = a.grades[0] ?? {}
console.log('  第 1 行:', JSON.stringify(r0))
check('学年学期', r0.term === '2025-2026学年第一学期', String(r0.term))
check('课程名', r0.name === '马克思主义基本原理', String(r0.name))
check('课程号', r0.code === '2211010024', String(r0.code))
check('总成绩原样保留', r0.score === '91', String(r0.score))
check('成绩转为数字 scoreNum=91', r0.scoreNum === 91, String(r0.scoreNum))
check('学分=3', r0.credit === 3, String(r0.credit))
check('绩点=3.85', r0.gpa === 3.85, String(r0.gpa))
check('课程类别', r0.category === '通识教育基础课', String(r0.category))
check('课程性质', r0.nature === '必修', String(r0.nature))
check('修读方式', r0.mode === '正常', String(r0.mode))
check('是否主修（否）', r0.major === false, String(r0.major))
check('考试日期', r0.examDate === '2026-06-30', String(r0.examDate))
check('重修重考', r0.retake === '正常', String(r0.retake))

/* 「操作」列在最前面 —— 写死下标的话课程名会取到"查看" */
check('最前面的「操作」列没有串位', a.grades.every((g) => !/^查看/.test(g.name)),
  JSON.stringify(a.grades.map((g) => g.name).slice(0, 3)))

const majorRow = a.grades.find((g) => g.code === '2121030179')
check('是否主修（是）', majorRow?.major === true, String(majorRow?.major))

/* 非数字成绩：优秀 / 及格 / 良好 / 通过 都要原样留着，scoreNum 为 null */
const good = a.grades.find((g) => g.name === '专业示例课程五')
check('「优秀」原样保留', good?.score === '优秀', String(good?.score))
check('「优秀」的 scoreNum 为 null（不瞎猜 90 分）', good?.scoreNum === null, String(good?.scoreNum))
check('没有绩点时是 null 而不是 0', good?.gpa === null, String(good?.gpa))
check('每行都有课程名', a.grades.every((g) => g.name && g.name.length > 0))

/* ---------------------------- ② 翻页 ----------------------------
   ⚠️ 点的是**页面自己的分页元素**（`#next`），不是解析器导出的动作 ——
   自动翻页已经移除（用户明确不要），脚本只负责把当前页解析对。
   这里验的是"用户自己翻页之后，解析结果跟着对"。 */
console.log('')
console.log('--- 场景 A2：点「下一页」（图标式按钮 >）---')
const clickOk = await ev(`(function () {
  var b = document.getElementById('next');
  if (!b) return false;
  b.click();
  return true;
})()`)
await sleep(250)
const a2 = JSON.parse(await ev(`JSON.stringify(cvParse())`))
const pageNow = await ev(`document.getElementById('app').getAttribute('data-page')`)
check('点到了下一页按钮（> 也算，不只有"下一页"三个字）', clickOk === true)
check('表格真的翻页了（页面标记 = 1）', pageNow === '1', String(pageNow))
check('第二页解析出 10 条', a2.grades.length === 10, `${a2.grades.length} 条`)
check('第二页内容与第一页不同', a2.grades[0]?.name !== a.grades[0]?.name,
  `${a.grades[0]?.name} → ${a2.grades[0]?.name}`)
check('第二页仍然是成绩页', a2.kind === 'grades', a2.kind)
check('第二页也认为还有下一页', a2.gradesPage?.hasNext === true)

/* 翻到最后一页：下一页按钮变禁用态，hasNext 必须是 false，
   否则面板会一直催用户"请自己翻页"（其实已经到底了） */
await ev(`document.getElementById('next').click(); 1`)
await sleep(250)
const a3 = JSON.parse(await ev(`JSON.stringify(cvParse())`))
const pageNow3 = await ev(`document.getElementById('app').getAttribute('data-page')`)
check('翻到第三页', pageNow3 === '2', String(pageNow3))
check('最后一页解析出 9 条', a3.grades.length === 9, `${a3.grades.length} 条`)
check('最后一页 hasNext=false（按钮是禁用态）', a3.gradesPage?.hasNext === false,
  JSON.stringify(a3.gradesPage))
check('三页合计 = 29 条', a.grades.length + a2.grades.length + a3.grades.length === ROWS.length)

/* ------------------- ③ 多插一列（按表头定位） ------------------- */
console.log('')
console.log('--- 场景 B：表头里多一列「绩点排名」---')
const b = (await parseOn(pageHtml({ extraCol: true }))).parsed
check('仍然识别为成绩页', b.kind === 'grades', b.kind)
check('仍然解析出 10 条', b.grades.length === 10, `${b.grades.length} 条`)
const b0 = b.grades[0] ?? {}
check('多一列后课程号不错位', b0.code === '2211010024', String(b0.code))
check('多一列后学分不错位', b0.credit === 3, String(b0.credit))
check('多一列后绩点不错位', b0.gpa === 3.85, String(b0.gpa))
check('多一列后重修重考不错位', b0.retake === '正常', String(b0.retake))

/* ------------------- ④ 分组表头（两行 thead） ------------------- */
console.log('')
console.log('--- 场景 C：两行分组表头 ---')
const c = (await parseOn(pageHtml({ groupedHead: true }))).parsed
check('两行表头也能识别', c.kind === 'grades', c.kind)
check('两行表头解析出 10 条', c.grades.length === 10, `${c.grades.length} 条`)
check('两行表头下课程号正确', c.grades[0]?.code === '2211010024', String(c.grades[0]?.code))
check('两行表头下绩点正确', c.grades[0]?.gpa === 3.85, String(c.grades[0]?.gpa))

/* ------------------- ⑤ 文字式分页 ------------------- */
console.log('')
console.log('--- 场景 D：文字式分页（上一页 / 下一页）---')
const d = (await parseOn(pageHtml({ pager: 'text' }))).parsed
check('文字式分页也能识别为成绩页', d.kind === 'grades', d.kind)
check('文字式分页 hasNext=true', d.gradesPage?.hasNext === true, JSON.stringify(d.gradesPage))
await ev(`document.getElementById('next').click(); 1`)
await sleep(250)
check('文字式分页也能翻页', (await ev(`document.getElementById('app').getAttribute('data-page')`)) === '1')

/* ------------------- ⑤b 固定表头：表头和数据是两张表 -------------------
   用户实测："认出了成绩页，但一行都没解析出来"。
   真实成绩页是 Ant Design，`scroll.y` 会把 thead 和 tbody 拆成**两张 table**；
   只按"表头里有没有总成绩+课程号"找表，会命中只有表头的那张 → 0 行。 */
console.log('')
console.log('--- 场景 D2：固定表头（表头 / 数据分成两张表）---')
const d2 = (await parseOn(pageHtml({ splitHead: true }))).parsed
check('固定表头版面也能识别为成绩页', d2.kind === 'grades', d2.kind)
check('固定表头版面解析出 10 条（不是 0 条）', d2.grades.length === 10, `${d2.grades.length} 条`)
check('固定表头下课程号正确', d2.grades[0]?.code === '2211010024', String(d2.grades[0]?.code))
check('固定表头下学分/绩点正确', d2.grades[0]?.credit === 3 && d2.grades[0]?.gpa === 3.85,
  `${d2.grades[0]?.credit} / ${d2.grades[0]?.gpa}`)
check('固定表头下知道还有下一页', d2.gradesPage?.hasNext === true)
check('诊断信息指出表头与数据不是同一张表',
  /表格第 1 张/.test(String(d2.gradeDebug?.表头来源)) && d2.gradeDebug?.选中数据表 === 1,
  JSON.stringify({ 来源: d2.gradeDebug?.表头来源, 数据: d2.gradeDebug?.选中数据表 }))

/* ------------------- ⑤d 用户真实页面那种版面 -------------------
   诊断信息（用户贴回来的 JSON）显示真实页面长这样：
     · 3 张 <table>，**全都没有 thead**
     · 没有哪一行表格文本含「总成绩 / 课程号」—— 表头是**表格外面的 div** 画的
     · 数据行的单元格里还有**隐藏的克隆格**：首行 16 格，而表头只有 15 列
       （课程名 / 课程号 各多一份，藏起来的那份在可见的那份前面）
     · 还多了一张一模一样的数据表
   原来那套"只在表格里、只看第一行"的找法在这张页面上全灭：
   选中表头 -1、选中数据 -1、解析出 0 行。 */
console.log('')
console.log('--- 场景 D4：表头在表格外 + 行里有隐藏克隆格 + 重复表（真实版面）---')

function pageOdd(opts = {}) {
  const { hiddenClone = true, dupTable = true } = opts
  /* 行：16 格，其中第 3、4 格（课程名/课程号）是隐藏的克隆 */
  const rowHtml = `function rowHtml(r, extra) {
    var clone = ${hiddenClone ? "'<td style=\"display:none\">' + r[1] + '</td><td style=\\\"display:none\\\">' + r[2] + '</td>'" : "''"};
    return '<tr><td>详情</td><td>' + r[0] + '</td>' + clone + '<td>' + r[1] + '</td><td>' + r[2] + '</td>'
      + (extra ? '<td>' + extra + '</td>' : '')
      + '<td>' + r[3] + '</td><td>' + r[4] + '</td><td>' + r[5] + '</td><td>' + r[6] + '</td><td>' + r[7] + '</td>'
      + '<td>' + r[8] + '</td><td>' + r[9] + '</td><td>' + r[10] + '</td><td>' + r[11] + '</td><td>' + r[12] + '</td></tr>';
  }`
  const head = ['操作', '学年学期', '课程名', '课程号', '总成绩', '课序号', '课程类别', '课程性质', '学分', '学时', '修读方式', '是否主修', '考试日期', '绩点', '重修重考']
  /* ⚠️ IIFE 结尾那个分号不能省：下面两个 fill() 是**相邻两条语句**，
     少了分号会被解析成 `(function(){…})()(function(){…})()` ——
     即"把第二个函数当成参数去调用第一个的返回值"，运行时抛 TypeError。
     症状很隐蔽：行数据更新了（IIFE 里先执行的），
     但后面的分页按钮禁用状态没更新 → 采集循环以为最后一页还有下一页。 */
  const fill = (id) => `(function(){
    var html = '';
    for (var i = page * 10; i < Math.min(page * 10 + 10, ROWS.length); i++) html += rowHtml(ROWS[i], EXTRA ? (i + 1) : '');
    document.getElementById('${id}').innerHTML = html;
  })();`

  return `<!doctype html><html><head><meta charset="utf-8"><title>成绩查询</title>
<style>body{font:13px/1.5 sans-serif}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}
.thead-row div{display:inline-block;min-width:56px;font-weight:600;padding:4px 6px}
.pager a{display:inline-block;padding:2px 8px;border:1px solid #bbb;margin-right:4px;cursor:pointer}
.pager a.disabled{opacity:.4}</style></head>
<body>
<div id="app">
  <div class="hd">学生成绩查询</div>
  <!-- 空数据占位表（真实页面里的第一张表，是隐藏的） -->
  <table id="empty" style="display:none"><tbody><tr><td>没有数据</td></tr></tbody></table>
  <!-- 表头：表格**外面**的一排 div -->
  <div class="thead-row">${head.map((h) => `<div>${h}</div>`).join('')}</div>
  <!-- 数据表：没有 thead -->
  <table id="t1"><tbody id="tb1"></tbody></table>
  ${dupTable ? '<!-- 一模一样再来一张（真实页面里就是两张） --><table id="t2"><tbody id="tb2"></tbody></table>' : ''}
  <div class="pager"><span>每页 10 条</span><span id="pginfo"></span>
    <a id="first" class="disabled">|&lt;</a><a id="prev" class="disabled">&lt;</a><a id="next">&gt;</a><a id="last">&gt;|</a>
  </div>
</div>
<script>
  var ROWS = ${JSON.stringify(ROWS)};
  var EXTRA = false;
  var page = 0;
  ${rowHtml}
  function render() {
    ${fill('tb1')}
    ${dupTable ? fill('tb2') : ''}
    var pages = Math.ceil(ROWS.length / 10);
    document.getElementById('pginfo').textContent = (page * 10 + 1) + '-' + Math.min(page * 10 + 10, ROWS.length) + ' 总记录数 ' + ROWS.length + ' 总页数 ' + pages;
    var last = page >= pages - 1;
    document.getElementById('prev').className = page === 0 ? 'disabled' : '';
    document.getElementById('first').className = page === 0 ? 'disabled' : '';
    document.getElementById('next').className = last ? 'disabled' : '';
    document.getElementById('last').className = last ? 'disabled' : '';
    document.getElementById('app').setAttribute('data-page', String(page));
  }
  document.getElementById('next').addEventListener('click', function () {
    if (page >= Math.ceil(ROWS.length / 10) - 1) return;
    setTimeout(function () { page++; render() }, 300);
  });
  render();
<\/script>
</body></html>`
}

const d4 = (await parseOn(pageOdd())).parsed
console.log('  诊断:', JSON.stringify(d4.gradeDebug && {
  表头来源: d4.gradeDebug.表头来源, 表头列数: d4.gradeDebug.表头列.length, 选中数据表: d4.gradeDebug.选中数据表, 表格数: d4.gradeDebug.表格数,
}, null, 0))
check('这种版面也能识别为成绩页', d4.kind === 'grades', d4.kind)
check('找到了表格外面的表头', d4.gradeDebug?.已找到表头 === true, String(d4.gradeDebug?.表头来源))
check('表头列出 15 列', d4.gradeDebug?.表头列?.length === 15, String(d4.gradeDebug?.表头列?.length))
check('解析出 10 条（不是 0 条）', d4.grades.length === 10, `${d4.grades.length} 条`)
check('没有把重复表的行算进来（不是 20 条）', d4.grades.length !== 20, `${d4.grades.length} 条`)
const o0 = d4.grades[0] ?? {}
check('隐藏的克隆格没有让列错位 —— 课程名', o0.name === '马克思主义基本原理', String(o0.name))
check('隐藏的克隆格没有让列错位 —— 课程号', o0.code === '2211010024', String(o0.code))
check('总成绩取到了 91', o0.score === '91', String(o0.score))
check('课序号不会串到总成绩', o0.score !== '33', String(o0.score))
check('学分 / 绩点正确', o0.credit === 3 && o0.gpa === 3.85, `${o0.credit} / ${o0.gpa}`)
check('课程类别 / 性质 / 修读方式正确',
  o0.category === '通识教育基础课' && o0.nature === '必修' && o0.mode === '正常',
  `${o0.category} / ${o0.nature} / ${o0.mode}`)
check('考试日期正确', o0.examDate === '2026-06-30', String(o0.examDate))
check('还能自动翻页（下一页仍是图标按钮）', d4.gradesPage?.hasNext === true, JSON.stringify(d4.gradesPage))

/* 注意：这里原来还断言"这种版面也能自动翻页收齐 29 条 / 翻页期间没有误判"。
   cvGradePages 采集循环已随书签脚本一起删除（用户明确不要自动翻页），
   那两条断言随之删除；上面"解析出 10 条 + 各列不错位"的解析断言全部保留。 */

/* ------------------- ⑤e 两张表：一张没分数列、一张有 -------------------
   用户真实数据反推出来的坑：页面上有两张表（比如「未提交成绩」和「有成绩」两个签），
   表头是 div 画的、离数据表很远。原来的解析器"取文档里第一个含 总成绩+课程号 的元素"
   当表头，于是**表头来自 A 表、数据来自 B 表**，列整体错位 2 格 ——
   真实症状：课程名对，学分和绩点是空的，成绩位置读到了「通识教育基础课」。
   现在：表头就近配对自己的数据表，再按"值的类型像不像这一列"打分挑最可信的一对。 */
console.log('')
console.log('--- 场景 D5：一张表没有分数列（表头会配错对象）---')

const pageTwoTables = `<!doctype html><html><head><meta charset="utf-8"><title>成绩查询</title></head><body>
<div id="app">
  <div class="hd">学生成绩查询</div>
  <!-- A 表：没有「总成绩 / 课序号」两列（真实页面里就是这种） -->
  <div class="thead-row"><div>操作</div><div>学年学期</div><div>课程名</div><div>课程号</div><div>课程类别</div><div>课程性质</div><div>学分</div><div>学时</div><div>修读方式</div><div>是否主修</div><div>考试日期</div><div>绩点</div><div>重修重考</div></div>
  <table id="ta"><tbody>
    <tr><td>详情</td><td>2025-2026学年 秋季学期</td><td>没分数的课甲</td><td>1111111111</td><td>通识教育基础课</td><td>必修</td><td>2</td><td>32</td><td>正常</td><td></td><td>2026-01-05</td><td>3.0</td><td>正常</td></tr>
    <tr><td>详情</td><td>2025-2026学年 秋季学期</td><td>没分数的课乙</td><td>2222222222</td><td>实践必修环节</td><td>必修</td><td>1</td><td>16</td><td>正常</td><td></td><td>2026-01-06</td><td>3.5</td><td>正常</td></tr>
  </tbody></table>
  <!-- B 表：有分数列，而且成绩**不全是数字**（优秀 / 及格） -->
  <div class="thead-row"><div>操作</div><div>学年学期</div><div>课程名</div><div>课程号</div><div>总成绩</div><div>课序号</div><div>课程类别</div><div>课程性质</div><div>学分</div><div>学时</div><div>修读方式</div><div>是否主修</div><div>考试日期</div><div>绩点</div><div>重修重考</div></div>
  <table id="tb"><tbody>
    <tr><td>详情</td><td>2024-2025学年 春季学期</td><td>马克思主义基本原理</td><td>2211010024</td><td>91</td><td>33</td><td>通识教育基础课</td><td>必修</td><td>3</td><td>64</td><td>正常</td><td></td><td>2026-06-30</td><td>3.85</td><td>正常</td></tr>
    <tr><td>详情</td><td>2024-2025学年 春季学期</td><td>大学体育(2)</td><td>2173010002</td><td>优秀</td><td>01</td><td>基础教育课程</td><td>必修</td><td>1</td><td>32</td><td>正常</td><td></td><td>2026-06-28</td><td>4.5</td><td>正常</td></tr>
  </tbody></table>
</div></body></html>`

const d5 = (await parseOn(pageTwoTables)).parsed
const g5 = d5.grades ?? []
console.log('  解析出:', JSON.stringify(g5.map((x) => `${x.name}|${x.score}|${x.credit}|${x.gpa}`)))
check('两张表时也能认出成绩页', d5.kind === 'grades', d5.kind)
check('选了**有分数列**的那张表（不是先出现的无分数表）', g5.length === 2, `${g5.length} 条`)
check('没有把无分数表的行混进来', !g5.some((x) => String(x.name).indexOf('没分数的课') === 0),
  JSON.stringify(g5.map((x) => x.name)))
const m0 = g5.find((x) => x.name === '马克思主义基本原理') ?? {}
check('数字成绩读对（91）', m0.score === '91', String(m0.score))
check('学分读对（3，不是 0）', m0.credit === 3, String(m0.credit))
check('绩点读对（3.85，不是 null）', m0.gpa === 3.85, String(m0.gpa))
check('课程类别没串到成绩里', m0.category === '通识教育基础课' && m0.score !== m0.category, `${m0.category} / ${m0.score}`)
check('考试日期没串到修读方式里', m0.examDate === '2026-06-30' && m0.mode === '正常', `${m0.examDate} / ${m0.mode}`)
const m1 = g5.find((x) => x.name === '大学体育(2)') ?? {}
check('非数字成绩原样保留（优秀）', m1.score === '优秀', String(m1.score))
check('非数字成绩不给 scoreNum 编数字', m1.scoreNum === null, String(m1.scoreNum))
check('非数字成绩的行，学分绩点照样读对', m1.credit === 1 && m1.gpa === 4.5, `${m1.credit} / ${m1.gpa}`)

/* 页面上**只有**那张没有分数列的表时：宁可一行都不导。
   硬按表头位置取列的话，这里会把「课程类别」当成成绩、学分读成 0 —— 全是错的，
   而且用户看不出来。项目原则：宁可空着，也不显示错的。 */
const onlyNoScore = pageTwoTables.slice(0, pageTwoTables.indexOf('<!-- B 表')) + '</div></body></html>'
const d6 = (await parseOn(onlyNoScore)).parsed
check('只有"没有分数列"的表时，一行都不导（不塞错位数据）', (d6.grades ?? []).length === 0,
  `${(d6.grades ?? []).length} 条`)

/* ------------------- ⑤f jqWidgets 网格（用户真实页面）-------------------
   诊断信息显示真实页面是 `jqx-grid-table`：表头是**一个 div 里 63 个列头**
   （含两份 课程名/课程号、一堆内部列、末尾还有个"总成绩"诱饵），
   数据行也是 **63 个格子**（其中 21 个可见）—— 两边是同一套列模型，**按位置一一对应**。
   上一版"只取可见格"把行压成 21 格，于是总成绩(第7列)读到了第7个可见格＝课程类别：
   症状正是用户报的"课程名对、学分绩点空、成绩变成课程类别"。 */
console.log('')
console.log('--- 场景 D6：jqWidgets 网格（63 列表头 + 63 格行）---')

const pageJqx = `<!doctype html><html><head><meta charset="utf-8"><title>成绩查询</title></head><body>
<div id="app"><div class="hd">学生成绩查询</div>
<div id="columntable"></div>
<table id="pinned" class="jqx-grid-table"><tbody></tbody></table>
<table id="main" class="jqx-grid-table"><tbody></tbody></table>
</div>
<script>
  /* 63 列：前 17 列是真列（4、5 是重复的课程名/课程号），34 是重修重考，末尾再来一个"总成绩"诱饵 */
  var COLS = ['操作','学年学期','课程名','课程号','课程名','课程号','总成绩','课序号','课程类别','课程性质','学分','学时','修读方式','是否主修','考试日期','绩点','积点分'];
  while (COLS.length < 62) COLS.push('备用' + COLS.length);
  COLS[34] = '重修重考';
  COLS.push('总成绩');
  var ROWS = [
    { 2:'马克思主义基本原理', 3:'2211010024', 6:'91', 7:'33', 8:'通识教育基础课', 9:'必修', 10:'3', 11:'64', 12:'正常', 13:'', 14:'2026-06-30', 15:'3.85', 34:'正常' },
    { 2:'大学体育(2)', 3:'2173010002', 6:'优秀', 7:'01', 8:'基础教育课程', 9:'必修', 10:'1', 11:'32', 12:'正常', 13:'', 14:'2026-06-28', 15:'4.5', 34:'正常' }
  ];
  var hd = document.getElementById('columntable');
  for (var i = 0; i < COLS.length; i++) {
    var d = document.createElement('div');
    d.setAttribute('role', 'columnheader');
    d.textContent = COLS[i];
    /* 真实页面里表头也有隐藏列；这里让 4、5 和 20 之后不可见（文本仍在，列头仍在） */
    if (i === 4 || i === 5 || i >= 20) d.style.display = 'none';
    hd.appendChild(d);
  }
  function fill(tableId) {
    var tb = document.getElementById(tableId).querySelector('tbody');
    for (var r = 0; r < ROWS.length; r++) {
      var tr = document.createElement('tr');
      for (var c = 0; c < COLS.length; c++) {
        var td = document.createElement('td');
        td.className = 'jqx-cell jqx-grid-cell jqx-item';
        td.textContent = c === 0 ? '详情' : (c === 1 ? '2025-2026学年 春季学期' : (ROWS[r][c] !== undefined ? ROWS[r][c] : '—'));
        /* 真实页面：63 格里只有 21 格可见 */
        if (c === 4 || c === 5 || c >= 20) td.style.display = 'none';
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
  }
  fill('pinned'); fill('main');
<\/script></body></html>`

const d7 = (await parseOn(pageJqx)).parsed
const g7 = d7.grades ?? []
console.log('  解析出:', JSON.stringify(g7.map((x) => `${x.name}|${x.score}|${x.credit}|${x.gpa}`)))
check('jqxGrid 网格也认得出成绩页', d7.kind === 'grades', d7.kind)
check('解析出 2 条（取全部格 → 与 63 列表头对齐）', g7.length === 2, `${g7.length} 条`)
const j0 = g7.find((x) => x.name === '马克思主义基本原理') ?? {}
check('课程名没串位', j0.name === '马克思主义基本原理', String(j0.name))
check('课程号没串位', j0.code === '2211010024', String(j0.code))
check('总成绩 = 91（不是课程类别）', j0.score === '91', String(j0.score))
check('学分 = 3（不是 0）', j0.credit === 3, String(j0.credit))
check('绩点 = 3.85（不是 null）', j0.gpa === 3.85, String(j0.gpa))
check('课程类别 / 性质 / 修读方式都对',
  j0.category === '通识教育基础课' && j0.nature === '必修' && j0.mode === '正常',
  `${j0.category} / ${j0.nature} / ${j0.mode}`)
check('考试日期 = 2026-06-30', j0.examDate === '2026-06-30', String(j0.examDate))
const j1 = g7.find((x) => x.name === '大学体育(2)') ?? {}
check('等级成绩（优秀）原样保留', j1.score === '优秀', String(j1.score))
check('等级成绩的行学分绩点也对', j1.credit === 1 && j1.gpa === 4.5, `${j1.credit} / ${j1.gpa}`)

/* ------------------- ⑤c 隐藏的假表不能被选中 ------------------- */
console.log('')
console.log('--- 场景 D3：前面有隐藏的"假成绩表" ---')
const d3 = (await parseOn(pageHtml({ hiddenTable: true }))).parsed
check('解析出的是真表（10 条）', d3.grades.length === 10, `${d3.grades.length} 条`)
check('没有把隐藏表里的行解析进来', !d3.grades.some((g) => g.name === '隐藏的课'),
  JSON.stringify(d3.grades.map((g) => g.name).slice(0, 3)))
check('第一行仍然是真表的第一条', d3.grades[0]?.name === ROWS[0][1], String(d3.grades[0]?.name))

/* ------------------- ⑥ 不是成绩页时不能误报 ------------------- */
console.log('')
console.log('--- 场景 E：课程列表页不应被当成成绩页 ---')
const e = (await parseOn(
  `<!doctype html><html><head><meta charset="utf-8"><title>我的课程</title></head><body>
   <div>课程代码：202620271213101000602</div><div>学分数：4.0</div>
   <div>必选修别：必修</div><div>2026-2027第1学期</div></body></html>`,
  'https://courses.cuc.edu.cn/user/courses',
)).parsed
check('课程页不会被误判成成绩页', e.kind === 'courses', e.kind)
check('课程页的 grades 为空数组', Array.isArray(e.grades) && e.grades.length === 0,
  JSON.stringify(e.grades))
check('课程页 gradesPage 为 null', e.gradesPage === null, JSON.stringify(e.gradesPage))

/* ------------------- ⑦ 采集器已移除（反向验证） -------------------
   原来这里跑 `cvGradePages` 自动翻三页收齐 29 条、外加"点了没反应要停下"的
   反向验证。**整块随自动翻页一起删除**（用户明确不要自动翻页，
   书签脚本又是它最后一个调用方）。断言"真的删掉了"，
   免得哪天有人把采集循环又拼回产物里而没人发现。 */
console.log('')
console.log('--- 场景 F：自动翻页采集循环已移除 ---')
check('解析器不再导出 cvGradePages', (await ev(`typeof cvGradePages`)) === 'undefined')
check('产物里也没有 cvGradePages 的定义',
  SCRIPT.includes('function cvGradePages') === false)
check('点击动作 _clickNextPage 也一并移除',
  (await ev(`typeof cvParse()._clickNextPage`)) === 'undefined')
check('分页判断 hasNextPage 仍然保留（面板要提示"请自己翻页"）',
  SCRIPT.includes('function hasNextPage') === true)

/* ------------------------------ 汇总 ------------------------------ */
console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close()
proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
