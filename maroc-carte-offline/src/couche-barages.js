/**
 * Couche « Barages » sur la carte : chargement du jeu de données
 * (`donnees/barages/barages.json`, voir barages.js), icônes, filtres REG / CIE / BT /
 * type / faction / origine dans le panneau Couches, légende, fiche dans le panneau latéral
 * (via l'extension de CouchesGendarmerie), légende de l'impression, et édition :
 * ajouter, déplacer, modifier, supprimer — toujours sur une route carrossable de la
 * bonne circonscription de brigade.
 *
 * Les modifications sont une surcouche enregistrée dans ce navigateur (le fichier du jeu
 * n'est jamais modifié) et s'exportent en un nouveau barages.json. Les filtres changent le
 * filtre des couches (setFilter), jamais les données.
 */
import { enDMS } from './barre-recherche.js';
import {
  COUCHES_AGREGATS, COUCHES_BARAGES, COUCHE_EDITION, COULEURS_BARAGES, CRENEAUX, FILTRES_DEFAUT, LIBELLES_CRENEAUX, NON_AFFECTE,
  RAYON_ACCROCHE_M, SANS_COMPAGNIE, SOURCE_AGREGATS, SOURCE_BARAGES, ZOOM_CIE, ZOOM_DETAIL, agregerBarages, appliquerEditions,
  construireHierarchie, correspond, couchesBarages, editionsVides, entitesBarages, expressionFiltre, factionDeLHeure, filtrePour,
  jeuExporte, lireEditions, lireJeuBarages, nombreEditions, normaliserFiltres, numeroFaction, optionsFiltres, refusModification,
  retirerSimules, traceValidation, trierBarages, typeEtFaction, validerBarage, validerEmplacement,
  entitesRetires, expressionFiltreRetires, restaurerBarage, retirerBarage, retraitsAffiches, atteintesProtegees, estProtege, MESSAGE_PROTEGE,
} from './barages.js';
import { telecharger } from './croquis.js';
import { element } from './dom.js';
import { emprise as empriseAutour, formaterDistance } from './mesure.js';

const CLE = 'maroc-carte:barages:v1';
const CLE_EDITIONS = 'maroc-carte:barages-editions:v1';
const MESSAGE_LECTURE_SEULE = 'Compte régional : consultation seulement. Proposez un déplacement ou une suppression depuis « Optimiser » (conflits assignés).';

const TEXTES = {
  fr: {
    type: { fixe: 'Barage fixe', intouchable: 'Barage fixe intouchable' },
    typeCourt: { tous: 'Tous', fixe: 'Fixes', intouchable: 'Intouchables' },
    origineCourt: { '': 'Toutes', simulation: 'Simulées', reelle: 'Réelles' },
    legende: { fixe: 'Barage fixe · une faction de 6 h', intouchable: 'Barage fixe intouchable · 24 h/24, sans faction' },
    simulation: 'Simulation',
    chargement: 'Chargement des barages…',
    absent: 'Jeu de barages absent : lancez « npm run barages » (données simulées).',
    erreur: (m) => `Barages illisibles : ${m}`,
    affiches: (n, total, f) => `${f.format(n)} affiché${n > 1 ? 's' : ''} sur ${f.format(total)}`,
    simules: 'données simulées',
    rejetes: (n) => `${n} enregistrement${n > 1 ? 's' : ''} rejeté${n > 1 ? 's' : ''} (invalide${n > 1 ? 's' : ''})`,
    referentiel: 'Jeu préparé pour un autre import des circonscriptions : les brigades peuvent ne plus correspondre. Relancez « npm run barages ».',
    sansCie: (n) => `${n} barage${n > 1 ? 's' : ''} dans une brigade sans circonscription de compagnie connue`,
    orphelines: (n) => `${n} modification${n > 1 ? 's' : ''} locale${n > 1 ? 's' : ''} visant un barage absent du jeu installé (ignorée${n > 1 ? 's' : ''})`,
    toutes: 'Toutes', toutesFactions: 'Toutes les factions', nonAffecte: 'Barages intouchables (24 h/24)',
    aucuneCie: 'Sans compagnie connue',
    identifiant: 'Identifiant', typeLigne: 'Type', faction: 'Faction', sansFaction: 'Barage intouchable · permanent 24 h/24',
    factionN: (n) => `Faction ${n}`, toutesCourt: 'Toutes', nonAffecteCourt: 'Barages intouchables',
    plusIntouchables: '+ intouchables (24 h/24)',
    legendeSimule: 'Simulé : anneau pointillé (et « SIM » de près)',
    legendeGroupe: 'Groupe de barages réels : par région (zoom < 7), par compagnie (< 9)',
    legendeGroupeSimule: 'Groupe de barages simulés (jamais mêlés aux réels)',
    heureActuelle: 'Heure actuelle',
    heureActuelleTitre: (heure, fuseau, faction) => `${faction} : faction de l’heure actuelle (${heure}, fuseau ${fuseau} de cet appareil). Affectation, pas un état en temps réel.`,
    groupe: (n, fixes, intouchables, sim) => `${n} barage${n > 1 ? 's' : ''}${sim ? ' simulé' + (n > 1 ? 's' : '') : ' réel' + (n > 1 ? 's' : '')} · ${fixes} fixe${fixes > 1 ? 's' : ''}, ${intouchables} intouchable${intouchables > 1 ? 's' : ''} · clic : approcher`,
    regionInconnue: 'Région inconnue', compagnieInconnue: 'Compagnie inconnue',
    origineVerrouillee: 'L’origine (simulée / réelle) d’un barage du jeu installé ne se change pas ici : seuls les barages ajoutés dans ce navigateur peuvent changer d’origine.',
    retirerSimulesConfirmer: (n) => `Retirer les ${n} barages simulés de l’affichage ? Les barages réels ne sont pas touchés ; « Annuler les modifications locales » les fait revenir.`,
    simulesRetires: (n) => `${n} barage${n > 1 ? 's' : ''} simulé${n > 1 ? 's' : ''} retiré${n > 1 ? 's' : ''} (modification locale).`,
    zoomDetail: 'Zoomez (niveau 9 ou plus) pour voir les barages un par un.',
    noteFaction: 'Les barages intouchables (24 h/24) restent affichés quelle que soit la faction ; le type « Fixes » les masque.',
    brigade: 'Brigade', compagnie: 'Compagnie', region: 'Région', route: 'Route', position: 'Position', donnee: 'Donnée',
    donneeSimulee: 'Simulée (isSimulation)', donneeReelle: 'Réelle (saisie ou jeu fourni)',
    modifieLocalement: ' · modifié dans ce navigateur',
    cieInconnue: (nom) => `non résolue${nom ? ` (la brigade indique « ${nom} », sans circonscription)` : ''}`,
    nonResolue: 'non résolue', routeSansNom: 'route sans nom',
    noteSimulation: 'Donnée simulée pour les tests : position fictive, ce n’est pas un emplacement opérationnel. La faction est une affectation, pas un état en temps réel.',
    noteReelle: 'La faction est une affectation enregistrée, pas un état en temps réel.',
    voirBt: 'Voir la circonscription BT', modifier: 'Modifier',
    deplacer: 'Déplacer', retirer: 'Supprimer', fermer: 'Fermer', restaurer: 'Restaurer',
    protege: 'Barage fixe — intouchable', statutProtege: 'Barage fixe — intouchable : jamais déplacé ni supprimé par l’optimisation (point de référence des analyses)',
    alertes: 'Alertes de proximité', alerteAvec: (id, km) => `avec ${id} à ${km} par la route`, voirAlerte: 'Voir l’alerte',
    ancienRetire: 'Ancien barage — retiré', retireLe: 'Retiré le', statut: 'Statut', statutRetire: 'Retiré du jeu actif (historique)',
    noteRetire: 'Ancien emplacement conservé pour l’historique : ce barage n’est plus compté, n’entre dans aucun calcul (proximité, espacement, carte de chaleur) et peut être restauré.',
    retirerConfirmer: (b, faction, bt) => `Retirer le barage « ${b.name || b.id} » (${b.id}) ?\n${faction} · ${bt}\n${b.latitude.toFixed(5)}, ${b.longitude.toFixed(5)}\n\nIl quitte le jeu actif (calculs, compteurs, filtres). Son ancien emplacement reste marqué « Ancien barage — retiré » et il peut être restauré. Modification locale à ce navigateur.`,
    retire: (id) => `${id} retiré : son ancien emplacement reste marqué sur la carte (historique).`,
    restaurerConfirmer: (b) => `Restaurer le barage « ${b.name || b.id} » (${b.id}) à ${b.latitude.toFixed(5)}, ${b.longitude.toFixed(5)} ?\n\nIl redevient actif avec ses informations d’origine (identifiant, faction, brigade).`,
    restaure: (id) => `${id} restauré : de nouveau actif.`,
    refus: (texte) => `Rien n’a été modifié : ${texte}`,
    legendeRetire: 'Ancien barage — retiré (historique, hors calculs)',
    voirActifs: 'Barages actifs', voirRetires: 'Barages retirés (historique)', nbRetires: (n) => (n ? `${n} ancien${n > 1 ? 's' : ''} emplacement${n > 1 ? 's' : ''}` : 'aucun'),
    annulationRetrait: 'annulation des modifications locales',
    titreImpression: (sim) => `Barages${sim ? ' (simulation)' : ''}`,
    // Édition
    ajouter: 'Ajouter sur une route',
    aideAjout: `Cliquez sur une route (à moins de ${RAYON_ACCROCHE_M} m) : le barage s'y accroche. Échap pour arrêter.`,
    aideDeplacement: (nom) => `Cliquez sur une route de la brigade ${nom} pour y déplacer le barage. Échap pour annuler.`,
    rechercheRoute: 'Recherche de la route…',
    horsRoute: `Aucune route carrossable à moins de ${RAYON_ACCROCHE_M} m (ou pas de données routières ici) : barage non posé.`,
    horsBt: 'Ce point de route n’est dans aucune circonscription de brigade : barage non posé.',
    autreBt: (nom) => `Aucune route de la brigade ${nom} à moins de ${RAYON_ACCROCHE_M} m : un barage reste dans sa brigade.`,
    routesIllisibles: 'Routes illisibles ici (tuiles) : barage non posé.',
    accroche: (route, d) => `Posé sur ${route}${d >= 1 ? `, à ${d} du clic` : ''}.`,
    invalide: (m) => `Modification refusée : ${m}`,
    nouveauNom: (route) => `Barage ${route}`.trim(),
    editionTitre: (id) => `Modification · ${id}`,
    prochainAjout: 'Réglages du prochain ajout',
    supprimerConfirmer: (nom) => `Supprimer le barage « ${nom} » ? (seulement dans ce navigateur, jusqu’à l’export)`,
    annulerConfirmer: (n) => `Annuler les ${n} modification(s) locale(s) des barages ?`,
    editions: (n) => (n ? `${n} modification${n > 1 ? 's' : ''} locale${n > 1 ? 's' : ''} (ce navigateur) : exportez barages.json pour les transmettre.` : 'Aucune modification locale.'),
    exporte: (n) => `${n} barage${n > 1 ? 's' : ''} exporté${n > 1 ? 's' : ''} : remplacez donnees/barages/barages.json par ce fichier, puis annulez les modifications locales.`,
  },
  ar: {
    type: { fixe: 'حاجز ثابت', intouchable: 'حاجز ثابت دائم' },
    typeCourt: { tous: 'الكل', fixe: 'ثابتة', intouchable: 'دائمة' },
    origineCourt: { '': 'الكل', simulation: 'محاكاة', reelle: 'حقيقية' },
    legende: { fixe: 'حاجز ثابت · فرقة 6 ساعات', intouchable: 'حاجز ثابت دائم · 24/24 ساعة، بدون فرقة' },
    simulation: 'محاكاة',
    chargement: 'جارٍ تحميل الحواجز…',
    absent: 'معطيات الحواجز غير موجودة: شغّل « npm run barages » (معطيات محاكاة).',
    erreur: (m) => `تعذّرت قراءة الحواجز: ${m}`,
    affiches: (n, total, f) => `${f.format(n)} معروض من ${f.format(total)}`,
    simules: 'معطيات محاكاة',
    rejetes: (n) => `${n} سجل مرفوض (غير صالح)`,
    referentiel: 'أُعدّت هذه المعطيات لاستيراد آخر للدوائر: قد لا تتطابق المراكز. أعد تشغيل « npm run barages ».',
    sansCie: (n) => `${n} حاجز في مركز بدون دائرة سرية معروفة`,
    orphelines: (n) => `${n} تعديل محلي يخص حاجزًا غير موجود في المعطيات المثبتة (متجاهَل)`,
    toutes: 'الكل', toutesFactions: 'كل الفرق', nonAffecte: 'الحواجز الدائمة (24/24 ساعة)',
    aucuneCie: 'بدون سرية معروفة',
    identifiant: 'المعرّف', typeLigne: 'النوع', faction: 'الفرقة', sansFaction: 'حاجز دائم · 24/24 ساعة',
    factionN: (n) => `الفرقة ${n}`, toutesCourt: 'الكل', nonAffecteCourt: 'الحواجز الدائمة',
    plusIntouchables: '+ الحواجز الدائمة (24/24 ساعة)',
    legendeSimule: 'محاكاة: حلقة منقطة (و« SIM » عن قرب)',
    legendeGroupe: 'مجموعة حواجز حقيقية: حسب الجهة (تكبير < 7)، حسب السرية (< 9)',
    legendeGroupeSimule: 'مجموعة حواجز محاكاة (لا تُخلط بالحقيقية)',
    heureActuelle: 'الساعة الحالية',
    heureActuelleTitre: (heure, fuseau, faction) => `${faction}: فرقة الساعة الحالية (${heure}، توقيت ${fuseau} لهذا الجهاز). تعيين وليس حالة آنية.`,
    groupe: (n, fixes, intouchables, sim) => `${n} حاجز${sim ? ' (محاكاة)' : ''} · ${fixes} ثابت، ${intouchables} دائم · نقرة: تقريب`,
    regionInconnue: 'جهة غير معروفة', compagnieInconnue: 'سرية غير معروفة',
    origineVerrouillee: 'لا يُغيَّر مصدر (محاكاة / حقيقي) حاجز من المعطيات المثبتة هنا: فقط الحواجز المضافة في هذا المتصفح.',
    retirerSimulesConfirmer: (n) => `إزالة ${n} حاجز محاكاة من العرض؟ الحواجز الحقيقية لا تتأثر؛ « إلغاء التعديلات المحلية » يعيدها.`,
    simulesRetires: (n) => `أُزيل ${n} حاجز محاكاة (تعديل محلي).`,
    zoomDetail: 'كبّر الخريطة (المستوى 9 فأكثر) لرؤية الحواجز واحدًا واحدًا.',
    noteFaction: 'الحواجز الدائمة (24/24 ساعة) تبقى معروضة مهما كانت الفرقة؛ النوع « ثابتة » يخفيها.',
    brigade: 'المركز', compagnie: 'السرية', region: 'الجهة', route: 'الطريق', position: 'الموقع', donnee: 'المعطى',
    donneeSimulee: 'محاكاة (isSimulation)', donneeReelle: 'حقيقية (مُدخلة أو مقدَّمة)',
    modifieLocalement: ' · معدَّل في هذا المتصفح',
    cieInconnue: (nom) => `غير محددة${nom ? ` (المركز يشير إلى « ${nom} » بدون دائرة)` : ''}`,
    nonResolue: 'غير محددة', routeSansNom: 'طريق بدون اسم',
    noteSimulation: 'معطى محاكاة للاختبار: موقع وهمي وليس موقعًا عملياتيًا. الفرقة تعيين وليست حالة آنية.',
    noteReelle: 'الفرقة تعيين مسجّل وليست حالة آنية.',
    voirBt: 'عرض دائرة المركز', modifier: 'تعديل',
    deplacer: 'نقل', retirer: 'حذف', fermer: 'إغلاق', restaurer: 'استعادة',
    protege: 'حاجز ثابت — لا يُمس', statutProtege: 'حاجز ثابت لا يُمس: لا يُنقل ولا يُحذف',
    alertes: 'تنبيهات القرب', alerteAvec: (id, km) => `مع ${id} على بعد ${km} عبر الطريق`, voirAlerte: 'عرض التنبيه',
    ancienRetire: 'حاجز سابق — مسحوب', retireLe: 'سُحب في', statut: 'الحالة', statutRetire: 'مسحوب من المجموعة النشطة (أرشيف)',
    noteRetire: 'الموقع السابق محفوظ للأرشيف: لا يُحتسب هذا الحاجز ولا يدخل في أي حساب، ويمكن استعادته.',
    retirerConfirmer: (b, faction, bt) => `سحب الحاجز « ${b.name || b.id} » (${b.id})؟\n${faction} · ${bt}\n${b.latitude.toFixed(5)}, ${b.longitude.toFixed(5)}\n\nيبقى موقعه السابق معلّماً ويمكن استعادته.`,
    retire: (id) => `سُحب ${id}: موقعه السابق يبقى معلّماً على الخريطة.`,
    restaurerConfirmer: (b) => `استعادة الحاجز « ${b.name || b.id} » (${b.id})؟`,
    restaure: (id) => `استُعيد ${id}.`,
    refus: (texte) => `لم يُغيَّر شيء: ${texte}`,
    legendeRetire: 'حاجز سابق — مسحوب (أرشيف، خارج الحسابات)',
    voirActifs: 'الحواجز النشطة', voirRetires: 'الحواجز المسحوبة (أرشيف)', nbRetires: (n) => (n ? `${n}` : '—'),
    annulationRetrait: 'إلغاء التعديلات المحلية',
    titreImpression: (sim) => `الحواجز${sim ? ' (محاكاة)' : ''}`,
    ajouter: 'إضافة على طريق',
    aideAjout: `انقر على طريق (أقل من ${RAYON_ACCROCHE_M} م): يُثبَّت الحاجز عليه. Esc للتوقف.`,
    aideDeplacement: (nom) => `انقر على طريق تابع لمركز ${nom} لنقل الحاجز إليه. Esc للإلغاء.`,
    rechercheRoute: 'جارٍ البحث عن الطريق…',
    horsRoute: `لا يوجد طريق صالح للسير على أقل من ${RAYON_ACCROCHE_M} م (أو لا توجد معطيات طرقية هنا): لم يُوضع الحاجز.`,
    horsBt: 'هذه النقطة من الطريق خارج دوائر المراكز: لم يُوضع الحاجز.',
    autreBt: (nom) => `لا يوجد طريق تابع لمركز ${nom} على أقل من ${RAYON_ACCROCHE_M} م: يبقى الحاجز في مركزه.`,
    routesIllisibles: 'تعذّرت قراءة الطرق هنا: لم يُوضع الحاجز.',
    accroche: (route, d) => `وُضع على ${route}${d >= 1 ? `، على بعد ${d} من النقرة` : ''}.`,
    invalide: (m) => `رُفض التعديل: ${m}`,
    nouveauNom: (route) => `حاجز ${route}`.trim(),
    editionTitre: (id) => `تعديل · ${id}`,
    prochainAjout: 'إعدادات الإضافة القادمة',
    supprimerConfirmer: (nom) => `حذف الحاجز « ${nom} »؟ (في هذا المتصفح فقط حتى التصدير)`,
    annulerConfirmer: (n) => `إلغاء ${n} تعديل محلي للحواجز؟`,
    editions: (n) => (n ? `${n} تعديل محلي (هذا المتصفح): صدّر barages.json لنقله.` : 'لا توجد تعديلات محلية.'),
    exporte: (n) => `تم تصدير ${n} حاجز: استبدل donnees/barages/barages.json بهذا الملف ثم ألغِ التعديلات المحلية.`,
  },
};

// ── Icônes (dessinées, aucune ressource externe) ───────────────────────────

/**
 * Fixe : disque avec une barre blanche (barrière) ; intouchable : octogone marqué « 24 ».
 * Les formes diffèrent : les deux types se distinguent sans la couleur. Simulé : la même
 * forme, plus petite, dans un anneau pointillé — visible à tout zoom de détail.
 */
function dessinerIcone(ctx, type, t, simulation = false) {
  const c = t / 2;
  if (simulation) {
    ctx.save();
    ctx.lineWidth = t * 0.06;
    ctx.strokeStyle = COULEURS_BARAGES.light[type];
    ctx.setLineDash([t * 0.09, t * 0.07]);
    ctx.beginPath();
    ctx.arc(c, c, t * 0.46, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
    ctx.translate(c, c);
    ctx.scale(0.8, 0.8);
    ctx.translate(-c, -c);
  }
  ctx.lineWidth = t * 0.08;
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = COULEURS_BARAGES.light[type];
  ctx.beginPath();
  if (type === 'intouchable') {
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      ctx.lineTo(c + t * 0.44 * Math.cos(a), c + t * 0.44 * Math.sin(a));
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(t * 0.36)}px system-ui, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('24', c, c + t * 0.02);
  } else {
    ctx.arc(c, c, t * 0.4, 0, 2 * Math.PI);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(t * 0.22, t * 0.42, t * 0.56, t * 0.16);
  }
}

function toileIcone(type, taille, simulation = false) {
  if (typeof document === 'undefined') return null;
  const toile = document.createElement('canvas');
  toile.width = taille;
  toile.height = taille;
  dessinerIcone(toile.getContext('2d'), type, taille, simulation);
  return toile;
}

/** Ajoute à une carte l'icône de barage qui lui manque (résolveur d'images manquantes). */
/** Ancien emplacement : disque gris pointillé barré, sans la couleur des barages actifs. */
function toileRetire(t) {
  if (typeof document === 'undefined') return null;
  const toile = document.createElement('canvas');
  toile.width = t;
  toile.height = t;
  const ctx = toile.getContext('2d');
  const c = t / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(c, c, t * 0.4, 0, 2 * Math.PI);
  ctx.fill();
  ctx.lineWidth = t * 0.07;
  ctx.strokeStyle = '#475569';
  ctx.setLineDash([t * 0.1, t * 0.07]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c - t * 0.17, c - t * 0.17); ctx.lineTo(c + t * 0.17, c + t * 0.17);
  ctx.moveTo(c + t * 0.17, c - t * 0.17); ctx.lineTo(c - t * 0.17, c + t * 0.17);
  ctx.stroke();
  return toile;
}

export function fournirIconeBarage(carte, id) {
  if (id === ICONE_RETIRE) {
    const toile = carte.hasImage(id) ? null : toileRetire(48);
    if (toile) carte.addImage(id, toile.getContext('2d').getImageData(0, 0, 48, 48), { pixelRatio: 2 });
    return;
  }
  const m = /^barage-(fixe|intouchable)(-sim)?$/.exec(id);
  if (!m || carte.hasImage(id)) return;
  const toile = toileIcone(m[1], 48, Boolean(m[2]));
  if (toile) carte.addImage(id, toile.getContext('2d').getImageData(0, 0, 48, 48), { pixelRatio: 2 });
}

const apercus = new Map();
function apercuIcone(type, simulation = false) {
  const cle = `${type}|${simulation}`;
  if (!apercus.has(cle)) apercus.set(cle, (type === 'retire' ? toileRetire(48) : toileIcone(type, 48, simulation))?.toDataURL() ?? '');
  return apercus.get(cle);
}

const lireStockage = (cle, defaut) => {
  try {
    return JSON.parse(localStorage.getItem(cle) || 'null') ?? defaut;
  } catch {
    return defaut;
  }
};
const ecrireStockage = (cle, valeur) => {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* stockage indisponible ou plein */ }
};

let compteur = 0;
const SOURCE_RETIRES = 'barages-retires';
const COUCHES_RETIRES = ['barages-retires', 'barages-retires-nom'];
const ICONE_RETIRE = 'barage-retire';
const CLE_AFFICHAGE = 'maroc-carte:barages-affichage:v1';
const nouvelId = (existants) => {
  let id;
  do id = `BAR-${Date.now().toString(36).toUpperCase()}-${(compteur++).toString(36).toUpperCase()}`; while (existants.has(id));
  return id;
};

export class CoucheBarages {
  /**
   * @param {maplibregl.Map} carte
   * @param {{ $: (id: string) => HTMLElement, langue?: string, url: string,
   *           circos: () => Promise<{ reg: object[], cie: object[], bt: { proprietes, geometrie, emprise }[] }>,
   *           routes: (bbox: number[], zMax: number) => Promise<{ lignes: object[] } | null>,
   *           importeLe?: string | null, montrerCirco?: (id: string) => void,
   *           surOutil?: () => void, ouvrirPanneau?: () => void, fermerFiche?: () => void }} options
   *   `circos` : circonscriptions importées (Competence.charger) ; `routes` : routes des tuiles locales
   *   (ReseauRoutier.lignes) ; `importeLe` : date de l'import (rapport.json), comparée à celle du jeu ;
   *   `surOutil` : un outil d'édition prend les clics (l'appelant arrête les autres outils).
   */
  constructor(carte, { $, langue = 'fr', url, circos, routes, importeLe = null, montrerCirco = () => {}, surOutil = () => {}, ouvrirPanneau = () => {}, fermerFiche = () => {} }) {
    Object.assign(this, { carte, $, langue, url, circos, routes, importeLe, montrerCirco, surOutil, ouvrirPanneau, fermerFiche });
    this.theme = 'light';
    this.actif = false;
    this.etat = 'inactif'; // 'chargement' | 'pret' | 'absent' | 'erreur'
    this.erreur = null;
    this.base = null; // jeu installé : { barages, rejetes, simulation, referentiel }
    this.hierarchie = null;
    this.circosBt = [];
    this.jeu = null; // jeu affiché (installé + modifications) : { barages, entites, proprietes, rejetes, orphelines, simulation, … }
    this.filtres = { ...FILTRES_DEFAUT, ...lireStockage(CLE, {}) };
    this.editions = lireEditions(lireStockage(CLE_EDITIONS, null));
    this.outil = null; // 'ajouter' | 'deplacer'
    this.edition = null; // identifiant du barage en cours de modification
    this.message = null;
    this.modele = { type: 'fixe', shift: CRENEAUX[0], isSimulation: true }; // réglages du prochain ajout
    this._chargement = null;
    this._jeton = 0;
    this.version = 0; // augmente à chaque changement des données affichées
    this.abonnes = new Set();
    this.controleAjout = null; // contrôle facultatif d'un barage ajouté (tableau d'optimisation)
    this.affichage = { actifs: true, retires: true, ...lireStockage(CLE_AFFICHAGE, {}) }; // couches « actifs » / « retirés »
    this.retires = []; // retraits affichés (historique)
    this.deplacerAvecValidation = null; // « Déplacer » vérifié par la route (tableau d'optimisation)
    this.alertesDe = null; // (id) => alertes de proximité du barage (tableau d'optimisation)
    this.voirAlerte = null; // (index) => sélectionne l'alerte dans la liste et sur la carte
    this.controleEspacement = null; // espacement routier d'un barage ajouté (tableau d'optimisation) : avis, jamais un blocage
    this.lectureSeule = false; // compte régional : consultation seulement (il propose, le superadmin décide)

    carte.on('click', (e) => this._surClic(e));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.outil) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea')) return;
      this.arreterOutil();
    });
    // Modifications faites dans un autre onglet : les reprendre.
    window.addEventListener('storage', (e) => {
      if (e.key !== CLE_EDITIONS || this.lectureSeule) return;
      this.editions = lireEditions(lireStockage(CLE_EDITIONS, null));
      if (this.base) this._recalculer();
    });
    this._lierPanneau();
  }

  get t() {
    return TEXTES[this.langue] ?? TEXTES.fr;
  }

  // ── Carte ────────────────────────────────────────────────────────────────

  /** À chaque chargement de style : source et couches, sous les tracés de mesure, d'analyse et de croquis. */
  installer({ theme = this.theme } = {}) {
    this.theme = theme;
    const carte = this.carte;
    const donnees = { type: 'FeatureCollection', features: this.jeu?.entites ?? [] };
    if (!carte.getSource(SOURCE_BARAGES)) carte.addSource(SOURCE_BARAGES, { type: 'geojson', data: donnees });
    if (!carte.getSource(SOURCE_AGREGATS)) carte.addSource(SOURCE_AGREGATS, { type: 'geojson', data: this._agregats() });
    const avant = carte.getStyle().layers.find((c) => /^(mesure|analyse|croquis)-/.test(c.id) && c.id !== 'analyse-temps')?.id;
    const couches = couchesBarages({ theme, visible: this._visible(), filtre: expressionFiltre(this.filtres), edition: this.edition ?? '' });
    for (const couche of couches) if (!carte.getLayer(couche.id)) carte.addLayer(couche, avant);
    // Anciens emplacements (historique) : couche et source à part, jamais comptées comme actives.
    if (!carte.getSource(SOURCE_RETIRES)) carte.addSource(SOURCE_RETIRES, { type: 'geojson', data: this._donneesRetires() });
    const filtre = expressionFiltreRetires(this.filtres);
    const visibility = this._visible() && this.affichage.retires ? 'visible' : 'none';
    const retires = [
      { id: COUCHES_RETIRES[0], type: 'symbol', source: SOURCE_RETIRES, minzoom: 5, layout: { visibility, 'icon-image': ICONE_RETIRE, 'icon-size': ['step', ['zoom'], 0.8, 9, 1], 'icon-allow-overlap': true } },
      {
        id: COUCHES_RETIRES[1], type: 'symbol', source: SOURCE_RETIRES, minzoom: 11,
        layout: { visibility, 'text-field': ['get', 'etiquette'], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true },
        paint: { 'text-color': '#475569', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      },
    ];
    for (const couche of retires) if (!carte.getLayer(couche.id)) carte.addLayer(filtre ? { ...couche, filter: filtre } : couche, avant);
  }

  _donneesRetires() {
    const t = this.t;
    return { type: 'FeatureCollection', features: entitesRetires(this.retires, this.hierarchie).map((f) => ({ ...f, properties: { ...f.properties, etiquette: `${t.ancienRetire}\n${f.properties.name}` } })) };
  }

  _visible() {
    return this.actif && this.etat === 'pret';
  }

  /** Groupes REG / CIE des barages filtrés (aux petites échelles) : mêmes filtres, mêmes nombres que le panneau. */
  _agregats() {
    return this.jeu ? agregerBarages(this.jeu.entites, this.hierarchie, this.filtres) : { type: 'FeatureCollection', features: [] };
  }

  /**
   * Visibilité, filtre et anneau d'édition des couches existantes. La source des barages
   * n'est pas touchée (filtre MapLibre) ; seuls les groupes, ≤ 240 points, sont recalculés.
   */
  _appliquer() {
    const filtre = expressionFiltre(this.filtres);
    const visibilite = this._visible() && this.affichage.actifs ? 'visible' : 'none';
    const filtreRetires = expressionFiltreRetires(this.filtres);
    for (const id of COUCHES_RETIRES) {
      if (!this.carte.getLayer(id)) continue;
      this.carte.setLayoutProperty(id, 'visibility', this._visible() && this.affichage.retires ? 'visible' : 'none');
      this.carte.setFilter(id, filtreRetires);
    }
    for (const id of [...COUCHES_AGREGATS, ...COUCHES_BARAGES, COUCHE_EDITION]) {
      if (!this.carte.getLayer(id)) continue;
      this.carte.setLayoutProperty(id, 'visibility', visibilite);
      if (COUCHES_BARAGES.includes(id)) this.carte.setFilter(id, filtrePour(id, filtre));
      if (id === COUCHE_EDITION) this.carte.setFilter(id, ['==', ['get', 'id'], this.edition ?? '']);
    }
    if (this._visible()) this.carte.getSource(SOURCE_AGREGATS)?.setData(this._agregats());
  }

  /** Couches « Barages actifs » et « Barages retirés (historique) » : affichage seulement, rien n'est supprimé. */
  definirAffichage(cle, valeur) {
    this.affichage = { ...this.affichage, [cle]: valeur };
    ecrireStockage(CLE_AFFICHAGE, this.affichage);
    this._appliquer();
    this.rendrePanneau();
  }

  /** Affiche ou masque la couche ; le jeu est chargé à la première activation. */
  definirVisibilite(actif) {
    this.actif = actif;
    if (actif) this._chargement ??= this.charger();
    else {
      this.arreterOutil();
      this.edition = null;
    }
    this._appliquer();
    this.rendrePanneau();
  }

  definirLangue(langue) {
    this.langue = langue;
    this.rendrePanneau();
  }

  /**
   * Frontière de données : lit le jeu installé (simulé ou validé, même format), le valide
   * contre les circonscriptions importées, puis y applique les modifications locales.
   */
  async charger() {
    this.etat = 'chargement';
    this.rendrePanneau();
    try {
      const [reponse, circos] = await Promise.all([fetch(this.url), this.circos()]);
      // Le serveur répond 404 ; le serveur de développement renvoie la page HTML.
      if (reponse.status === 404 || /html/.test(reponse.headers.get('content-type') ?? '')) {
        this.etat = 'absent';
        return;
      }
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
      if (!circos?.bt?.length) throw new Error('circonscriptions de brigade illisibles');
      this.hierarchie = construireHierarchie({
        reg: circos.reg.map((e) => e.proprietes), cie: circos.cie.map((e) => e.proprietes), bt: circos.bt.map((e) => e.proprietes),
      });
      this.circosBt = circos.bt;
      const donnees = await reponse.json();
      // `brut` : les enregistrements du fichier tels quels, y compris ceux que la carte refuse —
      // les modifications locales s'y appliquent, la validation vient ensuite (voir _recalculer).
      this.base = {
        ...lireJeuBarages(donnees, this.hierarchie),
        brut: donnees.barages,
        simulationDeclaree: donnees.simulation === true,
      };
      this.etat = 'pret';
      this._recalculer();
    } catch (erreur) {
      this.etat = 'erreur';
      this.erreur = erreur.message;
      this._chargement = null; // nouvel essai à la prochaine activation
    } finally {
      this._appliquer();
      this.rendrePanneau();
    }
  }

  /**
   * Jeu affiché = enregistrements du fichier + modifications locales, puis validation ; une
   * seule mise à jour de la source. Un enregistrement invalide du fichier reste hors de la
   * carte, sauf si une modification locale le rend valide.
   */
  _recalculer() {
    const { barages, orphelines, dejaInstalles } = appliquerEditions(this.base.brut, this.editions);
    const { barages: valides, rejetes } = trierBarages(barages, this.hierarchie);
    const entites = entitesBarages(valides, this.hierarchie);
    const proprietes = entites.map((f) => f.properties);
    this.version += 1;
    this.jeu = {
      barages: valides,
      fusionnes: barages, // tous les enregistrements, valides ou non (analyse de la qualité)
      dejaInstalles,
      parId: new Map(valides.map((b) => [b.id, b])),
      entites, proprietes, orphelines,
      rejetes,
      simulation: valides.length ? valides.some((b) => b.isSimulation) : this.base.simulation,
      referentielDifferent: Boolean(this.base.referentiel?.importeLe && this.importeLe && this.base.referentiel.importeLe !== this.importeLe),
      sansCie: proprietes.filter((p) => p.cieId === SANS_COMPAGNIE).length,
    };
    if (this.edition && !this.jeu.parId.has(this.edition)) this.edition = null;
    this.retires = retraitsAffiches(this.editions, new Set(barages.filter((b) => b && typeof b === 'object').map((b) => b.id)));
    this.carte.getSource(SOURCE_RETIRES)?.setData(this._donneesRetires());
    this.filtres = normaliserFiltres(proprietes, this.hierarchie, this.filtres);
    this.carte.getSource(SOURCE_BARAGES)?.setData({ type: 'FeatureCollection', features: entites });
    this._appliquer();
    this.rendrePanneau();
    for (const abonne of this.abonnes) abonne(this.version);
  }

  /** Être prévenu de chaque changement des données affichées (tableau d'optimisation). */
  surDonnees(abonne) {
    this.abonnes.add(abonne);
    return () => this.abonnes.delete(abonne);
  }

  /**
   * Instantané en lecture seule pour l'analyse : chaque enregistrement (valide ou non) avec sa
   * provenance — fichier installé (et son rang) ou ajout de ce navigateur.
   */
  instantane() {
    if (this.etat !== 'pret' || !this.jeu) return null;
    const locaux = new Set(this.editions.ajouts.map((a) => a.id));
    return {
      version: this.version,
      enregistrements: this.jeu.fusionnes.map((b, i) => ({
        barage: structuredClone(b),
        source: b && typeof b === 'object' && locaux.has(b.id) && !this.jeu.dejaInstalles.includes(b.id) ? 'local' : 'fichier',
        rang: i,
      })),
      orphelines: [...this.jeu.orphelines],
      dejaInstalles: [...this.jeu.dejaInstalles],
      simulationDeclaree: this.base.simulationDeclaree,
      referentielDifferent: this.jeu.referentielDifferent,
    };
  }

  /** Enregistrements du fichier installé par identifiant (valeurs d'origine, pour les annulations). */
  baseParId() {
    return new Map((this.base?.brut ?? []).filter((b) => b && typeof b === 'object').map((b) => [b.id, b]));
  }

  /**
   * Remplace la surcouche locale par `editions` (corrections approuvées, ou leur annulation) :
   * écrite d'abord, adoptée seulement si l'écriture réussit. Le fichier installé n'est pas touché.
   * @returns {{ ok: true } | { ok: false, erreur: string }}
   */
  remplacerEditions(editions, { proteger = true } = {}) {
    if (this.lectureSeule) return { ok: false, erreur: MESSAGE_LECTURE_SEULE };
    // Garde de persistance : aucune écriture de l'optimisation ne touche un barage intouchable.
    if (proteger && this.base) {
      const atteints = atteintesProtegees(this.base.brut, this.editions, editions);
      if (atteints.length) return { ok: false, erreur: `${MESSAGE_PROTEGE} (${atteints.join(', ')})` };
    }
    try {
      localStorage.setItem(CLE_EDITIONS, JSON.stringify(editions));
    } catch (erreur) {
      return { ok: false, erreur: erreur?.message ?? String(erreur) };
    }
    this.editions = editions;
    this._recalculer();
    return { ok: true };
  }

  // ── Édition ──────────────────────────────────────────────────────────────

  _enregistrerEditions() {
    if (!this.lectureSeule) ecrireStockage(CLE_EDITIONS, this.editions);
  }

  /**
   * Consultation seule (compte régional) : aucun ajout, déplacement, suppression ni export ; les
   * modifications locales d'un autre utilisateur de ce navigateur ne sont pas appliquées. Les
   * propositions passent par l'espace du compte régional et le serveur.
   */
  definirLectureSeule(actif) {
    this.lectureSeule = Boolean(actif);
    if (!this.lectureSeule) return;
    this.arreterOutil();
    this.edition = null;
    this.editions = editionsVides();
    if (this.base) this._recalculer();
    else this.rendrePanneau();
  }

  /** true (et message) si la couche est en consultation seule. */
  _refuserLecture() {
    if (!this.lectureSeule) return false;
    this.message = { type: 'erreur', texte: MESSAGE_LECTURE_SEULE };
    this.rendrePanneau();
    return true;
  }

  _estAjout(id) {
    return this.editions.ajouts.some((a) => a.id === id);
  }

  activerOutil(outil) {
    if (this._refuserLecture()) return;
    if (this.outil === outil) return this.arreterOutil();
    if (!this._visible() || (outil === 'deplacer' && !this.jeu.parId.has(this.edition))) return;
    this.surOutil();
    this.outil = outil;
    this.message = null;
    this.carte.getCanvas().style.cursor = 'crosshair';
    this.rendrePanneau();
  }

  arreterOutil() {
    if (!this.outil) return;
    this.outil = null;
    this._jeton += 1; // une accroche encore en calcul est abandonnée
    this.carte.getCanvas().style.cursor = '';
    this.rendrePanneau();
  }

  /**
   * Lit les routes autour du point proposé et le valide (validerEmplacement) : la route
   * carrossable la plus proche (≤ RAYON_ACCROCHE_M), dans une circonscription de brigade
   * (celle de `btAttendu` pour un déplacement). Un refus porte un message à afficher.
   * @returns {Promise<{ statut: 'valide', origine, point, route, distance, btId } | { statut: 'refuse', raison, erreur: string }>}
   */
  async placerSurRoute(propose, btAttendu = null) {
    let lu;
    try {
      lu = await this.routes(empriseAutour(propose, propose, RAYON_ACCROCHE_M + 50), 15);
    } catch {
      lu = null;
    }
    const v = validerEmplacement(propose, lu?.lignes ?? null, this.circosBt, { btAttendu });
    if (v.statut === 'valide') return v;
    const t = this.t;
    const erreur = {
      'routes-illisibles': t.routesIllisibles,
      'aucune-route': t.horsRoute,
      'hors-brigade': t.horsBt,
      'autre-brigade': t.autreBt(this.hierarchie.brigades.get(btAttendu)?.nom ?? btAttendu),
    }[v.raison];
    return { ...v, erreur };
  }

  /** « Faction 1 · 00:00–06:00 » */
  _libelleFaction(shift) {
    return `${this.t.factionN(numeroFaction(shift))} · ${LIBELLES_CRENEAUX[shift]}`;
  }

  _nomRoute(route) {
    return [route?.ref, route?.nom].filter(Boolean).join(' · ') || this.t.routeSansNom;
  }

  async _surClic(e) {
    if (!this.outil) return;
    const outil = this.outil;
    const jeton = ++this._jeton;
    const clic = [e.lngLat.lng, e.lngLat.lat];
    this.message = this.t.rechercheRoute;
    this.rendrePanneau();
    const cible = outil === 'deplacer' ? this.jeu.parId.get(this.edition) : null;
    const place = await this.placerSurRoute(clic, cible?.btId ?? null);
    if (jeton !== this._jeton) return;
    if (place.statut !== 'valide') {
      this.message = place.erreur;
      return this.rendrePanneau();
    }
    // Le barage n'est posé (ou déplacé) qu'après validation, avec la trace de celle-ci.
    const position = { latitude: place.point[1], longitude: place.point[0], route: place.route, validation: traceValidation(place) };
    const accroche = this.t.accroche(this._nomRoute(place.route), formaterDistance(place.distance, this.langue));
    if (outil === 'ajouter') {
      const barage = this._nouveauBarage(place, this.modele);
      const erreurs = validerBarage(barage, this.hierarchie);
      if (erreurs.length) {
        this.message = this.t.invalide(erreurs.join(' ; '));
        return this.rendrePanneau();
      }
      this.editions.ajouts.push(barage);
      this.edition = barage.id;
    } else {
      if (!this._modifier(this.edition, position)) return;
      this.arreterOutil();
    }
    this._enregistrerEditions();
    // Contrôle facultatif (règle du tableau d'optimisation) : un avis, jamais un blocage.
    const controle = outil === 'ajouter' && this.controleAjout ? this.controleAjout(this.editions.ajouts.at(-1)) : null;
    this.message = controle ? `${accroche} ${controle}` : accroche;
    this._recalculer();
    // Espacement routier avec la même faction (tableau d'optimisation) : affiché quand il est calculé.
    if (outil === 'ajouter' && this.controleEspacement) {
      const ajoute = this.editions.ajouts.at(-1);
      this.controleEspacement(ajoute).then((texte) => {
        if (!texte || this.edition !== ajoute.id || this._jeton !== jeton) return;
        this.message = `${this.message} ${texte}`;
        this.rendrePanneau();
      }).catch(() => {});
    }
  }

  /** Barage à créer à un emplacement validé (`placerSurRoute`), d'après un modèle de type et de faction. */
  _nouveauBarage(place, modele, nom = null) {
    const id = nouvelId(new Set([...this.jeu.parId.keys(), ...this.editions.ajouts.map((a) => a.id), ...(this.editions.retraits ?? []).map((r) => r.barageId)]));
    return {
      id, name: nom?.trim() || this.t.nouveauNom(place.route?.ref || place.route?.nom || ''), ...typeEtFaction(modele.type, modele.shift),
      latitude: place.point[1], longitude: place.point[0], route: place.route, validation: traceValidation(place), btId: place.btId, isSimulation: modele.isSimulation === true,
    };
  }

  /**
   * Création confirmée hors de la carte (carte de chaleur du tableau d'optimisation) : même chemin
   * que l'outil « Ajouter » — route la plus proche dans une brigade, validation, surcouche locale.
   * @returns {Promise<{ ok: true, barage: object } | { ok: false, erreur: string }>}
   */
  async creerSurRoute(point, modele, { nom = null } = {}) {
    if (this.etat !== 'pret') return { ok: false, erreur: 'couche Barages non chargée' };
    const place = await this.placerSurRoute(point, null);
    if (place.statut !== 'valide') return { ok: false, erreur: place.erreur ?? 'emplacement refusé' };
    const barage = this._nouveauBarage(place, modele, nom);
    const erreurs = validerBarage(barage, this.hierarchie);
    if (erreurs.length) return { ok: false, erreur: erreurs.join(' ; ') };
    const editions = { ...this.editions, ajouts: [...this.editions.ajouts, barage] };
    const ecriture = this.remplacerEditions(editions);
    return ecriture.ok ? { ok: true, barage } : { ok: false, erreur: ecriture.erreur };
  }

  /**
   * Applique des champs au barage `id` (surcouche) ; refusé si le résultat est invalide, ou
   * si l'on change l'origine (simulée / réelle) d'un barage du jeu installé.
   */
  _modifier(id, champs) {
    if (this._refuserLecture()) return false;
    const actuel = this.jeu.parId.get(id);
    if (!actuel) return false;
    const refus = refusModification(champs, { ajoutLocal: this._estAjout(id) });
    if (refus) {
      this.message = refus === 'origine-verrouillee' ? this.t.origineVerrouillee : this.t.invalide(refus);
      this.rendrePanneau();
      return false;
    }
    const suivant = { ...actuel, ...champs, id };
    const erreurs = validerBarage(suivant, this.hierarchie);
    if (erreurs.length) {
      this.message = this.t.invalide(erreurs.join(' ; '));
      this.rendrePanneau();
      return false;
    }
    if (this._estAjout(id)) this.editions.ajouts = this.editions.ajouts.map((a) => (a.id === id ? suivant : a));
    else this.editions.modifs[id] = { ...this.editions.modifs[id], ...champs };
    return true;
  }

  modifier(id, champs) {
    if (!this._modifier(id, champs)) return;
    this._enregistrerEditions();
    this.message = null;
    this._recalculer();
  }

  /** « Supprimer » de l'éditeur : un retrait avec historique (l'ancien emplacement reste marqué). */
  supprimer(id) {
    this.retirer(id);
  }

  /**
   * Retire un barage du jeu actif, après confirmation : historique (copie complète, date) et
   * retrait écrits ensemble dans la surcouche locale ; l'ancien emplacement reste marqué.
   */
  retirer(id) {
    if (this._refuserLecture()) return;
    const b = this.jeu?.parId.get(id);
    if (!b) return;
    const t = this.t;
    if (estProtege(b)) {
      this.message = t.refus(MESSAGE_PROTEGE);
      return this.rendrePanneau();
    }
    const bt = this.hierarchie?.brigades.get(b.btId)?.nom ?? b.btId;
    const faction = CRENEAUX.includes(b.shift) ? this._libelleFaction(b.shift) : t.sansFaction;
    if (!window.confirm(t.retirerConfirmer(b, faction, bt))) return;
    const r = retirerBarage(this.editions, b, this._estAjout(id) ? 'local' : 'fichier');
    if (r.erreur) {
      this.message = t.refus(r.erreur);
      return this.rendrePanneau();
    }
    const ecriture = this.remplacerEditions(r.editions);
    if (!ecriture.ok) {
      this.message = t.refus(ecriture.erreur);
      return this.rendrePanneau();
    }
    if (this.edition === id) this.edition = null;
    this.arreterOutil();
    this.fermerFiche(); // sa fiche décrirait un barage retiré
    this.message = t.retire(id);
    this.rendrePanneau();
  }

  /** Restaure un barage retiré (confirmé) ; refusé s'il est déjà actif (pas de doublon). */
  restaurer(retraitId) {
    if (this._refuserLecture()) return;
    const r = (this.editions.retraits ?? []).find((x) => x.id === retraitId);
    if (!r) return;
    const t = this.t;
    if (!window.confirm(t.restaurerConfirmer(r.barage))) return;
    const actifs = new Set(this.jeu.fusionnes.filter((b) => b && typeof b === 'object').map((b) => b.id));
    const res = restaurerBarage(this.editions, retraitId, actifs);
    if (res.erreur) {
      this.message = t.refus(res.erreur);
      return this.rendrePanneau();
    }
    const erreurs = validerBarage(res.barage, this.hierarchie);
    if (erreurs.length) {
      this.message = t.refus(erreurs.join(' ; '));
      return this.rendrePanneau();
    }
    const ecriture = this.remplacerEditions(res.editions);
    if (!ecriture.ok) {
      this.message = t.refus(ecriture.erreur);
      return this.rendrePanneau();
    }
    this.fermerFiche();
    this.message = t.restaure(r.barageId);
    this.rendrePanneau();
    // Espacement routier avec la même faction (même règle que partout) : un avis.
    this.controleEspacement?.(this.jeu.parId.get(r.barageId))?.then((texte) => {
      if (texte) {
        this.message = `${this.message} ${texte}`;
        this.rendrePanneau();
      }
    }).catch(() => {});
  }

  /** « Déplacer » de la fiche : vérification routière du tableau d'optimisation, sinon l'outil de l'éditeur. */
  deplacer(id) {
    if (this._refuserLecture()) return;
    if (!this.jeu?.parId.has(id)) return;
    if (estProtege(this.jeu.parId.get(id))) {
      this.message = this.t.refus(MESSAGE_PROTEGE);
      return this.rendrePanneau();
    }
    this.fermerFiche();
    if (this.deplacerAvecValidation) return this.deplacerAvecValidation(id);
    this.editer(id);
    this.activerOutil('deplacer');
  }

  /** Ouvre le formulaire de modification d'un barage (fiche → « Modifier »). */
  editer(id) {
    if (this._refuserLecture()) return;
    if (!this.jeu?.parId.has(id)) return;
    this.arreterOutil();
    this.edition = id;
    this.message = null;
    this.ouvrirPanneau();
    this._appliquer();
    this.rendrePanneau();
    this.$('barages-filtres').scrollIntoView?.({ block: 'nearest' });
    this.$('barages-formulaire').scrollIntoView?.({ block: 'nearest' });
  }

  annulerEditions() {
    const n = nombreEditions(this.editions);
    if (!n || !window.confirm(this.t.annulerConfirmer(n))) return;
    const maintenant = new Date().toISOString();
    const retraits = (this.editions.retraits ?? []).map((r) => (r.restaureLe ? r : { ...r, restaureLe: maintenant, restaurePar: this.t.annulationRetrait }));
    this.editions = { ...editionsVides(), retraits };
    this.edition = null;
    this.arreterOutil();
    this._enregistrerEditions();
    this._recalculer();
  }

  /**
   * Retirer les barages simulés de l'affichage (opération explicite, confirmée) : surcouche
   * locale, les réels ne sont pas touchés, le fichier non plus ; « Annuler les modifications
   * locales » les fait revenir.
   */
  retirerSimules() {
    const n = this.jeu?.barages.filter((b) => b.isSimulation === true).length ?? 0;
    if (!n || !window.confirm(this.t.retirerSimulesConfirmer(n))) return;
    this.editions = retirerSimules(this.base.barages, this.editions);
    if (this.jeu.parId.get(this.edition)?.isSimulation === true) this.edition = null;
    this.arreterOutil();
    this.fermerFiche();
    this._enregistrerEditions();
    this.message = this.t.simulesRetires(n);
    this._recalculer();
  }

  exporter() {
    if (!this.jeu) return;
    const jeu = jeuExporte(this.jeu.barages, { referentiel: this.base.referentiel ?? (this.importeLe ? { importeLe: this.importeLe } : null) });
    telecharger('barages.json', JSON.stringify(jeu), 'application/json');
    this.message = this.t.exporte(jeu.barages.length);
    this.rendrePanneau();
  }

  // ── Fiche (extension de CouchesGendarmerie) ───────────────────────────────

  /**
   * Couches cliquables, infobulle et fiche, pour le panneau latéral de gendarmerie.js. Un clic
   * sur un groupe (région, compagnie) n'ouvre pas de fiche : la carte s'approche jusqu'à
   * l'échelon suivant, cadrée sur ses barages.
   */
  extension() {
    const groupes = ['barages-agregats-reg', 'barages-agregats-cie'];
    return {
      couches: ['barages-symbole', COUCHES_RETIRES[0], ...groupes],
      nom: (p) => p.name ?? p.nom,
      infobulle: (p) => (p.niveau
        ? [this._nomGroupe(p), this.t.groupe(p.n, p.fixes, p.intouchables, p.simulation)]
        : p.retire ? [this.t.ancienRetire, p.name]
          : [p.name, `${this.t.type[p.type] ?? p.type}${p.isSimulation ? ` · ${this.t.simulation}` : ''}`]),
      fiche: (p, coord) => (p.retire ? this._ficheRetire(p) : this._fiche(p, coord)),
      clic: (p) => (p.niveau ? (this.ouvrirGroupe(p), true) : false),
    };
  }

  _nomGroupe(p) {
    return p.nom ?? (p.niveau === 'reg' ? this.t.regionInconnue : this.t.compagnieInconnue);
  }

  /** Approche la carte d'un groupe : cadrée sur ses barages, au moins jusqu'à l'échelon suivant. */
  ouvrirGroupe(p) {
    const camera = this.carte.cameraForBounds([[p.ouest, p.sud], [p.est, p.nord]], { padding: 80, maxZoom: 14 });
    const zoomMin = p.niveau === 'reg' ? ZOOM_CIE : ZOOM_DETAIL;
    this.carte.flyTo({ center: camera?.center ?? [(p.ouest + p.est) / 2, (p.sud + p.nord) / 2], zoom: Math.max(camera?.zoom ?? 0, zoomMin + 0.01), speed: 1.4 });
  }

  _fiche(p, [lon, lat]) {
    const t = this.t;
    const h = this.hierarchie;
    const bt = h?.brigades.get(p.btId);
    const cie = bt?.cieId ? h.compagnies.get(bt.cieId) : null;
    const reg = bt?.regId ? h.regions.get(bt.regId) : null;
    const simulation = p.isSimulation === true;
    const local = this._estAjout(p.id) || Boolean(this.editions.modifs[p.id]);
    const protege = estProtege(p);
    const alertes = this.alertesDe?.(p.id) ?? [];
    return {
      type: `${t.type[p.type] ?? p.type}${simulation ? ` · ${t.simulation}` : ''}`,
      titre: p.name,
      fil: [reg?.nom, cie?.nom, bt?.nom],
      lignes: [
        [t.identifiant, p.id, true],
        [t.typeLigne, t.type[p.type] ?? p.type],
        [t.faction, CRENEAUX.includes(p.shift) ? this._libelleFaction(p.shift) : t.sansFaction],
        [t.brigade, bt?.nom ?? p.btId],
        [t.compagnie, cie?.nom ?? t.cieInconnue(bt?.cieSource)],
        [t.region, reg?.nom ?? t.nonResolue],
        [t.route, p.routeRef || p.routeNom ? [p.routeRef, p.routeNom].filter(Boolean).join(' · ') : p.routeClasse ? t.routeSansNom : null],
        [t.donnee, `${simulation ? t.donneeSimulee : t.donneeReelle}${local ? t.modifieLocalement : ''}`],
        [t.position, `${enDMS(lat, 'N', 'S')}\n${enDMS(lon, 'E', 'O')}`, true],
        ...(protege ? [[t.statut, t.protege]] : []),
        ...(alertes.length ? [[t.alertes, alertes.map((a) => t.alerteAvec(a.avec, a.km)).join('\n'), true]] : []),
      ],
      note: protege ? t.statutProtege : simulation ? t.noteSimulation : t.noteReelle,
      actions: [
        ...(this.lectureSeule ? [] : [[t.deplacer, () => this.deplacer(p.id), false, protege && t.statutProtege], [t.retirer, () => this.retirer(p.id), false, protege && t.statutProtege]]),
        ...alertes.slice(0, 3).map((a) => [`${t.voirAlerte} (${a.avec})`, () => this.voirAlerte?.(a.index), true]),
        ...(this.lectureSeule ? [] : [[t.modifier, () => this.editer(p.id), true]]), [t.voirBt, () => this.montrerCirco(p.btId), true], [t.fermer, () => this.fermerFiche(), true],
      ],
    };
  }

  /** Fiche d'un ancien emplacement : retiré, date, informations d'origine ; « Restaurer ». */
  _ficheRetire(p) {
    const t = this.t;
    const r = (this.editions.retraits ?? []).find((x) => x.id === p.retraitId);
    if (!r) return { type: t.ancienRetire, titre: p.name, lignes: [], actions: [[t.fermer, () => this.fermerFiche(), true]] };
    const b = r.barage;
    const h = this.hierarchie;
    const bt = h?.brigades.get(b.btId);
    const cie = bt?.cieId ? h.compagnies.get(bt.cieId) : null;
    const reg = bt?.regId ? h.regions.get(bt.regId) : null;
    const date = new Intl.DateTimeFormat(this.langue === 'ar' ? 'ar-MA' : 'fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(r.retireLe));
    return {
      type: t.ancienRetire,
      titre: b.name ?? b.id,
      fil: [reg?.nom, cie?.nom, bt?.nom],
      lignes: [
        [t.statut, t.statutRetire],
        [t.retireLe, date],
        [t.identifiant, b.id, true],
        [t.typeLigne, t.type[b.type] ?? b.type],
        [t.faction, CRENEAUX.includes(b.shift) ? this._libelleFaction(b.shift) : t.sansFaction],
        [t.brigade, bt?.nom ?? b.btId],
        [t.route, b.route ? [b.route.ref, b.route.nom].filter(Boolean).join(' · ') || t.routeSansNom : null],
        [t.donnee, b.isSimulation === true ? t.donneeSimulee : t.donneeReelle],
        [t.position, `${enDMS(b.latitude, 'N', 'S')}\n${enDMS(b.longitude, 'E', 'O')}`, true],
      ],
      note: t.noteRetire,
      actions: [[t.restaurer, () => this.restaurer(r.id)], [t.fermer, () => this.fermerFiche(), true]],
    };
  }

  /** Légende de la feuille imprimée (impression.js), si la couche est affichée. */
  pourImpression() {
    if (!this._visible()) return [];
    const t = this.t;
    const types = this.filtres.type === 'tous' ? ['fixe', 'intouchable'] : [this.filtres.type];
    return [
      { type: 'titre', libelle: t.titreImpression(this.jeu.simulation) },
      ...types.map((type) => ({ type: 'image', couleur: COULEURS_BARAGES.light[type], image: apercuIcone(type), libelle: t.legende[type] })),
    ];
  }

  // ── Panneau ──────────────────────────────────────────────────────────────

  _changerFiltre(cle, valeur) {
    this.filtres = { ...this.filtres, [cle]: valeur };
    if (this.jeu) this.filtres = normaliserFiltres(this.jeu.proprietes, this.hierarchie, this.filtres);
    ecrireStockage(CLE, this.filtres);
    this._appliquer();
    this.rendrePanneau();
  }

  _lierPanneau() {
    const $ = this.$;
    for (const [id, cle] of [['barages-reg', 'reg'], ['barages-cie', 'cie'], ['barages-bt', 'bt'], ['barages-faction', 'faction']]) {
      $(id).addEventListener('change', (e) => this._changerFiltre(cle, e.target.value));
    }
    // Boutons recréés à chaque rendu : un seul écouteur, sur leur conteneur.
    $('barages-factions-carte').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-faction]');
      if (!b || b.disabled) return;
      // « Heure actuelle » : la faction qui couvre l'heure de l'appareil, choisie au moment du clic.
      this._changerFiltre('faction', b.dataset.faction === 'maintenant' ? factionDeLHeure() : b.dataset.faction);
    });
    for (const b of document.querySelectorAll('[data-barage-type]')) b.addEventListener('click', () => this._changerFiltre('type', b.dataset.barageType));
    for (const b of document.querySelectorAll('[data-barage-origine]')) b.addEventListener('click', () => this._changerFiltre('origine', b.dataset.barageOrigine));
    $('barages-voir-actifs').addEventListener('change', (e) => this.definirAffichage('actifs', e.target.checked));
    $('barages-voir-retires').addEventListener('change', (e) => this.definirAffichage('retires', e.target.checked));
    $('barages-reinit').addEventListener('click', () => {
      this.filtres = { ...FILTRES_DEFAUT };
      ecrireStockage(CLE, this.filtres);
      this._appliquer();
      this.rendrePanneau();
    });

    // Édition : le formulaire modifie le barage choisi, ou règle le prochain ajout.
    $('barages-ajouter').addEventListener('click', () => {
      // Arrêter l'ajout garde le barage choisi ; le démarrer libère le formulaire pour le prochain.
      if (this.outil !== 'ajouter') {
        this.edition = null;
        this._appliquer();
      }
      this.activerOutil('ajouter');
    });
    $('barages-nom').addEventListener('change', (e) => this.edition && this.modifier(this.edition, { name: e.target.value.trim() || this.edition }));
    for (const b of document.querySelectorAll('[data-barage-edition-type]')) {
      b.addEventListener('click', () => {
        const actuel = this.edition ? this.jeu.parId.get(this.edition) : this.modele;
        const champs = typeEtFaction(b.dataset.barageEditionType, CRENEAUX.includes(actuel.shift) ? actuel.shift : this.modele.shift);
        if (this.edition) return this.modifier(this.edition, champs);
        Object.assign(this.modele, champs);
        this.rendrePanneau();
      });
    }
    $('barages-edition-faction').addEventListener('change', (e) => {
      if (this.edition) this.modifier(this.edition, { shift: e.target.value });
      else {
        this.modele.shift = e.target.value;
        this.rendrePanneau();
      }
    });
    $('barages-edition-simulation').addEventListener('change', (e) => {
      if (this.edition) this.modifier(this.edition, { isSimulation: e.target.checked });
      else this.modele.isSimulation = e.target.checked;
    });
    $('barages-deplacer').addEventListener('click', () => this.activerOutil('deplacer'));
    $('barages-supprimer').addEventListener('click', () => this.edition && this.supprimer(this.edition));
    $('barages-terminer').addEventListener('click', () => {
      this.edition = null;
      this.message = null;
      this.arreterOutil();
      this._appliquer();
      this.rendrePanneau();
    });
    $('barages-exporter').addEventListener('click', () => this.exporter());
    $('barages-annuler-editions').addEventListener('click', () => this.annulerEditions());
    $('barages-retirer-simules').addEventListener('click', () => this.retirerSimules());
    // Les groupes ou les barages un par un selon le zoom : l'aide d'ajout le rappelle.
    this.carte.on('zoomend', () => this.outil === 'ajouter' && !this.message && this.rendrePanneau());
  }

  /**
   * Faction sur la carte : « Toutes », Faction 1 à 4, « Barages intouchables », avec le nombre de
   * barages que chaque choix afficherait sous les autres filtres. Même filtre que le panneau.
   */
  _rendreFactionsCarte(factions, total, nombre) {
    const t = this.t;
    const bouton = (valeur, libelle, n, titre) => {
      const b = element('button', null, libelle);
      b.type = 'button';
      b.dataset.faction = valeur;
      b.setAttribute('aria-pressed', String(this.filtres.faction === valeur));
      b.title = `${titre} (${nombre.format(n)})`;
      b.setAttribute('aria-label', b.title);
      b.disabled = n === 0 && this.filtres.faction !== valeur;
      b.append(element('small', null, nombre.format(n)));
      return b;
    };
    const maintenant = new Date();
    const actuelle = factionDeLHeure(maintenant);
    const heure = new Intl.DateTimeFormat(this.langue === 'ar' ? 'ar-MA' : 'fr-FR', { hour: '2-digit', minute: '2-digit' }).format(maintenant);
    const fuseau = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '?';
    const surHeure = bouton('maintenant', t.heureActuelle, factions.find((x) => x.id === actuelle)?.n ?? 0,
      t.heureActuelleTitre(heure, fuseau, t.factionN(numeroFaction(actuelle))));
    surHeure.setAttribute('aria-pressed', 'false');
    surHeure.classList.add('heure');
    this.$('barages-factions-carte').replaceChildren(
      element('span', 'titre', t.faction),
      bouton('', t.toutesCourt, total, t.toutesFactions),
      ...factions.map((x) => (x.id === NON_AFFECTE
        ? bouton(x.id, t.nonAffecteCourt, x.n, t.nonAffecte)
        : bouton(x.id, t.factionN(numeroFaction(x.id)), x.n, `${this._libelleFaction(x.id)} ${t.plusIntouchables}`))),
      surHeure,
    );
  }

  rendrePanneau() {
    const $ = this.$;
    const t = this.t;
    const nombre = new Intl.NumberFormat(this.langue === 'ar' ? 'ar-MA' : 'fr-FR');

    const ligneLegende = (src, texte) => {
      const li = element('li');
      const img = element('img');
      Object.assign(img, { src, alt: '', width: 18, height: 18 });
      li.append(img, element('span', null, texte));
      return li;
    };
    const groupe = (classe, texte) => {
      const li = element('li');
      li.append(element('i', `pastille-groupe ${classe}`, '12'), element('span', null, texte));
      return li;
    };
    $('barages-legende').replaceChildren(
      ...['fixe', 'intouchable'].map((type) => ligneLegende(apercuIcone(type), t.legende[type])),
      ligneLegende(apercuIcone('fixe', true), t.legendeSimule),
      groupe('reel', t.legendeGroupe),
      groupe('simule', t.legendeGroupeSimule),
      ligneLegende(apercuIcone('retire'), t.legendeRetire),
    );
    // Couches « actifs » / « retirés (historique) »
    $('barages-voir-actifs').checked = this.affichage.actifs;
    $('barages-voir-retires').checked = this.affichage.retires;
    $('barages-libelle-actifs').textContent = t.voirActifs;
    $('barages-libelle-retires').textContent = t.voirRetires;
    $('barages-nb-retires').textContent = t.nbRetires(this.retires.length);
    $('barages-affichage').hidden = !this.actif;

    const jeu = this.jeu;
    const pret = this.etat === 'pret' && jeu;
    // Tant qu'aucun jeu réel seul n'est affiché, la couche est présentée comme une simulation.
    $('barages-simulation').hidden = Boolean(pret && !jeu.simulation);
    $('barages-mention-simulation').hidden = Boolean(pret && !jeu.simulation);
    let statut = '';
    if (this.actif && this.etat === 'chargement') statut = t.chargement;
    else if (this.actif && this.etat === 'absent') statut = t.absent;
    else if (this.actif && this.etat === 'erreur') statut = t.erreur(this.erreur);
    else if (pret) {
      const n = jeu.proprietes.filter((p) => correspond(p, this.filtres)).length;
      statut = `${t.affiches(n, jeu.proprietes.length, nombre)}${jeu.simulation ? ` · ${t.simules}` : ''}`;
    }
    $('barages-statut').textContent = statut;

    const avertissements = [];
    if (pret && jeu.rejetes.length) avertissements.push(t.rejetes(jeu.rejetes.length));
    if (pret && jeu.orphelines.length) avertissements.push(t.orphelines(jeu.orphelines.length));
    if (pret && jeu.referentielDifferent) avertissements.push(t.referentiel);
    if (pret && jeu.sansCie) avertissements.push(t.sansCie(jeu.sansCie));
    $('barages-avertissement').textContent = avertissements.join(' · ');
    $('barages-avertissement').hidden = !this.actif || !avertissements.length;

    const visible = this.actif && pret;
    $('barages-filtres').hidden = !visible;
    $('barages-edition').hidden = !visible || this.lectureSeule;
    $('barages-factions-carte').hidden = !visible;
    if (!visible) return;

    // Filtres
    const f = this.filtres;
    const o = optionsFiltres(jeu.proprietes, this.hierarchie, f);
    this._rendreFactionsCarte(o.factions, jeu.proprietes.filter((p) => correspond(p, { ...f, faction: '' })).length, nombre);
    const remplir = (id, tous, liste, valeur, libelle = (x) => x.nom) => {
      $(id).replaceChildren(new Option(tous, ''), ...liste.map((x) => new Option(`${libelle(x)} (${nombre.format(x.n)})`, x.id)));
      $(id).value = valeur;
    };
    remplir('barages-reg', t.toutes, o.regions, f.reg);
    remplir('barages-cie', t.toutes, o.compagnies, f.cie, (x) => x.nom ?? t.aucuneCie);
    remplir('barages-bt', t.toutes, o.brigades, f.bt);
    remplir('barages-faction', t.toutesFactions, o.factions, f.faction, (x) => (x.id === NON_AFFECTE ? t.nonAffecte : this._libelleFaction(x.id)));
    $('barages-note-faction').textContent = f.faction && f.faction !== NON_AFFECTE && f.type !== 'fixe' ? t.noteFaction : '';
    for (const b of document.querySelectorAll('[data-barage-type]')) {
      b.setAttribute('aria-pressed', String(b.dataset.barageType === f.type));
      b.textContent = t.typeCourt[b.dataset.barageType];
    }
    for (const b of document.querySelectorAll('[data-barage-origine]')) {
      b.setAttribute('aria-pressed', String(b.dataset.barageOrigine === f.origine));
      b.textContent = t.origineCourt[b.dataset.barageOrigine];
    }

    // Édition
    const choisi = this.edition ? jeu.parId.get(this.edition) : null;
    const valeurs = choisi ?? this.modele;
    $('barages-ajouter').setAttribute('aria-pressed', String(this.outil === 'ajouter'));
    $('barages-ajouter').textContent = t.ajouter;
    $('barages-deplacer').setAttribute('aria-pressed', String(this.outil === 'deplacer'));
    const loin = this.carte.getZoom() < ZOOM_DETAIL ? ` ${t.zoomDetail}` : '';
    const aide = this.message ?? (this.outil === 'ajouter' ? `${t.aideAjout}${loin}`
      : this.outil === 'deplacer' ? `${t.aideDeplacement(this.hierarchie.brigades.get(choisi?.btId)?.nom ?? '')}${loin}` : '');
    $('barages-edition-aide').textContent = aide;
    $('barages-edition-titre').textContent = choisi ? t.editionTitre(choisi.id) : t.prochainAjout;
    for (const id of ['barages-champ-nom', 'barages-actions-edition']) $(id).hidden = !choisi;
    if (choisi && document.activeElement !== $('barages-nom')) $('barages-nom').value = choisi.name ?? '';
    for (const b of document.querySelectorAll('[data-barage-edition-type]')) {
      b.setAttribute('aria-pressed', String(b.dataset.barageEditionType === valeurs.type));
      b.textContent = t.typeCourt[b.dataset.barageEditionType];
    }
    const faction = $('barages-edition-faction');
    // Un fixe choisit l'une des quatre factions ; un intouchable n'en a aucune.
    faction.replaceChildren(...(valeurs.type === 'intouchable' ? [new Option(t.sansFaction, '')] : CRENEAUX.map((c) => new Option(this._libelleFaction(c), c))));
    faction.value = valeurs.type === 'intouchable' ? '' : valeurs.shift;
    faction.disabled = valeurs.type === 'intouchable';
    $('barages-edition-simulation').checked = valeurs.isSimulation === true;
    // Origine verrouillée pour un barage du jeu installé : un simulé ne devient pas réel (ni l'inverse) ici.
    $('barages-edition-simulation').disabled = Boolean(choisi && !this._estAjout(choisi.id));
    const n = nombreEditions(this.editions);
    $('barages-editions').textContent = t.editions(n);
    $('barages-annuler-editions').disabled = !n;
    $('barages-retirer-simules').disabled = !jeu.barages.some((b) => b.isSimulation === true);
  }
}
