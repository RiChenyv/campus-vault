/* __CV_HEADER__ */
/**
 * 油猴脚本 —— 与 parse.js 拼成完整的 .user.js。
 *
 * 它是**唯一**的页面脚本入口（书签脚本 2026-10 已删除）。好处：
 *  · @match 自动运行：进学校页面就出现按钮，用户不用记"该在哪个页面点"
 *  · GM_xmlhttpRequest 跨域：不受 CORS 限制
 *  · 页面内面板：能画课程预览表，而不是 alert 纯文本
 *  · GM_setValue 存令牌：一次输入，长期有效
 *
 * 令牌**不写死在脚本里**：这样脚本地址稳定、可分享，
 * 换令牌也只需在面板里重填，不用重新安装。
 */
(function () {
  'use strict'

  /* 后端地址由服务端拼接时注入（见 lib/inject.ts）——
     不能写死，否则改端口（PORT 环境变量）之后脚本就全指错了地方，
     而表现只是"连不上本地服务"，看不出是地址问题。 */
  var API = '__CV_API_BASE__'
  var TOKEN_KEY = 'cv_import_token'
  /* 路径前缀别漏：后端把导入相关接口挂在 /api/import 下。
     之前 whoami 写成 /whoami（少了 /import），面板的令牌校验永远 404、
     无论令牌好坏都显示「令牌无效」—— 看起来像不存在的令牌也能导入，
     实际是验证本身坏掉了。集中成常量，免得再拼错。 */
  var IMPORT_BASE = '/import'

  /* ───────────────────────── HTTP ─────────────────────────
     用 GM_xmlhttpRequest 而不是 fetch：它不受 CORS 限制，
     学校页面往 127.0.0.1 发请求也能通（fetch 会被浏览器拦）。

     ⚠️ `anonymous: true` 是关键，别删：
     GM_xmlhttpRequest 是**扩展级请求，不受 SameSite 限制**，
     默认会把 127.0.0.1:5175 的会话 cookie 一起发过去。
     那样后端就可能按 cookie 判断归属 —— 于是"在 Campus Vault 里
     登录哪个账号，导入就进哪个账号"，令牌彻底失效，换账号后
     不用重填令牌也能导入。带上这个标记就不发 cookie，
     归属只由令牌决定。 */
  function req(method, path, body) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: method,
        url: API + path,
        anonymous: true,
        headers: {
          'Content-Type': 'application/json',
          /* 导入令牌走专用头，**不能用 Authorization** ——
             那个头是浏览器标签页的会话令牌用的，混用会让后端把会话 id
             当导入令牌去查，结果全 401。详见 server/src/lib/http.ts。 */
          'X-Import-Token': GM_getValue(TOKEN_KEY, '') || '',
        },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 20000,
        onload: function (r) {
          var j = null
          try { j = JSON.parse(r.responseText) } catch (e) { /* 非 JSON */ }
          if (r.status >= 200 && r.status < 300 && j && j.ok) resolve(j.data)
          else reject(new Error((j && j.error && j.error.message) || ('HTTP ' + r.status)))
        },
        onerror: function () { reject(new Error('连不上本地服务，确认 Campus Vault 正在运行')) },
        ontimeout: function () { reject(new Error('请求超时')) },
      })
    })
  }

  /* ───────────────────────── 样式 ───────────────────────── */
  var CSS = [
    '#cv-fab{position:fixed;right:22px;bottom:22px;z-index:2147483000;display:flex;align-items:center;gap:8px;',
    'padding:10px 16px;border:0;border-radius:999px;cursor:pointer;font:600 13px/1 system-ui,-apple-system,"Microsoft YaHei",sans-serif;',
    'color:#fff;background:linear-gradient(135deg,#7b8cff,#9b6bff);box-shadow:0 10px 30px -8px rgba(80,90,220,.7);transition:transform .15s}',
    '#cv-fab:hover{transform:translateY(-2px)}',
    '#cv-mask{position:fixed;inset:0;z-index:2147483001;background:rgba(12,14,26,.55);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);',
    'display:flex;align-items:center;justify-content:center;font:400 13px/1.6 system-ui,-apple-system,"Microsoft YaHei",sans-serif}',
    '#cv-panel{width:min(560px,92vw);max-height:82vh;overflow:auto;border-radius:20px;padding:22px 24px;color:#eef1ff;',
    'background:linear-gradient(160deg,rgba(38,42,70,.98),rgba(26,29,50,.98));border:1px solid rgba(255,255,255,.14);',
    'box-shadow:0 40px 90px -30px #000}',
    '#cv-panel h2{margin:0 0 4px;font-size:17px;font-weight:600}',
    '#cv-panel .cv-sub{color:#9aa1c2;font-size:12px;margin-bottom:16px;white-space:pre-line}',
    '#cv-panel .cv-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.08)}',
    '#cv-panel .cv-name{font-weight:600;color:#fff}',
    '#cv-panel .cv-meta{color:#9aa1c2;font-size:11.5px}',
    '#cv-panel .cv-stat{display:inline-block;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.09);margin:0 6px 6px 0;font-size:11.5px}',
    '#cv-panel .cv-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}',
    '#cv-panel button{padding:9px 18px;border-radius:11px;border:1px solid rgba(255,255,255,.16);cursor:pointer;',
    'font:600 13px/1 inherit;color:#eef1ff;background:rgba(255,255,255,.07)}',
    '#cv-panel button.cv-primary{background:linear-gradient(135deg,#7b8cff,#9b6bff);border-color:transparent}',
    '#cv-panel button:disabled{opacity:.45;cursor:default}',
    '#cv-panel input{width:100%;padding:9px 11px;border-radius:10px;border:1px solid rgba(255,255,255,.18);',
    'background:rgba(0,0,0,.28);color:#fff;font:inherit;outline:none;box-sizing:border-box}',
    '#cv-panel .cv-err{color:#ff9db0;margin-top:10px;font-size:12px}',
    '#cv-panel .cv-note{color:#c9b98a;font-size:11.5px;margin-top:8px;white-space:pre-line}',
  ].join('')

  function el(tag, style, text) {
    var e = document.createElement(tag)
    if (style) e.setAttribute('style', style)
    if (text != null) e.textContent = text
    return e
  }

  /* ───────────────────────── 面板 ───────────────────────── */

  function close() {
    var m = document.getElementById('cv-mask')
    if (m) m.remove()
  }

  function openPanel(build) {
    close()
    var mask = el('div')
    mask.id = 'cv-mask'
    var panel = el('div')
    panel.id = 'cv-panel'
    mask.appendChild(panel)
    // 点遮罩关闭，但点面板内部不关
    mask.addEventListener('click', function (e) { if (e.target === mask) close() })
    document.body.appendChild(mask)
    build(panel)
  }

  function head(panel, title, sub) {
    panel.appendChild(el('h2', null, title))
    if (sub) panel.appendChild(el('div', 'cv-sub', sub))
  }

  /** 返回创建出来的按钮数组 —— 调用方需要拿到「导入」那颗做禁用/启用 */
  function actions(panel, buttons) {
    var bar = el('div', 'cv-actions')
    var made = []
    buttons.forEach(function (b) {
      var btn = el('button', b.primary ? 'cv-primary' : null, b.label)
      btn.addEventListener('click', b.onClick)
      if (b.disabled) btn.disabled = true
      bar.appendChild(btn)
      made.push(btn)
    })
    panel.appendChild(bar)
    return made
  }

  function showError(panel, msg) {
    var old = panel.querySelector('.cv-err')
    if (old) old.remove()
    panel.appendChild(el('div', 'cv-err', msg))
  }

  /**
   * 复制文本到剪贴板，并给按钮一个反馈。
   * 先试老办法（textarea + execCommand）：它在没有剪贴板权限时也能用，
   * 而且是用户点击触发的，不会被拦。最后才退回 clipboard API。
   * **复制失败要说失败** —— 原来直接写"已复制"，用户粘出来是空的更浪费时间。
   */
  function copyText(text, btn) {
    var finish = function (ok) { if (btn) btn.textContent = ok ? '已复制' : '复制失败，请手动选中' }
    var ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('style', 'position:fixed;left:-9999px;top:0')
    document.body.appendChild(ta)
    ta.select()
    var ok = false
    try { ok = document.execCommand('copy') } catch (e) { ok = false }
    ta.remove()
    if (ok) { finish(true); return }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { finish(true) }, function () { finish(false) })
      return
    }
    finish(false)
  }

  /* ───────────────────────── 令牌 ───────────────────────── */

  function askToken(panel, onDone) {
    head(panel, '先填一次导入令牌', '在 Campus Vault 的「导入」页面复制')
    var wrap = el('div', 'margin-top:14px')
    var inp = el('input')
    inp.placeholder = 'cvi_...'
    inp.value = GM_getValue(TOKEN_KEY, '') || ''
    wrap.appendChild(inp)
    panel.appendChild(wrap)
    /* 令牌存在浏览器里、不带账号信息。**换账号时必须手动换令牌** ——
       不说清楚的话，用户会以为导入是跟着当前登录账号走的。 */
    panel.appendChild(el('div', 'cv-note',
      '令牌决定了导入到哪个账号，和你在 Campus Vault 里当前登录谁无关。\n' +
      '要换账号，就在这里换成那个账号自己的令牌。'))
    var status = el('div', 'cv-meta', '')
    status.style.marginTop = '8px'
    panel.appendChild(status)

    var check = function () {
      var v = (inp.value || '').trim()
      if (!v) { status.textContent = ''; return }
      status.textContent = '校验中…'
      req('POST', IMPORT_BASE + '/whoami', { token: v })
        .then(function (u) {
          status.textContent = '这份令牌属于：' + (u.username || u.account) + '（' + u.account + '）'
          status.style.color = '#8fe3c4'
        })
        .catch(function (e) {
          status.textContent = '令牌无效：' + (e && e.message ? e.message : e)
          status.style.color = '#ff9db0'
        })
    }
    inp.addEventListener('blur', check)

    actions(panel, [
      { label: '取消', onClick: close },
      {
        label: '保存并继续',
        primary: true,
        onClick: function () {
          var v = (inp.value || '').trim()
          if (!v) return showError(panel, '令牌不能为空')
          GM_setValue(TOKEN_KEY, v)
          close()
          run()
        },
      },
    ])
    if (inp.value) check()
  }

  /* ───────────────────────── 主流程 ───────────────────────── */

  var KIND_LABEL = {
    courses: '我的课程',
    portal: '融合服务门户',
    /* 课表页仍然认出来（好给明确指引），但**不由脚本导入** */
    timetable: '教务系统课表',
    grades: '成绩查询',
    unknown: '未知页面',
  }

  /**
   * 当前页面是不是成绩查询页。
   *
   * 判据和解析器里的 pageKind **完全一致**（总成绩 + 绩点 + 课程号），
   * 而且同样要**连跨同源 iframe 一起读** —— 只读顶层文档的话，
   * 表格嵌在 iframe 里的情况就永远认不出来。
   */
  function looksLikeGrades() {
    var t = ''
    try {
      t = document.body ? document.body.innerText : ''
      var frames = document.querySelectorAll('iframe')
      for (var i = 0; i < frames.length; i++) {
        try {
          var d = frames[i].contentDocument
          if (d && d.body) t += '\n' + d.body.innerText
        } catch (e) { /* 跨域 iframe 读不到，跳过 */ }
      }
    } catch (e) {
      return false
    }
    return /总成绩/.test(t) && /绩点/.test(t) && /课程号/.test(t)
  }

  /** 只改文案，不做判断 */
  function setFabLabel(isGrades) {
    var fab = document.getElementById('cv-fab')
    if (!fab) return
    var want = isGrades ? '导入成绩' : '导入到 Campus Vault'
    if (fab.textContent !== want) fab.textContent = want
    fab.title = isGrades
      ? '读取这一页成绩，导入本地课程知识库（翻页请自己在页面上点）'
      : '把当前页面的课程 / 个人信息导入本地课程知识库'
  }

  /** 判一次并同步按钮文案。返回"是不是成绩页" */
  function syncFabLabel() {
    var g = looksLikeGrades()
    setFabLabel(g)
    return g
  }

  function run() {
    var data = cvParse()
    /* 按钮文案以**解析结果**为准：它连 iframe 一起解析，比上面那个轻量判据更准，
       而且用户点了按钮之后这一刻的判断就是最终判断。 */
    setFabLabel(data.kind === 'grades')
    var fields = Object.keys(data.profile).filter(function (k) { return data.profile[k] })
    var hasGrades = data.kind === 'grades' && (data.grades || []).length > 0
    var hasSomething = fields.length || data.courses.length || data.today.length ||
      data.assignments.length || hasGrades

    openPanel(function (panel) {
      if (!GM_getValue(TOKEN_KEY, '')) return askToken(panel, function () {})

      /* 认出了成绩页、却一行都没解析出来。
         这种情况必须**单独说清楚**，不能落到下面那句"没有可导入的内容"——
         那句话会让人以为是自己点错了页面，而真正的原因是页面结构变了。
         同时给一个「复制诊断信息」的出口：结构快照里带着"有几张表、
         哪张被选中、表头是什么、第一行有哪些单元格"，
         比截图有用得多（截图看不出表头和数据是不是两张表）。 */
      if (data.kind === 'grades' && !hasGrades) {
        head(panel, '认出了成绩页，但一行都没解析出来', '当前页面：' + data.host)
        panel.appendChild(el('div', 'cv-note',
          '多半是学校页面改版了（例如表格结构变了：表头和数据不在同一张表里）。\n' +
          '点下面的「复制诊断信息」，把这段内容发回来就能按真实结构修解析规则。'))
        var dbg = data.gradeDebug || {}
        var sum = el('div', 'cv-meta',
          '页面上 ' + (dbg.表格数 || 0) + ' 张表 · ' +
          '表头：' + (dbg.表头来源 || '没找到') + ' · ' +
          '数据表 #' + (dbg.选中数据表 === undefined ? '-' : dbg.选中数据表) + ' · ' +
          '解析出 ' + (dbg.解析出行数 || 0) + ' 行')
        sum.style.marginTop = '10px'
        panel.appendChild(sum)

        var dbgText = JSON.stringify(dbg, null, 1)
        var box = el('div', 'cv-meta', dbgText.slice(0, 1500))
        box.style.cssText = 'margin-top:8px;max-height:150px;overflow:auto;white-space:pre-wrap;word-break:break-all'
        panel.appendChild(box)

        var dbgBtns = actions(panel, [
          { label: '关闭', onClick: close },
          { label: '复制诊断信息', primary: true, onClick: function () { copyText(dbgText, dbgBtns[1]) } },
        ])
        return
      }

      /* 教务课表页：**已经不由脚本导入了**（2026-10 改的）。
         必须单独一条分支说清楚去哪儿导 —— 落到下面那句"没识别到内容"
         用户会以为是页面没被认出来，然后一直重试。 */
      if (data.kind === 'timetable') {
        head(panel, '课表改成用文件导入了', '当前页面：教务系统课表')
        panel.appendChild(el('div', 'cv-note',
          '这一页的版面太复杂（一个格子里可能有 4~6 个不同周次 / 教室 / 线上线下的时段），' +
          '脚本按页面解析容易漏；改成用教务系统自己导出的表格，同一份内容能一次导准。'))
        var steps = el('div', 'cv-meta',
          '① 在本页找「导出」按钮，拿到课表 .xlsx\n' +
          '② 打开 Campus Vault → 导入 →「上传文件」\n' +
          '③ 把那份 .xlsx 拖进去 → 先看预览 → 确认导入')
        steps.style.cssText = 'margin-top:10px;white-space:pre-line;line-height:1.7'
        panel.appendChild(steps)
        panel.appendChild(el('div', 'cv-meta',
          '这一页右上的成绩入口不受影响：成绩请到「成绩查询」页，那里按钮会变成「导入成绩」。'))
        var tbBtns = actions(panel, [{ label: '知道了', primary: true, onClick: close }])
        void tbBtns
        return
      }

      if (!hasSomething) {
        head(panel, '没识别到内容', '当前页面：' + data.host)
        panel.appendChild(el('div', 'cv-note',
          '支持的页面：\n· courses.cuc.edu.cn/user/courses（我的课程）\n' +
          '· bkjw.cuc.edu.cn 的成绩查询页（总成绩 / 绩点 / 课程号 那一页）\n' +
          '· i.cuc.edu.cn（融合服务门户）\n\n' +
          '课表请用「导出 xlsx → 导入页上传文件」那条路（脚本不再解析课表页）。\n' +
          '如果页面没错，那就是学校改版了 —— 下面这段诊断信息能帮忙定位。'))
        /* 诊断：把"到底看到了什么"摆出来。
           只说一句「没识别到内容」的话，用户无从下手、开发者也猜不准。 */
        var d = data.debug || {}
        var diag = el('div', 'cv-meta')
        diag.style.marginTop = '10px'
        diag.style.whiteSpace = 'pre-line'
        diag.textContent =
          '文档：' + (d.docs || []).join(' / ') + '\n' +
          'iframe：共 ' + (d.iframeCount || 0) + ' 个' +
          (d.blockedFrames ? '，其中 ' + d.blockedFrames + ' 个读不到（跨域）' : '') + '\n' +
          '关键字：' + Object.keys(d.marks || {}).map(function (k) {
            return k + (d.marks[k] ? '✓' : '✗')
          }).join(' ')

        var sample = el('div', 'cv-meta')
        sample.style.marginTop = '8px'
        sample.style.maxHeight = '140px'
        sample.style.overflow = 'auto'
        sample.style.whiteSpace = 'pre-wrap'
        sample.style.wordBreak = 'break-all'
        sample.textContent = '页面文本开头：\n' + (d.sample || '(空)')

        var box = el('div')
        box.appendChild(diag)
        box.appendChild(sample)
        panel.appendChild(box)

        var btns = actions(panel, [
          { label: '关闭', onClick: close },
          {
            label: '复制诊断信息',
            onClick: function () {
              var text = 'Campus Vault 导入诊断\n页面：' + data.href + '\n' +
                '类型：' + data.kind + '\n\n' +
                '文档：' + (d.docs || []).join(' / ') + '\n' +
                'iframe：共 ' + (d.iframeCount || 0) + ' 个，' + (d.blockedFrames || 0) + ' 个跨域\n' +
                '关键字：' + JSON.stringify(d.marks || {}) + '\n\n' +
                '页面文本开头：\n' + (d.sample || '(空)')
              try {
                navigator.clipboard.writeText(text).then(function () {
                  btns[1].textContent = '已复制'
                })
              } catch (e) {
                // 剪贴板不可用时退化成选中文本，让用户自己 Ctrl+C
                var r = document.createRange()
                r.selectNodeContents(sample)
                var sel = window.getSelection()
                sel.removeAllRanges()
                sel.addRange(r)
                btns[1].textContent = '已选中，按 Ctrl+C'
              }
            },
          },
        ])
        return
      }

      head(panel, '导入到 Campus Vault', KIND_LABEL[data.kind] || data.kind)

      /* 归属必须显式显示。令牌是浏览器级存储，换账号不会自动变 ——
         不写出来，用户会以为"导入跟着当前登录账号走"。

         校验没通过就**禁用导入按钮**：只显示一行红字没用，按钮照样能按，
         用户会以为"验证说不存在、却能成功导入"。 */
      var owner = el('div', 'cv-meta', '正在确认归属…')
      owner.style.marginBottom = '10px'
      panel.appendChild(owner)

      var stats = el('div')
      if (fields.length) stats.appendChild(el('span', 'cv-stat', '个人信息 ' + fields.length + ' 项'))
      if (data.courses.length) {
        var slotN = 0
        data.courses.forEach(function (c) { slotN += (c.slots || []).length })
        stats.appendChild(el('span', 'cv-stat',
          '课程 ' + data.courses.length + ' 门' + (slotN ? ' · 时间段 ' + slotN + ' 条' : '')))
      }
      /* 成绩页上不显示"今日课表/作业"。
         成绩表格的表头里就有「考试日期」，会被作业识别规则当成一条作业 ——
         显示成「作业 1 条」是纯粹的噪音，还会让人以为识别错了页面。 */
      if (data.kind !== 'grades') {
        if (data.today.length) stats.appendChild(el('span', 'cv-stat', '今日课表 ' + data.today.length + ' 条'))
        if (data.assignments.length) stats.appendChild(el('span', 'cv-stat', '作业 ' + data.assignments.length + ' 条'))
      }
      if (hasGrades) {
        /* 成绩页是**分页**的，这一页只是全部的一角。
           不说清楚的话用户会以为"只有 10 条"，而那正是要避免的误导。
           ⚠️ 已经不做自动翻页了（用户明确不要），所以这里只能说"本页"，
           不能再写"导入时会自动翻页收齐" —— 那是句空话。 */
        stats.appendChild(el('span', 'cv-stat',
          '成绩 ' + data.grades.length + ' 条' +
          (data.gradesPage && data.gradesPage.hasNext ? '（本页，还有下一页，请自己翻页后再点一次）' : '（本页）')))
      }
      panel.appendChild(stats)

      data.courses.slice(0, 20).forEach(function (c) {
        var row = el('div', 'cv-row')
        var box = el('div', 'min-width:0;flex:1')
        box.appendChild(el('div', 'cv-name', c.name))
        var meta = []
        if (c.code) meta.push('代码 ' + c.code)
        if (c.credits) meta.push(c.credits + ' 学分')
        if (c.term) meta.push(c.term)
        if (meta.length) box.appendChild(el('div', 'cv-meta', meta.join(' · ')))
        row.appendChild(box)
        panel.appendChild(row)
      })
      if (data.courses.length > 20) {
        panel.appendChild(el('div', 'cv-meta', '…还有 ' + (data.courses.length - 20) + ' 门'))
      }

      /* 同上：成绩页不列今日课表与作业（表头会被误认成作业） */
      if (data.kind !== 'grades') {
        data.today.slice(0, 8).forEach(function (s) {
          var row = el('div', 'cv-row')
          var box = el('div', 'min-width:0;flex:1')
          box.appendChild(el('div', 'cv-name', s.name))
          box.appendChild(el('div', 'cv-meta', '第 ' + s.from + '-' + s.to + ' 节 · ' + s.room))
          row.appendChild(box)
          panel.appendChild(row)
        })

        data.assignments.slice(0, 8).forEach(function (a) {
          var row = el('div', 'cv-row')
          var box = el('div', 'min-width:0;flex:1')
          box.appendChild(el('div', 'cv-name', a.title))
          if (a.due) box.appendChild(el('div', 'cv-meta', '截止 ' + a.due))
          row.appendChild(box)
          panel.appendChild(row)
        })
      }

      /* 成绩预览。只列前 12 条 —— 面板是确认用的，不是给人逐条读的 */
      if (hasGrades) {
        data.grades.slice(0, 12).forEach(function (g) {
          var row = el('div', 'cv-row')
          var box = el('div', 'min-width:0;flex:1')
          box.appendChild(el('div', 'cv-name', g.name))
          var meta = []
          if (g.term) meta.push(g.term)
          if (g.credit) meta.push(g.credit + ' 学分')
          if (g.gpa !== null && g.gpa !== undefined) meta.push('绩点 ' + g.gpa)
          box.appendChild(el('div', 'cv-meta', meta.join(' · ')))
          row.appendChild(box)
          /* 成绩单独一列放右边：这是这一页最该看清的东西 */
          var sc = el('div', 'cv-name', g.score || '未出分')
          sc.style.minWidth = '56px'
          sc.style.textAlign = 'right'
          if (!g.score) sc.style.color = '#9aa1c2'
          row.appendChild(sc)
          panel.appendChild(row)
        })
        if (data.grades.length > 12) {
          panel.appendChild(el('div', 'cv-meta', '…本页还有 ' + (data.grades.length - 12) + ' 条'))
        }
      }

      /* 2026-10：调课信息那块展示删了 —— 它只属于教务课表页，
         而课表已经改走导出 xlsx（解析器不再产出 adjustments）。 */

      if (data.notes.length) {
        data.notes.forEach(function (n) { panel.appendChild(el('div', 'cv-note', n)) })
      }

      /* 成绩页的主按钮不是"导入"，而是"先把几页收齐" ——
         一次 cvParse 只能看到当前页的 10 条，直接导入会漏掉三分之二。 */
      var primary = hasGrades
        ? { label: '导入成绩', primary: true, disabled: true, onClick: function () { collectGrades(data) } }
        : {
            label: '导入',
            primary: true,
            /* 先禁用，等 whoami 确认令牌有效再放开。
               否则令牌是坏的照样能点，用户会以为"验证说不存在、却能导入"。 */
            disabled: true,
            onClick: function (ev) {
              var btn = ev.currentTarget
              /* ⚠️ 必须先挡住"什么都没发就报成功"。
                 今日课表 / 作业在面板上会显示，但它们**从来不会发给后端**
                 （下面 jobs 里只有 profile + courses）。原来的代码在
                 jobs 为空时 Promise.all([]) 立刻 resolve → toast('导入完成')：
                 用户看到绿色的"导入完成"，其实一个请求都没发，页面当然没变化。
                 成绩页特别容易踩这里 —— 表格表头里的「考试日期」会被
                 作业识别规则命中，于是面板显示"作业 1 条"，让人以为有东西可导。 */
              if (!fields.length && !data.courses.length) {
                btn.disabled = false
                showError(panel,
                  '这个页面上没有可以导入的内容。\n' +
                  '（「今日课表 / 作业」只是展示，不会写进知识库；' +
                  '要导成绩请到教务系统的成绩查询页，那里按钮会变成「导入成绩」。）')
                return
              }
              btn.disabled = true
              btn.textContent = '导入中…'
              Promise.all([req('POST', IMPORT_BASE, {
                profile: data.profile,
                courses: data.courses,
                source: 'userscript@' + data.host,
                dryRun: false,
              })])
                .then(function () {
                  close()
                  toast('导入完成')
                })
                .catch(function (e) {
                  btn.disabled = false
                  btn.textContent = '导入'
                  showError(panel, e && e.message ? e.message : String(e))
                })
            },
          }

      var btns = actions(panel, [
        { label: '取消', onClick: close },
        {
          label: '换个令牌',
          onClick: function () {
            GM_setValue(TOKEN_KEY, '')
            close()
            run()
          },
        },
        primary,
      ])

      /* 校验令牌归属；通过才放开「导入」。
         失败时保持禁用，并告诉用户去哪儿换令牌。 */
      var importBtn = btns[btns.length - 1]
      req('POST', IMPORT_BASE + '/whoami', { token: GM_getValue(TOKEN_KEY, '') })
        .then(function (u) {
          owner.textContent = '将导入到：' + (u.username || u.account) + '（' + u.account + '）'
          owner.style.color = '#8fe3c4'
          importBtn.disabled = false
        })
        .catch(function (e) {
          owner.textContent = '令牌无效，无法导入：' + (e && e.message ? e.message : e)
          owner.style.color = '#ff9db0'
          importBtn.textContent = '令牌无效'
        })
    })
  }

  /* ───────────────────── 成绩：收齐 → 确认 → 导入 ─────────────────────
     三步分开，因为成绩页是分页的：
       ① 自动翻页收齐（会动用户的页面）
       ② 让用户看一眼条数再确认（不确认不写库）
       ③ 把服务端的结果和提示念回去
     ---------------------------------------------------------------- */

  /** 采集停止原因的中文说法。静默少收几页比报错更难查，所以要念出来 */
  var STOP_TEXT = {
    done: '已经翻到最后一页',
    stuck: '点了「下一页」，但表格迟迟没刷新',
    'no-change': '点了「下一页」，但内容没变',
    'no-button': '页面上找不到能点的「下一页」',
    'max-pages': '翻页次数到了上限',
    'max-rows': '收集条数到了上限',
    'no-rows': '这一页没解析到成绩行',
    'not-grades': '当前页面不是成绩页',
    'parse-error': '解析时出错了',
  }

  /**
   * 收集当前这一页的成绩。
   *
   * ⚠️ **不再自动翻页**（用户明确说这个功能不必做）：
   * 各家的分页按钮千奇百怪，自动点的收益不值那份脆弱；
   * 改成"抓一页导一页"—— 只读当前页，导完提示用户自己翻页后再点一次。
   * 重复导入是安全的：服务端按「学期 + 课程号」更新同一行，不会重复。
   * （`cvGradePages` 那个自动翻页采集循环也已经删掉了 —— 书签脚本是它
   * 最后一个调用方，用户又明确不要自动翻页。）
   */
  function collectGrades(data) {
    openPanel(function (panel) {
      head(panel, '正在读取这一页成绩', '只导入当前页 —— 翻页请自己在页面上点')
      var line = el('div', 'cv-sub', '读取中…')
      panel.appendChild(line)
      panel.appendChild(el('div', 'cv-note',
        '脚本只抓**当前这一页**。还有下一页时，请自己在页面上翻页，再点一次「导入成绩」。重复导入不会产生重复记录。'))
      actions(panel, [{ label: '取消', onClick: close }])

      try {
        var d = cvParse()
        var rows = (d && d.grades) || []
        line.textContent = '这一页共 ' + rows.length + ' 条'
        if (d && d.gradesPage && d.gradesPage.hasNext) {
          panel.appendChild(el('div', 'cv-note', '检测到还有下一页：导入完这一页后，请翻页再点一次。'))
        }
        showGradeConfirm(data, { rows: rows, pages: 1, stopped: 'single-page', notes: [] })
      } catch (e) {
        showError(panel, e && e.message ? e.message : String(e))
      }
    })
  }

  /** 读取完当前页之后**不直接写库**：让用户看一眼条数再决定 */
  function showGradeConfirm(data, res) {
    openPanel(function (panel) {
      head(panel, '这一页读完了', '只导入这一页 · 确认后才会写入 Campus Vault')
      var stats = el('div')
      stats.appendChild(el('span', 'cv-stat', '成绩 ' + res.rows.length + ' 条'))
      /* ⚠️ 只在**真的翻了多页**时才说页数。
         现在脚本不自动翻页，一直传 pages = 1 —— 写「共 1 页」既没信息量又让人以为漏了页。 */
      if (res.pages > 1) stats.appendChild(el('span', 'cv-stat', '共 ' + res.pages + ' 页'))
      panel.appendChild(stats)

      if (!res.rows.length) {
        panel.appendChild(el('div', 'cv-note',
          '这一页一条都没读到。多半是学校改版了、解析规则对不上 —— 可以把这一页截图反馈。'))
      }
      ;(res.notes || []).forEach(function (n) { panel.appendChild(el('div', 'cv-note', n)) })
      /* ⚠️ 停止原因**只认已知的中文说明**（STOP_TEXT 里有才显示）。
         别把内部标识（"single-page"、"stuck" 这种）原样打到界面上 ——
         用户看到的是开发词汇，既看不懂也不知道该干什么。
         不翻页了就不存在"翻页停止"这回事，所以正常情况下这里什么都不显示。 */
      var why = res.stopped ? STOP_TEXT[res.stopped] : ''
      if (why) {
        panel.appendChild(el('div', 'cv-note',
          '说明：' + why + '。已经读到的 ' + res.rows.length + ' 条仍然可以导入。'))
      }

      var owner = el('div', 'cv-meta', '正在确认归属…')
      owner.style.margin = '10px 0'
      panel.appendChild(owner)

      res.rows.slice(0, 8).forEach(function (g) {
        var row = el('div', 'cv-row')
        var box = el('div', 'min-width:0;flex:1')
        box.appendChild(el('div', 'cv-name', g.name))
        var meta = []
        if (g.term) meta.push(g.term)
        if (g.credit) meta.push(g.credit + ' 学分')
        box.appendChild(el('div', 'cv-meta', meta.join(' · ')))
        row.appendChild(box)
        var sc = el('div', 'cv-name', g.score || '未出分')
        sc.style.minWidth = '56px'
        sc.style.textAlign = 'right'
        if (!g.score) sc.style.color = '#9aa1c2'
        row.appendChild(sc)
        panel.appendChild(row)
      })
      if (res.rows.length > 8) {
        panel.appendChild(el('div', 'cv-meta', '…还有 ' + (res.rows.length - 8) + ' 条'))
      }

      var btns = actions(panel, [
        { label: '关闭', onClick: close },
        /* 重新收集要从第一页开始，而现在已经停在最后一页了 ——
           只有刷新页面这一条路，所以按钮上直接写明。 */
        { label: '刷新页面重收', onClick: function () { location.reload() } },
        {
          label: res.rows.length ? '确认导入 ' + res.rows.length + ' 条' : '没有可导入的成绩',
          primary: true,
          disabled: true,
          onClick: function (ev) {
            var btn = ev.currentTarget
            btn.disabled = true
            btn.textContent = '导入中…'
            req('POST', IMPORT_BASE + '/grades', {
              grades: res.rows,
              source: 'userscript@' + data.host,
              dryRun: false,
            })
              .then(function (r) { showGradeDone(r) })
              .catch(function (e) {
                btn.disabled = false
                btn.textContent = '确认导入'
                showError(panel, e && e.message ? e.message : String(e))
              })
          },
        },
      ])
      var doneBtn = btns[btns.length - 1]
      req('POST', IMPORT_BASE + '/whoami', { token: GM_getValue(TOKEN_KEY, '') })
        .then(function (u) {
          owner.textContent = '将导入到：' + (u.username || u.account) + '（' + u.account + '）'
          owner.style.color = '#8fe3c4'
          if (res.rows.length) doneBtn.disabled = false
        })
        .catch(function (e) {
          owner.textContent = '令牌无效，无法导入：' + (e && e.message ? e.message : e)
          owner.style.color = '#ff9db0'
          doneBtn.textContent = '令牌无效'
        })
    })
  }

  /** 结果面板。把服务端的 notes 念出来 —— 比如"9 条对不上课程"，
      不说的话用户会以为课表里少了东西。 */
  function showGradeDone(r) {
    openPanel(function (panel) {
      var a = r.applied || {}
      head(panel, '成绩导入完成', '新增 ' + (a.created || 0) + ' 条 · 更新 ' + (a.updated || 0) + ' 条')
      var stats = el('div')
      stats.appendChild(el('span', 'cv-stat', '新增 ' + (a.created || 0)))
      stats.appendChild(el('span', 'cv-stat', '更新 ' + (a.updated || 0)))
      if (a.kept) stats.appendChild(el('span', 'cv-stat', '手改保留 ' + a.kept))
      if (a.linked) stats.appendChild(el('span', 'cv-stat', '关联课程 ' + a.linked))
      if (a.unlinked) stats.appendChild(el('span', 'cv-stat', '仅成绩 ' + a.unlinked))
      panel.appendChild(stats)
      ;(r.notes || []).forEach(function (n) { panel.appendChild(el('div', 'cv-note', n)) })
      panel.appendChild(el('div', 'cv-note',
        '在 Campus Vault 的「我的课程 → 学分总览」里查看，学分和绩点都能手动改。'))
      actions(panel, [{ label: '好', primary: true, onClick: close }])
    })
  }

  function toast(msg) {
    var t = el('div',
      'position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:2147483002;' +
      'padding:11px 20px;border-radius:999px;color:#fff;font:600 13px/1 system-ui,-apple-system,"Microsoft YaHei",sans-serif;' +
      'background:linear-gradient(135deg,#3fbf90,#2f9e77);box-shadow:0 14px 34px -12px #000', msg)
    document.body.appendChild(t)
    setTimeout(function () { t.remove() }, 2400)
  }

  /* ───────────────────────── 挂载 ───────────────────────── */

  function mount() {
    if (document.getElementById('cv-fab') || !document.body) return
    // 打一行日志。「装了但没按钮」时，这一行能立刻区分是
    // "脚本根本没跑"（没这行）还是"跑到了但挂载失败"（有这行没按钮）。
    try {
      console.log('[Campus Vault] 导入助手已加载 · ' + location.host)
    } catch (e) { /* 某些页面禁 console，忽略 */ }

    var style = el('style')
    style.textContent = CSS
    document.head.appendChild(style)

    var fab = el('button', null, '导入到 Campus Vault')
    fab.id = 'cv-fab'
    fab.title = '把当前页面的课程 / 个人信息导入本地课程知识库'
    fab.addEventListener('click', run)
    document.body.appendChild(fab)

    /* 页面类型只能等内容出来才知道：学校页面是异步渲染的，而且是 Vue/Ant
       这类前端框架 —— mount 时（document-idle）表格往往还没出来。
       用户实测：成绩页开着十几秒，按钮还是「导入到 Campus Vault」，
       因为原来只在 mount 和 mount+3s 各查了一次，**错过了就永远不补**。

       所以改成轮询，**认出来就不再查**（最多 60 秒）：
       没认出成绩页的页面最多多花几十次 innerText 读取，可以忽略。 */
    syncFabLabel()
    var tries = 0
    var timer = setInterval(function () {
      tries++
      if (syncFabLabel() || tries >= 50) clearInterval(timer)
    }, 1200)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
  else mount()
})()
