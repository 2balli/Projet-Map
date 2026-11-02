#!/usr/bin/env node
/**
 * NOTIFICATIONS, LECTURE, PERMISSIONS ET WORKFLOW D'ASSIGNATION — DE BOUT EN BOUT.
 *
 * Même méthode que scripts/verifier-modification-barrage.mjs : le script lance
 * SON service sur une COPIE du jeu de démonstration et ne lui parle que par
 * HTTP. Rien n'est simulé : chaque notification vérifiée est née d'une vraie
 * écriture (assignation, changement de faction, déplacement validé).
 *
 *   node scripts/verifier-notifications-service.mjs
 *   npm run check:notifications:service
 *
 *   1. une assignation génère une notification réelle, vue par la région du
 *      barrage et pas par une autre ;
 *   2. ouverte, elle quitte les non lues… 3. …et reste dans l'historique ;
 *   4. marquer lue une notification hors périmètre est refusé ;
 *   5. le suivi du workflow est réservé au Super Admin, et lu en base :
 *      en attente → (faction changée) terminé ; en attente → (déplacement
 *      demandé) en cours → (validé) terminé ;
 *   6. le Super Admin ne peut toujours pas modifier un barrage ;
 *   7. une seule notification pour une opération qui écrit plusieurs lignes ;
 *   8. le flux temps réel pousse l'événement sans recharger.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chargerComptes, definirCompte, enregistrerComptes } from '../serveur/comptes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8550 + (process.pid % 250);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'Essai-Notif-2026';

let ok = 0;
const echecs = [];
const dit = (bon, titre, detail = '') => {
  console.log(`  ${bon ? 'RÉUSSI ' : 'ÉCHOUÉ '} ${titre}${detail ? ' — ' + detail : ''}`);
  if (bon) ok++;
  else echecs.push(titre);
};
const titre = (t) => console.log(`\n=== ${t} ===`);
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Données d'épreuve : copie de la démonstration, trois barrages libres */
/* ------------------------------------------------------------------ */

const source = resolve(ROOT, 'donnees-demo');
const travail = mkdtempSync(join(tmpdir(), 'gr-notif-service-'));
const DONNEES = join(travail, 'donnees');
cpSync(source, DONNEES, { recursive: true, filter: (f) => !/sauvegardes|\.avant-/.test(f) });
rmSync(join(DONNEES, 'notifications.json'), { force: true });

const lireJson = (nom) => JSON.parse(readFileSync(join(DONNEES, nom), 'utf8'));
const assignesOuverts = new Set(
  (lireJson('instructions.json').items ?? []).filter((i) => i.statut === 'ouverte').map((i) => i.barrageId),
);
const estIntouchable = (m) => m?.protection === 'intouchable' || m?.intouchable === true;
const libres = lireJson('marquages.json').items.filter(
  (m) => m.type === 'barrage_fixe' && m.bt && m.cie && m.reg && !estIntouchable(m) &&
    (m.statutBarrage ?? 'approuve') !== 'supprime' && m.statutBarrage !== 'retire_optimisation' &&
    !assignesOuverts.has(m.id),
);
let REGION = null;
for (const reg of [...new Set(libres.map((m) => m.reg))].sort()) {
  if (libres.filter((m) => m.reg === reg).length >= 3) {
    REGION = reg;
    break;
  }
}
if (!REGION) {
  console.error('\nAucune région du jeu ne se prête à l’épreuve.\n');
  process.exit(1);
}
const [B, C, D] = libres.filter((m) => m.reg === REGION);
const autre = libres.find((m) => m.reg !== REGION);
console.log(`  région ${REGION} — barrages ${B.id}, ${C.id}, ${D.id}`);

{
  const f = join(DONNEES, 'comptes.json');
  const etat = chargerComptes(f);
  const compte = (o) => definirCompte(etat, { role: 'commandement', code: CODE, doitChanger: false, ...o });
  await compte({ matricule: 'NOTIF-ADMIN', rang: 'admin', unite: 'notif-admin', nom: 'Admin épreuve' });
  await compte({ matricule: 'NOTIF-REG', rang: 'reg', unite: REGION, nom: 'CMND Région épreuve' });
  await compte({ matricule: 'NOTIF-REG2', rang: 'reg', unite: autre.reg, nom: 'CMND autre région' });
  await compte({ matricule: 'NOTIF-CIE', rang: 'cie', unite: B.cie, reg: REGION, nom: 'CMND Cie épreuve' });
  await compte({ matricule: 'NOTIF-BT', rang: 'unite', unite: B.bt, cie: B.cie, reg: REGION, nom: 'CMND Brigade épreuve' });
  enregistrerComptes(f, etat);
}

/* ------------------------------------------------------------------ */
/* Service                                                            */
/* ------------------------------------------------------------------ */

const service = spawn(
  process.execPath,
  [join(ROOT, 'scripts', 'serve.mjs'), '--port', String(PORT), '--host', '127.0.0.1', '--donnees', DONNEES],
  { cwd: ROOT },
);
let sortieService = '';
service.stdout.on('data', (d) => (sortieService += d));
service.stderr.on('data', (d) => (sortieService += d));
let debout = false;
for (let i = 0; i < 360 && service.exitCode === null; i++) {
  try {
    if ((await fetch(`${BASE}/api/etat`, { signal: AbortSignal.timeout(3000) })).ok) {
      debout = true;
      break;
    }
  } catch {
    /* pas encore */
  }
  await attendre(250);
}
if (!debout) {
  console.error('\nLe service ne démarre pas.\n' + sortieService);
  service.kill();
  rmSync(travail, { recursive: true, force: true });
  process.exit(1);
}

async function ouvrir(matricule) {
  const r = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte' },
    body: JSON.stringify({ matricule, code: CODE }),
  });
  if (!r.ok) throw new Error(`connexion ${matricule} : HTTP ${r.status}`);
  return { matricule, cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') };
}
async function appel(s, chemin, { methode = 'GET', corps } = {}) {
  const r = await fetch(BASE + chemin, {
    method: methode,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte', Cookie: s.cookie },
    body: corps ? JSON.stringify(corps) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  return { statut: r.status, ...(await r.json().catch(() => ({}))) };
}
const notifications = (s) => appel(s, '/api/notifications');
const suivi = async (admin, barrageId) =>
  (await appel(admin, '/api/assignations/suivi')).items?.find((x) => x.barrageId === barrageId) ?? null;
const assignationDe = async (s, barrageId) =>
  (await appel(s, '/api/assignations')).aTraiter?.find((a) => a.barrageId === barrageId) ?? null;

try {
  const admin = await ouvrir('NOTIF-ADMIN');
  const reg = await ouvrir('NOTIF-REG');
  const reg2 = await ouvrir('NOTIF-REG2');
  const cie = await ouvrir('NOTIF-CIE');
  const bt = await ouvrir('NOTIF-BT');

  /* ---------------------------------------------------------------- */
  titre('1 — une modification génère une notification réelle');
  const avantReg = await notifications(reg);
  dit(avantReg.statut === 200 && avantReg.nonLues === 0, 'aucune notification avant toute écriture', `nonLues ${avantReg.nonLues}`);
  const a = await appel(admin, '/api/barrages/assigner', { methode: 'POST', corps: { ids: [B.id, C.id], texte: 'Épreuve notifications' } });
  dit(a.statut === 201 && a.assignees?.length === 2, 'le Super Admin assigne deux barrages', `HTTP ${a.statut} ${a.erreur ?? ''}`);
  const n1 = await notifications(reg);
  const nB = n1.items?.find((n) => n.barrageId === B.id && n.type === 'assignation');
  dit(Boolean(nB) && nB.lue === false, 'le CMND Région reçoit l’assignation, non lue');
  dit(n1.nonLues === 2, 'badge : deux non lues', `nonLues ${n1.nonLues}`);
  dit(Boolean(nB?.titre && nB?.description && nB?.cree && nB?.acteur?.matricule === 'NOTIF-ADMIN' && nB?.barrage?.nom !== undefined),
    'titre, description, date, auteur et barrage renseignés');
  dit((await notifications(reg2)).items?.every((n) => n.barrageId !== B.id), 'une autre région ne la voit pas');
  dit((await notifications(admin)).items?.every((n) => n.acteur?.matricule !== 'NOTIF-ADMIN'), 'le Super Admin ne se notifie pas lui-même');
  dit((await notifications(bt)).items?.some((n) => n.barrageId === B.id), 'la brigade du barrage en est informée');

  /* ---------------------------------------------------------------- */
  titre('2 et 3 — ouverte, elle quitte les non lues et reste dans l’historique');
  const lue = await appel(reg, `/api/notifications/${nB.id}/lue`, { methode: 'POST' });
  dit(lue.statut === 200 && lue.item?.lue === true && lue.nonLues === 1, 'marquée lue', `HTTP ${lue.statut} nonLues ${lue.nonLues}`);
  const n2 = await notifications(reg);
  dit(n2.items.filter((n) => !n.lue).every((n) => n.id !== nB.id), 'absente des non lues');
  dit(n2.items.some((n) => n.id === nB.id && n.lue), 'présente dans l’historique, marquée lue');
  dit((await notifications(bt)).items.find((n) => n.id === nB.id)?.lue === false, 'toujours non lue pour un autre compte');

  /* ---------------------------------------------------------------- */
  titre('4 — permissions de lecture');
  const intrus = await appel(reg2, `/api/notifications/${nB.id}/lue`, { methode: 'POST' });
  dit(intrus.statut === 404, 'marquer lue une notification hors périmètre : refusé', `HTTP ${intrus.statut}`);
  const anonyme = await fetch(`${BASE}/api/notifications`);
  dit(anonyme.status === 401, 'sans session : 401', `HTTP ${anonyme.status}`);
  dit((await appel(reg, '/api/assignations/suivi')).statut === 403, 'le suivi du workflow est refusé au CMND Région');
  dit((await appel(cie, '/api/assignations/suivi')).statut === 403, 'et au CMND Cie');

  /* ---------------------------------------------------------------- */
  titre('5a — workflow : en attente → faction changée → terminé');
  let sB = await suivi(admin, B.id);
  dit(sB?.statut === 'en_attente' && sB?.responsable?.unite === REGION, 'assigné, rien fait : en attente', `${sB?.statut}`);
  const factionCible = ['F1', 'F2', 'F3', 'F4'].find((f) => f !== (B.factionId || null));
  const aB = await assignationDe(reg, B.id);
  const t = await appel(reg, `/api/assignations/${aB.id}/traiter`, { methode: 'POST', corps: { factionId: factionCible, commentaire: 'épreuve' } });
  dit(t.statut === 200 && t.assignation?.statut === 'traitee', 'le CMND Région traite : faction changée', `HTTP ${t.statut} ${t.erreur ?? ''}`);
  sB = await suivi(admin, B.id);
  dit(sB?.statut === 'termine' && sB?.sansModification === false, 'suivi : terminé, opération enregistrée', `${sB?.statut}`);
  dit(sB?.historique?.some((h) => h.libelle === 'Faction changée'), 'l’historique porte le changement de faction');
  dit(sB?.barrage?.factionId === factionCible, 'l’état du barrage reflète la base', sB?.barrage?.factionId);

  titre('7 — une seule notification pour une seule opération');
  const pourB = (await notifications(admin)).items.filter((n) => n.barrageId === B.id && n.acteur?.matricule === 'NOTIF-REG');
  dit(pourB.length === 1, 'changement de faction + clôture = une notification', `${pourB.length} : ${pourB.map((n) => n.type).join(', ')}`);
  dit((await notifications(bt)).items.some((n) => n.barrageId === B.id && n.acteur?.matricule === 'NOTIF-REG'),
    'la brigade est notifiée du changement');

  /* ---------------------------------------------------------------- */
  titre('5b — workflow : déplacement demandé (en cours) → validé (terminé)');
  const dep = await appel(reg, `/api/marquages/${C.id}`, { methode: 'PATCH', corps: { lng: C.lng + 0.0015, lat: C.lat + 0.0015 } });
  dit(dep.statut === 202 && dep.enAttente, 'le déplacement part en validation', `HTTP ${dep.statut} ${dep.erreur ?? ''}`);
  let sC = await suivi(admin, C.id);
  dit(sC?.statut === 'en_cours' && sC?.demandesEnAttente >= 1, 'suivi : en cours, pas terminé avant validation', `${sC?.statut}`);
  dit(Boolean(await assignationDe(reg, C.id)), 'l’assignation reste ouverte tant que rien n’est appliqué');
  const acc = await appel(admin, `/api/instructions/${dep.demande?.id}`, { methode: 'PATCH', corps: { action: 'accepter', commentaire: 'épreuve' } });
  dit(acc.statut === 200, 'le Super Admin valide le déplacement', `HTTP ${acc.statut} ${acc.erreur ?? ''}`);
  sC = await suivi(admin, C.id);
  dit(sC?.statut === 'termine', 'suivi : terminé une fois le déplacement appliqué', `${sC?.statut}`);
  dit(sC?.historique?.some((h) => h.libelle === 'Barrage déplacé'), 'l’historique porte le déplacement');
  const validation = (await notifications(reg)).items.find((n) => n.barrageId === C.id && n.acteur?.matricule === 'NOTIF-ADMIN' && n.type === 'validation');
  dit(Boolean(validation), 'le CMND Région est notifié de la validation');

  /* ---------------------------------------------------------------- */
  titre('6 — le Super Admin suit sans contourner les permissions');
  const tente = await appel(admin, `/api/marquages/${D.id}`, { methode: 'PATCH', corps: { lng: D.lng + 0.001 } });
  dit(tente.statut === 403, 'il ne déplace pas un barrage', `HTTP ${tente.statut}`);
  const tenteFaction = await appel(admin, `/api/barrages/${D.id}/faction`, { methode: 'POST', corps: { factionId: 'F1' } });
  dit(tenteFaction.statut === 403, 'il ne change pas une faction', `HTTP ${tenteFaction.statut}`);

  /* ---------------------------------------------------------------- */
  titre('8 — temps réel : l’événement arrive sans recharger');
  /** Ouvre le flux d'un compte et accumule ce qu'il reçoit, jusqu'à `fermer()`. */
  const ecouter = async (s) => {
    const controle = new AbortController();
    const r = await fetch(`${BASE}/api/notifications/flux`, { headers: { Cookie: s.cookie }, signal: controle.signal });
    const etat = { statut: r.status, type: r.headers.get('content-type') ?? '', texte: '' };
    const lecteur = r.body.getReader();
    const lecture = (async () => {
      try {
        for (;;) {
          const { value, done } = await lecteur.read();
          if (done) break;
          etat.texte += new TextDecoder().decode(value);
        }
      } catch {
        /* flux coupé par `fermer` */
      }
    })();
    etat.fermer = async () => {
      controle.abort();
      await lecture;
    };
    return etat;
  };
  /* Les deux flux sont ouverts AVANT l'événement : l'absence chez l'autre région est donc un vrai filtrage. */
  const fluxReg = await ecouter(reg);
  const fluxAutre = await ecouter(reg2);
  dit(fluxReg.statut === 200 && /text\/event-stream/.test(fluxReg.type), 'le flux s’ouvre', `HTTP ${fluxReg.statut}`);
  await attendre(300);
  await appel(admin, '/api/barrages/assigner', { methode: 'POST', corps: { ids: [D.id] } });
  for (let i = 0; i < 50 && !fluxReg.texte.includes('event: notification'); i++) await attendre(100);
  await attendre(500);
  await fluxReg.fermer();
  await fluxAutre.fermer();
  dit(fluxReg.texte.includes('event: notification'), 'le CMND Région reçoit l’événement en direct');
  dit(!fluxAutre.texte.includes('event: notification'), 'une autre région, connectée au même moment, ne reçoit rien');
} catch (e) {
  dit(false, 'l’épreuve se déroule sans exception', e?.stack ?? String(e));
  console.error(sortieService.slice(-3000));
} finally {
  service.kill();
  rmSync(travail, { recursive: true, force: true });
}

console.log(`\n  ${ok} vérification(s) réussie(s), ${echecs.length} échouée(s)`);
if (echecs.length) {
  for (const e of echecs) console.error('  - ' + e);
  process.exit(1);
}
