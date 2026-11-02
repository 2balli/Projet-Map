#!/usr/bin/env node
/**
 * ÉPREUVE DES FACTIONS SUR UN VRAI SERVICE — filtre serveur, RBAC, persistance.
 *
 * `verifier-factions-unite.mjs` éprouve les règles ; celui-ci éprouve ce que le
 * serveur en fait :
 *
 *   1. la route rend la définition, la faction courante et les affectations ;
 *   2. `/api/marquages?faction=` filtre RÉELLEMENT, et pas seulement à l'écran ;
 *   3. le filtre s'ajoute au RBAC, il ne s'y substitue jamais — un chef de
 *      brigade qui demande une faction ne voit pas un poste de plus ;
 *   4. les chiffres se recoupent : somme des factions, postes sans faction,
 *      total ;
 *   5. tout survit à un redémarrage, parce que rien n'est en mémoire.
 *
 *   node scripts/verifier-factions-service.mjs
 *   node scripts/verifier-factions-service.mjs --donnees donnees-demo
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chargerComptes, definirCompte, enregistrerComptes } from '../serveur/comptes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8520 + (process.pid % 150);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'Factions-Epreuve-2026';

let ok = 0;
const echecs = [];
const dit = (bon, titre, detail = '') => {
  console.log(`  ${bon ? 'RÉUSSI ' : 'ÉCHOUÉ '} ${titre}${detail ? ' — ' + detail : ''}`);
  if (bon) ok++;
  else echecs.push(titre);
};

const demande = process.argv.indexOf('--donnees');
const choisi = demande > -1 ? process.argv[demande + 1] : null;
const source = choisi
  ? resolve(ROOT, choisi)
  : existsSync(join(ROOT, 'donnees-production'))
    ? join(ROOT, 'donnees-production')
    : join(ROOT, 'donnees-serveur');

if (!existsSync(source)) {
  console.error(`\nDossier de donnees introuvable : ${source}\n`);
  process.exit(1);
}

const travail = mkdtempSync(join(tmpdir(), 'gr-factions-'));
const DONNEES = join(travail, 'donnees');
cpSync(source, DONNEES, { recursive: true });
rmSync(join(DONNEES, 'sauvegardes'), { recursive: true, force: true });
console.log(`\n  donnees d'epreuve : copie de ${source}`);

/**
 * QUATRE PROFILS, UN PAR ÉCHELON — le RBAC ne se vérifie pas autrement.
 *
 * Les unités sont tirées du jeu de données lui-même : coder « Ouarzazate » en
 * dur marcherait aujourd'hui et casserait sur un autre dépôt.
 */
const { readFileSync } = await import('node:fs');
const marquages = JSON.parse(readFileSync(join(DONNEES, 'marquages.json'), 'utf8')).items ?? [];
const BARRAGES = ['barrage_fixe', 'barrage_mobile'];
const HORS_SERVICE = ['supprime', 'retire_optimisation'];
const postesFichier = marquages.filter(
  (m) => BARRAGES.includes(m.type) && !HORS_SERVICE.includes(m.statutBarrage) && m.bt && m.cie,
);
if (!postesFichier.length) {
  console.error('\nAucun barrage rattaché dans ce jeu de données.\n');
  rmSync(travail, { recursive: true, force: true });
  process.exit(1);
}
/* La brigade la mieux pourvue : celle qui donnera les comparaisons les plus
   parlantes entre échelons. */
const compte = new Map();
for (const m of postesFichier) compte.set(m.bt, (compte.get(m.bt) ?? 0) + 1);
const BT = [...compte.entries()].sort((a, b) => b[1] - a[1])[0][0];
const modele = postesFichier.find((m) => m.bt === BT);
const CIE = modele.cie;
const REG = modele.reg;

{
  const f = join(DONNEES, 'comptes.json');
  const etat = chargerComptes(f);
  for (const c of [
    { matricule: 'FA-ADMIN', rang: 'admin', unite: 'fa-admin', nom: 'Administration' },
    { matricule: 'FA-REG', rang: 'reg', unite: REG, nom: 'Région' },
    { matricule: 'FA-CIE', rang: 'cie', unite: CIE, nom: 'Compagnie', reg: REG },
    { matricule: 'FA-BT', rang: 'unite', unite: BT, nom: 'Brigade', reg: REG, cie: CIE },
  ]) {
    await definirCompte(etat, { ...c, role: 'commandement', code: CODE });
  }
  enregistrerComptes(f, etat);
}
console.log(`  périmètre d'épreuve : région ${REG} > compagnie ${CIE} > brigade ${BT}\n`);

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function demarrer() {
  const proc = spawn(
    process.execPath,
    [join(ROOT, 'scripts', 'serve.mjs'), '--port', String(PORT), '--host', '127.0.0.1', '--donnees', DONNEES],
    { cwd: ROOT },
  );
  let sortie = '';
  proc.stdout.on('data', (d) => {
    sortie += d;
  });
  proc.stderr.on('data', (d) => {
    sortie += d;
  });
  for (let i = 0; i < 360; i++) {
    if (proc.exitCode !== null) break;
    try {
      if ((await fetch(`${BASE}/api/etat`, { signal: AbortSignal.timeout(4000) })).ok) return proc;
    } catch {
      /* pas encore là */
    }
    await attendre(250);
  }
  console.error('\nLe service ne démarre pas.\n' + sortie);
  proc.kill();
  rmSync(travail, { recursive: true, force: true });
  process.exit(1);
}

const terminer = (proc) =>
  new Promise((r) => {
    if (!proc || proc.exitCode !== null) return r();
    const forcer = setTimeout(() => proc.kill('SIGKILL'), 3000);
    proc.once('exit', () => {
      clearTimeout(forcer);
      r();
    });
    proc.kill();
  });

async function ouvrir(matricule) {
  const r = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte' },
    body: JSON.stringify({ matricule, code: CODE }),
    signal: AbortSignal.timeout(30_000),
  });
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
}

const appeler = async (cookie, chemin) => {
  const r = await fetch(`${BASE}/api/${chemin}`, {
    signal: AbortSignal.timeout(180_000),
    headers: { 'X-Requested-With': 'gr-carte', Cookie: cookie },
  });
  return { statut: r.status, corps: await r.json().catch(() => ({})) };
};

const estBarrage = (m) => BARRAGES.includes(m.type);

let service = await demarrer();

try {
  const admin = await ouvrir('FA-ADMIN');

  /* ================================================================ */
  console.log('=== 1. LA DÉFINITION ET LA FACTION COURANTE ===\n');

  const f = await appeler(admin, 'factions');
  dit(f.statut === 200, 'la route des factions répond', `statut ${f.statut}`);

  const factions = f.corps.factions ?? [];
  dit(factions.length === 4, 'quatre factions sont définies', `${factions.length}`);
  dit(
    factions.every((x) => /^([01]\d|2[0-4]):[0-5]\d$/.test(x.debut) && /^([01]\d|2[0-4]):[0-5]\d$/.test(x.fin)),
    'chacune porte de vraies bornes horaires, pas du texte',
    factions.map((x) => `${x.id} ${x.debut}-${x.fin}`).join(' · '),
  );
  dit(
    Boolean(f.corps.factionActuelle) && factions.some((x) => x.id === f.corps.factionActuelle),
    'la faction courante est désignée par le SERVEUR',
    `${f.corps.factionActuelle} à ${f.corps.heureServeur} (heure serveur)`,
  );
  /* Et elle correspond bien à l'heure annoncée : c'est le contrôle qui
     empêcherait un décalage de fuseau de passer inaperçu. */
  const heure = Number(String(f.corps.heureServeur).slice(0, 2));
  dit(
    f.corps.factionActuelle === factions[Math.floor(heure / 6)].id,
    'et elle correspond à l’heure du serveur',
    `${heure}h → ${factions[Math.floor(heure / 6)].id}`,
  );

  /* ================================================================ */
  console.log('\n=== 2. LES AFFECTATIONS ET LES COMPTEURS ===\n');

  const tous = await appeler(admin, 'marquages');
  const postesAdmin = (tous.corps.items ?? []).filter(estBarrage);

  dit(
    f.corps.total === postesAdmin.length,
    'le total des factions correspond aux barrages visibles',
    `${f.corps.total} / ${postesAdmin.length}`,
  );
  dit(
    Object.keys(f.corps.assignations ?? {}).length === postesAdmin.length,
    'chaque barrage visible porte sa liste de factions',
  );

  const sansFactionCalcule = Object.values(f.corps.assignations ?? {}).filter(
    (l) => !l.length,
  ).length;
  dit(
    f.corps.sansFaction === sansFactionCalcule,
    'le compte des postes sans faction se recoupe',
    `${f.corps.sansFaction} sans affectation`,
  );

  for (const x of factions) {
    const attendu = Object.values(f.corps.assignations ?? {}).filter((l) => l.includes(x.id)).length;
    dit(
      f.corps.compteurs[x.id] === attendu,
      `le compteur de ${x.id} se recoupe avec les affectations`,
      `${f.corps.compteurs[x.id]} barrage(s)`,
    );
  }

  console.log('\n  répartition :');
  for (const x of factions) {
    console.log(`    ${x.id}  ${x.libelle}  ${String(f.corps.compteurs[x.id]).padStart(5)}`);
  }
  console.log(`    —   sans faction       ${String(f.corps.sansFaction).padStart(5)}`);

  /* ================================================================ */
  console.log('\n=== 3. LE FILTRE EST APPLIQUÉ PAR LE SERVEUR ===\n');

  for (const x of factions) {
    const r = await appeler(admin, `marquages?faction=${x.id}`);
    const rendus = (r.corps.items ?? []).filter(estBarrage);
    dit(
      r.statut === 200 && rendus.length === f.corps.compteurs[x.id],
      `?faction=${x.id} rend exactement les barrages de cette faction`,
      `${rendus.length} rendu(s)`,
    );
    dit(
      rendus.every((m) => (f.corps.assignations[m.id] ?? []).includes(x.id)),
      `  et aucun poste étranger à ${x.id}`,
    );
  }

  const toutes = await appeler(admin, 'marquages?faction=toutes');
  dit(
    (toutes.corps.items ?? []).filter(estBarrage).length === postesAdmin.length,
    '« toutes » rend le dispositif entier',
    `${(toutes.corps.items ?? []).filter(estBarrage).length}`,
  );

  const actuelle = await appeler(admin, 'marquages?faction=actuelle');
  dit(
    (actuelle.corps.items ?? []).filter(estBarrage).length ===
      f.corps.compteurs[f.corps.factionActuelle],
    '« actuelle » rend la faction que le serveur dit courante',
    `${(actuelle.corps.items ?? []).filter(estBarrage).length} pour ${f.corps.factionActuelle}`,
  );

  const inconnue = await appeler(admin, 'marquages?faction=F9');
  dit(inconnue.statut === 400, 'une faction inconnue est refusée', `statut ${inconnue.statut}`);

  /* LES NON-BARRAGES TRAVERSENT LE FILTRE — sinon la carte se viderait. */
  const nonBarragesSansFiltre = (tous.corps.items ?? []).filter((m) => !estBarrage(m)).length;
  const nonBarragesFiltres = (
    await appeler(admin, `marquages?faction=${factions[0].id}`)
  ).corps.items.filter((m) => !estBarrage(m)).length;
  dit(
    nonBarragesSansFiltre === nonBarragesFiltres,
    'les points noirs et congestions ne sont pas filtrés par faction',
    `${nonBarragesFiltres} repère(s) conservé(s)`,
  );

  /* ================================================================ */
  console.log('\n=== 4. LE FILTRE NE CONTOURNE JAMAIS LE RBAC ===\n');

  const profils = [
    ['FA-REG', 'région'],
    ['FA-CIE', 'compagnie'],
    ['FA-BT', 'brigade'],
  ];
  const vus = new Map();

  for (const [matricule, nom] of profils) {
    const s = await ouvrir(matricule);
    const sien = await appeler(s, 'marquages');
    const siens = (sien.corps.items ?? []).filter(estBarrage);
    vus.set(matricule, siens.length);

    const sesFactions = await appeler(s, 'factions');
    dit(
      sesFactions.corps.total === siens.length,
      `${nom.padEnd(10)} : ses factions ne portent que SES barrages`,
      `${sesFactions.corps.total} barrage(s)`,
    );

    /* Demander une faction ne doit JAMAIS élargir le périmètre. */
    let elargi = false;
    for (const x of factions) {
      const r = await appeler(s, `marquages?faction=${x.id}`);
      const rendus = (r.corps.items ?? []).filter(estBarrage);
      if (rendus.length > siens.length) elargi = true;
      if (rendus.some((m) => !siens.some((y) => y.id === m.id))) elargi = true;
    }
    dit(!elargi, `${nom.padEnd(10)} : aucune faction ne lui montre un poste de plus`);
  }

  dit(
    vus.get('FA-BT') <= vus.get('FA-CIE') && vus.get('FA-CIE') <= vus.get('FA-REG'),
    'la restriction reste monotone : brigade ⊆ compagnie ⊆ région',
    `${vus.get('FA-BT')} ≤ ${vus.get('FA-CIE')} ≤ ${vus.get('FA-REG')}`,
  );

  const sansSession = await fetch(`${BASE}/api/factions`, {
    headers: { 'X-Requested-With': 'gr-carte' },
  });
  dit(sansSession.status === 401, 'sans session, les factions sont refusées', `statut ${sansSession.status}`);

  /* ================================================================ */
  console.log('\n=== 5. LES FILTRES SE COMBINENT ===\n');

  {
    /**
     * COMPAGNIE + FACTION, puis COMPAGNIE + BRIGADE + FACTION.
     *
     * Le périmètre n'est pas un paramètre de requête : il vient du COMPTE. Un
     * chef de compagnie EST son périmètre, et « compagnie + faction » se lit
     * donc « sa compagnie, telle faction ». C'est plus sûr qu'un filtre
     * territorial librement choisi — on ne peut pas demander la compagnie du
     * voisin — et c'est ce que le RBAC impose déjà partout ailleurs.
     *
     * La structure semée rend l'attendu vérifiable à l'unité près : une
     * compagnie porte au plus un barrage par faction, une brigade en porte
     * exactement un.
     */
    const sCie = await ouvrir('FA-CIE');
    const sesBarrages = ((await appeler(sCie, 'marquages')).corps.items ?? []).filter(estBarrage);
    const sesFactions = new Set(sesBarrages.map((m) => m.factionId).filter(Boolean));

    dit(
      sesBarrages.every((m) => m.cie === CIE),
      'compagnie + faction : tous les postes rendus sont de SA compagnie',
      `${sesBarrages.length} poste(s) dans ${CIE}`,
    );

    let combineJuste = true;
    for (const x of factions) {
      const r = await appeler(sCie, `marquages?faction=${x.id}`);
      const rendus = (r.corps.items ?? []).filter(estBarrage);
      const attendus = sesBarrages.filter((m) => m.factionId === x.id);
      if (rendus.length !== attendus.length) combineJuste = false;
      if (!rendus.every((m) => m.cie === CIE && m.factionId === x.id)) combineJuste = false;
    }
    dit(
      combineJuste,
      'compagnie + faction : le résultat croise bien les DEUX filtres',
      `${sesFactions.size} faction(s) représentée(s) dans ${CIE}`,
    );

    const sBt = await ouvrir('FA-BT');
    const sonBarrage = ((await appeler(sBt, 'marquages')).corps.items ?? []).filter(estBarrage);
    dit(
      sonBarrage.every((m) => m.bt === BT && m.cie === CIE),
      'compagnie + brigade + faction : le périmètre de brigade est appliqué',
      `${sonBarrage.length} poste(s) dans ${BT}`,
    );

    let triJuste = true;
    let vus = 0;
    for (const x of factions) {
      const r = await appeler(sBt, `marquages?faction=${x.id}`);
      const rendus = (r.corps.items ?? []).filter(estBarrage);
      vus += rendus.length;
      const attendus = sonBarrage.filter((m) => m.factionId === x.id);
      if (rendus.length !== attendus.length) triJuste = false;
      if (!rendus.every((m) => m.bt === BT && m.factionId === x.id)) triJuste = false;
    }
    dit(triJuste, 'compagnie + brigade + faction : les TROIS filtres se croisent');
    dit(
      vus === sonBarrage.filter((m) => m.factionId).length,
      'et chaque poste de la brigade n’apparaît que dans SA faction',
      `${vus} apparition(s) sur ${sonBarrage.length} poste(s)`,
    );

    /* Une faction que la brigade ne tient pas doit rendre une carte VIDE — et
       non la carte entière, ce que ferait un filtre mal branché. */
    const absente = factions.find((x) => !sonBarrage.some((m) => m.factionId === x.id));
    if (absente) {
      const r = await appeler(sBt, `marquages?faction=${absente.id}`);
      dit(
        (r.corps.items ?? []).filter(estBarrage).length === 0,
        `une faction que la brigade ne tient pas rend zéro barrage (${absente.id})`,
      );
    }
  }

  /* ================================================================ */
  console.log('\n=== 6. TOUT SURVIT AU REDÉMARRAGE ===\n');

  const avant = JSON.stringify({
    compteurs: f.corps.compteurs,
    sansFaction: f.corps.sansFaction,
    total: f.corps.total,
  });

  await terminer(service);
  service = await demarrer();
  const admin2 = await ouvrir('FA-ADMIN');
  const apres = await appeler(admin2, 'factions');

  dit(
    JSON.stringify({
      compteurs: apres.corps.compteurs,
      sansFaction: apres.corps.sansFaction,
      total: apres.corps.total,
    }) === avant,
    'les mêmes chiffres après redémarrage — rien n’était en mémoire',
  );
  dit(
    JSON.stringify(apres.corps.assignations) === JSON.stringify(f.corps.assignations),
    'et les mêmes relations Barrage → Faction',
  );
  dit(
    apres.corps.factions.length === 4 &&
      apres.corps.factions.every((x, i) => x.id === factions[i].id),
    'la définition des factions est inchangée',
  );
} finally {
  await terminer(service);
  rmSync(travail, { recursive: true, force: true });
}

console.log(`\n  ${ok} épreuve(s) réussie(s), ${echecs.length} échec(s).`);
if (echecs.length) {
  for (const e of echecs) console.log(`    - ${e}`);
  process.exit(1);
}
console.log('');
