# Carte opérationnelle hors ligne de la Gendarmerie Royale — image autonome.
#
# L'image contient tout : l'application compilée, les tuiles du Royaume et les
# couches de la Gendarmerie (dossier donnees/, préparé sur ce poste par
# « npm run data » et « npm run gendarmerie »). Elle fonctionne sans aucune
# connexion : voir docker/LISEZMOI.md et « npm run transfert ».

# ── 1. Compilation de l'application (Vite) ─────────────────────────────────
FROM node:22-alpine AS compilation
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html connexion.html vite.config.js ./
COPY src ./src
RUN npm run build

# ── 2. Exécution : Node seul, le serveur n'a aucune dépendance ─────────────
FROM node:22-alpine
LABEL org.opencontainers.image.title="carte-gendarmerie" \
      org.opencontainers.image.description="Carte opérationnelle hors ligne de la Gendarmerie Royale"
WORKDIR /app
COPY serveur.mjs ./
# API des comptes et des conflits (serveur/) et modules partagés sans dépendance (src/).
COPY serveur ./serveur
COPY src ./src
COPY scripts/comptes.mjs ./scripts/comptes.mjs
COPY --from=compilation /app/dist ./dist
COPY donnees ./donnees
# Écoute sur toutes les interfaces du conteneur, port 5555.
ENV HOTE=0.0.0.0 \
    PORT=5555 \
    NODE_ENV=production
# Comptes, conflits et journal d'audit : hors de l'image, sur un volume (jamais servis).
ENV ETAT=/app/etat
RUN mkdir -p /app/etat && chown node:node /app/etat
VOLUME /app/etat
USER node
EXPOSE 5555
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/connexion.html').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "serveur.mjs", "--sans-navigateur"]
