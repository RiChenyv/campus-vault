/**
 * 书签脚本的**实际执行体**（纯 JS，不要写成 TS）。
 *
 * 为什么要单独一个 .js：书签脚本靠 `fn.toString()` 生成 `javascript:` URL，
 * 而 toString() 返回源码文本 —— 写在 .ts 里类型标注可能残留在文本中，
 * 粘进浏览器就是语法错误。所以这里刻意用纯 JS，且不引用任何外部变量。
 *
 * ─── 解析策略 ───────────────────────────────────────────────
 * 学校页面是 Vue SPA，DOM 结构（class 名）会随版本变，
 * 所以**不依赖具体选择器**，而是靠页面上的**文字特征**定位：
 *   找到含「课程代码：」的元素 → 向上找到同时含「学分数」的卡片容器 → 解析该卡片文本。
 * 页面改版时最先变的是 class，最不容易变的是这些中文标签。
 * 认不出来就明确报错，绝不猜 —— 宁可导入失败，不要把错数据写进库。
 *
 * ─── 已知页面 ───────────────────────────────────────────────
 *  A. courses.cuc.edu.cn/user/courses  「我的课程」
 *     卡片：`2131010006-基础示例课程二[02]`
 *           课程代码：202620271213101000602
 *           {学院}  开课：2026-09-07
 *           必选修别：必修  学分数：4.0  授课教师：…
 *           （右侧）2026-2027第1学期
 *     左侧栏：姓名 / 身份（学生）
 *
 *  B. i.cuc.edu.cn/Newstudent-portal/  「融合服务门户」
 *     右侧栏：姓名 / 学院（可能被 CSS 截断）
 *     今日课表：`3-4 节：计算机系统  @ 网络工程…`
 */
function cvImport(CFG) {
  var $ = function (s) { return document.querySelector(s) }
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)) }
  var txt = function (el) { return (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim() }

  /* ───────────────── 通用：键值对 ───────────────── */

  /** 在整页文本里找「标签：值」。最通用，作为兜底。 */
  function kvFromText(body, labels, maxLen) {
    for (var i = 0; i < labels.length; i++) {
      // 值里不允许出现空格，因为标签后面往往紧跟别的字段
      var re = new RegExp(labels[i] + '\\s*[:：]\\s*([^\\s，,、；;|]{1,' + (maxLen || 40) + '})')
      var m = body.match(re)
      if (m && m[1]) return m[1].trim()
    }
    return ''
  }

  /** 表格里的「标签 → 值」 */
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
   * 清理取到的值。
   *
   * 学校页面大量使用 CSS 截断（`text-overflow: ellipsis`），
   * 但 textContent 拿到的是**完整文本** —— 所以正常情况下不会带省略号。
   * 真带上省略号说明这个来源确实不全，此时**宁可留空也不要存半截**：
   * 「计算机与网络空间安...」比空字符串更糟，因为它看起来像有效数据。
   */
  function clean(v) {
    if (!v) return ''
    var s = String(v).replace(/[.．·…]+\s*$/, '').trim()
    // 明显被截断的（以单个"安"结尾但不是完整学院名）交给调用方判断；
    // 这里只负责去掉省略号本身
    return s
  }

  /** 找带 title 属性的祖先 —— 截断文本常把全称放在 title 里 */
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

  /* ───────────────── 页面识别 ───────────────── */

  function pageKind() {
    var url = location.href
    var body = document.body ? document.body.innerText : ''
    if (/courses\.cuc\.edu\.cn/.test(url) && /我的课程|课程代码/.test(body)) return 'courses'
    if (/i\.cuc\.edu\.cn/.test(url)) return 'portal'
    /* 光看 URL 太脆：学校换个路径、或者页面被 iframe 嵌进来就失效了。
       所以再加一层**按内容**判断，两边任一命中即可。 */
    if (/课程代码/.test(body) && /学分数/.test(body)) return 'courses'
    if (/融合服务门户|今日课表|待办任务/.test(body)) return 'portal'
    if (/课程代码/.test(body)) return 'courses'
    return 'unknown'
  }

  /* ───────────────── 课程卡片解析 ───────────────── */

  /* 学期：`2026-2027第1学期`。必须是 var 且在 findCards 之前 —— var 不提升赋值。 */
  var TERM_RE = /(\d{4})\s*[-–—]\s*(\d{4})\s*第\s*(\d)\s*学期/

  /**
   * 找到所有"课程卡片"容器。
   *
   * 做法：定位所有含「课程代码：」的元素，向上找最近的、含「学分数」的祖先，
   * 那就是一张卡片的**内容区**。
   *
   * ⚠️ 但学期（`2026-2027第1学期`）在卡片里是**内容区的兄弟节点**，
   * 只找到「学分数」那一层就会漏掉它。所以再往上顶一层，
   * 前提是那一层**没有包含第二门课**（否则就吃到隔壁卡片了）。
   */
  function findCards() {
    var all = $$('*')
    var anchors = all.filter(function (el) {
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
          // 学分数在，但学期可能在外面 —— 试着往上顶一层
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
    // 去掉"包含另一张卡片"的外层容器，只留最内层的卡片
    return cards.filter(function (c) {
      return !cards.some(function (o) { return o !== c && c.contains(o) })
    })
  }

  /* 学期：`2026-2027第1学期` */


  function parseCard(card) {
    var t = (card.textContent || '').replace(/\s+/g, ' ').trim()
    if (!/课程代码/.test(t)) return null

    var code = (t.match(/课程代码\s*[:：]\s*([A-Za-z0-9-]{4,32})/) || [])[1] || ''
    var credits = (t.match(/学分数\s*[:：]\s*(\d+(?:\.\d+)?)/) || [])[1] || ''
    var term = (t.match(TERM_RE) || [])[0] || ''
    var college = (t.match(/([\u4e00-\u9fa5]{2,20}(?:学院|学部|中心|系))/) || [])[1] || ''
    var kind = (t.match(/必选修别\s*[:：]\s*([\u4e00-\u9fa5]{1,6})/) || [])[1] || ''
    var opened = (t.match(/开课\s*[:：]\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || ''

    /* 课程名：卡片第一行形如 `2131010006-基础示例课程二[02]`
       取「数字课程号 - 名称[班号]」里的名称部分。
       取不到就退回："去掉所有已知字段后的最长中文串"。 */
    var name = ''
    var head = (t.match(/(\d{6,12})\s*[-—]\s*([^\s]{2,60})/) || [])[2] || ''
    if (head) {
      name = head.replace(/\[\d+\]\s*$/, '').replace(/[（(]\d+[)）]\s*$/, '').trim()
    }
    if (!name) {
      var stripped = t
        .replace(/课程代码\s*[:：]\s*[A-Za-z0-9-]+/g, ' ')
        .replace(/学分数\s*[:：]\s*[\d.]+/g, ' ')
        .replace(/[^\u4e00-\u9fa5A-Za-z0-9（）()\[\]\-：: ]/g, ' ')
      var cands = stripped.split(/\s+/).filter(function (s) { return s.length >= 3 && s.length <= 40 && /[\u4e00-\u9fa5]/.test(s) })
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
      raw: (t.slice(0, 300) + (college ? ' | 学院:' + college : '') + (kind ? ' | 类别:' + kind : '') + (opened ? ' | 开课:' + opened : '')).slice(0, 400),
    }
  }

  function courses() {
    var out = []
    var cards = findCards()
    for (var i = 0; i < cards.length; i++) {
      var c = parseCard(cards[i])
      if (!c) continue
      // 去重（同一门课可能在卡片里出现两次）
      var dup = false
      for (var k = 0; k < out.length; k++) {
        if (out[k].code === c.code && out[k].name === c.name && out[k].term === c.term) { dup = true; break }
      }
      if (!dup) out.push(c)
    }

    // 兜底：万一卡片定位失败（比如整页只有一个大容器），
    // 直接按「课程代码：」把整页文本切开逐段解析
    if (!out.length) {
      var body = document.body.innerText.replace(/\r/g, '')
      var segs = body.split(/(?=课程代码\s*[:：])/)
      for (var s = 1; s < segs.length; s++) {
        var seg = segs[s].slice(0, 600)
        var fake = { textContent: seg }
        var parsed = parseCard(fake)
        if (parsed) out.push(parsed)
      }
    }
    return out
  }

  /* ───────────────── 个人信息解析 ───────────────── */

  function profile() {
    var body = document.body.innerText
    var kind = pageKind()

    var realName = ''
    var college = ''
    var studentId = ''
    var major = ''
    var grade = ''
    var className = ''

    if (kind === 'courses' || (/课程代码/.test(body) && /学分数/.test(body))) {
      // 左侧栏是「头像 / 姓名 / 身份」，姓名通常在头像下方。
      // 用「身份」做锚点，往上找姓名。
      var side = $$('aside, div').filter(function (el) {
        var t = txt(el)
        return t.length < 200 && /^(学生|教师|管理员)$/.test(t.replace(/\s/g, ''))
      })[0]
      if (side) {
        var up = side
        for (var i = 0; i < 4 && up; i++) {
          var cands = (up.innerText || '').split('\n').map(function (x) { return x.trim() }).filter(Boolean)
          for (var c = 0; c < cands.length; c++) {
            // 2~4 个汉字，且不是导航词
            if (/^[\u4e00-\u9fa5]{2,4}$/.test(cands[c]) && !/学生|教师|首页|公告|我的|小组|收藏|关注|分享/.test(cands[c])) {
              realName = cands[c]; break
            }
          }
          if (realName) break
          up = up.parentElement
        }
      }
    }

    if (kind === 'portal' || /融合服务门户|今日课表/.test(body)) {
      // 门户右上角是「姓名 ▾」。用下拉箭头前的文本做锚点。
      var m = body.match(/([\u4e00-\u9fa5]{2,4})\s*[▾▼⌄]/)
      if (m) realName = m[1]
      /* 学院在姓名下方，常被 CSS 截断成「计算机与网络空间安...」。
         先找带 title 的元素（全称常放在那里），再从正文正则匹配。 */
      var cands = $$('*').filter(function (el) {
        return el.children.length === 0 && /学院|学部|中心/.test(el.getAttribute && (el.getAttribute('title') || ''))
      })
      if (cands.length) college = clean(titleOf(cands[0])) || clean(cands[0].getAttribute('title'))
      if (!college) {
        var mc = body.match(/([\u4e00-\u9fa5]{4,25}(?:学院|学部|中心))/)
        if (mc) college = mc[1]
      }
    }

    // 通用兜底
    if (!realName) realName = kv(['姓名', '名字'], 10)
    if (!studentId) studentId = kv(['学号', '学籍号'], 20)
    if (!college) college = kv(['学院', '院系', '学部'], 25)
    if (!major) major = kv(['专业', '专业名称'], 25)
    if (!grade) grade = kv(['年级'], 10)
    if (!className) className = kv(['班级', '行政班'], 25)

    return {
      realName: realName,
      studentId: studentId,
      college: college,
      major: major,
      grade: grade,
      className: className,
    }
  }

  /* ───────────────── 提交 ───────────────── */

  function post(path, body, dry) {
    body.dryRun = dry
    body.source = CFG.source + '@' + location.host
    return fetch(CFG.api + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CFG.token },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (j) {
        if (!r.ok || !j || !j.ok) throw new Error((j && j.error && j.error.message) || 'HTTP ' + r.status)
        return j.data
      })
    })
  }

  var payload = { profile: profile(), courses: courses() }
  var keys = []
  for (var kk in payload.profile) if (payload.profile[kk]) keys.push(kk)

  if (!keys.length && !payload.courses.length) {
    alert(
      '没能从当前页面识别到信息。\n\n' +
        '当前页面：' + location.host + '\n' +
        '识别为：' + pageKind() + '\n\n' +
        '请在这些页面上使用：\n' +
        '· courses.cuc.edu.cn/user/courses （我的课程）\n' +
        '· i.cuc.edu.cn/Newstudent-portal/ （融合服务门户）\n\n' +
        '如果页面没错，那就是学校改版了，需要更新解析规则。',
    )
    return
  }

  post('/import', payload, true)
    .then(function (plan) {
      var L = [
        '将从当前页面导入（' + location.host + '）：',
        '',
        '个人信息：' + (keys.length ? keys.length + ' 个字段（' + keys.join('、') + '）' : '未识别到'),
        '课　　程：' + plan.courses.total + ' 门' +
          (plan.courses.total ? '（新增 ' + plan.courses.create + ' · 更新 ' + plan.courses.update + '）' : ''),
      ]
      if (plan.courses.total) {
        L.push('')
        L.push('识别到的课程：')
        var names = plan.courses.createNames.concat(plan.courses.updateNames).slice(0, 12)
        for (var i = 0; i < names.length; i++) L.push('  · ' + names[i])
        if (plan.courses.total > names.length) L.push('  …还有 ' + (plan.courses.total - names.length) + ' 门')
      }
      L.push('')
      L.push('确认导入吗？（重复导入不会产生重复课程）')
      if (!confirm(L.join('\n'))) return null
      return post('/import', payload, false)
    })
    .then(function (done) {
      if (!done) return
      alert(
        '导入完成\n\n' +
          '新增课程 ' + done.applied.created + ' 门 · 更新 ' + done.applied.updated + ' 门\n' +
          '资料 ' + done.applied.profileFields + ' 个字段\n\n' +
          '回到 Campus Vault 的「个人中心」即可看到。',
      )
    })
    .catch(function (e) {
      alert(
        '导入失败：' + (e && e.message ? e.message : e) + '\n\n' +
          '请确认：\n· Campus Vault 后端正在运行（http://127.0.0.1:5175）\n· 导入令牌没有过期',
      )
    })
}
