/**
 * 后端接口级端到端测试。
 *
 * 用独立端口 + 独立数据目录跑，不碰正式数据。
 * 覆盖：账号全流程、文件上传/下载/Range/删除、四类数据接口、
 * 活动日志的回滚语义，以及一批**安全边界**（越权、路径穿越、伪装文件、协议注入）。
 */

const BASE = process.env.TEST_BASE ?? 'http://127.0.0.1:5176'

let pass = 0
let fail = 0
const failures = []

function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`PASS  ${name}`)
  } else {
    fail++
    failures.push(`${name}  ${extra}`)
    console.log(`FAIL  ${name}${extra ? '  (' + extra + ')' : ''}`)
  }
}

function section(t) {
  console.log('')
  console.log(`--- ${t} ---`)
}

/** 极简 cookie jar：每个"浏览器"一个实例 */
function makeClient() {
  let cookie = ''
  return {
    get cookie() {
      return cookie
    },
    setCookie(v) {
      cookie = v
    },
    async req(method, path, body, opts = {}) {
      const headers = {}
      if (cookie) headers.Cookie = cookie
      let payload
      if (opts.form) {
        payload = opts.form
      } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
        payload = JSON.stringify(body)
      }
      const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' })
      const sc = res.headers.getSetCookie?.() ?? []
      for (const c of sc) {
        const kv = c.split(';')[0]
        if (kv.startsWith('cv_sid=')) {
          const val = kv.slice('cv_sid='.length)
          cookie = val ? kv : ''
        }
      }
      const text = await res.text()
      let json = null
      try {
        json = JSON.parse(text)
      } catch {
        /* 二进制或空响应 */
      }
      return { status: res.status, json, text, headers: res.headers, raw: res }
    },
  }
}

const j = (r) => r.json

/* ================================================================== */
/*                              主流程                                 */
/* ================================================================== */

const admin = makeClient()
const userA = makeClient()
const userB = makeClient()

section('健康检查')
{
  const r = await admin.req('GET', '/api/health')
  check('health 返回 ok', j(r)?.ok === true)
  check('seed 管理员存在', (j(r)?.data?.counts?.users ?? 0) >= 1, 'users=' + j(r)?.data?.counts?.users)
}

section('账号：管理员登录')
{
  const bad = await admin.req('POST', '/api/auth/login', { account: 'admin', password: 'wrong-password' })
  check('错误密码被拒', bad.status === 401 && j(bad)?.error?.code === 'AUTH_INVALID')

  const ghost = await admin.req('POST', '/api/auth/login', { account: '00000000000', password: 'Whatever1' })
  check('不存在的账号与错误密码提示完全一致（防账号枚举）',
    ghost.status === 401 && j(ghost)?.error?.message === j(bad)?.error?.message,
    JSON.stringify(j(ghost)?.error?.message))

  const r = await admin.req('POST', '/api/auth/login', { account: 'admin', password: 'Cv-Dev-Only-2026' })
  check('管理员登录成功', r.status === 200 && j(r)?.data?.user?.isAdmin === true)
  check('登录返回 HttpOnly cookie', (r.headers.getSetCookie?.() ?? []).some((c) => /HttpOnly/i.test(c)))
  check('cookie 带 SameSite', (r.headers.getSetCookie?.() ?? []).some((c) => /SameSite/i.test(c)))

  const me = await admin.req('GET', '/api/auth/me')
  check('me 返回当前用户', j(me)?.data?.user?.account === 'admin')
}

section('账号：注册与密码规则')
{
  const weak = await userA.req('POST', '/api/auth/register', { password: 'abc', confirm: 'abc' })
  check('弱密码被服务端拒绝', weak.status === 400 && j(weak)?.error?.code === 'PWD_WEAK', JSON.stringify(j(weak)?.error))

  const seq = await userA.req('POST', '/api/auth/register', { password: 'Abc12345', confirm: 'Abc12345' })
  check('顺序字符 abc 被拒', seq.status === 400 && j(seq)?.error?.code === 'PWD_WEAK')

  const rep = await userA.req('POST', '/api/auth/register', { password: 'Abcd1234', confirm: 'Abcd1234' })
  check('连续重复字符被拒', rep.status === 400 && j(rep)?.error?.code === 'PWD_WEAK')

  const mism = await userA.req('POST', '/api/auth/register', { password: 'Xk7#mQ2p', confirm: 'Xk7#mQ2z' })
  check('两次密码不一致被拒', j(mism)?.error?.code === 'PWD_MISMATCH')

  const okr = await userA.req('POST', '/api/auth/register', { password: 'Xk7#mQ2p', confirm: 'Xk7#mQ2p' })
  const accA = j(okr)?.data?.account
  check('注册成功并自动登录', okr.status === 200 && typeof accA === 'string')
  check('账号是 11 位数字且首位非 0', /^[1-9]\d{10}$/.test(String(accA)), String(accA))
  check('新账号不是管理员', j(okr)?.data?.user?.isAdmin === false)
  check('注册后 me 可用', j(await userA.req('GET', '/api/auth/me'))?.data?.user?.account === accA)
}

section('账号：退出与改密')
{
  const r = await userB.req('POST', '/api/auth/register', { password: 'Zp9$vL4n', confirm: 'Zp9$vL4n' })
  const accB = j(r)?.data?.account
  check('用户 B 注册成功', /^[1-9]\d{10}$/.test(String(accB)))

  const before = await userB.req('GET', '/api/auth/me')
  check('B 退出前 me 可用', j(before)?.ok === true)

  await userB.req('POST', '/api/auth/logout')
  const after = await userB.req('GET', '/api/auth/me')
  check('退出后 me 返回 401（会话真的失效了，不是只清了前端）', after.status === 401, 'status=' + after.status)

  // 重新登录再改密
  await userB.req('POST', '/api/auth/login', { account: accB, password: 'Zp9$vL4n' })
  const wrongOld = await userB.req('PATCH', '/api/auth/password', {
    oldPassword: 'nope-nope', next: 'Qw8@tR3m', confirm: 'Qw8@tR3m',
  })
  check('原密码错误被拒', wrongOld.status === 401 && j(wrongOld)?.error?.code === 'PWD_WRONG')

  const changed = await userB.req('PATCH', '/api/auth/password', {
    oldPassword: 'Zp9$vL4n', next: 'Qw8@tR3m', confirm: 'Qw8@tR3m',
  })
  check('改密成功', changed.status === 200)

  const oldPw = await makeClient().req('POST', '/api/auth/login', { account: accB, password: 'Zp9$vL4n' })
  check('旧密码已失效', oldPw.status === 401)
  const newPw = await makeClient().req('POST', '/api/auth/login', { account: accB, password: 'Qw8@tR3m' })
  check('新密码可登录', newPw.status === 200)
}

section('文件：上传')
const uploaded = []
{
  const mk = (name, content, type) => {
    const fd = new FormData()
    fd.append('files', new Blob([content], { type }), name)
    fd.append('scope', 'qbank')
    return fd
  }

  const md = await admin.req('POST', '/api/files', null, {
    form: mk('复习提纲.md', '# 标题\n\n内容段落', 'text/markdown'),
  })
  check('上传 markdown 成功', md.status === 200 && j(md)?.data?.files?.length === 1, JSON.stringify(j(md)?.error))
  if (j(md)?.data?.files?.[0]) uploaded.push(j(md).data.files[0])

  // 中文 + 空格 + 括号的文件名（路径穿越与编码的经典触发场景）
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82])
  const tricky = await admin.req('POST', '/api/files', null, {
    form: mk('错题 截图 (第1章).png', png, 'image/png'),
  })
  check('中文+空格+括号的文件名可上传', tricky.status === 200, JSON.stringify(j(tricky)?.error))
  if (j(tricky)?.data?.files?.[0]) uploaded.push(j(tricky).data.files[0])

  // 伪装文件：声称是 png，实际是 PDF
  const fake = await admin.req('POST', '/api/files', null, {
    form: mk('假的图片.png', '%PDF-1.4\n恶意内容', 'image/png'),
  })
  check('伪装扩展名的文件被文件头校验拦下', fake.status !== 200, 'status=' + fake.status)

  // 路径穿越尝试
  const traversal = await admin.req('POST', '/api/files', null, {
    form: mk('../../../../evil.md', '# evil', 'text/markdown'),
  })
  check('路径穿越文件名不会逃出数据目录', traversal.status === 200 || traversal.status === 400)

  // 不允许的扩展名
  const exe = await admin.req('POST', '/api/files', null, {
    form: mk('payload.exe', 'MZ\x90\x00', 'application/octet-stream'),
  })
  check('可执行文件扩展名被拒', exe.status === 400, 'status=' + exe.status)
}

section('文件：列表与筛选')
{
  const all = await admin.req('GET', '/api/files')
  check('列表返回全部文件', (j(all)?.data?.files?.length ?? 0) >= 3, String(j(all)?.data?.files?.length))

  const byKind = await admin.req('GET', '/api/files?kind=markdown')
  check('按类型筛选生效', (j(byKind)?.data?.files ?? []).every((f) => f.kind === 'markdown'))

  const byQ = await admin.req('GET', '/api/files?q=' + encodeURIComponent('提纲'))
  check('关键词搜索生效', (j(byQ)?.data?.files ?? []).length === 1, String((j(byQ)?.data?.files ?? []).length))

  const other = await userA.req('GET', '/api/files')
  check('用户 A 看不到管理员的文件（数据隔离）', (j(other)?.data?.files ?? []).length === 0)
}

section('文件：下载与 Range')
{
  const id = uploaded[0]?.id
  const full = await admin.req('GET', `/api/files/${id}/raw`)
  check('下载返回 200', full.status === 200)
  check('内容正确', full.text.includes('标题'), full.text.slice(0, 30))
  check('声明 Accept-Ranges', full.headers.get('accept-ranges') === 'bytes')
  check('中文文件名用 RFC 5987 编码', /filename\*=UTF-8''/.test(full.headers.get('content-disposition') ?? ''),
    full.headers.get('content-disposition'))

  const range = await fetch(`${BASE}/api/files/${id}/raw`, {
    headers: { Range: 'bytes=0-4', Cookie: admin.cookie },
  })
  check('Range 请求返回 206', range.status === 206, 'status=' + range.status)
  check('Content-Range 正确', /^bytes 0-4\/\d+$/.test(range.headers.get('content-range') ?? ''),
    range.headers.get('content-range'))
  const partBuf = Buffer.from(await range.arrayBuffer())
  check('Range 内容长度正确（按字节计）', partBuf.length === 5, 'bytes=' + partBuf.length)
  check('Range 内容与原文件前 5 字节一致', partBuf.equals(Buffer.from('# 标题').subarray(0, 5)),
    JSON.stringify(partBuf.toString('hex')))

  const badRange = await fetch(`${BASE}/api/files/${id}/raw`, {
    headers: { Range: 'bytes=99999-999999', Cookie: admin.cookie },
  })
  check('越界 Range 返回 416', badRange.status === 416, 'status=' + badRange.status)

  const dl = await admin.req('GET', `/api/files/${id}/raw?download=1`)
  check('download=1 时 Content-Disposition 为 attachment',
    /^attachment/.test(dl.headers.get('content-disposition') ?? ''))

  const stolen = await userA.req('GET', `/api/files/${id}/raw`)
  check('越权下载别人的文件返回 404', stolen.status === 404, 'status=' + stolen.status)
}

section('灵感')
{
  const empty = await admin.req('POST', '/api/ideas', { text: '   ' })
  check('空灵感被拒', empty.status === 400)

  const r = await admin.req('POST', '/api/ideas', { text: '第一条灵感' })
  check('创建灵感成功', r.status === 200 && j(r)?.data?.idea?.id > 0)
  const ideaId = j(r)?.data?.idea?.id

  const withImg = await admin.req('POST', '/api/ideas', {
    text: '带图的灵感',
    fileIds: [uploaded[1]?.id],
  })
  check('灵感可挂图片', (j(withImg)?.data?.idea?.images ?? []).length === 1,
    JSON.stringify(j(withImg)?.data?.idea?.images))

  const list = await admin.req('GET', '/api/ideas')
  check('灵感列表返回两条', (j(list)?.data?.ideas ?? []).length === 2)

  const del = await admin.req('DELETE', `/api/ideas/${ideaId}`)
  check('删除灵感成功', del.status === 200)
  const after = await admin.req('GET', '/api/ideas')
  check('删除后只剩一条', (j(after)?.data?.ideas ?? []).length === 1)
}

section('上传的 push：一次上传算一次（v13 批次键）')
{
  const uploadOne = (name, batchKey) => {
    const fd = new FormData()
    fd.append('files', new Blob(['# ' + name], { type: 'text/markdown' }), name)
    fd.append('scope', 'qbank')
    if (batchKey) fd.append('batchKey', batchKey)
    return fd
  }
  const total = async () => j(await admin.req('GET', '/api/activity'))?.data?.total ?? 0

  /* 一次用户动作 = 一个批次键，同批的每个文件都带着它 */
  const before = await total()
  const key = 'test-batch-1'
  for (const n of ['批次一-1.md', '批次一-2.md', '批次一-3.md']) {
    const r = await admin.req('POST', '/api/files', null, { form: uploadOne(n, key) })
    check(`${n} 上传成功`, r.status === 200, JSON.stringify(j(r)?.error))
  }
  const afterBatch = await total()
  check('同一批传 3 个文件 → 只记 1 次 push', afterBatch === before + 1, `${before} → ${afterBatch}`)

  /* 换一批 → 再记一次。这条是"不是永远只记一条"的对照 */
  await admin.req('POST', '/api/files', null, { form: uploadOne('批次二-1.md', 'test-batch-2') })
  const afterSecond = await total()
  check('换一批再传 → 再记 1 次 push', afterSecond === afterBatch + 1, `${afterBatch} → ${afterSecond}`)

  /* 反向验证：**不带**批次键时，行为和以前完全一样（每次请求记一次）。
     少了这条，"永远只记一条"也能让上面两条全绿 —— 那就永远 PASS 也永远没用。 */
  const beforeNoKey = await total()
  for (const n of ['无批次-1.md', '无批次-2.md']) {
    await admin.req('POST', '/api/files', null, { form: uploadOne(n, '') })
  }
  const afterNoKey = await total()
  check('不带批次键时仍是每次请求记一次（老行为没变）', afterNoKey === beforeNoKey + 2, `${beforeNoKey} → ${afterNoKey}`)
}

section('待办与活动日志回滚语义')
{
  const actBefore = j(await admin.req('GET', '/api/activity'))?.data?.total ?? 0

  const r = await admin.req('POST', '/api/todos', { title: '写实验报告' })
  const todoId = j(r)?.data?.todo?.id
  check('创建待办成功', r.status === 200 && todoId > 0)

  const done = await admin.req('PATCH', `/api/todos/${todoId}`, { done: true })
  check('标记完成成功', done.status === 200)
  const actDone = j(await admin.req('GET', '/api/activity'))?.data?.total ?? 0
  check('完成待办产生一次 push', actDone === actBefore + 1, `${actBefore} → ${actDone}`)

  const undone = await admin.req('PATCH', `/api/todos/${todoId}`, { done: false })
  check('取消完成成功', undone.status === 200)
  const actUndone = j(await admin.req('GET', '/api/activity'))?.data?.total ?? 0
  check('取消完成后 push 回退（存流水而非计数的意义）', actUndone === actBefore, `${actDone} → ${actUndone}`)

  // 重复标记完成不应重复计数
  await admin.req('PATCH', `/api/todos/${todoId}`, { done: true })
  await admin.req('PATCH', `/api/todos/${todoId}`, { done: true })
  const actTwice = j(await admin.req('GET', '/api/activity'))?.data?.total ?? 0
  check('重复标记完成只算一次', actTwice === actBefore + 1, `${actBefore} → ${actTwice}`)

  await admin.req('DELETE', `/api/todos/${todoId}`)
  const actDel = j(await admin.req('GET', '/api/activity'))?.data?.total ?? 0
  check('删除待办后 push 也回退', actDel === actBefore, `${actTwice} → ${actDel}`)
}

section('热力图聚合')
{
  const r = await admin.req('GET', '/api/activity')
  const days = j(r)?.data?.days ?? []
  check('返回按天聚合的数组', Array.isArray(days))
  check('日期格式为 YYYY-MM-DD', days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date)), JSON.stringify(days.slice(0, 3)))
  check('没有零计数的日期混进来', days.every((d) => d.count > 0), JSON.stringify(days.filter((d) => d.count <= 0)))
  const sum = days.reduce((n, d) => n + d.count, 0)
  check('按天求和等于总数', sum === (j(r)?.data?.total ?? -1), `${sum} vs ${j(r)?.data?.total}`)
}

section('书签')
{
  const noName = await admin.req('POST', '/api/bookmarks', { url: 'example.com' })
  check('缺名称被拒', noName.status === 400)

  const auto = await admin.req('POST', '/api/bookmarks', { name: '示例站', url: 'example.com' })
  check('网址自动补 https://', j(auto)?.data?.bookmark?.url === 'https://example.com',
    String(j(auto)?.data?.bookmark?.url))
  const bid = j(auto)?.data?.bookmark?.id

  const js = await admin.req('POST', '/api/bookmarks', { name: 'xss', url: 'javascript:alert(1)' })
  check('javascript: 协议被拒（点击即执行脚本）', js.status === 400, 'status=' + js.status)

  const data = await admin.req('POST', '/api/bookmarks', { name: 'data', url: 'data:text/html,<script>' })
  check('data: 协议被拒', data.status === 400, 'status=' + data.status)

  const upd = await admin.req('PATCH', `/api/bookmarks/${bid}`, { name: '改过的名字', category: '工具' })
  check('更新书签成功', upd.status === 200)
  const list = await admin.req('GET', '/api/bookmarks')
  const hit = (j(list)?.data?.bookmarks ?? []).find((b) => b.id === bid)
  check('更新已生效', hit?.name === '改过的名字' && hit?.category === '工具', JSON.stringify(hit))

  const del = await admin.req('DELETE', `/api/bookmarks/${bid}`)
  check('删除书签成功', del.status === 200)
}

section('一键清空：灵感 / 待办')
{
  // ---- 灵感：清空应同时回退热力图、回收配图文件 ----
  const actBefore = j(await admin.req('GET', '/api/activity'))?.data?.total ?? 0
  const filesBefore = j(await admin.req('GET', '/api/files?scope=idea'))?.data?.files?.length ?? 0

  // 造 3 条灵感，其中一条带图
  const img = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82])
  const fd = new FormData()
  fd.append('files', new Blob([img], { type: 'image/png' }), '灵感配图.png')
  fd.append('scope', 'idea')
  const up = await admin.req('POST', '/api/files', null, { form: fd })
  const imgId = j(up)?.data?.files?.[0]?.id
  check('配图上传成功', !!imgId)

  for (let i = 0; i < 3; i++) {
    await admin.req('POST', '/api/ideas', i === 0 ? { text: `待清空-${i}`, fileIds: [imgId] } : { text: `待清空-${i}` })
  }
  const listBefore = j(await admin.req('GET', '/api/ideas'))?.data?.ideas?.length ?? 0
  check('已造出 3 条灵感', listBefore >= 3, String(listBefore))
  const actWithIdeas = j(await admin.req('GET', '/api/activity'))?.data?.total ?? 0
  check('灵感产生了 push', actWithIdeas >= actBefore + 3, `${actBefore} -> ${actWithIdeas}`)

  const cleared = await admin.req('DELETE', '/api/ideas')
  check('清空灵感返回 removed 数量', cleared.status === 200 && j(cleared)?.data?.removed >= 3,
    JSON.stringify(j(cleared)?.data))

  const listAfter = j(await admin.req('GET', '/api/ideas'))?.data?.ideas?.length ?? -1
  check('清空后灵感列表为空', listAfter === 0, String(listAfter))

  const actAfter = j(await admin.req('GET', '/api/activity'))?.data?.total ?? 0
  check('清空后 push 也回退（热力图不会留脏数据）', actAfter === actBefore, `${actWithIdeas} -> ${actAfter}`)

  const filesAfter = j(await admin.req('GET', '/api/files?scope=idea'))?.data?.files?.length ?? -1
  check('配图文件被回收为 0（不留孤儿）', filesAfter === 0, `${filesBefore} -> ${filesAfter}`)

  const imgGone = await admin.req('GET', `/api/files/${imgId}/raw`)
  check('被回收的配图无法再下载', imgGone.status === 404, 'status=' + imgGone.status)

  // 空库再清一次不应报错
  const again = await admin.req('DELETE', '/api/ideas')
  check('空库重复清空返回 removed: 0', again.status === 200 && j(again)?.data?.removed === 0,
    JSON.stringify(j(again)?.data))

  // ---- 待办：清空应回退"完成待办"产生的 push ----
  const tBefore = j(await admin.req('GET', '/api/activity'))?.data?.total ?? 0
  const ids = []
  for (let i = 0; i < 3; i++) {
    const r = await admin.req('POST', '/api/todos', { title: `待清空任务-${i}` })
    ids.push(j(r)?.data?.todo?.id)
  }
  // 完成其中两个，制造 push
  await admin.req('PATCH', `/api/todos/${ids[0]}`, { done: true })
  await admin.req('PATCH', `/api/todos/${ids[1]}`, { done: true })
  const tWithDone = j(await admin.req('GET', '/api/activity'))?.data?.total ?? 0
  check('完成待办产生了 push', tWithDone === tBefore + 2, `${tBefore} -> ${tWithDone}`)

  const tCleared = await admin.req('DELETE', '/api/todos')
  check('清空待办返回 removed', tCleared.status === 200 && j(tCleared)?.data?.removed >= 3,
    JSON.stringify(j(tCleared)?.data))

  const tListAfter = j(await admin.req('GET', '/api/todos'))?.data?.todos?.length ?? -1
  check('清空后待办列表为空', tListAfter === 0, String(tListAfter))

  const tActAfter = j(await admin.req('GET', '/api/activity'))?.data?.total ?? 0
  check('清空后待办的 push 也回退', tActAfter === tBefore, `${tWithDone} -> ${tActAfter}`)
}

section('一键清空的隔离性')
{
  // A 清空自己的，不该动到 B 的数据
  const bIdea = await userB.req('POST', '/api/ideas', { text: 'B 的灵感' })
  check('B 能建灵感', bIdea.status === 200)
  const bTodo = await userB.req('POST', '/api/todos', { title: 'B 的待办' })
  check('B 能建待办', bTodo.status === 200)

  const aCleared = await admin.req('DELETE', '/api/ideas')
  check('A 清空自己的灵感', aCleared.status === 200)

  const bStill = j(await userB.req('GET', '/api/ideas'))?.data?.ideas?.length ?? -1
  check('B 的灵感未被波及', bStill === 1, String(bStill))

  await admin.req('DELETE', '/api/todos')
  const bTodoStill = j(await userB.req('GET', '/api/todos'))?.data?.todos?.length ?? -1
  check('B 的待办未被波及', bTodoStill === 1, String(bTodoStill))

  // 清理 B 的数据，免得影响后续用例
  await userB.req('DELETE', '/api/ideas')
  await userB.req('DELETE', '/api/todos')
}

section('安全边界')
{
  // SQL 注入尝试：参数化查询应该让它变成普通字符串
  const inj = await admin.req('POST', '/api/ideas', { text: "'; DROP TABLE ideas; --" })
  check('SQL 注入字符串被当作普通文本', inj.status === 200)
  const stillOk = await admin.req('GET', '/api/ideas')
  check('ideas 表未被破坏', stillOk.status === 200 && Array.isArray(j(stillOk)?.data?.ideas))

  // 用户 A 尝试操作管理员的资源
  const ideaL = j(await admin.req('GET', '/api/ideas'))?.data?.ideas?.[0]?.id
  const crossDel = await userA.req('DELETE', `/api/ideas/${ideaL}`)
  check('跨用户删除被拒', crossDel.status === 404, 'status=' + crossDel.status)

  const crossFile = await userA.req('DELETE', `/api/files/${uploaded[0]?.id}`)
  check('跨用户删文件被拒', crossFile.status === 404, 'status=' + crossFile.status)

  const crossPatch = await userA.req('PATCH', `/api/files/${uploaded[0]?.id}`, { note: 'hacked' })
  check('跨用户改文件被拒', crossPatch.status === 404, 'status=' + crossPatch.status)

  // 未登录
  const anon = makeClient()
  check('未登录访问 files 被拒', (await anon.req('GET', '/api/files')).status === 401)
  check('未登录访问 todos 被拒', (await anon.req('GET', '/api/todos')).status === 401)
  check('未登录访问 bookmarks 被拒', (await anon.req('GET', '/api/bookmarks')).status === 401)
  check('未登录访问 activity 被拒', (await anon.req('GET', '/api/activity')).status === 401)
  check('未登录访问 github 被拒', (await anon.req('GET', '/api/github/torvalds')).status === 401)

  // 头像不能挂别人的文件
  const stealAvatar = await userA.req('PATCH', '/api/auth/profile', { avatarFileId: uploaded[0]?.id })
  check('不能把别人的文件设成自己的头像', stealAvatar.status === 400, 'status=' + stealAvatar.status)
}

section('文件：删除与磁盘清理')
{
  const before = j(await admin.req('GET', '/api/files'))?.data?.files?.length ?? 0
  const target = uploaded[1]
  const del = await admin.req('DELETE', `/api/files/${target.id}`)
  check('删除文件成功', del.status === 200)
  const after = j(await admin.req('GET', '/api/files'))?.data?.files?.length ?? 0
  check('列表数量减少', after === before - 1, `${before} → ${after}`)
  const gone = await admin.req('GET', `/api/files/${target.id}/raw`)
  check('删除后无法再下载', gone.status === 404, 'status=' + gone.status)
}

/* ================================================================== */

console.log('')
console.log('==================================================')
console.log(`  通过 ${pass} / ${pass + fail}`)
if (fail) {
  console.log('  失败项：')
  for (const f of failures) console.log('   - ' + f)
}
console.log('==================================================')
process.exit(fail ? 1 : 0)
