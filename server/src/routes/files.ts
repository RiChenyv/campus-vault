import { Readable } from 'node:stream'
import { Router } from 'express'
import multer from 'multer'
import type { Db } from '../db.ts'
import { getUser, requireAuth } from '../lib/auth.ts'
import { badRequest, notFound, ok, param, wrap } from '../lib/http.ts'
import {
  MAX_FILE_BYTES,
  type StoredFile,
  UnsafeFileError,
  fixFilename,
  allowedExtensions,
  isAllowedExt,
  kindOf,
  mimeOf,
  readStored,
  removeStored,
  saveStream,
  statStored,
} from '../lib/storage.ts'
import { logActivity } from '../lib/activity.ts'

/**
 * 自定义 multer 存储引擎：**直接把上传流接到磁盘**。
 *
 * 为什么不用内置的两种：
 *  · `multer.diskStorage` 会拿**客户端提供的文件名**去写磁盘 ——
 *    那正是要避免的（路径穿越 / 重名覆盖 / 中文编码问题）。
 *  · `multer.memoryStorage` 会把整个文件读进内存 ——
 *    上传一个 200MB 的视频就能把服务打爆。
 *
 * 自定义引擎里 `file.stream` 是原始的 IncomingMessage 流，
 * 直接交给 saveStream 边收边写，内存占用是常数级的。
 */
function makeStorage(dataDir: string): multer.StorageEngine {
  return {
    _handleFile(_req, file, cb) {
      // 修正 latin1 误解码的中文文件名，再交给落盘逻辑
      saveStream(file.stream, dataDir, fixFilename(file.originalname))
        .then((stored: StoredFile) => cb(null, stored as unknown as Partial<Express.Multer.File>))
        .catch((e: Error) => cb(e))
    },
    _removeFile(_req, file, cb) {
      // 后续中间件报错时 multer 会回调这里；文件已经落盘，
      // 交给上层按需清理，这里不抛错
      const anyFile = file as unknown as { absPath?: string; storePath?: string }
      if (anyFile.storePath) {
        void removeStored(dataDir, anyFile.storePath)
      }
      cb(null)
    },
  }
}

interface FileRow {
  id: string
  name: string
  kind: string
  mime: string
  bytes: number
  scope: string
  course_id: string
  note: string
  /** 相对根目录，空串 = 散装文件 */
  folder: string
  created_at: number
}

const toDto = (r: FileRow) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  mime: r.mime,
  bytes: r.bytes,
  scope: r.scope,
  courseId: r.course_id,
  note: r.note,
  folder: r.folder ?? '',
  createdAt: r.created_at,
  url: `/api/files/${r.id}/raw`,
})

export function fileRoutes(db: Db, dataDir: string): Router {
  const r = Router()
  const upload = multer({
    storage: makeStorage(dataDir),
    // 扩展名白名单在**建流之前**先挡一道：
    // 明显不该传的类型不必等客户端传完 200MB 再拒绝
    fileFilter(_req, file, cb) {
      const name = fixFilename(file.originalname)
      if (!isAllowedExt(name)) {
        cb(new UnsafeFileError(`不支持的文件类型：${name}`))
        return
      }
      cb(null, true)
    },
    limits: { fileSize: MAX_FILE_BYTES, files: 20 },
  })
  r.use(requireAuth(db))

  /* ------------------------------ 列表 ------------------------------ */
  r.get(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const scope = typeof req.query.scope === 'string' ? req.query.scope : ''
      const courseId = typeof req.query.courseId === 'string' ? req.query.courseId : ''
      const kind = typeof req.query.kind === 'string' ? req.query.kind : ''
      const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''

      const where: string[] = ['owner_id = ?']
      const args: (string | number)[] = [me.id]
      if (scope) {
        where.push('scope = ?')
        args.push(scope)
      }
      if (courseId) {
        where.push('course_id = ?')
        args.push(courseId)
      }
      if (kind) {
        where.push('kind = ?')
        args.push(kind)
      }
      if (q) {
        // 也搜文件夹名：用户更可能记得「数据结构作业」而不是里面某个文件名
        where.push('(lower(name) LIKE ? OR lower(note) LIKE ? OR lower(folder) LIKE ?)')
        args.push(`%${q}%`, `%${q}%`, `%${q}%`)
      }

      const rows = db
        .prepare(
          `SELECT id, name, kind, mime, bytes, scope, course_id, note, folder, created_at
             FROM files WHERE ${where.join(' AND ')}
            ORDER BY created_at DESC, rowid DESC LIMIT 2000`,
        )
        .all(...args) as unknown as FileRow[]

      ok(res, { files: rows.map(toDto), total: rows.length })
    }),
  )

  /* ------------------------------ 上传 ------------------------------ */
  r.post(
    '/',
    upload.array('files', 20),
    wrap(async (req, res) => {
      const me = getUser(req)
      const files = (req.files as unknown as UploadedFile[] | undefined) ?? []
      if (!files.length) throw badRequest('没有收到文件')

      const scope = typeof req.body?.scope === 'string' && req.body.scope ? req.body.scope : 'qbank'
      const courseId = typeof req.body?.courseId === 'string' ? req.body.courseId : ''
      const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : ''
      // 相对根目录。上传整个文件夹时由前端带上；散装文件是空串。
      const folder = typeof req.body?.folder === 'string' ? req.body.folder.trim().slice(0, 300) : ''
      /* 一次上传动作的批次键。前端是逐文件发请求的，带上它之后
         这一批无论多少文件都只记一次 push（见 lib/activity.ts 的说明）。 */
      const batchKey = typeof req.body?.batchKey === 'string' ? req.body.batchKey.trim().slice(0, 64) : ''

      const saved: ReturnType<typeof toDto>[] = []
      let now = Date.now()
      for (const f of files) {
        // multer 按 latin1 解码了文件名，这里必须修正后再入库，
        // 否则数据库里存的是 å¤ä¹ æçº².md 这种乱码
        const name = fixFilename(f.originalname)
        const kind = kindOf(name)
        const mime = mimeOf(name)
        db.prepare(
          `INSERT INTO files (id, owner_id, name, kind, mime, bytes, sha256, store_path, scope, course_id, note, folder, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          f.id, me.id, name, kind, mime, f.bytes, f.sha256,
          f.storePath, scope, courseId, note, folder, now,
        )
        /* 一次上传动作 = 一次 push。同一批的后续文件会被幂等跳过
           （v13 的部分唯一索引 + INSERT OR IGNORE），所以 ref_id 记的是**这一批的第一个文件**。 */
        logActivity(db, me.id, 'file', f.id, Date.now(), batchKey)
        // 同一批上传的多个文件若共用同一个毫秒时间戳，排序会并列，
        // 刷新后顺序可能变化。这里给每个文件递增 1ms 保证稳定。
        now += 1
        saved.push(
          toDto({
            id: f.id,
            name,
            kind,
            mime,
            bytes: f.bytes,
            scope,
            course_id: courseId,
            note,
            folder,
            created_at: now,
          }),
        )
      }
      ok(res, { files: saved })
    }),
  )

  /* --------------------------- 原始字节流 ---------------------------
     Range 必须支持：否则 PDF 不能翻页预载、视频不能拖进度条，
     每次都得等整个文件下完。 */
  /**
   * 允许上传的扩展名。
   * 客户端拿它做前置过滤（选文件夹时特别需要）。
   * 必须放在 /:id 这类动态路由**之前**，否则 'allowed' 会被当成文件 id。
   */
  r.get(
    '/allowed',
    wrap(async (_req, res) => {
      ok(res, { extensions: allowedExtensions() })
    }),
  )

  r.get(
    '/:id/raw',
    wrap(async (req, res) => {
      const me = getUser(req)
      // 归属校验：不能只凭 id 就拿到别人的文件
      const row = db
        .prepare('SELECT id, name, mime, bytes, store_path, owner_id FROM files WHERE id = ?')
        .get(param(req, 'id')) as
        | { id: string; name: string; mime: string; bytes: number; store_path: string; owner_id: number }
        | undefined
      if (!row || row.owner_id !== me.id) throw notFound('文件不存在')

      const st = await statStored(dataDir, row.store_path)
      if (!st) throw notFound('文件已从磁盘丢失')

      const total = st.size
      res.setHeader('Content-Type', row.mime || mimeOf(row.name))
      res.setHeader('Accept-Ranges', 'bytes')
      // inline 才能在浏览器里直接预览；下载用 ?download=1
      // 中文文件名必须用 RFC 5987 的 filename* 编码，否则响应头会乱码
      const disp = req.query.download === '1' ? 'attachment' : 'inline'
      res.setHeader('Content-Disposition', `${disp}; filename*=UTF-8''${encodeURIComponent(row.name)}`)
      res.setHeader('Cache-Control', 'private, max-age=3600')

      const range = req.headers.range
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
        if (m) {
          const start = m[1] ? Number(m[1]) : 0
          let end = m[2] ? Number(m[2]) : total - 1
          if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
            res.setHeader('Content-Range', `bytes */${total}`)
            res.status(416).end()
            return
          }
          end = Math.min(end, total - 1)
          res.status(206)
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
          res.setHeader('Content-Length', String(end - start + 1))
          readStored(dataDir, row.store_path).pipe(res)
          return
        }
      }

      res.setHeader('Content-Length', String(total))
      readStored(dataDir, row.store_path).pipe(res)
    }),
  )

  /* ------------------------------ 改备注 / 课程 ------------------------------ */
  r.patch(
    '/:id',
    wrap(async (req, res) => {
      const me = getUser(req)
      const row = db
        .prepare('SELECT id, owner_id FROM files WHERE id = ?')
        .get(param(req, 'id')) as { id: string; owner_id: number } | undefined
      if (!row || row.owner_id !== me.id) throw notFound('文件不存在')

      const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined
      const courseId = typeof req.body?.courseId === 'string' ? req.body.courseId : undefined
      if (note !== undefined) db.prepare('UPDATE files SET note = ? WHERE id = ?').run(note, row.id)
      if (courseId !== undefined) db.prepare('UPDATE files SET course_id = ? WHERE id = ?').run(courseId, row.id)
      ok(res, { done: true })
    }),
  )

  /* ------------------------------ 删除 ------------------------------
     顺序很重要：**先删数据库行，再删磁盘文件**。
     反过来的话，删完文件、删行之前若进程崩了，就会留下
     「行还在但文件没了」的记录 —— 读它永远 404/500，且无法自愈。
     现在这个顺序最坏只是留个孤儿文件，可以定期清理。 */
  /* ---------------------------- 清空（按 scope） ----------------------------
     一次删掉某个范围内的全部文件：数据库行**和磁盘文件**都要删。
     只删库的话磁盘会越积越多，而且用户看不到、也清不掉。

     两个安全边界：
      · 只删自己（owner_id）的
      · 排除被灵感配图 / 待办附件引用的文件 —— 即使它们的 scope 碰巧一致，
        也不该被清空题库顺手删掉（那会让灵感里出现裂图）
     ---------------------------------------------------------------------- */
  r.delete(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const scope = typeof req.query.scope === 'string' && req.query.scope ? req.query.scope : 'qbank'

      const rows = db
        .prepare(
          `SELECT f.id, f.store_path FROM files f
            WHERE f.owner_id = ? AND f.scope = ?
              AND NOT EXISTS (SELECT 1 FROM idea_images ii WHERE ii.file_id = f.id)
              AND NOT EXISTS (SELECT 1 FROM todo_attachments ta WHERE ta.file_id = f.id)`,
        )
        .all(me.id, scope) as { id: string; store_path: string }[]

      if (!rows.length) {
        ok(res, { removed: 0, scope })
        return
      }

      const del = db.prepare('DELETE FROM files WHERE id = ?')
      let removed = 0
      for (const f of rows) {
        // 先删库行再删磁盘，和单文件删除保持同一顺序：
        // 反过来的话崩在中间会留下"行还在、文件没了"的死记录
        del.run(f.id)
        removed++
      }
      // 磁盘删除是异步的，但已经不影响正确性 —— 失败最多留个孤儿文件，
      // 不会出现"记录指向不存在的文件"
      await Promise.all(rows.map((f) => removeStored(dataDir, f.store_path)))

      ok(res, { removed, scope })
    }),
  )

  r.delete(
    '/:id',
    wrap(async (req, res) => {
      const me = getUser(req)
      const row = db
        .prepare('SELECT id, store_path, owner_id FROM files WHERE id = ?')
        .get(param(req, 'id')) as { id: string; store_path: string; owner_id: number } | undefined
      if (!row || row.owner_id !== me.id) throw notFound('文件不存在')

      db.prepare('DELETE FROM files WHERE id = ?').run(row.id)
      await removeStored(dataDir, row.store_path)
      ok(res, { done: true })
    }),
  )

  return r
}

/** multer 自定义引擎产出的对象形状（带我们自己的字段） */
interface UploadedFile {
  originalname: string
  id: string
  storePath: string
  bytes: number
  sha256: string
}

export { Readable }
