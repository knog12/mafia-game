// client/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/', // هذا يضمن أن المسار يبدأ من الجذر (الضروري لقراءة الأصوات)
  build: {
    assetsInlineLimit: 0, // يضمن عدم تحويل الملفات الصغيرة لضمان عملها كملفات منفصلة
  },
});