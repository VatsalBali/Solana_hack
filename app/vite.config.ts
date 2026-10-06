import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// web3.js and Anchor expect Node's Buffer in the browser.
export default defineConfig({
  plugins: [react(), nodePolyfills({ include: ['buffer'], globals: { Buffer: true } })],
})
