#!/usr/bin/env node
/**
 * ÉPREUVE DE BOUT EN BOUT DU WORKFLOW DES CONFLITS — serveur réel.
 *
 *   npm run check:workflow-conflits:api
 *
 * Le service tourne sur une COPIE de donnees-demo. Les conflits sont
 * DÉTECTÉS par le serveur après de vraies opérations (changement de faction
 * par un CMD Région), puis suivent tout le workflow par l'API, avec les
 * comptes de chaque rôle :
 *
 *   détection → Les Conflits (Super Admin seul)
 *   option B  : assignation Région → assignation CIE → début → soumission
 *               → rejet (motif) → reprise → soumission → validation → Suivi → clôture → Historique
 *   option A  : désassignation → réassignation → prise en charge Région → soumission
 *               → rejet → resoumission → validation
 *
 * À chaque étape : état, section, notifications (destinataire, absence de
 * doublon, compteur de non-lues), cloisonnement (autre région, autre
 * compagnie, brigade), transitions interdites refusées, historique complet.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chargerComptes, definirCompte, enregistrerComptes } from '../serveur/comptes.mjs';
import { enService } from '../serveur/modificationBarrage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8910 + (process.pid % 80);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'Epreuve-Workflow-2026';
let reussis = 0;
const echecs = [];
const verifie = (ok, titre, detail = '') => {
  console.log(`  ${ok ? 'RÉUSSI ' : 'ÉCHOUÉ '} ${titre}${detail ? ` — ${detail}` : ''}`);
  if (ok) reussis++;
  else echecs.push(titre);
};

const travail = mkdtempSync(join(tmpdir(), 'gr-workflow-'));
const DONNEES = join(travail, 'donnees');
cpSync(join(ROOT, 'donnees-demo'), DONNEES, { recursive: true, filter: (src) => !src.includes('sauvegardes') });

/* Deux paires de postes voisins EN SERVICE, même région, factions différentes,
   sans conflit enregistré : deux vraies opérations, deux vraies détections. */
const m = JSON.parse(readFileSync(join(DONNEES, 'marquages.json'), 'utf8'));
const postes = (m.items ?? m).filter((x) => ['barrage_fixe', 'barrage_mobile'].includes(x.type) && enService(x) &&
  !x.intouchable && x.protection !== 'intouchable' && !String(x.id).startsWith('BFI-') && x.reg && x.cie && x.factionId && Number.isFinite(x.lat));
const connues = new Set(JSON.parse(readFileSync(join(DONNEES, 'suivi-conflits.json'), 'utf8')).items.map((c) => c.paireCle));
const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180));
/* Par région, des paires (< 8 km) choisies sans poste commun : chaque
   opération ne touche qu'une paire. La première région qui en a deux. */
const parRegion = new Map();
for (const a of postes) for (const b of postes) {
  if (a.id < b.id && a.reg === b.reg && a.factionId !== b.factionId && !connues.has([a.id, b.id].sort().join('|')) && km(a, b) < 8) {
    parRegion.set(a.reg, [...(parRegion.get(a.reg) ?? []), [a, b]]);
  }
}
const independantesDe = (l) => {
  const pris = new Set();
  return [...l].sort((x, y) => km(...x) - km(...y)).filter(([x, y]) => !pris.has(x.id) && !pris.has(y.id) && pris.add(x.id) && pris.add(y.id));
};
const [REGION, independantes] = [...parRegion].map(([r, l]) => [r, independantesDe(l)]).find(([, l]) => l.length >= 2) ?? [];
if (!REGION) {
  console.error('\nPas deux paires indépendantes dans une même région de donnees-demo.\n');
  process.exit(1);
}
const [P1, P2] = independantes;
const autreRegion = postes.find((x) => x.reg !== REGION)?.reg;
const ciesRegion = [...new Set(postes.filter((x) => x.reg === REGION).map((x) => x.cie))];
const CIE1 = P1[1].cie;
const CIE2 = ciesRegion.find((c) => c !== CIE1) ?? `${CIE1}-bis`;
const cieHors = postes.find((x) => x.reg !== REGION)?.cie;

const COMPTES = [
  { matricule: 'WF-ADMIN', rang: 'admin', unite: 'wf-admin', role: 'commandement', nom: 'Super Admin épreuve' },
  { matricule: 'WF-REG', rang: 'reg', unite: REGION, role: 'commandement', nom: `CMD Région ${REGION}` },
  { matricule: 'WF-REG-AUTRE', rang: 'reg', unite: autreRegion, role: 'commandement', nom: `CMD Région ${autreRegion}` },
  { matricule: 'WF-CIE', rang: 'cie', unite: CIE1, reg: REGION, role: 'commandement', nom: `CMD CIE ${CIE1}` },
  { matricule: 'WF-CIE-AUTRE', rang: 'cie', unite: CIE2, reg: REGION, role: 'commandement', nom: `CMD CIE ${CIE2}` },
  { matricule: 'WF-CIE-HORS', rang: 'cie', unite: cieHors, reg: autreRegion, role: 'commandement', nom: `CMD CIE ${cieHors}` },
  { matricule: 'WF-BT', rang: 'unite', unite: P1[0].bt || 'BT', reg: REGION, cie: CIE1, role: 'commandement', nom: 'Brigade épreuve' },
];
{
  const f = join(DONNEES, 'comptes.json');
  const etat = chargerComptes(f);
  for (const c of COMPTES) await definirCompte(etat, { ...c, code: CODE });
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
  console.error('\nLe service ne démarre pas :\n' + sortie.slice(-2000));
  finir(1);
}

const appel = (s, chemin, o = {}) => fetch(BASE + chemin, {
  ...o,
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte', ...(s?.cookie ? { Cookie: s.cookie } : {}), ...(o.headers ?? {}) },
});
const corps = async (r) => r.json().catch(() => ({}));
const post = (s, chemin, body = {}) => appel(s, chemin, { method: 'POST', body: JSON.stringify(body) });
async function ouvrir(matricule) {
  const r = await fetch(`${BASE}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte' }, body: JSON.stringify({ matricule, code: CODE }) });
  return { cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') };
}
const liste = async (s) => corps(await appel(s, '/api/conflits'));
const un = async (s, id) => (await liste(s)).items?.find((c) => c.id === id) ?? null;
const notifs = async (s) => corps(await appel(s, '/api/notifications'));
const notifsDe = async (s, id) => ((await notifs(s)).items ?? []).filter((n) => n.conflitId === id || n.details?.conflitId === id);
const action = (s, id, a, extra = {}) => post(s, `/api/conflits/${encodeURIComponent(id)}/action`, { action: a, ...extra });
const traiter = (s, id) => post(s, `/api/conflits/${encodeURIComponent(id)}/traiter`, { action: 'derogation', details: { justification: 'Maintien justifié : axe stratégique (épreuve).' } });
const decider = (s, id, decision, raison = '') => post(s, `/api/conflits/${encodeURIComponent(id)}/decider`, { decision, raison });

try {
  console.log(`\n  région ${REGION} · CIE ${CIE1} / ${CIE2} · autre région ${autreRegion}\n`);
  const S = {};
  for (const c of COMPTES) S[c.matricule] = await ouvrir(c.matricule);
  verifie(Object.values(S).every((s) => s.cookie), `${COMPTES.length} sessions (Super Admin, 2 régions, 3 compagnies, brigade)`);

  /* ---------------- 1. Détection ---------------- */
  const avant = new Set(((await liste(S['WF-ADMIN'])).items ?? []).map((c) => c.id));
  for (const [a, b] of [P1, P2]) {
    const r = await post(S['WF-REG'], `/api/barrages/${encodeURIComponent(b.id)}/faction`, { factionId: a.factionId });
    verifie(r.status === 200, `opération réelle : ${b.nom} passe en ${a.factionId}`, `HTTP ${r.status}`);
  }
  const la = await liste(S['WF-ADMIN']);
  const nouveaux = (la.items ?? []).filter((c) => !avant.has(c.id));
  const c1 = nouveaux.find((c) => [c.barrageAId, c.barrageBId].includes(P1[1].id));
  const c2 = nouveaux.find((c) => [c.barrageAId, c.barrageBId].includes(P2[1].id));
  verifie(Boolean(c1 && c2), '1. le serveur détecte les conflits (Super Admin)', `${nouveaux.length} nouveau(x)`);
  verifie(c1?.workflow?.etat === 'NEW' && c1?.workflow?.section === 'conflits', '1. conflit détecté : NEW, section « Les Conflits »', `${c1?.workflow?.etat}/${c1?.workflow?.section}`);
  verifie(!(await liste(S['WF-REG'])).items?.some((c) => c.id === c1.id) && (await liste(S['WF-REG'])).compteurs?.conflits === 0,
    '1. le CMD Région ne voit pas un conflit non assigné (ni dans ses compteurs)');
  verifie((await notifsDe(S['WF-ADMIN'], c1.id)).some((n) => n.titre === 'Nouveau conflit détecté'), '1. notification « Nouveau conflit détecté » au Super Admin');
  verifie((await notifsDe(S['WF-REG'], c1.id)).length === 0, '1. aucune notification à la région tant qu’il n’est pas assigné');

  /* ---------------- 2. Assignation Super Admin → CMD Région ---------------- */
  let r = await action(S['WF-ADMIN'], c1.id, 'commencer');
  verifie(r.status === 403, 'transition arbitraire : le Super Admin ne « commence » pas', `HTTP ${r.status}`);
  r = await post(S['WF-REG'], `/api/conflits/${encodeURIComponent(c1.id)}/assigner`, { matricules: ['WF-REG'] });
  verifie(r.status === 403, '2. un CMD Région ne peut pas assigner', `HTTP ${r.status}`);
  r = await post(S['WF-ADMIN'], `/api/conflits/${encodeURIComponent(c1.id)}/assigner`, { matricules: ['REGION-INEXISTANTE'] });
  verifie(r.status === 422, '2. cible inconnue refusée (plus de repli sur « le premier compte »)', `HTTP ${r.status}`);
  r = await post(S['WF-ADMIN'], `/api/conflits/${encodeURIComponent(c1.id)}/assigner`, { matricules: ['WF-REG'] });
  let b = await corps(r);
  verifie(r.status === 200 && b.conflit?.workflow?.etat === 'ASSIGNED_REGION', '2. assignation au CMD Région : ASSIGNED_REGION', `HTTP ${r.status} ${b.conflit?.workflow?.etat}`);
  const enreg = b.conflit;
  verifie(enreg?.assignation?.regions?.[0]?.unite === REGION && enreg?.assignation?.assignePar?.matricule === 'WF-ADMIN' && Boolean(enreg?.assignation?.assigneLe),
    '2. assignation enregistrée : conflit, région, auteur, date, état');
  r = await post(S['WF-ADMIN'], `/api/conflits/${encodeURIComponent(c1.id)}/assigner`, { matricules: ['WF-REG'] });
  b = await corps(r);
  verifie(r.status === 200 && b.inchange === true, '2. même assignation rejouée (double clic) : aucun changement', `HTTP ${r.status} ${b.erreur ?? b.conflit?.workflow?.etat}`);
  const nReg = (await notifsDe(S['WF-REG'], c1.id)).filter((n) => n.titre === 'Nouveau conflit à traiter');
  verifie(nReg.length === 1, '3. notification « Nouveau conflit à traiter » au CMD Région, une seule fois', `${nReg.length}`);
  const nl = await notifs(S['WF-REG']);
  verifie(nl.nonLues >= 1 && nl.items?.some((n) => n.conflitId === c1.id && !n.lue), '3. comptée parmi les non-lues', `nonLues=${nl.nonLues}`);
  await post(S['WF-REG'], `/api/notifications/${encodeURIComponent(nReg[0].id)}/lue`);
  verifie((await notifs(S['WF-REG'])).nonLues === nl.nonLues - 1, '3. lue : le compteur baisse d’un');
  verifie(!(await notifsDe(S['WF-REG-AUTRE'], c1.id)).length && !(await notifsDe(S['WF-CIE'], c1.id)).length, '3. la notification ne fuit ni vers une autre région ni vers une compagnie');
  let vu = await un(S['WF-REG'], c1.id);
  verifie(vu?.workflow?.section === 'a_traiter' && vu.workflow.actions.prendre_en_charge && vu.workflow.actions.assigner_cie,
    '2. côté Région : section « À traiter », options A (traiter) et B (assigner CIE)');
  const la2 = await liste(S['WF-ADMIN']);
  verifie(la2.items.filter((c) => c.id === c1.id).length === 1 && la2.items.find((c) => c.id === c1.id).workflow.section === 'a_traiter',
    '2. plus dans « Les Conflits » : une seule section, aucun doublon');
  verifie(!(await un(S['WF-REG-AUTRE'], c1.id)) && (await action(S['WF-REG-AUTRE'], c1.id, 'prendre_en_charge')).status === 403,
    '5. cloisonnement : une autre région ne voit ni n’agit (403)');

  /* ---------------- 3. Région → CMD CIE (option B) ---------------- */
  r = await post(S['WF-REG'], `/api/conflits/${encodeURIComponent(c1.id)}/transmettre`, { matricule: 'WF-CIE-HORS' });
  verifie(r.status === 403, '4. assignation à une CIE d’une autre région refusée', `HTTP ${r.status} ${(await corps(r)).erreur ?? ''}`);
  r = await post(S['WF-ADMIN'], `/api/conflits/${encodeURIComponent(c1.id)}/transmettre`, { matricule: 'WF-CIE' });
  verifie(r.status === 403, '4. le Super Admin n’assigne pas directement à une CIE', `HTTP ${r.status}`);
  verifie((await corps(await appel(S['WF-REG'], `/api/conflits/${encodeURIComponent(c1.id)}/cmnd-cie?reg=${encodeURIComponent(autreRegion)}`))).region === REGION,
    '4. liste des CMD CIE : toujours celle de SA région (paramètre ignoré)');
  r = await post(S['WF-REG'], `/api/conflits/${encodeURIComponent(c1.id)}/transmettre`, { matricule: 'WF-CIE' });
  b = await corps(r);
  verifie(r.status === 200 && b.conflit?.workflow?.etat === 'ASSIGNED_CIE', '4. assignation au CMD CIE : ASSIGNED_CIE', `HTTP ${r.status} ${b.conflit?.workflow?.etat ?? b.erreur}`);
  verifie((await notifsDe(S['WF-CIE'], c1.id)).filter((n) => n.titre === 'Nouveau conflit assigné à votre compagnie').length === 1, '4. notification au CMD CIE, une seule');
  verifie(!(await un(S['WF-CIE-AUTRE'], c1.id)) && !(await notifsDe(S['WF-CIE-AUTRE'], c1.id)).length, '5. une autre compagnie de la région ne voit rien');
  verifie(Boolean(await un(S['WF-REG'], c1.id)), '4. la Région garde la visibilité');
  verifie(((await liste(S['WF-BT'])).items ?? []).length === 0, '5. une brigade ne voit aucun conflit du workflow');

  /* ---------------- 4. CMD CIE : début, soumission ---------------- */
  verifie((await decider(S['WF-ADMIN'], c1.id, 'approuver')).status === 409, 'validation impossible avant soumission (409)');
  r = await action(S['WF-CIE'], c1.id, 'commencer');
  verifie(r.status === 200 && (await corps(r)).etat === 'IN_PROGRESS_CIE', '4. le CMD CIE commence : IN_PROGRESS_CIE');
  r = await traiter(S['WF-CIE'], c1.id);
  b = await corps(r);
  verifie(r.status === 200 && b.conflit?.workflow?.etat === 'PENDING_VALIDATION' && b.conflit.workflow.section === 'a_valider',
    '6. soumission pour validation : PENDING_VALIDATION, « À valider »', `HTTP ${r.status} ${b.conflit?.workflow?.etat}`);
  verifie((await traiter(S['WF-CIE'], c1.id)).status === 409, '6. double soumission refusée (409)');
  verifie((await decider(S['WF-REG'], c1.id, 'approuver')).status === 403, '6. la Région ne valide pas (403)');
  verifie((await notifsDe(S['WF-ADMIN'], c1.id)).filter((n) => n.titre === 'Validation requise').length === 1, '6. notification « Validation requise » au Super Admin');

  /* ---------------- 5. Rejet, reprise, validation ---------------- */
  verifie((await decider(S['WF-ADMIN'], c1.id, 'rejeter', '')).status === 422, '7. rejet sans motif refusé (422)');
  r = await decider(S['WF-ADMIN'], c1.id, 'rejeter', 'Justification insuffisante : préciser l’axe.');
  b = await corps(r);
  verifie(r.status === 200 && b.conflit?.workflow?.etat === 'REJECTED' && b.conflit.workflow.section === 'a_traiter', '7. rejet motivé : REJECTED, retour « À traiter »');
  verifie((await notifsDe(S['WF-CIE'], c1.id)).some((n) => n.titre === 'Traitement rejeté — à corriger' && /Justification insuffisante/.test(n.description)),
    '7. le responsable (CMD CIE) est notifié du rejet, avec le motif');
  vu = await un(S['WF-CIE'], c1.id);
  verifie(vu?.workflow?.motifRejet?.includes('Justification insuffisante'), '7. le motif est présenté au responsable');
  verifie((await action(S['WF-REG'], c1.id, 'prendre_en_charge')).status === 409, '7. le rejet revient au CMD CIE, pas à la Région (409)');
  verifie((await action(S['WF-CIE'], c1.id, 'commencer')).status === 200, '7. le CMD CIE reprend le traitement');
  verifie((await traiter(S['WF-CIE'], c1.id)).status === 200, '7. et soumet de nouveau');
  r = await decider(S['WF-ADMIN'], c1.id, 'approuver');
  b = await corps(r);
  verifie(r.status === 200 && b.conflit?.workflow?.etat === 'FOLLOW_UP' && b.conflit.workflow.section === 'suivi', '8. validation : FOLLOW_UP, section « Suivi »');
  verifie((await notifsDe(S['WF-CIE'], c1.id)).some((n) => n.titre === 'Traitement validé'), '8. le responsable est notifié de la validation');

  /* ---------------- 6. Clôture, historique ---------------- */
  verifie((await action(S['WF-REG'], c1.id, 'cloturer')).status === 403, '9. la Région ne clôture pas (403)');
  r = await action(S['WF-ADMIN'], c1.id, 'cloturer');
  verifie(r.status === 200 && (await corps(r)).etat === 'CLOSED', '9. clôture par le Super Admin : CLOSED');
  verifie((await action(S['WF-ADMIN'], c1.id, 'cloturer')).status === 409, '9. clôture rejouée : refusée, sans effet');
  verifie(!(await liste(S['WF-ADMIN'])).items.some((c) => c.id === c1.id), '9. retiré des sections actives');
  const hAdmin = (await corps(await appel(S['WF-ADMIN'], '/api/conflits/historique'))).items ?? [];
  const hReg = (await corps(await appel(S['WF-REG'], '/api/conflits/historique'))).items ?? [];
  const hAutre = (await corps(await appel(S['WF-REG-AUTRE'], '/api/conflits/historique'))).items ?? [];
  verifie(hAdmin.some((c) => c.id === c1.id) && hReg.some((c) => c.id === c1.id) && !hAutre.some((c) => c.id === c1.id),
    '9. « Historique » : Super Admin et Région concernée, pas une autre région');
  const hist = (await corps(await appel(S['WF-ADMIN'], `/api/conflits/${encodeURIComponent(c1.id)}/historique`))).historique ?? [];
  const parcours = hist.filter((h) => h.vers).map((h) => `${h.action}:${h.vers}`);
  const attendu = ['detection:NEW', 'assigner_region:ASSIGNED_REGION', 'assigner_cie:ASSIGNED_CIE', 'commencer:IN_PROGRESS_CIE',
    'soumettre:PENDING_VALIDATION', 'rejeter:REJECTED', 'commencer:IN_PROGRESS_CIE', 'soumettre:PENDING_VALIDATION',
    'valider:APPROVED', 'valider:FOLLOW_UP', 'cloturer:CLOSED'];
  verifie(JSON.stringify(parcours) === JSON.stringify(attendu), '10. historique complet et chronologique', hist.filter((h) => h.vers).map((h) => `${h.action}:${h.vers}(${h.auteur?.matricule})`).join(' → '));
  verifie(hist.filter((h) => h.vers).every((h) => h.auteur?.matricule !== undefined && h.date && h.de !== undefined),
    '10. chaque étape : auteur, date, état de départ et d’arrivée');
  verifie(hist.some((h) => h.action === 'rejeter' && /Justification insuffisante/.test(h.motif ?? '')), '10. le motif du rejet est conservé');
  const auteurs = new Set(hist.filter((h) => h.vers && h.action !== 'detection').map((h) => h.auteur?.matricule));
  verifie(['WF-ADMIN', 'WF-REG', 'WF-CIE'].every((x) => auteurs.has(x)), '10. les trois responsables y figurent', [...auteurs].join(', '));

  /* ---------------- 7. Option A : désassignation, réassignation, traitement direct Région ---------------- */
  r = await post(S['WF-ADMIN'], `/api/conflits/${encodeURIComponent(c2.id)}/assigner`, { matricules: ['WF-REG-AUTRE'] });
  verifie(r.status === 200, 'option A : assigné d’abord à une autre région (erreur volontaire)');
  r = await post(S['WF-ADMIN'], `/api/conflits/${encodeURIComponent(c2.id)}/desassigner`);
  b = await corps(r);
  verifie(r.status === 200 && b.conflit?.workflow?.etat === 'NEW' && b.conflit.workflow.section === 'conflits', 'désassignation : retour dans « Les Conflits » (NEW)');
  verifie(!(await un(S['WF-REG-AUTRE'], c2.id)) && (await notifsDe(S['WF-REG-AUTRE'], c2.id)).some((n) => n.titre === 'Conflit retiré'),
    'la région retirée perd l’accès et en est notifiée');
  await post(S['WF-ADMIN'], `/api/conflits/${encodeURIComponent(c2.id)}/assigner`, { matricules: ['WF-REG'] });
  r = await action(S['WF-REG'], c2.id, 'prendre_en_charge');
  verifie(r.status === 200 && (await corps(r)).etat === 'IN_PROGRESS_REGION', '5. traitement direct : le CMD Région prend en charge (IN_PROGRESS_REGION)');
  r = await traiter(S['WF-REG'], c2.id);
  verifie(r.status === 200 && (await corps(r)).conflit?.workflow?.etat === 'PENDING_VALIDATION', '5. le CMD Région soumet : PENDING_VALIDATION');
  await decider(S['WF-ADMIN'], c2.id, 'rejeter', 'Compléter le traitement.');
  verifie((await notifsDe(S['WF-REG'], c2.id)).some((n) => n.titre === 'Traitement rejeté — à corriger'), '7. rejet renvoyé au CMD Région, notifié');
  verifie((await action(S['WF-CIE'], c2.id, 'commencer')).status === 403, '7. la CIE (non assignée) ne peut pas le reprendre');
  r = await traiter(S['WF-REG'], c2.id);
  verifie(r.status === 200 && (await corps(r)).conflit?.workflow?.etat === 'PENDING_VALIDATION', '7. resoumission directe par la Région');
  r = await decider(S['WF-ADMIN'], c2.id, 'approuver');
  verifie(r.status === 200 && (await corps(r)).conflit?.workflow?.etat === 'FOLLOW_UP', '8. validation : en suivi');
  verifie((await notifsDe(S['WF-REG'], c2.id)).some((n) => n.titre === 'Traitement validé'), '8. le CMD Région est notifié de la validation');

  /* ---------------- Suppression : Super Admin seul, jamais un traitement validé ou clos ---------------- */
  const supprimer = (s, id) => appel(s, `/api/conflits/${encodeURIComponent(id)}`, { method: 'DELETE' });
  verifie((await supprimer(S['WF-REG'], c2.id)).status === 403 && (await supprimer(S['WF-CIE'], c2.id)).status === 403,
    'suppression refusée à la Région et à la CIE (403)');
  verifie((await supprimer(S['WF-ADMIN'], c2.id)).status === 409 && (await supprimer(S['WF-ADMIN'], c1.id)).status === 409,
    'suppression d’un conflit en suivi ou clos refusée au Super Admin (409)');
  verifie((await un(S['WF-ADMIN'], c2.id))?.workflow?.actions?.supprimer === false && (await un(S['WF-REG'], c2.id))?.workflow?.actions?.supprimer === false,
    'le droit de suppression exposé à l’interface est faux pour ces cas');

  /* ---------------- 8. Cohérence globale ---------------- */
  for (const [nom, s] of [['Super Admin', S['WF-ADMIN']], ['Région', S['WF-REG']], ['CIE', S['WF-CIE']]]) {
    const l = await liste(s);
    const ids = (l.items ?? []).map((c) => c.id);
    const parSection = {};
    for (const c of l.items ?? []) parSection[c.workflow.section] = (parSection[c.workflow.section] ?? 0) + 1;
    const h = ((await corps(await appel(s, '/api/conflits/historique'))).items ?? []).length;
    const ok = new Set(ids).size === ids.length &&
      ['conflits', 'a_traiter', 'a_valider', 'suivi'].every((k) => (parSection[k] ?? 0) === (l.compteurs?.[k] ?? 0)) &&
      (l.compteurs?.historique ?? 0) === h;
    verifie(ok, `13. ${nom} : aucun doublon, compteurs = conflits réellement listés`, JSON.stringify(l.compteurs));
  }
  const toutes = ((await notifs(S['WF-ADMIN'])).items ?? []).filter((n) => n.cle);
  verifie(new Set(toutes.map((n) => n.cle)).size === toutes.length, '12. aucune notification du workflow en double', `${toutes.length} notification(s)`);
} catch (e) {
  verifie(false, 'exception', e.stack);
}
console.log(`\n  ${reussis} réussi(s), ${echecs.length} échoué(s)\n`);
finir(echecs.length ? 1 : 0);
