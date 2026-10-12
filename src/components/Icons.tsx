import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

const base = (p: P) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p,
})

export const IconQuestions = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19v14.5H6.5A2.5 2.5 0 0 0 4 21z" />
    <path d="M12 8.2a2 2 0 0 1 2.4 2c0 1.4-1.9 1.7-2.3 3" />
    <circle cx="12" cy="16.2" r="0.9" fill="currentColor" stroke="none" />
  </svg>
)

export const IconIdeas = (p: P) => (
  <svg {...base(p)}>
    <path d="M9.2 17.4h5.6M10 20.4h4" />
    <path d="M12 3.6a6 6 0 0 0-3.6 10.8c.5.4.8 1 .8 1.6v1.4h5.6v-1.4c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3.6Z" />
  </svg>
)

export const IconTodos = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 7.5l1.8 1.8L9.7 6" />
    <path d="M4.5 16.5l1.8 1.8 3.4-3.3" />
    <path d="M12.5 7.8h7M12.5 16.8h7" />
  </svg>
)

export const IconCalendar = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M3.5 10h17M8.5 3.5V6M15.5 3.5V6" />
    <circle cx="8.6" cy="14" r="1" fill="currentColor" stroke="none" />
    <circle cx="12.6" cy="14" r="1" fill="currentColor" stroke="none" />
    <circle cx="16.6" cy="14" r="1" fill="currentColor" stroke="none" />
  </svg>
)

export const IconCourses = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4.2 3.4 8.2 12 12.2l8.6-4z" />
    <path d="M6.4 10.4v4.4c0 1.6 2.5 2.9 5.6 2.9s5.6-1.3 5.6-2.9v-4.4" />
    <path d="M20.6 8.6v5.2" />
  </svg>
)

export const IconSchedule = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="4.8" width="17" height="15.6" rx="3" />
    <path d="M3.5 9.6h17M9.2 9.6v10.8M14.9 9.6v10.8" />
  </svg>
)

export const IconNotes = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 3.6h7.6L19 9v11.4H6z" />
    <path d="M13.4 3.6V9H19" />
    <path d="M9 12.6h6M9 16h4" />
  </svg>
)

export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.2" />
    <path d="m15.6 15.6 4 4" />
  </svg>
)

export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </svg>
)

export const IconBack = (p: P) => (
  <svg {...base(p)}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </svg>
)

export const IconSparkle = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z" />
  </svg>
)

export const IconGauge = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 16.5a8.5 8.5 0 1 1 16 0" />
    <path d="m12 13.5 4-3.6" />
    <circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" />
  </svg>
)

export const IconFlame = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3.6s4.8 3.6 4.8 8.2a4.8 4.8 0 0 1-9.6 0c0-1.5.6-2.7 1.3-3.6.5 1.1 1.5 1.7 2.3 1.7 0-2.6 1.2-5 1.2-6.3Z" />
  </svg>
)

export const IconFolder = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.6 7.2A2 2 0 0 1 5.6 5.2h3.3l1.7 2h7.8a2 2 0 0 1 2 2v8.6a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2z" />
  </svg>
)

export const IconSchool = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4.2 2.6 8.6 12 13l9.4-4.4L12 4.2Z" />
    <path d="M6.2 10.6v4.6c0 1.3 2.6 2.4 5.8 2.4s5.8-1.1 5.8-2.4v-4.6" />
  </svg>
)

export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3.8v11.4" />
    <path d="m7.6 10.8 4.4 4.4 4.4-4.4" />
    <path d="M4.6 19.4h14.8" />
  </svg>
)

export const IconUpload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 15.6V4.4M8.2 8.2 12 4.4l3.8 3.8" />
    <path d="M4.6 15v2.6a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2V15" />
  </svg>
)

export const IconChevron = (p: P) => (
  <svg {...base(p)}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </svg>
)

export const IconLogout = (p: P) => (
  <svg {...base(p)}>
    <path d="M14.4 7.6V5.8A1.8 1.8 0 0 0 12.6 4H6.2a1.8 1.8 0 0 0-1.8 1.8v12.4A1.8 1.8 0 0 0 6.2 20h6.4a1.8 1.8 0 0 0 1.8-1.8v-1.8" />
    <path d="M9.6 12h10.2" />
    <path d="m16.6 8.8 3.2 3.2-3.2 3.2" />
  </svg>
)

export const IconGithub = (p: P) => (
  <svg {...base(p)}>
    <path d="M9.3 20.4v-2.6c-2.6.5-3.2-1.1-3.2-1.1-.5-1.2-1.2-1.5-1.2-1.5-.9-.6.1-.6.1-.6 1 .1 1.6 1 1.6 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.7-1.4-2.3-.3-4.7-1.2-4.7-5.1 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.8-4.7 5.1.4.4.8 1.1.8 2.2v3.2" />
  </svg>
)

export const IconStar = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 4.2 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8z" />
  </svg>
)

export const IconRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 12a8 8 0 1 1-2.4-5.7" />
    <path d="M20 4.4v4.2h-4.2" />
  </svg>
)

export const IconLink = (p: P) => (
  <svg {...base(p)}>
    <path d="M10.2 13.8a4 4 0 0 0 5.7 0l2.9-2.9a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
    <path d="M13.8 10.2a4 4 0 0 0-5.7 0l-2.9 2.9a4 4 0 0 0 5.7 5.7l1.2-1.2" />
  </svg>
)

export const IconEdit = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.6 19.4h4l10-10a2.4 2.4 0 0 0-3.4-3.4l-10 10z" />
    <path d="m14.2 6.8 3.4 3.4" />
  </svg>
)

export const IconExternal = (p: P) => (
  <svg {...base(p)}>
    <path d="M13.6 4.6h5.8v5.8" />
    <path d="M19.4 4.6 11 13" />
    <path d="M18 14.2v4.2a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18.4V8a1.8 1.8 0 0 1 1.8-1.8h4.2" />
  </svg>
)

export const IconFile = (p: P) => (
  <svg {...base(p)}>
    <path d="M13.4 3.2H7.4a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.6z" />
    <path d="M13.4 3.2v5.4h5.2" />
  </svg>
)

export const IconImage = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="3" />
    <circle cx="8.6" cy="9.6" r="1.7" />
    <path d="m4.2 17.4 4.6-4.4a2 2 0 0 1 2.7 0l3.1 2.9m0 0 2.2-2a2 2 0 0 1 2.7 0l1.3 1.2m-6.2.8 2.6 2.4" />
  </svg>
)

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.6 7.2h14.8" />
    <path d="M9.4 7.2V5.6a1.6 1.6 0 0 1 1.6-1.6h2a1.6 1.6 0 0 1 1.6 1.6v1.6" />
    <path d="M6.6 7.2l.9 11a1.8 1.8 0 0 0 1.8 1.7h5.4a1.8 1.8 0 0 0 1.8-1.7l.9-11" />
    <path d="M10.4 10.8v5.6M13.6 10.8v5.6" />
  </svg>
)

export const IconUser = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8.4" r="3.9" />
    <path d="M4.8 20.2c.7-3.6 3.7-5.6 7.2-5.6s6.5 2 7.2 5.6" />
  </svg>
)

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="m4.5 12.5 5 5 10-11" />
  </svg>
)

export const IconCredits = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 3.4V12l7.4 4.3" />
  </svg>
)

export const ICON_MAP = {
  questions: IconQuestions,
  ideas: IconIdeas,
  todos: IconTodos,
  calendar: IconCalendar,
  courses: IconCourses,
  schedule: IconSchedule,
  notes: IconNotes,
  credits: IconCredits,
} as const

export type IconName = keyof typeof ICON_MAP
