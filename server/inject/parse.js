/**
 * 共享的页面解析逻辑 —— 油猴脚本用这一份。
 *
 * 为什么不各写一份：解析规则是**跟着学校页面改版走的**，
 * 抄成两份意味着改版时要记得改两处，早晚会漏一处。
 * 后端的 lib/inject.ts 会把本文件与油猴脚本外壳拼成最终产物。
 *
 * 解析策略：**不依赖 class 名**，靠页面上的中文标签定位。
 * 学校页面是 Vue SPA，class 名会随版本变，但「课程代码：」「学分数：」
 * 这些标签稳定得多。认不出来就明确报错，绝不猜。
 *
 * 返回 { kind, profile, courses, notes }
 */
function cvParse() {
  /* 查询跨同源 iframe。融合门户把卡片嵌在 iframe 里，
     只查顶层文档会漏掉整块内容。collected 在下方赋值，
     这里做个兜底免得函数被提前调用时炸掉。 */
  var $$ = function (s) {
    var docs = (typeof collected !== 'undefined' && collected && collected.pages)
      ? collected.pages.map(function (p) { return p.doc })
      : [document]
    var out = []
    for (var i = 0; i < docs.length; i++) {
      try {
        var found = docs[i].querySelectorAll(s)
        for (var j = 0; j < found.length; j++) out.push(found[j])
      } catch (e) { /* 已卸载或跨域的文档，跳过 */ }
    }
    return out
  }
  var txt = function (el) { return (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim() }

  /* 学期：`2026-2027第1学期`。必须是 var 且在 findCards 之前 —— var 不提升赋值 */
  var TERM_RE = /(\d{4})\s*[-–—]\s*(\d{4})\s*第\s*(\d)\s*学期/

  /* ───────────── 键值对 ───────────── */

  function kvFromText(body, labels, maxLen) {
    for (var i = 0; i < labels.length; i++) {
      var re = new RegExp(labels[i] + '\\s*[:：]\\s*([^\\s，,、；;|]{1,' + (maxLen || 40) + '})')
      var m = body.match(re)
      if (m && m[1]) return m[1].trim()
    }
    return ''
  }

  function kvFromTables(labels) {
    var rows = $$('tr')
    for (var i = 0; i < rows.length; i++) {
      var cells = Array.prototype.slice.call(rows[i].children)
      for (var c = 0; c < cells.length - 1; c++) {
        var k = txt(cells[c]).replace(/[:：]\s*$/, '')
        for (var l = 0; l < labels.length; l++) {
          if (k === labels[l]) return txt(cells[c + 1])
        }
      }
    }
    return ''
  }

  /**
   * 去掉尾部省略号。
   * 学校页面大量用 CSS 截断，但 textContent 拿到的是完整文本，
   * 所以正常不会带省略号；真带了说明来源确实不全 ——
   * 此时宁可留空也不要存半截：「计算机与网络空间安...」比空串更糟，
   * 因为它看起来像有效数据。
   */
  function clean(v) {
    if (!v) return ''
    return String(v).replace(/[.．·…]+\s*$/, '').trim()
  }

  function titleOf(el) {
    var cur = el
    for (var i = 0; i < 3 && cur; i++) {
      var tv = cur.getAttribute && cur.getAttribute('title')
      if (tv && tv.trim()) return tv.trim()
      cur = cur.parentElement
    }
    return ''
  }

  function kv(labels, maxLen) {
    return clean(kvFromTables(labels) || kvFromText(document.body.innerText, labels, maxLen))
  }

  /* ───────────── 页面识别 ───────────── */

  function pageKind(body) {
    var url = location.href

    /* 成绩查询页必须**最先**判断。
       它的 URL 也在 bkjw.cuc.edu.cn 下，所以下面那条
       /bkjw\.cuc\.edu\.cn|\/xskcb/ 会先命中 ——
       顺序反了的话成绩页永远解析不出来。
       判据用表头文字（总成绩 + 绩点 + 课程号），比 URL 可靠。 */
    if (/总成绩/.test(body) && /绩点/.test(body) && /课程号/.test(body)) return 'grades'
    if (/courses\.cuc\.edu\.cn/.test(url) && /我的课程|课程代码/.test(body)) return 'courses'
    if (/i\.cuc\.edu\.cn/.test(url)) return 'portal'
    /* 教务系统课表页：**认出来，但不导入**。
       2026-10 起课表改走「教务系统导出 xlsx → 导入页上传文件」。
       这里仍单独认一个 kind，是为了让面板能明确告诉用户该去哪儿，
       而不是落到 unknown 含糊地说一句"没识别到内容"。 */
    if (/bkjw\.cuc\.edu\.cn|\/xskcb/.test(url)) return 'timetable'
    /* 光看 URL 太脆：换个路径、或被 iframe 嵌进来就失效。
       所以再加一层按内容判断，两边任一命中即可。 */
    if (/课程代码/.test(body) && /学分数/.test(body)) return 'courses'
    if (/融合服务门户|今日课表|待办任务/.test(body)) return 'portal'
    // 按内容兜底：教务课表页有一列「节次/星期」和大量「星期N,HH:MM~HH:MM」
    if (/节次\/星期/.test(body) && /星期[一二三四五六日1-7]\s*[,，]\s*\d{1,2}:\d{2}/.test(body)) return 'timetable'
    if (/课程代码/.test(body)) return 'courses'
    return 'unknown'
  }

  /* ───────────── 课程 ───────────── */

  /**
   * 找课程卡片。
   * 定位含「课程代码：」的元素，向上找最近的含「学分数」的祖先 = 卡片内容区。
   * 但学期在卡片里是**内容区的兄弟节点**，只找到「学分数」那层会漏掉它，
   * 所以再往上顶一层 —— 前提是那层没包含第二门课（否则会吃到隔壁卡片）。
   */
  function findCards() {
    var anchors = $$('*').filter(function (el) {
      return el.children.length > 0 && /课程代码\s*[:：]/.test(el.textContent || '')
    })
    var countCodes = function (el) {
      var m = (el.textContent || '').match(/课程代码\s*[:：]/g)
      return m ? m.length : 0
    }
    var cards = []
    for (var i = 0; i < anchors.length; i++) {
      var cur = anchors[i]
      for (var up = 0; up < 10 && cur && cur !== document.body; up++) {
        var t = cur.textContent || ''
        if (/学分数\s*[:：]/.test(t)) {
          var parent = cur.parentElement
          if (parent && parent !== document.body && !TERM_RE.test(t) && TERM_RE.test(parent.textContent || '')) {
            if (countCodes(parent) <= 1) cur = parent
          }
          if (cards.indexOf(cur) < 0) cards.push(cur)
          break
        }
        cur = cur.parentElement
      }
    }
    return cards.filter(function (c) {
      return !cards.some(function (o) { return o !== c && c.contains(o) })
    })
  }

  function parseCard(card) {
    var t = (card.textContent || '').replace(/\s+/g, ' ').trim()
    if (!/课程代码/.test(t)) return null

    var code = (t.match(/课程代码\s*[:：]\s*([A-Za-z0-9-]{4,32})/) || [])[1] || ''
    var credits = (t.match(/学分数\s*[:：]\s*(\d+(?:\.\d+)?)/) || [])[1] || ''
    var term = (t.match(TERM_RE) || [])[0] || ''
    var college = (t.match(/([\u4e00-\u9fa5]{2,20}(?:学院|学部|中心|系))/) || [])[1] || ''
    var kind = (t.match(/必选修别\s*[:：]\s*([\u4e00-\u9fa5]{1,6})/) || [])[1] || ''
    var opened = (t.match(/开课\s*[:：]\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || ''

    /* 课程名：卡片第一行形如 `2131010006-基础示例课程二[02]`，
       取「课程号 - 名称[班号]」里的名称部分 */
    var name = ''
    var head = (t.match(/(\d{6,12})\s*[-—]\s*([^\s]{2,60})/) || [])[2] || ''
    if (head) name = head.replace(/\[\d+\]\s*$/, '').replace(/[（(]\d+[)）]\s*$/, '').trim()
    if (!name) {
      var stripped = t
        .replace(/课程代码\s*[:：]\s*[A-Za-z0-9-]+/g, ' ')
        .replace(/学分数\s*[:：]\s*[\d.]+/g, ' ')
        .replace(/[^\u4e00-\u9fa5A-Za-z0-9（）()\[\]\-：: ]/g, ' ')
      var cands = stripped.split(/\s+/).filter(function (s) {
        return s.length >= 3 && s.length <= 40 && /[\u4e00-\u9fa5]/.test(s)
      })
      cands.sort(function (a, b) { return b.length - a.length })
      name = cands[0] || ''
    }
    if (!name) return null

    return {
      code: code,
      name: name,
      teacher: '',
      credits: credits ? Number(credits) : 0,
      term: term,
      room: '',
      raw: (t.slice(0, 300) + (college ? ' | 学院:' + college : '') +
        (kind ? ' | 类别:' + kind : '') + (opened ? ' | 开课:' + opened : '')).slice(0, 400),
    }
  }

  function courses() {
    var out = []
    var cards = findCards()
    for (var i = 0; i < cards.length; i++) {
      var c = parseCard(cards[i])
      if (!c) continue
      var dup = false
      for (var k = 0; k < out.length; k++) {
        if (out[k].code === c.code && out[k].name === c.name && out[k].term === c.term) { dup = true; break }
      }
      if (!dup) out.push(c)
    }
    // 兜底：卡片定位失败时，按「课程代码：」把整页文本切开逐段解析
    if (!out.length) {
      var body = document.body.innerText.replace(/\r/g, '')
      var segs = body.split(/(?=课程代码\s*[:：])/)
      for (var s = 1; s < segs.length; s++) {
        var parsed = parseCard({ textContent: segs[s].slice(0, 600) })
        if (parsed) out.push(parsed)
      }
    }
    return out
  }

  /* ───────────── 个人信息 ───────────── */

  function profile(body, kind) {
    var realName = '', college = '', studentId = '', major = '', grade = '', className = ''

    if (kind === 'courses' || (/课程代码/.test(body) && /学分数/.test(body))) {
      // 左侧栏是「头像 / 姓名 / 身份」。用「学生/教师」做锚点往上找姓名。
      var side = $$('aside, div').filter(function (el) {
        var t = txt(el)
        return t.length < 200 && /^(学生|教师|管理员)$/.test(t.replace(/\s/g, ''))
      })[0]
      if (side) {
        var up = side
        for (var i = 0; i < 4 && up; i++) {
          var cands = (up.innerText || '').split('\n').map(function (x) { return x.trim() }).filter(Boolean)
          for (var c = 0; c < cands.length; c++) {
            if (/^[\u4e00-\u9fa5]{2,4}$/.test(cands[c]) &&
              !/学生|教师|首页|公告|我的|小组|收藏|关注|分享/.test(cands[c])) {
              realName = cands[c]; break
            }
          }
          if (realName) break
          up = up.parentElement
        }
      }
    }

    if (kind === 'portal' || /融合服务门户|今日课表/.test(body)) {
      /* 门户右上角是「姓名 ▾」。那个三角经常是图标而不是字符，
         所以除了字符还要试几种常见写法，最后退回"导航区里的 2~4 字中文名"。 */
      /* 三角箭头在真实页面上是个**图标**（不是 ▾ 字符），所以字符匹配常常落空。
         改用一个结构锚点：学院是可靠的（能从 title 属性拿到），
         而姓名就紧挨在学院上方 —— 门户右侧卡片是「姓名 / 学院 / 身份」三行。 */
      var m = body.match(/([\u4e00-\u9fa5]{2,4})\s*[▾▼⌄∨ˇ]/)
      if (m) realName = m[1]
      if (!realName) {
        // 「姓名」两字被图标分隔时，取它前面紧邻的中文名
        var m2 = body.match(/([\u4e00-\u9fa5]{2,4})[\s\S]{0,4}?(?:退出|个人中心|我的主页|切换)/)
        if (m2) realName = m2[1]
      }
      /* 学院在姓名下方，常被 CSS 截断成「计算机与网络空间安...」。
         先找带 title 的元素（全称常放那里），再从正文正则匹配。 */
      var cands2 = $$('*').filter(function (el) {
        return el.children.length === 0 &&
          /学院|学部|中心/.test(el.getAttribute && (el.getAttribute('title') || ''))
      })
      if (cands2.length) college = clean(titleOf(cands2[0])) || clean(cands2[0].getAttribute('title'))
      if (!college) {
        var mc = body.match(/([\u4e00-\u9fa5]{4,25}(?:学院|学部|中心))/)
        if (mc) college = mc[1]
      }

      /* 姓名：从学院元素所在的小容器里往上找 2~4 字中文名。
         比 match 整个 body 可靠得多 —— 整页里 2~4 字的中文串太多了，
         而"和学院挨在一起"这个约束几乎唯一。 */
      if (!realName && cands2.length) {
        var up2 = cands2[0]
        for (var k2 = 0; k2 < 4 && up2; k2++) {
          var lines2 = String(up2.innerText || '').split('\n')
            .map(function (s) { return s.replace(/\s+/g, '').trim() })
            .filter(Boolean)
          for (var j2 = 0; j2 < lines2.length; j2++) {
            if (/^[\u4e00-\u9fa5]{2,4}$/.test(lines2[j2]) &&
                !/学生|教师|学院|学部|中心|退出|登录/.test(lines2[j2])) {
              realName = lines2[j2]
              break
            }
          }
          if (realName) break
          up2 = up2.parentElement
        }
      }
    }

    if (!realName) realName = kv(['姓名', '名字'], 10)
    if (!studentId) studentId = kv(['学号', '学籍号'], 20)
    if (!college) college = kv(['学院', '院系', '学部'], 25)
    if (!major) major = kv(['专业', '专业名称'], 25)
    if (!grade) grade = kv(['年级'], 10)
    if (!className) className = kv(['班级', '行政班'], 25)

    return {
      realName: realName, studentId: studentId, college: college,
      major: major, grade: grade, className: className,
    }
  }

  /* ───────────── 教务系统课表页：**不再由脚本导入** ─────────────
     2026-10 改成用文件导入（导入页「上传文件」→ 教务系统导出的课表 .xlsx）。
     原因：那一页一个格子里塞了 4~6 个不同周次 / 不同教室 / 线上线下不同的
     时段，还靠固定表头把表拆成两张，版面一改就整段失效 —— 而导出成表格后
     同一份内容是**结构化**的，解析稳得多（见 lib/timetableXlsx.ts）。

     pageKind 仍然把这一页认成 `timetable`，好让面板明确告诉用户
     "课表请用导出文件导入"，而不是含糊地说"没识别到内容"。 */


  /* ───────────── 门户首页的今日课表与作业 ───────────── */

  /** `3-4 节：示例课程  @某实验室…` → 结构化 */
  function todaySchedule(body) {
    var out = []
    /* 原来的正则要求课名和地点之间有 @ —— 可真实页面上那个是**图标**，
       于是整条匹配不上，今日课表永远是空的。
       改成：先抓到「N-M 节：后面的整段」，再按分隔符切课名与地点。 */
    var re = /(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*节\s*[:：]\s*([^\n]{2,60})/g
    var m
    while ((m = re.exec(body))) {
      var rest = m[3].trim()
      // 地点前可能是 @、全角＠、若干空格、或一个图标字符
      var parts = rest.split(/\s*[@＠]\s*|[\s\u3000]+/).filter(Boolean)
      out.push({
        name: (parts[0] || '').trim(),
        from: Number(m[1]),
        to: Number(m[2]),
        room: (parts.slice(1).join(' ') || '').trim(),
      })
    }
    return out
  }

  /** 课程任务：`《示例课程》第3次作业 | 通识示例课程一：… | 2026-10-07 15:59` */
  function assignments(body) {
    var out = []
    var lines = body.split('\n')
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim()
      if (!t || t.length > 80) continue
      if (!/作业|实验|报告|论文|测验|考试/.test(t)) continue
      // 课表行也可能含「实验」（如「基础示例课程一」），但不是待办
      if (/^\d{1,2}\s*[-–—]\s*\d{1,2}\s*节/.test(t)) continue
      // 截止时间在同一行或相邻行
      var when = ''
      var mm = (t + ' ' + (lines[i + 1] || '')).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/)
      if (mm) when = mm[0]
      out.push({ title: t.slice(0, 100), due: when })
    }
    return out
  }

  /* 采集页面文本。
     ⚠️ 必须连**同源 iframe** 一起读：`innerText` 不包含 iframe 里的内容，
     而融合门户（i.cuc.edu.cn）这类系统常把卡片嵌在 iframe 里 ——
     只读顶层文档的话整页看起来"什么都没有"，用户就会看到「没识别到内容」。
     跨域 iframe 读不到（会抛异常），记录下来供诊断。 */
  function collectPages() {
    var pages = [{ doc: document, label: '顶层文档' }]
    var frames = document.querySelectorAll('iframe')
    var blocked = 0
    for (var i = 0; i < frames.length; i++) {
      try {
        var d = frames[i].contentDocument
        if (d && d.body) pages.push({ doc: d, label: 'iframe #' + (i + 1) })
        else blocked++
      } catch (e) {
        blocked++
      }
    }
    return { pages: pages, iframeCount: frames.length, blocked: blocked }
  }

  var collected = collectPages()
  var body = collected.pages
    .map(function (pg) {
      try {
        return pg.doc.body ? pg.doc.body.innerText : ''
      } catch (e) {
        return ''
      }
    })
    .join('\n')
  var kind = pageKind(body)
  var notes = []

  /* 课程列表页那条路解析出课程（**不含时间段**）。
     教务课表页不再由脚本解析 —— 课表改走"导出 xlsx → 导入页上传"，
     见上面 pageKind 里 timetable 那段的说明与 lib/timetableXlsx.ts。 */
  var coursesOut = kind === 'timetable' ? [] : courses()

  if (kind === 'timetable') {
    notes.push(
      '这是教务系统的课表页 —— 课表已经改成**用文件导入**了：' +
      '在本页点「导出」拿到课表 .xlsx，然后到 Campus Vault 的导入页 →「上传文件」→ 传那份表格。',
    )
  }
  if (kind === 'unknown') {
    notes.push('无法判断当前页面类型，可能学校改版了')
  }


  /* ------------------------- 成绩查询 -------------------------
     页面是一张表格，表头形如：
       操作 | 学年学期 | 课程名 | 课程号 | 总成绩 | 课序号 | 课程类别 |
       课程性质 | 学分 | 学时 | 修读方式 | 是否主修 | 考试日期 | 绩点 | 重修重考

     **按表头文字定位列**，不写死下标 —— 学校加一列（比如"绩点排名"）
     就会让所有下标错位，而按表头找不会。

     ⚠️ 表格是**分页**的（每页 10 条）。这个函数只解析当前页，
     翻页由**用户自己在页面上点**（脚本不自动翻页）。
     ---------------------------------------------------------- */

  var GRADE_COLS = {
    学期: ['学年学期', '学期'],
    课程名: ['课程名', '课程名称'],
    课程号: ['课程号', '课程代码'],
    成绩: ['总成绩', '成绩'],
    学分: ['学分'],
    绩点: ['绩点', '绩点成绩'],
    类别: ['课程类别'],
    性质: ['课程性质'],
    修读: ['修读方式'],
    主修: ['是否主修'],
    考试: ['考试日期'],
    重修: ['重修重考'],
  }

  /**
   * 在一个表头行里，按候选名找到列下标。
   *
   * **先找完全相等的，再退回"包含"** —— 这一步不能省。
   * 只看"包含"的话，学校加一列「绩点排名」，找「绩点」会先命中年排名那一列，
   * 于是绩点全变成了名次（实测：绩点 3.85 读成了 1）。
   * 完全相等优先就能把「绩点」和「绩点排名」分开。
   */
  function findCol(headers, names) {
    for (var i = 0; i < names.length; i++) {
      for (var j = 0; j < headers.length; j++) {
        if (headers[j] === names[i]) return j
      }
    }
    for (var k = 0; k < names.length; k++) {
      for (var m = 0; m < headers.length; m++) {
        if (headers[m].indexOf(names[k]) >= 0) return m
      }
    }
    return -1
  }

  /** 表格/单元格是不是"看得见"的。
      隐藏的克隆格（固定列那种实现会把同一格复制一份藏起来）必须跳过，
      否则按位置取列会整体错位。 */
  function isVisible(el) {
    try {
      var cs = window.getComputedStyle ? window.getComputedStyle(el) : null
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false
      return !!(el.getClientRects && el.getClientRects().length)
    } catch (e) {
      return false
    }
  }

  /** 一行里**可见的**单元格。用 td 和 th 都收（有的系统表头用 th、数据用 td） */
  function cellsOf(row, visibleOnly) {
    var all = row.querySelectorAll('td,th')
    var out = []
    for (var i = 0; i < all.length; i++) {
      if (visibleOnly && !isVisible(all[i])) continue
      out.push(all[i])
    }
    return out
  }

  /** 一行的**可见文本**（innerText 会跳过隐藏元素，这正是我们要的） */
  function rowText(el) {
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
  }

  /** 一张表的数据行（没有 tbody 时退化成"跳过表头行"） */
  function rowsOf(t) {
    var rows = t.querySelectorAll('tbody tr')
    if (rows.length) return Array.prototype.slice.call(rows)
    var skip = t.querySelectorAll('thead tr').length || 1
    return Array.prototype.slice.call(t.querySelectorAll('tr'), skip)
  }

  /** 表头文字（没有 thead 就用第一行当表头） */
  function headTextOf(t) {
    var headEl = t.querySelector('thead')
    var txt = headEl ? (headEl.innerText || headEl.textContent || '') : ''
    if (!txt) {
      var first = t.querySelector('tr')
      txt = first ? (first.innerText || first.textContent || '') : ''
    }
    return txt
  }

  /**
   * 找**列标题**在哪。
   *
   * 实测某教务系统的版面是这样的（用户把诊断信息发回来后才知道）：
   *   · 页面上 3 张 `<table>`，**全都没有 thead**
   *   · 没有哪一行表格文本里含「总成绩 / 课程号」—— 表头是**表格外面的 div 画的**
   *   · 数据行的单元格里还有**隐藏的克隆格**（课程名/课程号各多一份）
   * 所以"只在表格里、只看第一行"这套找法会全军覆没（选中表头 = -1）。
   *
   * 现在按可靠度依次找：
   *   ① 任意表里的**任意一行**（不只看第一行 / 不只看 thead）
   *   ② 表格外**最深**的那个同时含「总成绩」和「课程号」的元素，取它的子元素当列标题
   */
  function findHeader() {
    var tables = $$('table')
    var i
    var r
    for (i = 0; i < tables.length; i++) {
      var trs = tables[i].querySelectorAll('tr')
      for (r = 0; r < trs.length; r++) {
        var t = trs[r].innerText || trs[r].textContent || ''
        if (t.indexOf('总成绩') >= 0 && t.indexOf('课程号') >= 0) {
          var cells = cellsOf(trs[r], false)
          var labels = []
          for (var c = 0; c < cells.length; c++) {
            labels.push((cells[c].innerText || cells[c].textContent || '').replace(/\s+/g, '').trim())
          }
          return { labels: labels, how: '表格第 ' + (i + 1) + ' 张的第 ' + (r + 1) + ' 行', el: trs[r] }
        }
      }
    }
    /* 表格外找：候选 = 文本里同时有 总成绩 和 课程号 的元素；
       取"最深"的那个（它内部没有别的候选），它的子元素就是列标题 */
    var cands = $$('div,ul,section,header,li,span,p')
    var best = null
    for (i = 0; i < cands.length; i++) {
      var el = cands[i]
      var txt = el.innerText || el.textContent || ''
      if (txt.indexOf('总成绩') < 0 || txt.indexOf('课程号') < 0) continue
      var inner = el.querySelectorAll('div,ul,section,header,li,span,p')
      var deeper = false
      for (var k = 0; k < inner.length; k++) {
        var it = inner[k].innerText || inner[k].textContent || ''
        if (it.indexOf('总成绩') >= 0 && it.indexOf('课程号') >= 0) { deeper = true; break }
      }
      if (!deeper) best = el
    }
    if (!best) return null
    var kids = Array.prototype.slice.call(best.children)
    var out = []
    if (kids.length >= 5) {
      for (i = 0; i < kids.length; i++) {
        out.push((kids[i].innerText || kids[i].textContent || '').replace(/\s+/g, '').trim())
      }
    } else {
      /* 子元素不够多，说明整行文字挤在一个节点里 —— 按空白切开兜底 */
      var parts = (best.innerText || best.textContent || '').split(/[\s\n]+/)
      for (i = 0; i < parts.length; i++) if (parts[i]) out.push(parts[i].replace(/\s+/g, '').trim())
    }
    return { labels: out, how: '表格外的一排元素（' + kids.length + ' 个子元素）', el: best }
  }

  /**
   * 选"数据表"。
   *
   * 页面上可能有好几张表（空数据占位、固定列克隆、另一张一模一样的表……），
   * 用**可见单元格的条数**当分数选最像数据表的那张 ——
   * 隐藏克隆多的表分数会低。
   */
  function findDataTable() {
    var tables = $$('table')
    var best = null
    var bestScore = 0
    for (var i = 0; i < tables.length; i++) {
      var rows = rowsOf(tables[i])
      var score = 0
      var rowsWithData = 0
      for (var r = 0; r < rows.length && r < 60; r++) {
        var n = cellsOf(rows[r], true).length
        if (n >= 5) { rowsWithData++; score += n }
      }
      if (rowsWithData && score > bestScore) { bestScore = score; best = tables[i] }
    }
    return best
  }

  /**
   * 成绩页的结构快照 —— **解析不出行时用来定位问题**。
   *
   * 用户点一下面板上的「复制诊断信息」，粘回来的就是"页面上到底有哪些表、
   * 表头是什么、第一行有哪些单元格"。没有它只能靠截图猜 DOM 结构，
   * 而截图看不出"表头是不是在表格里""行里有没有隐藏的克隆格"这类关键差别。
   *
   * 第一版就是靠它定的位，所以这里保留并加了**更细的线索**：
   * 表头元素长什么样（outerHTML）、单元格的 class（有的组件靠 class 对列）。
   */
  function gradeDebugInfo() {
    var head = findHeader()
    var body = findDataTable()
    var tables = []
    var all = $$('table')
    for (var i = 0; i < all.length && i < 12; i++) {
      var t = all[i]
      var rows = rowsOf(t)
      var firstRow = rows[0]
      var visCells = firstRow ? cellsOf(firstRow, true) : []
      var allCells = firstRow ? cellsOf(firstRow, false) : []
      var cells = []
      for (var c = 0; c < visCells.length && c < 16; c++) {
        cells.push((visCells[c].innerText || visCells[c].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 12))
      }
      var cls = []
      for (var c2 = 0; c2 < allCells.length && c2 < 16; c2++) {
        cls.push(String(allCells[c2].className || '').slice(0, 40))
      }
      tables.push({
        序号: i,
        可见: isVisible(t),
        自身class: String(t.className || '').slice(0, 60),
        thead行数: t.querySelectorAll('thead tr').length,
        数据行数: rows.length,
        首行可见格数: visCells.length,
        首行总格数: allCells.length,
        表头文字: rowText(t).slice(0, 60),
        首行单元格: cells,
        首行class: cls,
      })
    }
    return {
      已找到表头: !!head,
      表头来源: head ? head.how : '(没找到)',
      表头列: head ? head.labels : [],
      选中数据表: body ? all.indexOf(body) : -1,
      解析出行数: body ? rowsOf(body).filter(function (r) { return cellsOf(r, true).length >= 5 }).length : 0,
      表格数: all.length,
      表格明细: tables,
      表头元素片段: head && head.el ? String(head.el.outerHTML || '').slice(0, 400) : '',
    }
  }

  /* ── 表头 × 数据 的配对校验 ──────────────────────────────────────────
     实测踩过的坑（用户真实数据反推出来的）：
     页面上有两张表，**一张有分数列、一张没有**（比如「未提交成绩」那个签），
     而表头是 div 画的、可以离数据表很远。原来"取文档里第一个含
     总成绩+课程号 的元素"当表头 —— 于是表头来自 A 表、数据来自 B 表，
     列整体错位 2 格：学分位置读到了「课程类别」，绩点位置读到了「考试日期」，
     表现为"课程名对、学分和绩点全是空"。

     所以：**表头必须配对自己的数据表**（就近找），再用"值的类型像不像这一列"
     打分挑出最可信的那一对。分数列是数字或"优秀/及格"这类等级词，
     一眼就能和「课程类别」这种文字列区分开。 */

  /** 这一列的值，像不像这个表头？分越高越像 */
  function typeScore(label, val) {
    var v = String(val || '').replace(/\s+/g, '')
    if (!label || !v) return 0
    if (/^(课程名|课程名称)$/.test(label)) {
      return /[A-Za-z\u4e00-\u9fa5]/.test(v) && !/^\d+$/.test(v) && v.indexOf('学年') < 0 ? 3 : 0
    }
    if (/^(课程号|课程代码)$/.test(label)) return /^[A-Za-z0-9]{6,}$/.test(v) ? 4 : 0
    if (/^(学年学期|学期)$/.test(label)) return /^\d{4}-\d{4}学年/.test(v) ? 4 : 0
    if (/^(总成绩|成绩)$/.test(label)) {
      if (/^\d{1,3}(\.\d+)?$/.test(v) && parseFloat(v) <= 150) return 4
      /* 成绩**不全是数字**：优秀 / 良好 / 及格 / 通过 / 免修 / 缓考 都要认 */
      if (/^(优秀|良好|中等|及格|不及格|通过|不通过|合格|不合格|免修|缓考|未通过|优|良|中|差)$/.test(v)) return 4
      return 0
    }
    if (/^课程类别$/.test(label)) return /(课|环节)$/.test(v) ? 3 : 0
    if (/^课程性质$/.test(label)) return /^(必修|选修|限选|任选|实践|专业课|公共课|基础课)/.test(v) ? 3 : 0
    if (/^学分$/.test(label)) { var n = parseFloat(v); return /^\d+(\.\d+)?$/.test(v) && n > 0 && n <= 20 ? 3 : 0 }
    if (/^学时$/.test(label)) { var h = parseFloat(v); return /^\d{1,3}$/.test(v) && h >= 4 ? 3 : 0 }
    if (/^(修读方式|重修重考)$/.test(label)) return /^(正常|重修|重考|免修|缓考|补修)$/.test(v) ? 3 : 0
    if (/^是否主修$/.test(label)) return /^(是|否)$/.test(v) ? 2 : 0
    if (/^考试日期$/.test(label)) return /^\d{4}-\d{1,2}-\d{1,2}$/.test(v) ? 4 : 0
    if (/^绩点/.test(label)) { var g = parseFloat(v); return /^\d+(\.\d+)?$/.test(v) && g > 0 && g <= 5 ? 3 : 0 }
    return 0
  }

  /** 就近找**属于这张表**的表头（同一容器里、紧挨着数据表上面的那排标签） */
  function nearestHeaderOf(table) {
    /* ① 表自己带头（thead / 第一行） */
    var own = table.querySelector('thead tr')
    var ownTxt = own ? (own.innerText || own.textContent || '') : ''
    if (ownTxt.indexOf('总成绩') >= 0 && ownTxt.indexOf('课程号') >= 0) {
      return { labels: labelsOfRow(own), el: own, how: '表内 thead' }
    }
    /* ② 往上找 3 层，每一层看**前一个兄弟**：表头通常就是数据表上面那排 div */
    var node = table
    for (var up = 0; up < 3 && node; up++) {
      var sib = node.previousElementSibling
      for (var k = 0; k < 4 && sib; k++) {
        var t = sib.innerText || sib.textContent || ''
        if (t.indexOf('总成绩') >= 0 && t.indexOf('课程号') >= 0) {
          var labels = labelsOfEl(sib)
          if (labels.length >= 5) return { labels: labels, el: sib, how: '数据表正上方那排标签' }
        }
        sib = sib.previousElementSibling
      }
      node = node.parentElement
    }
    return null
  }

  /** 一行里每个单元格的文字（表头和数据行共用） */
  function labelsOfRow(row) {
    var cells = cellsOf(row, false)
    var out = []
    for (var i = 0; i < cells.length; i++) {
      out.push((cells[i].innerText || cells[i].textContent || '').replace(/\s+/g, '').trim())
    }
    return out
  }

  /** 一个"表头元素"的列名。
      表头可能是 `<tr>`（取 td/th），也可能是**一排 div**（取子元素）——
      实测那套教务系统的表头就是 div 画的。 */
  function labelsOfEl(el) {
    if (!el) return []
    if (el.tagName === 'TR') return labelsOfRow(el)
    var kids = Array.prototype.slice.call(el.children)
    var out = []
    for (var i = 0; i < kids.length; i++) {
      out.push((kids[i].innerText || kids[i].textContent || '').replace(/\s+/g, '').trim())
    }
    return out
  }

  function grades() {
    /* 候选：每张"像数据表"的表 × 配得上它的表头。打分挑最可信的一对 */
    var tables = $$('table')
    var best = null
    for (var ti = 0; ti < tables.length; ti++) {
      var candTable = tables[ti]
      var rows = rowsOf(candTable)
      if (!rows.length) continue
      var head = nearestHeaderOf(candTable) || findHeader()
      if (!head) continue
      var idx = {}
      for (var key in GRADE_COLS) idx[key] = findCol(head.labels, GRADE_COLS[key])
      if (idx.课程名 < 0 || idx.成绩 < 0) continue
      /* 两种取格方式都要试，用"值像不像这一列"打分选，不靠猜：
         · all     —— 行里的**全部**格子。jqxGrid 这类网格（jqx-grid-table）
                      表头和数据行共用同一套列模型（实测两边都是 63 列），
                      按位置一一对应才对：隐藏列在两边都存在，一个都不能跳。
                      ★ 上一版就是这里错的：表头 63 列的索引，配上"只留可见 21 格"
                        的数组 → 总成绩(第7列)读到了第7个可见格＝课程类别，
                        症状是"课程名对、学分和绩点空、成绩变成课程类别"。
         · visible —— 只留可见格。另一种版面（固定列实现会把同一格复制一份藏起来，
                      表头列数少于行格数）必须这样，否则整体错位。 */
      var modes = ['all', 'visible']
      for (var mi = 0; mi < modes.length; mi++) {
        var mode = modes[mi]
        var score = 0
        var used = 0
        var scoreHits = 0
        for (var r0 = 0; r0 < rows.length && used < 3; r0++) {
          var c0 = cellsOf(rows[r0], mode === 'visible')
          if (c0.length < 5) continue
          used++
          for (var key2 in idx) {
            var j = idx[key2]
            if (j < 0 || j >= c0.length) continue
            var val = (c0[j].innerText || c0[j].textContent || '').replace(/\s+/g, ' ').trim()
            var pts = typeScore(GRADE_COLS[key2][0], val)
            score += pts
            /* 「成绩」那一列必须真的像成绩（分数或等级词）。
               否则说明这张表压根没有分数列（比如"未提交成绩"那个签），
               硬导进去就是一排错位的数据 —— 宁可一行不导。 */
            if (key2 === '成绩' && pts > 0) scoreHits++
          }
        }
        if (!used || !scoreHits) continue
        if (!best || score > best.score) {
          best = { table: candTable, head: head, idx: idx, score: score, rows: rows, mode: mode }
        }
      }
    }
    if (!best) return []
    var idx = best.idx
    var bodyRows = best.rows
    var useVisible = best.mode === 'visible'

    var out = []
    for (var r = 0; r < bodyRows.length; r++) {
      /* ⚠️ 只取**可见的**单元格。
         实测某教务系统的行里有隐藏的克隆格（课程名/课程号各多一份，
         首行 16 格而表头只有 15 列）—— 把它们算进来会让所有列整体错位。
         innerText 也会跳过不可见元素，两边口径一致。 */
      var tds = cellsOf(bodyRows[r], useVisible)
      if (tds.length < 5) continue
      var cell = function (k) {
        var i = idx[k]
        if (i < 0 || i >= tds.length) return ''
        return (tds[i].innerText || tds[i].textContent || '').replace(/\s+/g, ' ').trim()
      }
      var name = cell('课程名')
      var score = cell('成绩')
      // 没有课程名的行是空行/占位行
      if (!name) continue
      var credit = parseFloat(cell('学分'))
      var gpa = parseFloat(cell('绩点'))
      out.push({
        name: name,
        code: cell('课程号'),
        term: cell('学期'),
        // 成绩可能是 "91" 也可能 "优秀/及格"，两种都原样留着
        score: score,
        scoreNum: /^\d+(\.\d+)?$/.test(score) ? parseFloat(score) : null,
        credit: isNaN(credit) ? 0 : credit,
        gpa: isNaN(gpa) ? null : gpa,
        category: cell('类别'),
        nature: cell('性质'),
        mode: cell('修读'),
        major: cell('主修') === '是',
        examDate: cell('考试'),
        retake: cell('重修'),
      })
    }
    return out
  }

  /**
   * 分页按钮是不是禁用态。
   *
   * 四层都要看，因为不同前端框架禁用写法不一样：
   * `disabled` 属性、`aria-disabled`、自身 class、**父元素 class**
   * （layui 那种 `<li class="layui-disabled"><a>下一页</a></li>`）。
   * 漏了父元素那层，翻到最后一页仍会认为"还有下一页"，
   * 于是面板会一直催用户"请自己翻页"（其实已经到底了）。
   */
  function isDeadBtn(el) {
    if (el.disabled) return true
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true
    var re = /disabled|is-disabled|layui-disabled/i
    if (re.test(String(el.className || ''))) return true
    var up = el.parentElement
    for (var i = 0; i < 2 && up; i++) {
      if (re.test(String(up.className || ''))) return true
      up = up.parentElement
    }
    return false
  }

  /** 这个元素是不是待在分页控件里（用来给"光秃秃一个 > 符号"的按钮兜底） */
  function inPager(el) {
    var cur = el
    for (var i = 0; i < 3 && cur; i++) {
      var t = (cur.innerText || cur.textContent || '').replace(/\s+/g, '')
      if (/每页|总页数|总记录数|共\d+页|上一页|下一页/.test(t)) return true
      cur = cur.parentElement
    }
    return false
  }

  /**
   * 找"下一页"按钮。
   *
   * 页面上它可能是**文字**（下一页 / 下页），也可能只是一个符号 `>`
   * —— 截图里的分页就是 `[|<] [<] [>] [>|]` 四个图标。
   * 只认"下一页"三个字的话，成绩页永远只导得进第一页，
   * 而且不报错（用户看到的是"导入成功，只有 10 条"）。
   *
   * 所以按可靠度分层：
   *   ① 文字明确是"下一页" → 直接用
   *   ② title / aria-label / class 里带 next（图标按钮）
   *   ③ 文字就是一个 `>`，且**待在分页控件里** → 兜底
   * "末页"（`>|`）一律排除：它会跳过中间所有页。
   */
  function nextPageBtn() {
    var cands = $$('a,button,li,span,i')
    var fallback = null
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i]
      var txt = (el.innerText || el.textContent || '').replace(/\s+/g, '').trim()
      var hint =
        String((el.getAttribute && el.getAttribute('title')) || '') + ' ' +
        String((el.getAttribute && el.getAttribute('aria-label')) || '') + ' ' +
        String(el.className || '')
      // 末页按钮先排除，否则会一路跳到最后一页、漏掉中间页
      if (/末页|尾页|最后一页|last|end/i.test(hint)) continue
      if (isDeadBtn(el)) continue

      if (/^(下一页|下页|next)$/i.test(txt)) return el
      if (/下一页|下页/.test(hint)) return el
      if (/next|arrow-right|chevron-right|icon-right/i.test(hint)) return el
      if (!fallback && /^[>›»]$/.test(txt) && inPager(el)) fallback = el
    }
    return fallback
  }

  /** 这一页是不是还有下一页。
      ⚠️ 只**判断**，不点 —— 脚本不做自动翻页（用户明确不要），
      面板拿它提示"请自己翻页再点一次"。 */
  function hasNextPage() {
    return !!nextPageBtn()
  }

  return {
    kind: kind,
    host: location.host,
    href: location.href,
    profile: profile(body, kind),
    courses: coursesOut,
    today: todaySchedule(body),
    assignments: assignments(body),
    grades: kind === 'grades' ? grades() : [],
    /* 分页信息交给调用方：这一页是不是还有下一页。
       面板据此提示"请自己翻页再点一次" ——
       ⚠️ 脚本**不做自动翻页**（用户明确不要），只导当前这一页。 */
    gradesPage: kind === 'grades' ? { hasNext: hasNextPage() } : null,
    /* 成绩页的结构快照。解析不出行时，用户点「复制诊断信息」把它发回来，
       就能按**真实结构**修解析规则 —— 截图看不出"表头和数据是不是两张表"。 */
    gradeDebug: kind === 'grades' ? gradeDebugInfo() : null,
    notes: notes,
    /* 诊断信息。解析失败时把它显示出来，用户能直接告诉开发者
       "页面上到底有什么"，而不是只看到一句「没识别到内容」。 */
    debug: {
      docs: collected.pages.map(function (pg) { return pg.label + '(' + (pg.doc.body ? pg.doc.body.innerText.length : 0) + '字)' }),
      iframeCount: collected.iframeCount,
      blockedFrames: collected.blocked,
      textLength: body.length,
      sample: body.replace(/\s+/g, ' ').trim().slice(0, 500),
      marks: {
        今日课表: /今日课表/.test(body),
        待办任务: /待办任务|课程任务/.test(body),
        姓名样式: /[\u4e00-\u9fa5]{2,4}\s*[▾▼⌄∨ˇ]/.test(body),
        学院字样: /学院|学部/.test(body),
      },
    },
  }
}
