# Project Overview
- Purpose: Riftbound trading card scanner app; captures cards via phone camera, identifies them, and exports inventory to CSV.
- Stack: Vite + React + TypeScript; Tailwind CSS + shadcn-ui; Radix UI primitives; tanstack/react-query; Supabase client; TensorFlow (tfjs + mobilenet) + tesseract.js for image/OCR; fuse.js for fuzzy search; sharp for image handling.
- Repo structure: `src` (components, contexts, data, hooks, integrations, lib, pages, types, utils), `public`, `scripts`, `supabase`; root config for Vite/Tailwind/TS/ESLint.
- Entry: `src/main.tsx` mounts `src/App.tsx`; CSS in `src/index.css`.