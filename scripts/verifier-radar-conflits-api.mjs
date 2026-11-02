#!/usr/bin/env node
/**
 * ÉPREUVE DE BOUT EN BOUT DU RADAR — une vraie opération, une vraie détection.
 *
 *   npm run check:radar:api
 *
 * Le service est lancé sur une COPIE de donnees-demo. Un CMD Région aligne la
 * faction d'un poste sur celle d'un poste voisin (POST
 * /api/barrages/:id/faction, la route réelle) : c'est le SERVEUR qui détecte
 * alors le conflit (actualiserApresOperation). On vérifie que la liste
 * relue le contient, que le détecteur de la carte l'annonce une seule fois,
 * situé, et qu'une région voisine n'en voit rien. Puis le MÊME conflit suit le
 * workflow réel (transmission, traitement, validations) : l'état de son repère
 * suit (rouge → ambre/bleu → neutre → retiré) et rien n'est rejoué. Aucun
 * conflit n'est fabriqué.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chargerComptes, definirCompte, enregistrerComptes } from '../serveur/comptes.mjs';
import { enService } from '../serveur/modificationBarrage.mjs';
import { creerDetecteur, phaseConflit, positionConflit, PHASES } from '../src/detectionConflits.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8760 + (process.pid % 150);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'Epreuve-Radar-2026';
let reussis = 0;
const echecs = [];
const verifie = (ok, titre, detail = '') => {
  console.log(`  ${ok ? 'RÉUSSI ' : 'ÉCHOUÉ '} ${titre}${detail ? ` — ${detail}` : ''}`);
  if (ok) reussis++;
  else echecs.push(titre);
};

const travail = mkdtempSync(join(tmpdir(), 'gr-radar-'));
const DONNEES = join(travail, 'donnees');
cpSync(join(ROOT, 'donnees-demo'), DONNEES, { recursive: true });

/* Deux postes voisins EN SERVICE (ni supprimés ni retirés : le serveur
   ignore ceux-là, à juste titre), de la même région, de factions différentes,
   non intouchables, sans conflit déjà enregistré entre eux. */
const marquages = JSON.parse(readFileSync(join(DONNEES, 'marquages.json'), 'utf8'));
const postes = (marquages.items ?? marquages).filter((m) => ['barrage_fixe', 'barrage_mobile'].includes(m.type) &&
  enService(m) && !m.intouchable && m.protection !== 'intouchable' && m.reg && m.factionId && Number.isFinite(m.lat));
const suivi = JSON.parse(readFileSync(join(DONNEES, 'suivi-conflits.json'), 'utf8')).items;
const pairesConnues = new Set(suivi.map((c) => c.paireCle));
const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180));
let paire = null;
for (const a of postes) {
  for (const b of postes) {
    if (a.id >= b.id || a.reg !== b.reg || a.factionId === b.factionId) continue;
    if (pairesConnues.has([a.id, b.id].sort().join('|'))) continue;
    if (km(a, b) < 3) { paire = [a, b]; break; }
  }
  if (paire) break;
}
if (!paire) {
  console.error('\nAucune paire de postes voisins exploitable dans donnees-demo.\n');
  rmSync(travail, { recursive: true, force: true });
  process.exit(1);
}
const [A, B] = paire;
const autreRegion = postes.find((m) => m.reg !== A.reg)?.reg;
{
  const f = join(DONNEES, 'comptes.json');
  const etat = chargerComptes(f);
  await definirCompte(etat, { matricule: 'RADAR-REG', rang: 'reg', unite: A.reg, role: 'commandement', nom: `CMD Région ${A.reg}`, code: CODE });
  await definirCompte(etat, { matricule: 'RADAR-CIE', rang: 'cie', unite: B.cie || A.cie, role: 'commandement', nom: `CMD Cie ${B.cie || A.cie}`, reg: A.reg, code: CODE });
  await definirCompte(etat, { matricule: 'RADAR-ADMIN', rang: 'admin', unite: 'radar-admin', role: 'commandement', nom: 'Superadmin épreuve', code: CODE });
  await definirCompte(etat, { matricule: 'RADAR-AUTRE', rang: 'reg', unite: autreRegion, role: 'commandement', nom: `CMD Région ${autreRegion}`, code: CODE });
  enregistrerComptes(f, etat);
}

const service = spawn(process.execPath, [join(ROOT, 'scripts', 'serve.mjs'), '--port', String(PORT), '--host', '127.0.0.1', '--donnees', DONNEES], { cwd: ROOT });
let sortie = '';
service.stdout.on('data', (d) => (sortie += d));
service.stderr.on('data', (d) => (sortie += d));
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let debout = false;
for (let k = 0; k < 480 && service.exitCode === null; k++) {
  try { if ((await fetch(`${BASE}/api/etat`)).ok) { debout = true; break; } } catch { /* attente */ }
  await attendre(250);
}
const finir = (code) => {
  service.kill();
  rmSync(travail, { recursive: true, force: true });
  process.exit(code);
};
if (!debout) {
  console.error('\nLe service ne démarre pas :\n' + sortie.slice(-1500));
  finir(1);
}

const ouvrir = async (matricule) => {
  const r = await fetch(`${BASE}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte' }, body: JSON.stringify({ matricule, code: CODE }) });
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
};
const appel = (cookie, chemin, o = {}) => fetch(BASE + chemin, { ...o, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte', Cookie: cookie, ...(o.headers ?? {}) } });
const liste = async (cookie) => (await (await appel(cookie, '/api/conflits')).json()).items ?? [];

try {
  console.log(`\n  paire : ${A.nom} (${A.factionId}) ↔ ${B.nom} (${B.factionId}), ${km(A, B).toFixed(2)} km, région ${A.reg}\n`);
  const reg = await ouvrir('RADAR-REG');
  const autre = await ouvrir('RADAR-AUTRE');
  const admin = await ouvrir('RADAR-ADMIN');
  const cie = await ouvrir('RADAR-CIE');
  const detAdmin = creerDetecteur();
  const detReg = creerDetecteur();
  const detAutre = creerDetecteur();
  detAdmin.observer(await liste(admin));
  detReg.observer(await liste(reg));
  detAutre.observer(await liste(autre));
  verifie(detAdmin.estAmorce() && detReg.estAmorce(), 'première liste = référence (rien d’annoncé à l’ouverture)');

  const r = await appel(reg, `/api/barrages/${encodeURIComponent(B.id)}/faction`, { method: 'POST', body: JSON.stringify({ factionId: A.factionId }) });
  verifie(r.status === 200, `opération réelle : ${B.nom} passe en ${A.factionId}`, `HTTP ${r.status}`);

  /* La détection : le Super Admin la voit (« Les Conflits ») ; la région, pas
     encore — un conflit non assigné ne lui est pas visible. */
  const { nouveaux, animes } = detAdmin.observer(await liste(admin));
  const vise = nouveaux.find((c) => [c.barrageAId, c.barrageBId].includes(B.id));
  verifie(Boolean(vise), 'le serveur a détecté un NOUVEAU conflit, annoncé au Super Admin', vise ? `${vise.numero || vise.id} (${vise.distanceKm} km)` : `${nouveaux.length} nouveau(x)`);
  verifie(Boolean(vise && positionConflit(vise)) && animes.some((c) => c.id === vise?.id), 'conflit situé : impulsion radar sur la carte');
  verifie(vise?.historique?.some((h) => h.action === 'detection'), 'événement de détection présent dans l’historique (version)');
  verifie(detAdmin.observer(await liste(admin)).nouveaux.length === 0, 'relecture : rien n’est rejoué');
  verifie(phaseConflit(vise) === PHASES.NOUVEAU, 'repère : nouveau (rouge, pulsation de veille)', phaseConflit(vise));
  verifie(phaseConflit(vise, { pris: true }) === PHASES.EN_ATTENTE, 'consulté : la pulsation s’arrête');
  verifie(detReg.observer(await liste(reg)).nouveaux.length === 0, 'CMD Région : rien tant que le conflit ne lui est pas assigné');

  const post = (cookie, chemin, corps) => appel(cookie, chemin, { method: 'POST', body: JSON.stringify(corps) });
  const etat = async (titre, attendu, cookie = reg) => {
    const l = await liste(cookie);
    const c = l.find((x) => x.id === vise.id);
    const p = c ? phaseConflit(c) : null;
    const rejoue = detReg.observer(await liste(reg)).nouveaux.some((x) => x.id === vise.id);
    verifie(p === attendu && !rejoue, titre, `repère ${p ?? 'retiré'}${c ? ` (${c.workflow?.etat ?? '—'})` : ''}${rejoue ? ' — REJOUÉ' : ''}`);
  };

  let rr = await post(admin, `/api/conflits/${encodeURIComponent(vise.id)}/assigner`, { matricules: ['RADAR-REG'] });
  verifie(rr.status === 200, 'assigné par le Super Admin au CMD Région', `HTTP ${rr.status}`);
  const pourReg = detReg.observer(await liste(reg)).nouveaux;
  verifie(pourReg.length === 1 && pourReg[0].id === vise.id, 'CMD Région : le conflit assigné est annoncé, une fois');
  await etat('assigné : ambre (à traiter)', PHASES.EN_ATTENTE);
  rr = await post(reg, `/api/conflits/${encodeURIComponent(vise.id)}/transmettre`, { matricule: 'RADAR-CIE', consigne: 'Épreuve radar' });
  verifie(rr.status === 200, 'assigné au CMD CIE', `HTTP ${rr.status}`);
  await etat('assigné à la compagnie : ambre', PHASES.EN_ATTENTE);
  rr = await post(cie, `/api/conflits/${encodeURIComponent(vise.id)}/action`, { action: 'commencer' });
  verifie(rr.status === 200, 'la Compagnie commence', `HTTP ${rr.status}`);
  await etat('en traitement : bleu', PHASES.EN_TRAITEMENT);
  rr = await post(cie, `/api/conflits/${encodeURIComponent(vise.id)}/traiter`, { action: 'derogation', details: { justification: 'Maintien justifié (épreuve radar).' } });
  verifie(rr.status === 200, 'la Compagnie soumet son traitement', `HTTP ${rr.status}`);
  await etat('à valider : neutre, immobile', PHASES.TRAITE);
  rr = await post(admin, `/api/conflits/${encodeURIComponent(vise.id)}/decider`, { decision: 'approuver', raison: '' });
  verifie(rr.status === 200, 'le Super Admin valide', `HTTP ${rr.status}`);
  await etat('validé, en suivi : le repère est retiré', null);
  verifie(detAutre.observer(await liste(autre)).nouveaux.length === 0, `région ${autreRegion} : rien d’annoncé (cloisonnement)`);
} catch (e) {
  verifie(false, 'exception', e.message);
}
console.log(`\n  ${reussis} réussi(s), ${echecs.length} échoué(s)\n`);
finir(echecs.length ? 1 : 0);
