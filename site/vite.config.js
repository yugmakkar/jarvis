import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The only servers the published page may contact. The browser enforces this list.
const CONNECT = ['https://somafm.com', 'https://api.open-meteo.com', 'https://geocoding-api.open-meteo.com', 'https://en.wikipedia.org',
  'https://hacker-news.firebaseio.com', 'https://api.dictionaryapi.dev', 'https://icanhazdadjoke.com',
  'https://api.frankfurter.dev', 'https://api.mymemory.translated.net', 'http://localhost:11434'];
const CSP = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; ` +
  `connect-src 'self' ${CONNECT.join(' ')}; object-src 'none'; base-uri 'none'; form-action 'none'`;

export default defineConfig(({ command }) => ({
  base: './',   // relative paths, so the build works at any URL (GitHub Pages serves it under /jarvis/)
  plugins: [
    react(),
    {
      name: 'csp-on-build',   // the dev server needs inline scripts for hot reload, so the policy is added to real builds only
      transformIndexHtml: html => command === 'build'
        ? html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`)
        : html,
    },
  ],
}));
