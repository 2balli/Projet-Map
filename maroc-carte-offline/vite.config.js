import { defineConfig } from 'vite';

// `donnees/` (≈ 540 Mo de tuiles, polices, icônes) est servi tel quel en
// développement, mais n'est pas recopié dans `dist/` : en production,
// serveur.mjs sert les deux dossiers côte à côte.
export default defineConfig({
  publicDir: 'donnees',
  build: {
    copyPublicDir: false,
    chunkSizeWarningLimit: 1500,
    // Deux pages : la carte et la page de connexion (seule servie sans session par serveur.mjs).
    rollupOptions: { input: { index: 'index.html', connexion: 'connexion.html' } },
  },
  // Le worker de MapLibre 6 est un module ES : il est regroupé avec ses dépendances.
  worker: { format: 'es' },
  server: { port: 5174 },
});
