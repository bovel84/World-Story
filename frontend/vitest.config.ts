import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Il root del workspace non ha react: forza la risoluzione ai pacchetti del frontend.
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    // Inline zustand nel transform di vite: l'alias react si applica anche ai suoi import.
    server: { deps: { inline: ['zustand'] } },
  },
});
