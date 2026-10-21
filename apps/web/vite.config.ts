import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.OPENDOTS_PORT ?? 4317}`, changeOrigin: false } },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Découpage des dépendances lourdes : meilleur cache et chargement parallèle.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/](ai|@ai-sdk[\\/][^\\/]+|zod|eventsource-parser)[\\/]/.test(id)) return 'ai-sdk';
          if (/shiki|oniguruma|@streamdown[\\/]code/.test(id)) return undefined;
          if (/streamdown|micromark|mdast|hast|unified|remark|rehype|parse5|marked|entities|unist|vfile|property-information/.test(id)) return 'markdown';
          if (/radix-ui|@radix-ui|@floating-ui/.test(id)) return 'ui';
          return undefined;
        },
      },
    },
  },
});
