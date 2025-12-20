import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
              if (id.includes('react')) return 'vendor_react'
              if (id.includes('ethers')) return 'vendor_ethers'
              if (id.includes('web3modal')) return 'vendor_web3modal'
              return 'vendor'
            }
        }
      }
    }
  }
})
