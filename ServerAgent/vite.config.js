import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()], server: { port: 8798, proxy: { '/api': 'http://127.0.0.1:8797' } }, build: { outDir: 'dist', emptyOutDir: true } })
