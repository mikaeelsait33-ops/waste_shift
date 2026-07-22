import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const modulePath = id.replaceAll('\\', '/')

          if (modulePath.includes('/node_modules/react/')
            || modulePath.includes('/node_modules/react-dom/')
            || modulePath.includes('/node_modules/scheduler/')) {
            return 'react-vendor'
          }

          if (modulePath.includes('/node_modules/firebase/')
            || modulePath.includes('/node_modules/@firebase/')) {
            return 'firebase-vendor'
          }

          if (modulePath.includes('/node_modules/recharts/')
            || modulePath.includes('/node_modules/d3-')
            || modulePath.includes('/node_modules/victory-vendor/')) {
            return 'charts-vendor'
          }

          if (/\/src\/hooks\/use(InvoicePricing|MenuRecipes|StaffAccess|StoreRoom|WasteEntries)\.js$/.test(modulePath)) {
            return 'restaurant-operations'
          }

          return undefined
        },
      },
    },
  },
})
