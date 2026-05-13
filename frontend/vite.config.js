import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { VantResolver } from '@vant/auto-import-resolver';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    vue(),
    Components({
      resolvers: [VantResolver()]
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  // 构建产物输出到 ../public/,Express 直接托管
  build: {
    outDir: path.resolve(__dirname, '../public'),
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
    // chunk 大小提示阈值
    chunkSizeWarningLimit: 800
  },
  // 开发模式代理到后端
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3201',
        changeOrigin: true
      }
    }
  }
});
