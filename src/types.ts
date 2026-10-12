/** 全站共享类型 */

export type RouteId =
  | 'home'
  | 'courses'
  | 'schedule'
  | 'notes'
  | 'questions'
  | 'ideas'
  | 'todos'
  | 'calendar'
  /** 单门课程的详情页（笔记 / 题库 / 教师 / 课表位置） */
  | 'course-detail'
  /** 学分总览（占比扇形图 + 已修学分） */
  | 'credits'
  /** 导入中心：学校网站脚本 / 上传文件 / 手动添加 / 导入历史 */
  | 'import'

export type Quality = 'high' | 'mid' | 'eco'

export interface NavMeta {
  id: RouteId
  label: string
  sub: string
  icon: string
  /** 圆环上的坐标（-1 ~ 1），用于选中后自动旋转到 12 点方向 */
  angle: number
  rgb: string
}

export interface Course {
  id: string
  name: string
  teacher: string
  room: string
  term: string
  credit: number
  color: string
  rgb: string
  files: number
  notes: number
  progress: number
}

export type FileKind = 'markdown' | 'code' | 'docx' | 'pdf' | 'image' | 'slides' | 'archive'

export interface VaultFile {
  name: string
  kind: FileKind
  size: string
  updated: string
  tag: '笔记' | '作业' | '资料' | '实验' | '试卷'
}

export interface Todo {
  id: string
  title: string
  courseId: string
  due: string
  dueTone: 'danger' | 'warn' | 'calm'
  priority: '高' | '中' | '低'
  done: boolean
  /** 附件：图片直接内嵌预览，文件以胶囊展示；都存储在服务端 */
  attachments?: TodoAttachment[]
}

export type TodoAttachment =
  | { kind: 'image'; dataUrl: string; ratio: number; name: string; bytes: number }
  | { kind: 'file'; name: string; bytes: number }

/** 宝藏网址（书签） */
export interface Bookmark {
  id: string
  title: string
  url: string
  desc: string
  kind: string
  rgb: string
  at: string
}

export interface Idea {
  id: string
  text: string
  at: string
  tags: string[]
  color: string
  /** 配图：服务端文件地址（/api/files/:id/raw） */
  image?: {
    dataUrl: string
    ratio: number
    name?: string
  }
}

export interface Question {
  id: string
  courseId: string
  type: '单选' | '多选' | '判断' | '简答'
  stem: string
  options: string[]
  answer: number[]
  wrong: number
  accuracy: number
  /** 解析（可选，录题时可填） */
  explanation?: string
  /** 掌握度：0 未掌握 ~ 3 熟练。用于筛选与复习排期 */
  mastery?: 0 | 1 | 2 | 3
}

export interface ScheduleItem {
  day: number
  from: number
  span: number
  courseId: string
}
