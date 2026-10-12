import { useCallback, useEffect, useRef, useState } from 'react'
import { fileToAvatar } from './avatar'
import { updateProfile, type SessionUser } from './auth'
import { api } from './api'
import { upload } from './vaultStore'

/** 原型阶段存在 localStorage 的键。现在都归服务端管，启动时清掉。 */
const LEGACY_KEYS = ['cv.username', 'cv.github', 'cv.avatar', 'cv.avatarName']

/**
 * 个人资料：用户名 + 头像 + GitHub 用户名。
 *
 * ── 这里原来存 localStorage，是个数据隔离 bug ──
 * 原型阶段没有账号体系，`cv.username` / `cv.avatar` / `cv.github` 都是
 * **浏览器级**的键。接入登录后它们没有跟着改，于是：
 *   · 同一浏览器里登录任何账号，看到的都是同一份资料
 *   · 在 A 账号改名字，B 账号（包括管理员）也跟着变
 *   · 而且这些改动**从未发到服务端** —— 换台设备就全没了
 *
 * 现在以服务端为准：读 `auth.session.user`，写走 `PATCH /api/auth/profile`。
 * 后端那边本来就按 user_id 隔离，还会校验"头像文件必须属于本人"。
 *
 * 头像走的流程：本地裁成正方形 → 作为文件上传（scope='avatar'）→
 * 把返回的 fileId 写进 profile。这样它和其它资料一样有归属，也支持多端同步。
 */

export interface ProfileAuth {
  user: SessionUser | null
  /** 写完资料后重新拉一次 /auth/me，让全局状态跟上 */
  refreshUser: () => Promise<unknown>
}

/**
 * 头像地址。
 *
 * ⚠️ 这里**不能**直接返回 `/api/files/<id>/raw`：
 * 那个地址会被塞进 `<img src>`，而 <img> 发不出 Authorization 头，
 * 只能依赖 cookie —— 按标签页独立会话之后，cookie 未必是当前标签页的账号，
 * 于是"取自己的头像"变成"用别人的身份取自己的文件"，服务端按归属校验返回 404，
 * 头像就显示成空白。
 *
 * 所以改为：用带鉴权头的 fetch 拿 Blob，再转成 object URL。
 * 代价是多一次请求 + 要管生命周期（revoke），换来的是身份一定正确。
 */
function useAvatarUrl(fileId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!fileId) {
      setUrl(null)
      return
    }
    let alive = true
    let objectUrl: string | null = null
    api
      .blob(`/files/${encodeURIComponent(fileId)}/raw`)
      .then((blob) => {
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (alive) setUrl(null)
      })
    return () => {
      alive = false
      // 不 revoke 会一直占着内存，换几次头像就积起来了
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fileId])

  return url
}

export function useProfile(auth: ProfileAuth) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 唯一真相是会话里的用户对象，组件不再自己存一份
  const username = auth.user?.username ?? ''
  const github = auth.user?.github ?? ''
  const avatarFileId = auth.user?.avatarFileId ?? null
  /* 头像走带鉴权头的拉取，不用裸 URL —— 原因见 useAvatarUrl 的注释 */
  const avatarBlobUrl = useAvatarUrl(avatarFileId)

  const { refreshUser } = auth

  /* 清掉遗留的浏览器级资料键。
     不清的话它们会一直躺在 localStorage 里：头像那条可能是几百 KB 的
     data URL，而 `cv.username` 还会让人误以为"资料是存在本地的"。 */
  useEffect(() => {
    for (const k of LEGACY_KEYS) {
      try {
        localStorage.removeItem(k)
      } catch {
        /* 隐私模式读不了 localStorage，忽略 */
      }
    }
  }, [])

  /** 统一的写入口：失败要报出来，不能静默吞掉 —— 用户会以为改成功了 */
  const save = useCallback(
    async (patch: Parameters<typeof updateProfile>[0], what: string) => {
      setBusy(true)
      setError(null)
      try {
        await updateProfile(patch)
        await refreshUser()
        return true
      } catch (e) {
        setError(e instanceof Error ? `${what}失败：${e.message}` : `${what}失败`)
        return false
      } finally {
        setBusy(false)
      }
    },
    [refreshUser],
  )

  const setUsername = useCallback(
    (v: string) => {
      const name = v.trim().slice(0, 14)
      // 空名字直接忽略：后端允许空串，但界面上会变成一片空白，不好恢复
      if (!name || name === username) return
      void save({ username: name }, '改名')
    },
    [username, save],
  )

  /** 传空字符串表示清空（清空后 GitHub 页会回到"未配置"状态） */
  const setGithub = useCallback(
    (v: string) => {
      const login = v.trim()
      if (login === github) return
      void save({ github: login }, '保存 GitHub')
    },
    [github, save],
  )

  const pick = useCallback(() => {
    setError(null)
    inputRef.current?.click()
  }, [])

  const onFile = useCallback(
    async (file?: File | null) => {
      if (!file) return
      setBusy(true)
      setError(null)
      try {
        // 先在本地裁成正方形并压到合理体积，避免把几 MB 的原图传上去
        const prepared = await fileToAvatar(file)
        if (!prepared.dataUrl) throw new Error('这张图片无法处理')

        // dataURL → Blob，再当成普通文件上传
        const blob = await fetch(prepared.dataUrl).then((r) => r.blob())
        const ext = (prepared.dataUrl.match(/^data:image\/(\w+)/)?.[1] ?? 'png').replace('jpeg', 'jpg')
        const item = await upload(new File([blob], `avatar.${ext}`, { type: blob.type }), { scope: 'avatar' })

        await updateProfile({ avatarFileId: item.id })
        await refreshUser()
      } catch (e) {
        if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) {
          setError('图片太大，换一张小一点的试试')
        } else {
          setError(e instanceof Error ? `换头像失败：${e.message}` : '换头像失败')
        }
      } finally {
        setBusy(false)
        // 清空 input，否则连续选同一个文件不会再触发 change
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [refreshUser],
  )

  const reset = useCallback(() => {
    if (!avatarFileId) return
    void save({ avatarFileId: null }, '清除头像')
  }, [avatarFileId, save])

  /**
   * 保存在校信息。
   * 学校门户页只给姓名和学院，学号/专业/年级/班级那边根本没有，
   * 所以这几个字段**必须能手填**。
   * 与导入不冲突：导入只填补空字段，不会覆盖这里手填的内容。
   */
  const setSchool = useCallback(
    (v: { realName: string; studentId: string; college: string; major: string; grade: string; className: string }) =>
      save(
        {
          realName: v.realName.trim().slice(0, 40),
          studentId: v.studentId.trim().slice(0, 32),
          college: v.college.trim().slice(0, 60),
          major: v.major.trim().slice(0, 60),
          grade: v.grade.trim().slice(0, 20),
          className: v.className.trim().slice(0, 40),
        },
        '保存在校信息',
      ),
    [save],
  )

  return {
    username,
    github,
    /** 保留 dataUrl 这个字段名，调用方（AvatarFace 等）当作普通 img src 用即可。
        实际拿到的是 blob: URL —— 和普通 URL 用法完全一样。 */
    avatar: { dataUrl: avatarBlobUrl },
    /** 在校信息，供个人中心展示与编辑 */
    school: {
      realName: auth.user?.realName ?? '',
      studentId: auth.user?.studentId ?? '',
      college: auth.user?.college ?? '',
      major: auth.user?.major ?? '',
      grade: auth.user?.grade ?? '',
      className: auth.user?.className ?? '',
      importedAt: auth.user?.importedAt ?? null,
    },
    busy,
    error,
    pick,
    onFile,
    reset,
    inputRef,
    setUsername,
    setGithub,
    setSchool,
  }
}
