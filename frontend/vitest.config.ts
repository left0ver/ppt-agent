import type { UserConfigExport } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

const babelPlugin = await babel({ presets: [reactCompilerPreset()] })

export default {
  plugins: [
    react(),
    babelPlugin,
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
} satisfies UserConfigExport & {
  test: {
    environment: 'jsdom'
    setupFiles: string
    css: boolean
  }
}
