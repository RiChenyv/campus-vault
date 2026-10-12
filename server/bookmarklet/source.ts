/**
 * 书签脚本（bookmarklet）源文件。
 *
 * 用法：把 build() 产出的那一行 `javascript:...` 存成浏览器书签，
 * 在学校网站页面上点一下即可导入。
 *
 * 为什么是这个形态（而不是后端去爬）：
 *  学校页面在 SSO 后面，后端拿不到；也不该拿 —— 那需要保存你的学校密码。
 *  书签脚本跑在**你自己已登录的浏览器**里，读的是你本来就有权看的数据，
 *  凭据全程不离开浏览器。脚本只在你手动点的时候执行一次。
 *
 * 认证：会话 cookie 是 SameSite=Lax，跨站请求不会带上它，
 * 所以脚本用「导入令牌」（在个人中心生成）走 Authorization 头。
 *
 * ⚠️ 解析是**宽松**的：学校页面改版时必须明确报错，
 *    而不是静默抓一堆错数据写进库。所以每一步都返回"识别到了什么"，
 *    并且先走 dry-run 让用户确认。
 */

/** 打包成一行 javascript: URL */
export function build(opts: { api: string; token: string; source: string }) {
  const cfg = JSON.stringify(opts)
  /* eslint-disable */
  const fn = function (CFG: { api: string; token: string; source: string }) {
    const $ = (s: string) => document.querySelector(s) as HTMLElement | null
    const $$ = (s: string) => Array.from(document.querySelectorAll(s)) as HTMLElement[]
    const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

    /** 从页面里找"标签 → 值"这种键值对（学校信息页大量使用） */
    function kvByLabel(labels: string[]): string {
      // 1) <th>标签</th><td>值</td>
      for (const tr of $$('tr')) {
        const cells = Array.from(tr.children)
        for (let i = 0; i < cells.length - 1; i++) {
          const k = txt(cells[i]).replace(/[:：]\s*$/, '')
          if (labels.some((l) => k === l || k.includes(l))) return txt(cells[i + 1])
        }
      }
      // 2) label/span 标签 + 兄弟节点值
      for (const el of $$('label, dt, .label, .name, .title')) {
        const k = txt(el).replace(/[:：]\s*$/, '')
        if (!labels.some((l) => k === l || k.includes(l))) continue
        const sib = el.nextElementSibling
        if (sib) return txt(sib)
        const parentText = txt(el.parentElement)
        const rest = parentText.replace(txt(el), '').replace(/^[:：\s]+/, '')
        if (rest) return rest
      }
      // 3) "学号：2023xxxx" 这种整段文本
      const body = document.body.innerText
      for (const l of labels) {
        const m = body.match(new RegExp(l + '\\s*[:：]\\s*([^\\s\\n，,、]{2,40})'))
        if (m && m[1]) return m[1].trim()
      }
      return ''
    }

    /** 从课程列表页抓课程。宽松匹配：找不到表格就返回空数组，不猜。 */
    function courses() {
      const out: any[] = []
      // 课程号常见形态：字母数字组合，长度 6~20
      const CODE = /^[A-Za-z]{0,4}\d{4,16}[A-Za-z0-9-]*$/

      for (const tr of $$('table tr')) {
        const cells = Array.from(tr.children).map((c) => txt(c))
        if (cells.length < 2) continue
        // 表头跳过
        if (cells.some((c) => /课程名称|课程名/.test(c)) && cells.some((c) => /教师|学分/.test(c))) continue

        const codeCell = cells.find((c) => CODE.test(c.replace(/\s/g, '')))
        const nameCell = cells.find((c) => c.length >= 2 && c.length <= 60 && !CODE.test(c.replace(/\s/g, '')) && !/^\d+(\.\d+)?$/.test(c) && !/^\d{4}-/.test(c))
        if (!nameCell) continue

        const creditCell = cells.find((c) => /^\d+(\.\d+)?$/.test(c) && Number(c) <= 20)
        const teacherCell = cells.find((c) => /^[\u4e00-\u9fa5]{2,4}([,，、][\u4e00-\u9fa5]{2,4})*$/.test(c))
        const termCell = cells.find((c) => /\d{4}\s*[-–—]\s*\d{4}|\d{4}\s*学年|第\s*\d\s*学期/.test(c))

        out.push({
          code: codeCell ?? '',
          name: nameCell,
          teacher: teacherCell ?? '',
          credits: creditCell ? Number(creditCell) : 0,
          term: termCell ?? '',
          raw: cells.join(' | ').slice(0, 400),
        })
      }
      return out
    }

    /** 个人信息页的字段 */
    function profile() {
      return {
        realName: kvByLabel(['姓名', '名字']),
        studentId: kvByLabel(['学号', '学籍号']),
        college: kvByLabel(['学院', '院系', '学部']),
        major: kvByLabel(['专业', '专业名称']),
        grade: kvByLabel(['年级', '年级名称']),
        className: kvByLabel(['班级', '行政班']),
      }
    }

    async function post(path: string, body: any, dry: boolean) {
      body.dryRun = dry
      body.source = CFG.source
      const r = await fetch(CFG.api + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CFG.token },
        body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.ok) throw new Error(j?.error?.message || 'HTTP ' + r.status)
      return j.data
    }

    ;(async () => {
      const payload = { profile: profile(), courses: courses() }
      const pCount = Object.values(payload.profile).filter(Boolean).length
      if (!pCount && !payload.courses.length) {
        alert(
          '没能从当前页面识别到任何信息。\n\n' +
            '请确认：\n' +
            '· 你已经登录学校网站\n' +
            '· 当前页面是「个人信息」或「我的课程」页面\n\n' +
            '页面结构可能已经改版，需要更新解析规则。',
        )
        return
      }

      let plan: any
      try {
        plan = await post('/import', payload, true)
      } catch (e: any) {
        alert('连接本地服务失败：' + e.message + '\n\n请确认本地网站的后端正在运行。')
        return
      }

      const lines = [
        '将从当前页面导入：',
        '',
        `个人信息：识别到 ${plan.profile.fields} 个字段` + (plan.profile.keys.length ? `（${plan.profile.keys.join('、')}）` : ''),
        `课　程：识别到 ${plan.courses.total} 门` +
          (plan.courses.total ? `（新增 ${plan.courses.create} · 更新 ${plan.courses.update}）` : ''),
        `课　表：${plan.slots} 个时间段`,
        '',
        '确认导入吗？（重复导入不会产生重复课程）',
      ]
      if (!confirm(lines.join('\n'))) return

      try {
        const done = await post('/import', payload, false)
        alert(
          '导入完成\n\n' +
            `新增课程 ${done.applied.created} 门 · 更新 ${done.applied.updated} 门\n` +
            `课表 ${done.applied.slots} 条 · 资料 ${done.applied.profileFields} 个字段`,
        )
      } catch (e: any) {
        alert('导入失败：' + e.message)
      }
    })()
  }
  return 'javascript:(' + fn.toString() + ')(' + cfg + ');void 0'
}
