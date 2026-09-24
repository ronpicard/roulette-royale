import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative asset paths work on both username.github.io and /repository/ Pages sites.
  base: './',
  build: {
    rollupOptions: {
      output: { manualChunks: (id) => (id.includes('/node_modules/three/') ? 'three' : undefined) },
    },
  },
})
