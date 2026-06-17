// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
// Static output — all pages pre-rendered at build time.
// The /api/reviews endpoint is handled by a native Cloudflare Pages Function
// in /functions/api/reviews.js — no adapter needed.
export default defineConfig({
  site: 'https://mcqticker.online',
  output: 'static',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});