import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Lyssna på alla nätverksgränssnitt (0.0.0.0 / lokalt nätverk)
    port: 5173,
    open: false,
  },
});
