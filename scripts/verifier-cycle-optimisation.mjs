#!/usr/bin/env node
/**
 * ÉPREUVE DU CYCLE DE VIE D'UNE OPTIMISATION, bout en bout, sur un vrai
 * service et de vraies données.
 *
 * `verifier-optimisation-trajet.mjs` éprouve la DÉCISION : ce que l'analyse
 * propose, sur quel critère, et ce qu'elle refuse de faire. Ce script-ci
 * éprouve ce qui vient APRÈS, et qui ne se voit pas dans une fonction pure :
 *
 *   1. ANALYSER n'écrit rien — le dispositif est intact après le calcul, et
 *      chaque proposition porte l'avant ET l'après, de quoi l'afficher sur la
 *      carte avant d'engager quoi que ce soit ;
 *   2. APPLIQUER n'écrit que ce qui a été RETENU, déplace ou réaffecte sans
 *      rien effacer, et ouvre une demande de validation au commandement ;
 *   3. REDÉMARRER le service ne perd aucun changement ;
 *   4. RESTAURER rend au poste sa position ET sa faction d'origine ;
 *   5. REFUSER la validation restaure de la même façon ;
 *   6. le RBAC n'est pas contourné ;
 *   7. le mode MANUEL n'a pas bougé.
 *
 *   node scripts/verifier-cycle-optimisation.mjs --donnees donnees-demo
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chargerComptes, definirCompte, enregistrerComptes } from '../serveur/comptes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8300 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'Cycle-Optim-2026';

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

const travail = mkdtempSync(join(tmpdir(), 'gr-cycle-optim-'));
const DONNEES = join(travail, 'donnees');
cpSync(source, DONNEES, { recursive: true });
rmSync(join(DONNEES, 'sauvegardes'), { recursive: true, force: true });
console.log(`\n  donnees d'epreuve : copie de ${source}`);

/* Le périmètre d'épreuve est tiré du jeu de données : coder une unité en dur
   marcherait aujourd'hui et casserait sur un autre dépôt. */
const marquages = JSON.parse(readFileSync(join(DONNEES, 'marquages.json'), 'utf8')).items ?? [];
const TYPES = ['barrage_fixe', 'barrage_mobile'];
const HORS_SERVICE = ['supprime', 'retire_optimisation'];
const postesFichier = marquages.filter(
  (m) => TYPES.includes(m.type) && !HORS_SERVICE.includes(m.statutBarrage) && m.bt && m.cie,
);
if (!postesFichier.length) {
  console.error('\nAucun barrage rattaché dans ce jeu de données.\n');
  rmSync(travail, { recursive: true, force: true });
  process.exit(1);
}
const parCie = new Map();
for (const m of postesFichier) parCie.set(m.cie, (parCie.get(m.cie) ?? 0) + 1);
const CIE = [...parCie.entries()].sort((a, b) => b[1] - a[1])[0][0];
const modele = postesFichier.find((m) => m.cie === CIE);
const REG = modele.reg;
const BT = modele.bt;

{
  const f = join(DONNEES, 'comptes.json');
  const etat = chargerComptes(f);
  for (const c of [
    {
      matricule: 'CY-ADMIN',
      rang: 'admin',
      unite: 'cy-admin',
      nom: 'Administration',
      role: 'commandement',
    },
    { matricule: 'CY-REG', rang: 'reg', unite: REG, nom: 'Commandement région', role: 'commandement' },
    {
      matricule: 'CY-LECTURE',
      rang: 'unite',
      unite: BT,
      nom: 'Brigade lecture',
      role: 'lecture',
      reg: REG,
      cie: CIE,
    },
  ]) {
    await definirCompte(etat, { ...c, code: CODE });
  }
  enregistrerComptes(f, etat);
}
console.log(`  périmètre d'épreuve : région ${REG} > compagnie ${CIE}\n`);

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function demarrer() {
  const proc = spawn(
    process.execPath,
    [
      join(ROOT, 'scripts', 'serve.mjs'),
      '--port',
      String(PORT),
      '--host',
      '127.0.0.1',
      '--donnees',
      DONNEES,
    ],
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

const appeler = async (cookie, chemin, { methode = 'GET', corps = null } = {}) => {
  const r = await fetch(`${BASE}/api/${chemin}`, {
    method: methode,
    signal: AbortSignal.timeout(600_000),
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte', Cookie: cookie },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { statut: r.status, corps: await r.json().catch(() => ({})) };
};

/** Le fichier lui-même : « pas d'effacement » ne se vérifie pas sur une réponse HTTP. */
const surDisque = () => {
  const brut = JSON.parse(readFileSync(join(DONNEES, 'marquages.json'), 'utf8'));
  return brut.items ?? brut;
};

/** Ce qu'une restauration doit rendre à l'identique. */
const CHAMPS = [
  'id',
  'type',
  'nom',
  'lng',
  'lat',
  'route',
  'factionId',
  'debut',
  'fin',
  'bt',
  'cie',
  'reg',
  'cree',
];
const empreinte = (m) => JSON.stringify(Object.fromEntries(CHAMPS.map((c) => [c, m?.[c]])));

let service = await demarrer();

try {
  const admin = await ouvrir('CY-ADMIN');
  if (!admin) throw new Error('Session administrateur refusée.');

  /* ================================================================ */
  console.log('1. L’ANALYSE N’ÉCRIT RIEN\n');

  const avant = await appeler(admin, 'marquages');
  const fixesAvant = (avant.corps.items ?? []).filter((m) => TYPES.includes(m.type));

  const analyse = await appeler(admin, 'barrages/optimisation-auto', {
    methode: 'POST',
    /* AUCUN PARAMÈTRE D'OPTIMISATION N'EST ENVOYÉ — c'est le point du mode
       automatique. Le seuil est celui du serveur : une heure de route. */
    corps: { niveau: 'compagnie', unite: CIE },
  });

  dit(analyse.statut === 200, 'l’analyse répond', `statut ${analyse.statut}`);
  const resume = analyse.corps.resume ?? {};
  dit(
    analyse.corps.critere === 'temps_trajet_routier',
    'le critère est le TEMPS DE TRAJET par la route',
    `seuil ${analyse.corps.seuilMinutes} min`,
  );
  dit(
    analyse.corps.seuilMinutes === 60,
    'le seuil est UNE HEURE, sans qu’aucun paramètre ait été envoyé',
  );
  dit(
    typeof resume.conflitsAvant === 'number' && typeof resume.conflitsApres === 'number',
    'les conflits sont comptés avant et après',
    `${resume.conflitsAvant} → ${resume.conflitsApres} (${resume.conflitsResolus} dénoués)`,
  );
  dit(
    resume.retraits === 0 && resume.deplacements === 0,
    'AUCUN retrait, AUCUN déplacement : l’optimisation ne fait que réaffecter',
    `${resume.changementsFaction} réaffectation(s), ${resume.maintiens} maintien(s)`,
  );

  const propositions = analyse.corps.propositions ?? [];
  const applicables = propositions.filter((p) => p.action !== 'conserver');
  dit(
    propositions.every((p) => ['changer_faction', 'conserver'].includes(p.action)),
    'chaque proposition porte une action connue',
    `${applicables.length} applicable(s) sur ${propositions.length}`,
  );
  dit(
    propositions.every((p) => (p.raisons ?? []).length >= 4 && p.conflit?.nom),
    'chacune s’explique et nomme le poste en conflit',
  );
  dit(
    propositions.every(
      (p) =>
        p.nouvelleLng === undefined &&
        p.nouvelleLat === undefined &&
        p.nouvelleRoute === undefined,
    ),
    'AUCUNE proposition ne porte de nouvelle position — le barrage est intouchable',
  );
  dit(
    propositions
      .filter((p) => p.action === 'changer_faction')
      .every((p) => p.nouvelleFactionId && p.nouvelleFactionId !== p.factionId),
    'une réaffectation nomme une faction, et une AUTRE que l’actuelle',
  );
  dit(
    propositions
      .filter((p) => p.action === 'conserver')
      .every((p) => (p.raisons ?? []).some((r) => /affectation inchangée/i.test(r))),
    'un conflit non résolu dit « barrage conservé, affectation inchangée »',
  );

  const apresAnalyse = await appeler(admin, 'marquages');
  const fixesApresAnalyse = (apresAnalyse.corps.items ?? []).filter((m) => TYPES.includes(m.type));
  dit(
    JSON.stringify(fixesApresAnalyse.map(empreinte)) === JSON.stringify(fixesAvant.map(empreinte)),
    'le dispositif est RIGOUREUSEMENT intact après l’analyse',
    `${fixesAvant.length} poste(s)`,
  );

  if (!applicables.length) {
    console.log('\n  Aucune proposition applicable sur ce périmètre : le cycle s’arrête ici.\n');
  } else {
    /* ============================================================== */
    console.log('\n2. APPLIQUER N’ÉCRIT QUE CE QUI EST RETENU\n');

    const cible = applicables[0];
    const original = fixesAvant.find((m) => m.id === cible.id);
    const empreinteAvant = empreinte(original);
    const nonRetenues = applicables.slice(1).map((p) => p.id);

    const envoyer = (cookie) =>
      appeler(cookie, 'barrages/appliquer-optimisation-auto', {
        methode: 'POST',
        corps: {
          propositions: [
            {
              id: cible.id,
              action: cible.action,
              nouvelleFactionId: cible.nouvelleFactionId,
              minutesAvant: cible.minutesAvant,
              minutesApres: cible.minutesApres,
              raison: cible.raison,
            },
          ],
          parametres: analyse.corps.parametres,
          resume: analyse.corps.resume,
        },
      });

    /**
     * LA SIGNATURE DES ÉLÉMENTS — relevée AVANT, comparée APRÈS.
     *
     * C'est la garantie que le commandement a nommée en premier : les hommes
     * du barrage ne changent pas. Ils vivent dans le dépôt des relèves, que la
     * route d'application ne touche pas — encore faut-il le PROUVER, et non
     * le supposer.
     */
    const elementsDe = async (cookie, id) => {
      const r = await appeler(cookie, `elements?barrageId=${encodeURIComponent(id)}`);
      return (r.corps.items ?? [])
        .map((e) => `${e.matricule}|${e.grade}|${e.nom}|${e.creneau}|${e.date}`)
        .sort()
        .join(';');
    };
    const elementsAvantApplication = await elementsDe(admin, cible.id);

    const application = await envoyer(admin);
    dit(application.statut === 200, 'l’application répond', `statut ${application.statut}`);
    dit(
      application.corps.appliques === 1,
      'un seul changement a été écrit, celui qui était retenu',
      `${applicables.length} applicable(s), 1 retenu — action « ${cible.action} »`,
    );

    const apresApplication = await appeler(admin, 'marquages');
    const parId = new Map((apresApplication.corps.items ?? []).map((m) => [m.id, m]));
    const modifie = parId.get(cible.id);
    const elementsApresApplication = await elementsDe(admin, cible.id);

    dit(Boolean(modifie), 'le poste est TOUJOURS dans le dispositif — rien n’a été retiré');
    dit(
      modifie.factionId === cible.nouvelleFactionId,
      'sa faction est celle qui était proposée',
      `${original.factionId} → ${modifie.factionId}`,
    );

    /**
     * LE CRITERE DE VALIDATION EXIGE PAR LE COMMANDEMENT.
     *
     * Champ par champ, avant contre apres. La seule difference autorisee est
     * la faction ; tout le reste — identite, coordonnees, type, horaire,
     * duree, statut — doit etre RIGOUREUSEMENT identique. Ce controle est la
     * raison d'etre de cette etape : il ne verifie pas que le code a bien
     * fonctionne, il verifie que la regle a tenu de bout en bout, a travers
     * l'analyse, le reseau, la route d'ecriture et le depot.
     */
    const INTOUCHABLES = [
      ['id', 'identifiant'],
      ['lng', 'longitude'],
      ['lat', 'latitude'],
      ['type', 'type'],
      ['nom', 'nom'],
      ['route', 'axe'],
      ['debut', 'heure de début'],
      ['fin', 'heure de fin'],
      ['statutBarrage', 'statut'],
      ['bt', 'brigade'],
      ['cie', 'compagnie'],
      ['reg', 'région'],
    ];
    const ecarts = INTOUCHABLES.filter(([c]) => original[c] !== modifie[c]).map(
      ([c, libelle]) => `${libelle} : ${original[c]} → ${modifie[c]}`,
    );
    dit(
      ecarts.length === 0,
      'AVANT/APRÈS : identité, coordonnées, type, horaire, durée et statut IDENTIQUES',
      ecarts.length ? ecarts.join(' ; ') : `${INTOUCHABLES.length} champs contrôlés`,
    );

    /**
     * ET LES ELEMENTS. C'est la garantie que le commandement a nommee en
     * premier : les hommes du barrage ne changent pas. Ils vivent dans le
     * depot des releves, que la route d'application ne touche pas — encore
     * faut-il le PROUVER, et non le supposer.
     */
    dit(
      elementsApresApplication === elementsAvantApplication,
      'les ÉLÉMENTS du barrage sont STRICTEMENT INCHANGÉS',
      elementsAvantApplication
        ? `${elementsAvantApplication.split(';').length} élément(s), signature identique`
        : 'aucun élément sur ce poste',
    );
    dit(
      modifie.optimisationAuto?.avant?.lng === original.lng &&
        modifie.optimisationAuto?.avant?.factionId === (original.factionId || ''),
      'l’état d’AVANT est recopié dans la fiche — c’est ce qui rend le geste réversible',
    );
    dit(
      modifie.optimisationAuto?.critere === 'temps_trajet_routier' &&
        Boolean(modifie.optimisationAuto?.appliquePar),
      'la trace dit le critère, l’action, la date et qui a appliqué',
      modifie.optimisationAuto?.action,
    );
    dit(
      nonRetenues.every((id) => {
        const m = parId.get(id);
        const o = fixesAvant.find((x) => x.id === id);
        return m && o && m.lng === o.lng && m.lat === o.lat && m.factionId === o.factionId;
      }),
      'les propositions NON retenues n’ont pas été touchées',
      `${nonRetenues.length} écartée(s)`,
    );

    /**
     * UNE REQUÊTE FORGÉE NE DÉPLACE PAS UN BARRAGE.
     *
     * L'interface n'offre plus de déplacement — mais une interface ne garde
     * rien. On envoie donc au serveur exactement ce que l'ancienne version
     * envoyait : `action: 'deplacer'` avec une position d'arrivée. Il doit
     * refuser, et le poste ne doit pas avoir bougé d'un mètre.
     */
    const forgee = await appeler(admin, 'barrages/appliquer-optimisation-auto', {
      methode: 'POST',
      corps: {
        propositions: [
          {
            id: cible.id,
            action: 'deplacer',
            nouvelleLng: (original.lng ?? 0) + 0.05,
            nouvelleLat: (original.lat ?? 0) + 0.05,
            raison: 'requête forgée',
          },
        ],
      },
    });
    dit(
      forgee.statut === 403 || (forgee.corps.appliques ?? 0) === 0,
      'une requête forgée « deplacer » est REFUSÉE par le serveur',
      `statut ${forgee.statut} · ${forgee.corps.refuses?.[0]?.raison ?? '—'}`,
    );
    const apresForgee = await appeler(admin, 'marquages');
    const nonBouge = (apresForgee.corps.items ?? []).find((m) => m.id === cible.id);
    dit(
      nonBouge?.lng === modifie.lng && nonBouge?.lat === modifie.lat,
      'et le poste n’a pas bougé d’un mètre',
      `${nonBouge?.lng},${nonBouge?.lat}`,
    );

    const ligneDisque = surDisque().find((m) => m.id === cible.id);
    dit(Boolean(ligneDisque), 'la ligne est toujours dans marquages.json — aucun DELETE physique');
    dit(
      ligneDisque?.statutBarrage !== 'supprime',
      'et le poste reste en service',
      ligneDisque?.statutBarrage,
    );

    const notifs = await appeler(admin, 'instructions');
    const demandeValidation = (notifs.corps.items ?? []).find(
      (i) => i.barrageId === cible.id && i.action === 'retrait_optimisation',
    );
    dit(Boolean(demandeValidation), 'une demande de validation est ouverte');
    dit(
      demandeValidation?.aDecider === 'unite',
      'adressée au commandement concerné (RBAC respecté)',
      String(demandeValidation?.aDecider),
    );

    /* ============================================================== */
    console.log('\n3. TOUT SURVIT AU REDÉMARRAGE\n');

    await terminer(service);
    service = await demarrer();
    const admin2 = await ouvrir('CY-ADMIN');

    const apresRedemarrage = await appeler(admin2, 'marquages');
    const relu = (apresRedemarrage.corps.items ?? []).find((m) => m.id === cible.id);
    dit(
      relu && empreinte(relu) === empreinte(modifie),
      'le changement est identique après redémarrage — rien n’était en mémoire',
    );
    dit(
      relu?.optimisationAuto?.avant != null,
      'et l’état d’avant est toujours là, donc toujours réversible',
    );

    /* ============================================================== */
    console.log('\n4. LA RESTAURATION REND POSITION ET FACTION\n');

    const restauration = await appeler(admin2, `barrages/${cible.id}/restaurer-optimisation`, {
      methode: 'POST',
    });
    dit(restauration.statut === 200, 'la restauration répond', `statut ${restauration.statut}`);
    const rendu = restauration.corps.barrage;
    dit(
      empreinte(rendu) === empreinteAvant,
      'le poste retrouve EXACTEMENT sa position, sa route et sa faction d’origine',
    );
    dit(rendu?.optimisationAuto === null, 'la marque d’optimisation a été effacée');

    /* ============================================================== */
    console.log('\n5. UN REFUS DE VALIDATION RESTAURE AUSSI\n');

    const application2 = await envoyer(admin2);
    dit(application2.statut === 200, 'le changement est appliqué une seconde fois');

    const notifs2 = await appeler(admin2, 'instructions');
    const aRefuser = (notifs2.corps.items ?? [])
      .filter((i) => i.barrageId === cible.id && i.action === 'retrait_optimisation')
      .find((i) => i.statut === 'ouverte');

    if (!aRefuser) {
      dit(false, 'une demande ouverte est disponible pour le refus');
    } else {
      const parLAuteur = await appeler(admin2, `instructions/${aRefuser.id}`, {
        methode: 'PATCH',
        corps: { action: 'refuser', commentaire: 'Refus de l’auteur' },
      });
      dit(
        parLAuteur.statut === 403,
        'nul ne tranche sa propre demande (RBAC non contourné)',
        `statut ${parLAuteur.statut}`,
      );

      const chef = await ouvrir('CY-REG');
      const refus = await appeler(chef, `instructions/${aRefuser.id}`, {
        methode: 'PATCH',
        corps: { action: 'refuser', commentaire: 'Ce poste reste où il est.' },
      });
      dit(refus.statut === 200, 'le commandement concerné peut refuser', `statut ${refus.statut}`);

      const adminFin = await ouvrir('CY-ADMIN');
      const listeFin = await appeler(adminFin, 'marquages');
      const revenu = (listeFin.corps.items ?? []).find((m) => m.id === cible.id);
      dit(
        revenu && empreinte(revenu) === empreinteAvant,
        'le refus rend au poste sa position et sa faction d’origine',
      );
    }
  }

  /* ================================================================ */
  console.log('\n6. LE RBAC N’EST PAS CONTOURNÉ\n');

  {
    const lecteur = await ouvrir('CY-LECTURE');
    dit(Boolean(lecteur), 'le compte en lecture seule ouvre une session');

    const analyseLecteur = await appeler(lecteur, 'barrages/optimisation-auto', {
      methode: 'POST',
      corps: {},
    });
    dit(
      analyseLecteur.statut === 200,
      'il peut LIRE une analyse (elle n’écrit rien)',
      `statut ${analyseLecteur.statut}`,
    );

    const tentative = await appeler(lecteur, 'barrages/appliquer-optimisation-auto', {
      methode: 'POST',
      corps: {
        propositions: [{ id: 'inexistant', action: 'changer_faction', nouvelleFactionId: 'F1' }],
      },
    });
    dit(
      tentative.statut === 403,
      'mais il ne peut RIEN appliquer — compte en lecture seule',
      `statut ${tentative.statut}`,
    );

    const sansSession = await fetch(`${BASE}/api/barrages/optimisation-auto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte' },
      body: JSON.stringify({}),
    });
    dit(
      sansSession.status === 401,
      'et sans session, l’analyse est refusée',
      `statut ${sansSession.status}`,
    );
  }

  /* ================================================================ */
  console.log('\n7. LE MODE MANUEL N’A PAS BOUGÉ\n');

  {
    const admin3 = await ouvrir('CY-ADMIN');
    const manuel = await appeler(admin3, 'barrages/consolidation', {
      methode: 'POST',
      corps: {
        distanceMinKm: 5,
        niveau: null,
        unite: null,
        positionVille: null,
        accidents: false,
        seuilAccidents: 0,
        vip: false,
        nonEclaire: false,
      },
    });

    dit(manuel.statut === 200, 'la consolidation manuelle répond', `statut ${manuel.statut}`);
    dit(
      (manuel.corps.barrages?.length ?? 0) > 0 && manuel.corps.bilan?.examines > 0,
      'elle mesure toujours le dispositif EN KILOMÈTRES, comme avant',
      `${manuel.corps.bilan?.examines} examiné(s), ${manuel.corps.bilan?.sousLeSeuil} sous le seuil`,
    );
    const PORTES = ['entree', 'sortie', 'porte'];
    const proposables = (manuel.corps.barrages ?? []).filter(
      (b) => PORTES.includes(b.positionVille) && b.intouchable !== true,
    );
    dit(proposables.length === 0, 'et aucune porte de ville n’y est proposable');
  }
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
