import type { Course, Idea, Question, ScheduleItem, Todo, VaultFile } from '../types'

/* ------------------------------- 课程 ------------------------------- */

export const COURSES: Course[] = [
  {
    id: 'c1',
    name: '数据结构与算法',
    teacher: '陈立群',
    room: '信电楼 B302',
    term: '2025-2026 秋',
    credit: 4,
    color: '#6f9cff',
    rgb: '111 156 255',
    files: 42,
    notes: 18,
    progress: 0.78,
  },
  {
    id: 'c2',
    name: '计算机网络',
    teacher: '王海涛',
    room: '信电楼 A105',
    term: '2025-2026 秋',
    credit: 3,
    color: '#5cd6be',
    rgb: '92 214 190',
    files: 31,
    notes: 12,
    progress: 0.62,
  },
  {
    id: 'c3',
    name: '操作系统',
    teacher: '刘敏',
    room: '实验楼 C201',
    term: '2025-2026 秋',
    credit: 4,
    color: '#c494ff',
    rgb: '196 148 255',
    files: 27,
    notes: 9,
    progress: 0.45,
  },
  {
    id: 'c4',
    name: '线性代数',
    teacher: '赵启明',
    room: '教学楼 3-214',
    term: '2025-2026 秋',
    credit: 3,
    color: '#ffb36b',
    rgb: '255 179 107',
    files: 19,
    notes: 14,
    progress: 0.88,
  },
  {
    id: 'c5',
    name: '概率论与数理统计',
    teacher: '孙雅',
    room: '教学楼 2-108',
    term: '2025-2026 秋',
    credit: 3,
    color: '#ff8fb1',
    rgb: '255 143 177',
    files: 16,
    notes: 7,
    progress: 0.55,
  },
  {
    id: 'c6',
    name: '数据库系统原理',
    teacher: '周正',
    room: '信电楼 B210',
    term: '2025-2026 秋',
    credit: 3,
    color: '#8ee06a',
    rgb: '142 224 106',
    files: 23,
    notes: 11,
    progress: 0.7,
  },
]

export const courseOf = (id: string) => COURSES.find((c) => c.id === id)

/* ------------------------------- 文件 ------------------------------- */

export const FILES: Record<string, VaultFile[]> = {
  c1: [
    { name: '第06讲-平衡二叉树与AVL.md', kind: 'markdown', size: '18 KB', updated: '今天 14:20', tag: '笔记' },
    { name: '红黑树插入删除-图解.md', kind: 'markdown', size: '26 KB', updated: '昨天 21:05', tag: '笔记' },
    { name: 'graph_dijkstra.cpp', kind: 'code', size: '4.2 KB', updated: '昨天 16:40', tag: '实验' },
    { name: '作业3-图的最短路径.docx', kind: 'docx', size: '312 KB', updated: '10-28 09:12', tag: '作业' },
    { name: '历年期末真题(2019-2024).pdf', kind: 'pdf', size: '2.4 MB', updated: '10-25 20:31', tag: '试卷' },
    { name: '课件-第05讲-树与二叉树.pptx', kind: 'slides', size: '5.8 MB', updated: '10-21 10:02', tag: '资料' },
  ],
  c2: [
    { name: 'TCP三次握手与四次挥手.md', kind: 'markdown', size: '15 KB', updated: '今天 11:02', tag: '笔记' },
    { name: '拥塞控制算法对比.md', kind: 'markdown', size: '21 KB', updated: '昨天 19:44', tag: '笔记' },
    { name: 'socket_echo_server.py', kind: 'code', size: '2.8 KB', updated: '10-27 15:20', tag: '实验' },
    { name: 'Wireshark抓包实验报告.docx', kind: 'docx', size: '1.1 MB', updated: '10-26 22:10', tag: '作业' },
  ],
  c3: [
    { name: '进程调度算法总结.md', kind: 'markdown', size: '24 KB', updated: '昨天 23:18', tag: '笔记' },
    { name: '虚拟内存-页表与TLB.md', kind: 'markdown', size: '17 KB', updated: '10-29 20:00', tag: '笔记' },
    { name: 'banker_algorithm.c', kind: 'code', size: '3.6 KB', updated: '10-28 14:30', tag: '实验' },
    { name: '实验二-生产者消费者问题.docx', kind: 'docx', size: '486 KB', updated: '10-24 11:45', tag: '作业' },
  ],
  c4: [
    { name: '矩阵相似与对角化.md', kind: 'markdown', size: '19 KB', updated: '今天 09:40', tag: '笔记' },
    { name: '特征值速算技巧.md', kind: 'markdown', size: '8 KB', updated: '10-27 21:12', tag: '笔记' },
    { name: '线性代数期末复习提纲.pdf', kind: 'pdf', size: '1.6 MB', updated: '10-22 16:08', tag: '资料' },
  ],
  c5: [
    { name: '大数定律与中心极限定理.md', kind: 'markdown', size: '16 KB', updated: '10-29 19:22', tag: '笔记' },
    { name: '常见分布速查表.md', kind: 'markdown', size: '11 KB', updated: '10-20 18:00', tag: '笔记' },
    { name: '作业5-参数估计.docx', kind: 'docx', size: '224 KB', updated: '10-26 13:37', tag: '作业' },
  ],
  c6: [
    { name: '事务隔离级别与MVCC.md', kind: 'markdown', size: '28 KB', updated: '今天 16:05', tag: '笔记' },
    { name: '索引原理-B+树.md', kind: 'markdown', size: '22 KB', updated: '昨天 20:12', tag: '笔记' },
    { name: '课程设计-图书管理系统.sql', kind: 'code', size: '9.4 KB', updated: '10-28 17:50', tag: '实验' },
  ],
}

export const ALL_FILES: VaultFile[] = Object.values(FILES).flat()

export const RECENT_FILES: (VaultFile & { course: string; rgb: string })[] = [
  { ...FILES.c6[0], course: '数据库系统原理', rgb: '142 224 106' },
  { ...FILES.c1[0], course: '数据结构与算法', rgb: '111 156 255' },
  { ...FILES.c2[0], course: '计算机网络', rgb: '92 214 190' },
  { ...FILES.c3[0], course: '操作系统', rgb: '196 148 255' },
  { ...FILES.c4[0], course: '线性代数', rgb: '255 179 107' },
  { ...FILES.c5[0], course: '概率论与数理统计', rgb: '255 143 177' },
]

/* ------------------------------- 课表 ------------------------------- */

/** from: 第几节开始（1-10），span: 连续节数 */
export const SCHEDULE: ScheduleItem[] = [
  { day: 0, from: 1, span: 2, courseId: 'c1' },
  { day: 0, from: 5, span: 2, courseId: 'c4' },
  { day: 0, from: 9, span: 2, courseId: 'c6' },
  { day: 1, from: 3, span: 2, courseId: 'c2' },
  { day: 1, from: 7, span: 2, courseId: 'c5' },
  { day: 2, from: 1, span: 2, courseId: 'c3' },
  { day: 2, from: 3, span: 2, courseId: 'c1' },
  { day: 2, from: 5, span: 2, courseId: 'c4' },
  { day: 2, from: 9, span: 2, courseId: 'c2' },
  { day: 3, from: 3, span: 2, courseId: 'c6' },
  { day: 3, from: 7, span: 2, courseId: 'c5' },
  { day: 4, from: 1, span: 2, courseId: 'c2' },
  { day: 4, from: 5, span: 2, courseId: 'c3' },
  // 周末：一般只有少量课程，排课时也常被放到周末
  { day: 5, from: 1, span: 2, courseId: 'c6' },
  { day: 5, from: 3, span: 2, courseId: 'c3' },
  { day: 6, from: 5, span: 2, courseId: 'c1' },
  { day: 6, from: 7, span: 2, courseId: 'c5' },
]

export const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
/* 每节的开始时间。取自 WakeUp 截图里的作息表（共 12 节）。
   原来只有 10 节，而真实课表有 11-12 节的课，会画到网格外。 */
export const SLOTS = [
  '08:00',
  '09:00',
  '10:10',
  '11:10',
  '13:30',
  '14:30',
  '15:40',
  '16:40',
  '18:30',
  '19:30',
  '20:30',
  '21:25',
]

/* ------------------------------- 待办 ------------------------------- */

export const TODOS: Todo[] = [
  { id: 't1', title: '数据结构 作业3 · 图的最短路径实现', courseId: 'c1', due: '今天 23:59', dueTone: 'danger', priority: '高', done: false },
  { id: 't2', title: '操作系统 实验三预习报告', courseId: 'c3', due: '明天 18:00', dueTone: 'warn', priority: '高', done: false },
  { id: 't3', title: '复习线性代数 第五章 二次型', courseId: 'c4', due: '周五 20:00', dueTone: 'calm', priority: '中', done: false },
  { id: 't4', title: '计算机网络 抓包实验数据整理', courseId: 'c2', due: '周五 23:59', dueTone: 'calm', priority: '中', done: false },
  { id: 't5', title: '数据库 课程设计需求确认', courseId: 'c6', due: '11-05', dueTone: 'calm', priority: '中', done: false },
  { id: 't6', title: '概率论 作业5 参数估计提交', courseId: 'c5', due: '11-08', dueTone: 'calm', priority: '低', done: false },
  { id: 't7', title: '整理第05讲 树与二叉树的课件笔记', courseId: 'c1', due: '已完成', dueTone: 'calm', priority: '低', done: true },
  { id: 't8', title: '背诵网络层 常用协议与端口号', courseId: 'c2', due: '已完成', dueTone: 'calm', priority: '低', done: true },
]

/* ------------------------------- 灵感 ------------------------------- */

export const IDEAS: Idea[] = [
  {
    id: 'i1',
    text: '把「图的最短路径」做成可拖拽的节点画布，边权实时可改，Dijkstra 的每一步用涟漪动画展示。',
    at: '今天 16:42',
    tags: ['可视化', '算法'],
    color: '143 178 255',
  },
  {
    id: 'i2',
    text: '题库的错题能不能反向生成一张「知识薄弱点热力图」？按知识点聚合正确率，比单看错题更有用。',
    at: '今天 11:20',
    tags: ['题库', '统计'],
    color: '196 148 255',
  },
  {
    id: 'i3',
    text: '写个脚本把教务系统的课表页面导出成 CSV，避免每学期手动录入。',
    at: '昨天 22:05',
    tags: ['自动化'],
    color: '92 214 190',
  },
  {
    id: 'i4',
    text: '操作系统实验的银行家算法，可以用表格逐步演示"安全序列"的推导，比看代码直观。',
    at: '昨天 15:31',
    tags: ['实验', '可视化'],
    color: '255 168 120',
  },
  {
    id: 'i5',
    text: '灵感记录最好支持一个全局快捷键，随手记不需要先选课程、选标签，先落收件箱再说。',
    at: '10-28 09:14',
    tags: ['产品', '交互'],
    color: '255 143 177',
  },
  {
    id: 'i6',
    text: '期末复习时想按"老师划的重点"重新组织笔记顺序，而不是按时间。需要一个手动排序的重点清单。',
    at: '10-26 20:48',
    tags: ['复习'],
    color: '142 224 106',
  },
]

/* ------------------------------- 题库 ------------------------------- */

export const QUESTIONS: Question[] = [
  {
    id: 'q1',
    courseId: 'c1',
    type: '单选',
    stem: '在含有 n 个结点的二叉排序树中，查找失败时最多需要比较多少次关键字？',
    options: ['n / 2', 'log₂n', 'n', 'n - 1'],
    answer: [2],
    wrong: 3,
    accuracy: 0.62,
  },
  {
    id: 'q2',
    courseId: 'c2',
    type: '多选',
    stem: '下列关于 TCP 拥塞控制的说法，正确的有：',
    options: [
      '慢启动阶段拥塞窗口按指数增长',
      '拥塞避免阶段按线性增长',
      '收到三个重复 ACK 时直接回到慢启动',
      '超时重传时 ssthresh 减半',
    ],
    answer: [0, 1, 3],
    wrong: 2,
    accuracy: 0.48,
  },
  {
    id: 'q3',
    courseId: 'c3',
    type: '判断',
    stem: '在采用时间片轮转调度的系统中，时间片越短，系统开销越小。',
    options: ['正确', '错误'],
    answer: [1],
    wrong: 0,
    accuracy: 0.95,
  },
  {
    id: 'q4',
    courseId: 'c4',
    type: '单选',
    stem: '若 n 阶方阵 A 有 n 个互不相同的特征值，则 A 一定：',
    options: ['是正交矩阵', '可对角化', '是对称矩阵', '行列式为 0'],
    answer: [1],
    wrong: 1,
    accuracy: 0.8,
  },
  {
    id: 'q5',
    courseId: 'c6',
    type: '简答',
    stem: '简述 MySQL 中 MVCC 如何实现「可重复读」隔离级别，并说明它如何避免不可重复读。',
    options: [],
    answer: [],
    wrong: 4,
    accuracy: 0.35,
  },
  {
    id: 'q6',
    courseId: 'c5',
    type: '单选',
    stem: '设 X ~ N(0, 1)，则 P(|X| < 1.96) 约为：',
    options: ['0.68', '0.90', '0.95', '0.99'],
    answer: [2],
    wrong: 1,
    accuracy: 0.72,
  },
]

/* ------------------------------- 热力图 -------------------------------
   已迁到 src/data/heatmap.ts —— 那里存的是「每天 push 次数」而不是颜色档位，
   因为热力图现在要把次数显示在气泡里，只存档位会丢信息。 */

/* ------------------------------- 日历 -------------------------------
   这一节整块删掉了，两处都是"看起来是对的"的假数据：

   · `CAL_MONTH = { year: 2025, month: 11, … }` —— 月份网格写死，
     于是不管今天几号，界面永远显示 2025 年 11 月。
     现在按真实日期算：src/lib/monthGrid.ts
   · `CAL_EVENTS = [...]` —— 九个假节点。日历节点早就改从服务端读了
     （见 lib/useEvents.ts + calendar_events 表），这个数组只剩注释在引用，
     留着只会让人以为"日历里那些是它渲染的"。
   -------------------------------------------------------------------- */

/* ------------------------------- 统计快照 ------------------------------- */

export const STATS = {
  streak: 23,
  weekNotes: 9,
  pendingTodos: 6,
  accuracy: 0.68,
  questions: 268,
  ideas: 41,
}
