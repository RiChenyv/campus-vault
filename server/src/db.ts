/**
 * 数据库：SQLite（Node 24 内置 node:sqlite，零原生依赖）。
 *
 * 选 SQLite 的理由：单用户小规模完全够用，零运维、单文件，
 * 备份就是复制一个文件。不要为这种规模上 PostgreSQL。
 *
 * 两个必须开的开关：
 *  · journal_mode = WAL —— 默认的 DELETE 模式在并发读写时会锁整库，
 *    WAL 允许「一写多读」并行，是 SQLite 用于服务端的标准配置。
 *  · foreign_keys = ON —— SQLite 默认**不**强制外键，
 *    不显式打开的话 ON DELETE CASCADE 是静默失效的，会攒下一堆孤儿行。
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * 迁移：只能追加，不能修改已发布的条目。
 * 每条迁移在一个事务里执行，user_version 记录已应用到第几版。
 */
const MIGRATIONS: string[] = [
  /* ---- v1: 账号 / 会话 / 资料 ---- */
  `
  CREATE TABLE users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    account        TEXT    NOT NULL UNIQUE,
    password_hash  TEXT    NOT NULL,
    is_admin       INTEGER NOT NULL DEFAULT 0,
    failed_count   INTEGER NOT NULL DEFAULT 0,
    locked_until   INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    last_login_at  INTEGER
  );

  CREATE TABLE sessions (
    token      TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT,
    ip         TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE INDEX idx_sessions_exp  ON sessions(expires_at);

  CREATE TABLE profiles (
    user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    username       TEXT    NOT NULL DEFAULT '',
    avatar_file_id TEXT,
    github         TEXT    NOT NULL DEFAULT ''
  );
  `,

  /* ---- v2: 文件（题库资料 / 待办附件 / 灵感配图 / 头像 共用一张表）---- */
  `
  CREATE TABLE files (
    id         TEXT    PRIMARY KEY,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    kind       TEXT    NOT NULL,
    mime       TEXT    NOT NULL DEFAULT '',
    bytes      INTEGER NOT NULL,
    sha256     TEXT    NOT NULL DEFAULT '',
    store_path TEXT    NOT NULL,
    scope      TEXT    NOT NULL,
    course_id  TEXT    NOT NULL DEFAULT '',
    note       TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_files_owner_scope ON files(owner_id, scope, created_at DESC);
  CREATE INDEX idx_files_sha           ON files(owner_id, sha256);
  `,

  /* ---- v3: 灵感 / 待办 / 书签 ---- */
  `
  CREATE TABLE ideas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_ideas_owner ON ideas(owner_id, created_at DESC);

  CREATE TABLE idea_images (
    idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    file_id TEXT    NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    sort    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (idea_id, file_id)
  );

  CREATE TABLE todos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    done_at    INTEGER,
    created_at INTEGER NOT NULL,
    sort       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_todos_owner ON todos(owner_id, done, created_at DESC);

  CREATE TABLE todo_attachments (
    todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    file_id TEXT    NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    sort    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (todo_id, file_id)
  );

  CREATE TABLE bookmarks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    url        TEXT    NOT NULL,
    note       TEXT    NOT NULL DEFAULT '',
    category   TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_bookmarks_owner ON bookmarks(owner_id, created_at DESC);
  `,

  /* ---- v4: 活动日志（热力图的唯一真相）----
     存「事件流水」而不是「每天计数」：删掉一篇笔记后热力图要能自动少一格，
     存计数的话数字永远不会回退，数据就永久对不上了。
     计数在查询时按天聚合得到。 */
  `
  CREATE TABLE activity_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL,
    ref_id     TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_activity_owner_time ON activity_log(owner_id, created_at);
  `,

  /* ---- v5: 在校信息（个人资料扩展）+ 课程 + 课表 ----
     个人资料原来只有 username / avatar / github，装不下学号、学院这些。
     课程与课表独立成表，是为了让"从学校网站导入"有地方落 ——
     之前课程和课表都是 data/mock.ts 里的写死假数据。 */
  `
  ALTER TABLE profiles ADD COLUMN real_name  TEXT NOT NULL DEFAULT '';
  ALTER TABLE profiles ADD COLUMN student_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE profiles ADD COLUMN college    TEXT NOT NULL DEFAULT '';
  ALTER TABLE profiles ADD COLUMN major      TEXT NOT NULL DEFAULT '';
  ALTER TABLE profiles ADD COLUMN grade      TEXT NOT NULL DEFAULT '';
  ALTER TABLE profiles ADD COLUMN class_name TEXT NOT NULL DEFAULT '';
  ALTER TABLE profiles ADD COLUMN imported_at INTEGER;

  CREATE TABLE courses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    /* 学校那边的课程号。用它做幂等键 —— 重复导入不会产生重复课程。
       没有课程号时退化成「名称 + 学期 + 教师」。 */
    code       TEXT    NOT NULL DEFAULT '',
    name       TEXT    NOT NULL,
    teacher    TEXT    NOT NULL DEFAULT '',
    credits    REAL    NOT NULL DEFAULT 0,
    term       TEXT    NOT NULL DEFAULT '',
    room       TEXT    NOT NULL DEFAULT '',
    raw        TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX idx_courses_key ON courses(owner_id, code, name, term);
  CREATE INDEX idx_courses_owner ON courses(owner_id, term, name);

  CREATE TABLE schedule_slots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id  INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    /* 星期：1=周一 … 7=周日 */
    day        INTEGER NOT NULL,
    /* 第几节开始 / 连上几节 */
    from_slot  INTEGER NOT NULL,
    span       INTEGER NOT NULL DEFAULT 1,
    room       TEXT    NOT NULL DEFAULT '',
    weeks      TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_slots_owner ON schedule_slots(owner_id, day, from_slot);

  /* 导入日志：出问题时能回答"上次导入了什么、什么时候、成功没有" */
  CREATE TABLE import_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source     TEXT    NOT NULL DEFAULT '',
    summary    TEXT    NOT NULL DEFAULT '',
    detail     TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_import_owner ON import_log(owner_id, created_at DESC);
  `,

  /* ---- v6: 导入令牌 ----
     ⚠️ 这段是**历史记录**，别当现状读：当时唯一的使用者是书签脚本，
     而书签脚本 2026-10 已整体删除（用户嫌麻烦）。现在只有油猴脚本用它。
     仍然成立的部分：脚本从学校页面（courses.cuc.edu.cn）往 127.0.0.1:5175
     发请求属于**跨站**，而会话 cookie 是 SameSite=Lax —— 跨站 POST 不会带上它，
     所以脚本没法用登录态认证。
     改用一枚独立令牌：用户在导入页生成，脚本带着它走**专用头 X-Import-Token**
     （原来写的 Authorization 是错的 —— 那个头是标签页会话用的）。
     令牌只能用于导入接口，泄露了也拿不到别的数据，且可随时轮换。 */
  `
  CREATE TABLE import_tokens (
    token      TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label      TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE INDEX idx_import_tokens_user ON import_tokens(user_id);
  `,
  /* ---- v7: 文件所属文件夹 ----
     用户上传整个文件夹时，希望它在题库里显示成**一个可展开的条目**，
     而不是把几十个文件平铺出来。
     存"相对根目录"（如 `数据结构作业/第一章`）：按第一段分组就能得到
     顶层文件夹条目，剩余的层级还能作为子路径显示。空串 = 散装文件。 */
  `
  ALTER TABLE files ADD COLUMN folder TEXT NOT NULL DEFAULT '';
  CREATE INDEX idx_files_folder ON files(owner_id, scope, folder);
  `,


  /* ---- v8: 日历的「本月重要节点」 ----
     这些事件原来写死在 src/data/mock.ts 的 CAL_EVENTS 里，用户既不能加也不能删。
     字段刻意和原模型一一对应（day / label / tone / rgb 由 tone 推导），
     前端换数据源时不用改渲染逻辑，风险最小。 */
  `
  CREATE TABLE calendar_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day        INTEGER NOT NULL,
    label      TEXT    NOT NULL,
    tone       TEXT    NOT NULL DEFAULT 'activity',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_cal_owner ON calendar_events(owner_id, day, created_at);
  `,

  /* ---- v9: 手写笔记 ----
     「我的笔记」原来只是文件的视图（按课程分组），用户没法**自己写一条**。
     但很多笔记根本没有对应的文件 —— 课上随手记的两行、复习时的提纲。
     这类内容必须能在应用里直接写、直接改。
     course_id 是软关联（空串 = 未归类），和 files 的做法保持一致。 */
  `
  CREATE TABLE notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id  TEXT    NOT NULL DEFAULT '',
    title      TEXT    NOT NULL,
    body       TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_notes_owner ON notes(owner_id, updated_at DESC);
  `,

  /* ---- v10: 课程的界面字段 ----
     courses 表原本只为"从教务系统导入"设计（code/name/teacher/credits/term/room）。
     但用户还要能**自己建课程**、给课程配色、写备注 —— 这些导入拿不到。
     manual 标记用来区分"导入的"和"自己建的"：
     导入可以覆盖前者，但不该动后者。 */
  `
  ALTER TABLE courses ADD COLUMN color  TEXT    NOT NULL DEFAULT '';
  ALTER TABLE courses ADD COLUMN note   TEXT    NOT NULL DEFAULT '';
  ALTER TABLE courses ADD COLUMN manual INTEGER NOT NULL DEFAULT 0;
  `,

  /* ---- v11: 成绩单 ----
     和 courses 是**两件事**，所以单独一张表，不往 courses 里塞：
       · courses 回答"我在上什么课"（含本学期还在读、没出分的）
       · grades  回答"这门课最后考了多少分"（学分 / 绩点 / 成绩）
     混在一起的后果：一门课重修两次就有两条成绩，而 courses 靠
     (owner_id, code, name, term) 唯一 —— 第二条会被当成重复课程吞掉。

     `edited` 是「手填优先于导入」的落实：学分和绩点用户明确要求能手动改
     （学校给的学时/学分偶尔是错的）。改过就置 1，之后的导入只补空字段，
     不会把用户改的值顶回去。

     `course_id` 是**软关联**（存 courses.id 的字符串形式，空串 = 没有对应课程），
     和 files.course_id 一个路子：删课程不删成绩，只让它变成"仅成绩"记录。
     教务系统导来的课程号对不上的（选修、外校课、体育项目）就属于这种。

     唯一键 = 课程号 + 课程名 + 学期 + 重修标记：
     它同时是**导入的幂等键**（重复导入不会翻倍）和"未出分 → 出分"的更新键
     （所以键里**不能带 score**，否则出分后会多出一条）。 */
  `
  CREATE TABLE grades (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   TEXT    NOT NULL DEFAULT '',
    course_code TEXT    NOT NULL DEFAULT '',
    course_name TEXT    NOT NULL,
    term        TEXT    NOT NULL DEFAULT '',
    /* 成绩原样存：'91' 也可能 '优秀' / '及格' / '通过' */
    score       TEXT    NOT NULL DEFAULT '',
    /* 只有数字成绩才有值；'优秀' 这类是 NULL（不瞎猜成 90 分） */
    score_num   REAL,
    credit      REAL    NOT NULL DEFAULT 0,
    gpa         REAL,
    category    TEXT    NOT NULL DEFAULT '',
    nature      TEXT    NOT NULL DEFAULT '',
    mode        TEXT    NOT NULL DEFAULT '',
    is_major    INTEGER NOT NULL DEFAULT 0,
    exam_date   TEXT    NOT NULL DEFAULT '',
    retake      TEXT    NOT NULL DEFAULT '',
    /* 1 = 用户手动改过，导入不再覆盖 */
    edited      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX idx_grades_key ON grades(owner_id, course_code, course_name, term, retake);
  CREATE INDEX idx_grades_owner ON grades(owner_id, term, course_name);
  `,

  /* v12：成绩的"身份"改成「学期 + 课程号（没有课程号才用课程名）」。
     原来唯一键含 `retake`（重修重考），而它是展示字段：
     解析器写错列时它落到空串、修好之后变成「正常」——
     于是同一门课重导一次就**新增一行**，用户实测重导后数据翻倍。
     这里先把已有重复合并，再重建索引。

     ★ 合并规则（顺序即优先级）：
       ① edited = 1（用户手改过的）绝不能被合并掉
       ② 字段更全的（有成绩、有学分、有绩点）
       ③ 最新的
     被合并掉的行才删除；保留行的 course_id 等字段不动。 */
  `
  DELETE FROM grades WHERE id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY owner_id, term, CASE WHEN course_code <> '' THEN course_code ELSE course_name END
        ORDER BY edited DESC,
                 (score_num IS NOT NULL) DESC,
                 (credit > 0) DESC,
                 updated_at DESC,
                 id DESC
      ) AS rn
      FROM grades
    ) WHERE rn = 1
  );
  DROP INDEX IF EXISTS idx_grades_key;
  CREATE UNIQUE INDEX idx_grades_key
    ON grades(owner_id, term, CASE WHEN course_code <> '' THEN course_code ELSE course_name END);
  CREATE INDEX IF NOT EXISTS idx_grades_owner ON grades(owner_id, term, course_name);
  `,

  /* ---- v13: 上传的 push 从「按文件」改成「按一次上传动作」----
     原来每插一个文件就写一条 activity_log，于是"传一个文件夹 19 个文件"
     等于 19 次 push —— 数字和"我今天做了几件事"完全不成比例（实测最密集的一秒落 27 条）。

     改法：前端在**一次用户动作**（选一次文件 / 拖一次文件夹）开始时生成一个
     batch_key，同一批的每个文件都带着它；这里用**部分唯一索引** + `INSERT OR IGNORE`
     保证同一批无论多少文件都只落一条。

     用部分索引（WHERE batch_key <> ''）是为了不动历史行：
     老数据的 batch_key 一律是空串，不受唯一约束影响。 */
  `
  ALTER TABLE activity_log ADD COLUMN batch_key TEXT NOT NULL DEFAULT '';
  CREATE UNIQUE INDEX idx_activity_batch
    ON activity_log(owner_id, kind, batch_key) WHERE batch_key <> '';
  `,
]

export type Db = DatabaseSync

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)

  // 顺序有讲究：先开 WAL 再建表，否则首次建表会走默认日志模式
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA synchronous = NORMAL')

  migrate(db)
  return db
}

function migrate(db: Db) {
  const cur = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (let v = cur; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v]!
    db.exec('BEGIN')
    try {
      db.exec(sql)
      // PRAGMA 不接受参数占位符，这里拼的是循环变量，不是外部输入
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
      console.log(`[db] 已应用迁移 v${v + 1}`)
    } catch (e) {
      db.exec('ROLLBACK')
      throw new Error(`迁移 v${v + 1} 失败: ${(e as Error).message}`)
    }
  }
}
