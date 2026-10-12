import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 本地单人应用：只监听 127.0.0.1，绝不监听 0.0.0.0
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    open: false,
    // 临时目录、产物目录、**后端数据目录**不参与监听。
    //  · 浏览器 profile / esbuild 缓存这类文件被外部进程占用时会让 watcher
    //    抛 EBUSY 直接崩掉；Vite 自己的 `.<name>.<pid>.<hash>.tmpdir/` 同理。
    //  · server/data 是**后端写的运行时数据**（上传的文件就落在这里）。
    //    不忽略的话，每上传一个文件 watcher 就报一次变更 → 整页热重载，
    //    用户会看到"刚传完文件页面就刷新了"。这个坑很隐蔽：
    //    表现出来像前端 bug，实际是 watcher 扫到了后端的数据目录。
    watch: {
      ignored: [
        '**/.tmp/**',
        '**/dist/**',
        '**/.pnpm-store/**',
        '**/.npm-cache/**',
        '**/*.tmpdir/**',
        '**/.*.tmp',
        /* 数据目录一律不监听。原来只写了 data 和 data-test 两个**确切名字**，
           而测试常用 data-test-xxx 这种独立目录（为了不碰真实数据）——
           名字对不上，于是每上传一个文件就触发一次整页重载，
           表现出来是"上传完列表不刷新 / 测试莫名其妙失败"，很难查。 */
        '**/server/data/**',
        '**/server/data-*/**',
        '**/server/data-test/**',
      ],
    },
    // 后端就绪后，/api 会转发到本地 Node 服务
    proxy: {
      '/api': { target: 'http://127.0.0.1:5175', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
})
