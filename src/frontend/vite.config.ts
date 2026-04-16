/// <reference types="vitest/config" />

import { defineConfig, type UserConfig } from 'vite'
import type { InlineConfig } from 'vitest/node'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

const config: UserConfig & { test: InlineConfig } = {
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    globals: true,
  },
}

export default defineConfig(config)
