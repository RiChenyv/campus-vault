import type { NavMeta, RouteId } from '../types'

/**
 * 站点地图唯一来源。
 * 圆环四段：angle 表示该段所在圆心角，0° = 12 点方向，顺时针递增。
 * 选中第 i 段时，整个圆环旋转 -angle，把该段转到正上方（转速带来"转盘"手感）。
 */
export const NAV: NavMeta[] = [
  {
    id: 'questions',
    label: '题库',
    sub: '资料库 · 站内查看',
    icon: 'questions',
    angle: 0,
    rgb: '143 178 255',
  },
  {
    id: 'ideas',
    label: '灵感',
    sub: '速记收件箱',
    icon: 'ideas',
    angle: -90,
    rgb: '255 168 120',
  },
  {
    id: 'todos',
    label: '待办',
    sub: 'DDL · 优先级',
    icon: 'todos',
    angle: -180,
    rgb: '92 214 190',
  },
  {
    id: 'calendar',
    label: '日历',
    sub: '月度总览 · 热力图',
    icon: 'calendar',
    angle: -270,
    rgb: '196 148 255',
  },
]

/** 右侧三条玻璃胶囊：课程知识库主入口 */
export const PILLS: NavMeta[] = [
  {
    id: 'courses',
    label: '我的课程',
    /* 这个数字**由页面实时算**（见 PillNav 的 liveSub）。
       写死的值迟早和真实课程数不符 ——「我的课表」那条就是因为这个被删掉的。 */
    sub: '',
    icon: 'courses',
    angle: 0,
    rgb: '143 178 255',
  },
  {
    id: 'schedule',
    label: '我的课表',
    // 这条副标题已删除：写死的数字（18 节课 / 周三最满）与真实课表不符，
    // 而为了让它准确去建一套实时统计又不成比例。空串表示不显示。
    sub: '',
    icon: 'schedule',
    angle: 0,
    rgb: '92 214 190',
  },
  {
    id: 'notes',
    label: '我的笔记',
    /* 同上，由 liveSub 实时算 */
    sub: '',
    icon: 'notes',
    angle: 0,
    rgb: '196 148 255',
  },
]

/** 二级页面：不在圆环/胶囊上，但需要标题栏信息（Shell 通过 NAV_BY_ID 查找） */
export const SUB_PAGES: NavMeta[] = [
  {
    id: 'course-detail',
    label: '课程详情',
    sub: '笔记 · 题库 · 教师 · 课表位置',
    icon: 'courses',
    angle: 0,
    rgb: '143 178 255',
  },
  {
    id: 'credits',
    label: '学分总览',
    sub: '占比扇形图 · 已修学分 · 成绩明细',
    icon: 'credits',
    angle: 0,
    rgb: '92 214 190',
  },
]

export const NAV_BY_ID: Record<string, NavMeta> = Object.fromEntries(
  [...NAV, ...PILLS, ...SUB_PAGES].map((n) => [n.id, n]),
)

export const isRingRoute = (id: RouteId) => NAV.some((n) => n.id === id)

/**
 * 胶囊副标题的**实时**文案。
 *
 * NAV/PILLS 是静态站点地图，但副标题里的数字必须来自数据库 ——
 * 凡是写死的数字，早晚会和真实情况不符（「我的课表」那条
 * "18 节课 · 周三最满"就是因为对不上而被删掉的）。
 *
 * 拿不到数据时返回空串：**宁可什么都不显示，也不要显示错的**。
 */
export function liveSub(
  id: RouteId | string,
  data: { courseCount: number; week: number; noteFiles: number; writtenNotes: number },
): string {
  if (id === 'courses') {
    if (!data.courseCount) return ''
    return `${data.courseCount} 门在修 · 本学期第 ${data.week} 周`
  }
  if (id === 'notes') {
    // "笔记"= 手写的 + 上传的文件。两个都算，用户不会去区分来源
    const total = data.noteFiles + data.writtenNotes
    if (!total) return ''
    return data.writtenNotes
      ? `${total} 份笔记（${data.writtenNotes} 篇手写）`
      : `${total} 份笔记`
  }
  return ''
}
