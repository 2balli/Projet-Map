import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';

/**
 * LE FOND DE CARTE EN DÉVELOPPEMENT — le même chemin `/fond-carte/` que
 * `scripts/serve.mjs`, servi depuis `maroc-carte-offline/donnees/` avec les
 * requêtes partielles qu'exige l'archive PMTiles. Rien n'est copié : 550 Mo de
 * tuiles n'ont rien à faire dans `public/` ni dans `dist/`.
 */
const FOND_CARTE = resolve('maroc-carte-offline/donnees');
const fondCarte = () => ({
  name: 'fond-carte',
  configureServer(server) {
    server.middlewares.use('/fond-carte', (req, res, next) => {
      const relatif = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
      const cible = normalize(join(FOND_CARTE, relatif));
      if (!cible.startsWith(FOND_CARTE + sep)) return next();
      let info;
      try {
        info = statSync(cible);
        if (!info.isFile()) return next();
      } catch {
        res.statusCode = 404;
        return res.end();
      }
      res.setHeader('Accept-Ranges', 'bytes');
      const plage = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      if (plage && (plage[1] || plage[2])) {
        const debut = plage[1] ? Number(plage[1]) : Math.max(0, info.size - Number(plage[2]));
        const fin = Math.min(plage[1] && plage[2] ? Number(plage[2]) : info.size - 1, info.size - 1);
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${debut}-${fin}/${info.size}`);
        res.setHeader('Content-Length', fin - debut + 1);
        return createReadStream(cible, { start: debut, end: fin }).pipe(res);
      }
      res.setHeader('Content-Length', info.size);
      return createReadStream(cible).pipe(res);
    });
  },
});

export default defineConfig({
  /**
   * Chemins relatifs dans le build : l'application fonctionne quel que soit
   * le sous-répertoire où elle est déployée sur l'intranet
   * (http://serveur/ comme http://serveur/carte/), sans reconfiguration.
   */
  base: './',
  plugins: [react(), tailwindcss(), fondCarte()],
  server: {
    port: 5173,
    open: true,
    /**
     * En développement, Vite ne sert que les fichiers : l'API d'habilitation
     * vit dans le serveur Node (`npm run serve:api`). Le mandataire évite
     * d'avoir deux origines — donc pas de CORS, et le cookie de session
     * `SameSite=Strict` continue de fonctionner comme en production.
     */
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: false,
      },
    },
  },
});
