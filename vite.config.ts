import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// Dev-only: run the UI in a plain browser against the synthetic fixture.
// `VITE_PREVIEW=1 npm run dev`. Never set for `tauri build`.
const preview = process.env.VITE_PREVIEW === '1'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
      ...(preview
        ? {
            '@tauri-apps/plugin-sql': path.resolve(rootDir, './dev/preview/plugin-sql.ts'),
            '@tauri-apps/api/core': path.resolve(rootDir, './dev/preview/tauri-core.ts'),
          }
        : {}),
    },
  },
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    open: false,
  },
  envPrefix: ['VITE_'],
  build: {
    target: 'es2022',
  },
})
