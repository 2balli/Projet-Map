import * as maplibregl from 'maplibre-gl';
import urlTravailleur from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PMTiles, Protocol } from 'pmtiles';
import { construireStyle, EMPRISE_TUILES, LIMITES_NAVIGATION } from './carte-style.js';
import { OutilMesure } from './outil-mesure.js';
import { ReseauRoutierDistant } from './itineraire-distant.js';
import { diagnostiquerRendu } from './diagnostic-rendu.js';
import { BarreRecherche, enDMS } from './barre-recherche.js';
import { CouchesGendarmerie } from './gendarmerie.js';
import { COULEURS_GR, ECHELONS, echelonAuZoom } from './gendarmerie-style.js';
import { Analyse } from './analyse.js';
import { Competence } from './competence.js';
import { Croquis, fournirIcone } from './croquis.js';
import { CoucheBarages, fournirIconeBarage } from './couche-barages.js';
import { TableauOptimisation } from './optimisation-ui.js';
import { ouvrirSession, surveillerSession } from './session.js';
import { Impression } from './impression.js';
import { formaterLambert, versLambert } from './lambert.js';
import { formaterDistance, formaterDuree } from './mesure.js';
import logoGendarmerie from './assets/logo-gendarmerie.png';
import './style.css';

const VILLES = [
  { fr: 'Rabat', ar: 'الرباط', centre: [-6.8416, 34.0209] },
  { fr: 'Casablanca', ar: 'الدار البيضاء', centre: [-7.5898, 33.5731] },
  { fr: 'Marrakech', ar: 'مراكش', centre: [-7.9811, 31.6295] },
  { fr: 'Fès', ar: 'فاس', centre: [-5.0078, 34.0181] },
  { fr: 'Tanger', ar: 'طنجة', centre: [-5.834, 35.7595] },
  { fr: 'Meknès', ar: 'مكناس', centre: [-5.5473, 33.8935] },
  { fr: 'Oujda', ar: 'وجدة', centre: [-1.9086, 34.6814] },
  { fr: 'Agadir', ar: 'أكادير', centre: [-9.5981, 30.4278] },
  { fr: 'Ouarzazate', ar: 'ورزازات', centre: [-6.8936, 30.9189] },
  { fr: 'Guelmim', ar: 'كلميم', centre: [-10.0573, 28.987] },
  { fr: 'Laâyoune', ar: 'العيون', centre: [-13.2033, 27.1536] },
  { fr: 'Dakhla', ar: 'الداخلة', centre: [-15.957, 23.6848] },
];

const TEXTES = {
  fr: {
    titre: 'Gendarmerie Royale', sousTitre: 'Carte opérationnelle · hors ligne', royaumeDuMaroc: 'Royaume du Maroc',
    titrePage: 'Carte hors ligne', ariaCarte: 'Carte du Maroc', ariaPanneaux: 'Panneaux', ariaCompteurs: 'Effectifs importés',
    allerA: 'Aller à', royaume: 'Tout le Royaume', villes: 'Villes', commandements: 'Commandements régionaux',
    theme: 'Thème', clair: 'Clair', sombre: 'Sombre',
    langue: 'Langue', regions: 'Les 12 régions administratives',
    aide: 'Clic : fiche de l’unité ou de la circonscription · clic droit : coordonnées · / : rechercher',
    copier: 'Copier', copie: 'Copié ✓',
    mesure: 'Mesure', mesureDistance: 'Distance', mesureEcart: 'Entre 2 routes', effacer: 'Effacer',
    itineraire: 'Itinéraire', autoroutes: 'Autoroutes', plusCourt: 'Plus court',
    placeholderRecherche: 'Rechercher une brigade, un lieu, une rue…',
    chargementIndex: 'Chargement de l’index de recherche…', aucunResultat: 'Aucun résultat',
    indexAbsent: 'Index de recherche absent : lancez « npm run data ».', ajouterMesure: 'Ajouter à la mesure',
    // Gendarmerie
    donneesFictives: 'Données fictives — démonstration',
    renduLogiciel: 'Carte lente : le navigateur dessine sans carte graphique. Activez « Utiliser l’accélération graphique » dans ses paramètres, puis relancez-le.',
    ongletCouches: 'Couches', ongletMesure: 'Mesure', ongletAffichage: 'Affichage', fondDeCarte: 'Fond de carte', fermer: 'Fermer',
    aideMesure: 'Cliquez sur la carte pour poser des points : les tronçons suivent les routes. Alt + clic : à vol d’oiseau.',
    grTitre: 'Gendarmerie Royale', grDecoupage: 'Circonscriptions',
    grEchelon_auto: 'Auto', grEchelon_reg: 'Régions', grEchelon_cie: 'Compagnies', grEchelon_bt: 'Brigades', grEchelon_aucun: 'Aucune',
    grEchelonCourt_reg: 'Régions', grEchelonCourt_cie: 'Cies', grEchelonCourt_bt: 'BT',
    grAffiche: (n) => `Selon le zoom · affiché : ${n}`, grAucunAffiche: 'Selon le zoom · rien à ce zoom', grImpose: (n) => `${n}, à tous les zooms`,
    grUnites: 'Chefs-lieux d’unités', grExcel: 'Unités du classeur', grInfra: 'Infrastructures',
    grNiveauCourt_reg: 'Région', grNiveauCourt_cie: 'Compagnie', grNiveauCourt_bt: 'Brigade', grInfraCourt_gare: 'Gare',
    grRegionCourt: 'Rég.', grMesurerDepuis: 'Mesurer depuis ici',
    grCompteur_reg: 'Régions', grCompteur_cie: 'Compagnies', grCompteur_bt: 'Brigades',
    grAbsent: 'Données Gendarmerie absentes : lancez « npm run gendarmerie ».',
    grNiveau_reg: 'Commandement régional', grNiveau_cie: 'Compagnie', grNiveau_bt: 'Brigade territoriale',
    grCirco: 'Circonscription', grCirconscription: 'Circonscription', grParPosition: '(par position)',
    grCompagnie: 'Compagnie', grRegion: 'Région', grNbCie: 'Compagnies', grNbBt: 'Brigades',
    grPopulation: 'Population', grSuperficie: 'Superficie', grDensite: 'Densité', grParKm2: 'hab./km²',
    grPosition: 'Position', grAutreNom: 'Autre nom',
    grVoirCirco: 'Voir la circonscription', grCadrer: 'Cadrer',
    grConfiance: (p) => `Nom attribué avec ${p} % de concordance : limites à vérifier.`,
    grSurSite: (n) => `Unités sur le site (${n})`,
    grRattachees: (n) => `Unités rattachées · classeur (${n})`, grEgalementSurSite: (n) => `Également sur ce site (${n})`,
    grSurSiteDe: (nom) => `sur le site de ${nom}`, grAilleurs: 'autre site', grDependDe: (nom) => `relève de ${nom}`,
    grMemePosition: (noms) => `Même position que ${noms} dans la source : l’une des deux est à vérifier.`,
    grMemeSite: 'Sur le même site :',
    grDepend: 'Relève de', grChefLieuClasseur: 'Chef-lieu absent de la Carte tactique : position de l’état-major (EMCIE) du classeur.',
    grInfra_peage: 'Péage', grInfra_gare: 'Gare ferroviaire', grInfra_aeroport: 'Aéroport', grInfra_port: 'Port',
    // Analyse
    ongletAnalyse: 'Analyse', anCouverture: 'Couverture des brigades', anCouvertureLibelle: 'Temps d’accès à la brigade la plus proche',
    anZone: 'Zone d’intervention', anZoneAide: 'Ouvrez la fiche d’une unité ou faites un clic droit sur la carte : « Zone d’intervention ».',
    anBouclage: 'Bouclage', anBouclagePlacer: 'Placer le centre', anRayon: 'Rayon', anAxes: 'Axes principaux', anToutes: 'Toutes les voies',
    anCopierListe: 'Copier la liste', anTournee: 'Tournée de patrouille', anTourneePlacer: 'Ajouter des étapes',
    anRetour: 'Retour au point de départ', anOptimiser: 'Optimiser l’ordre',
    anActionZone: 'Zone d’intervention', anActionTournee: 'Ajouter à la tournée', anActionBouclage: 'Bouclage ici',
    compTitre: 'Compétence territoriale', compHors: 'Hors des circonscriptions de la Gendarmerie',
    compBrigade: 'Brigade', compCompagnie: 'Compagnie', compRegion: 'Région',
    compDepuis: (nom) => `Depuis ${nom}`, compCalcul: 'calcul du trajet…', compEchec: 'aucun itinéraire trouvé',
    compTrajet: (d, t) => `${d} · ≈ ${t} par la route`, compTracer: 'Tracer le trajet',
    copierLambert: 'Copier Lambert', coordonnees: 'Coordonnées', coordDms: 'Degrés', coordLambert: 'Lambert',
    // Croquis
    ongletCroquis: 'Croquis', croquisSymbole: 'Symbole', croquisCouleur: 'Couleur', croquisLibelle: 'Libellé', supprimer: 'Supprimer',
    croquisGeojson: 'Exporter GeoJSON', croquisKml: 'Exporter KML', croquisImporter: 'Importer…', croquisEffacer: 'Tout effacer',
    croquisStockage: 'Le croquis est enregistré dans ce navigateur ; exportez-le pour le transmettre ou l’ouvrir dans Google Earth ou un GPS.',
    // Impression
    ongletImpression: 'Imprimer', impTitre: 'Titre', impFormat: 'Format', impOrientation: 'Orientation', impPaysage: 'Paysage', impPortrait: 'Portrait',
    impEchelle: 'Échelle', impQuadrillage: 'Quadrillage', impLambert: 'Lambert', impGeo: 'Géographique', impAucun: 'Aucun',
    impMention: 'Mention (facultatif)', impMentionAide: 'ex. Diffusion restreinte', impNotes: 'Notes', impLancer: 'Imprimer / PDF',
    impAide: 'Le cadre doré montre l’emprise imprimée. Dans la boîte d’impression, choisissez « Enregistrer au format PDF » pour obtenir un fichier.',
    lgMesure: (d) => `Mesure · ${d}`,
    // Barages (couche-barages.js)
    brTitre: 'Barages', brSimulation: 'Simulation', brCouche: 'Barages (points de contrôle)', brLegende: 'Légende des barages',
    brRegion: 'Région', brCompagnie: 'Compagnie', brBrigade: 'Brigade', brType: 'Type', brFaction: 'Faction', brOrigine: 'Origine',
    brReinit: 'Réinitialiser les filtres',
    brEdition: 'Édition', brNom: 'Nom', brDonneeSimulee: 'Donnée simulée', brDeplacer: 'Déplacer', brTerminer: 'Terminé',
    brExporter: 'Exporter barages.json', brAnnulerEditions: 'Annuler les modifications locales', brRetirerSimules: 'Retirer les barages simulés',
    brAvertissementSimulation: 'Positions fictives générées pour les tests : ce ne sont pas des emplacements opérationnels.',
  },
  ar: {
    titre: 'الدرك الملكي', sousTitre: 'خريطة عملياتية · بدون اتصال', royaumeDuMaroc: 'المملكة المغربية',
    titrePage: 'خريطة بدون اتصال', ariaCarte: 'خريطة المغرب', ariaPanneaux: 'اللوحات', ariaCompteurs: 'الوحدات المستوردة',
    allerA: 'الانتقال إلى', royaume: 'المملكة كاملة', villes: 'المدن', commandements: 'القيادات الجهوية',
    theme: 'المظهر', clair: 'فاتح', sombre: 'داكن',
    langue: 'اللغة', regions: 'الجهات الإدارية الاثنتا عشرة',
    aide: 'نقرة: بطاقة الوحدة أو الدائرة · نقرة يمنى: الإحداثيات · /: البحث',
    copier: 'نسخ', copie: 'تم النسخ ✓',
    mesure: 'القياس', mesureDistance: 'المسافة', mesureEcart: 'بين طريقين', effacer: 'مسح',
    itineraire: 'المسار', autoroutes: 'الطرق السيارة', plusCourt: 'الأقصر',
    placeholderRecherche: 'ابحث عن مركز أو مكان أو شارع…',
    chargementIndex: 'جارٍ تحميل فهرس البحث…', aucunResultat: 'لا توجد نتائج',
    indexAbsent: 'فهرس البحث غير موجود: شغّل « npm run data ».', ajouterMesure: 'إضافة إلى القياس',
    donneesFictives: 'معطيات وهمية — للعرض فقط',
    renduLogiciel: 'الخريطة بطيئة: المتصفح يرسم بدون بطاقة الرسوميات. فعّل « استخدام تسريع الرسومات » في إعداداته ثم أعد تشغيله.',
    ongletCouches: 'الطبقات', ongletMesure: 'القياس', ongletAffichage: 'العرض', fondDeCarte: 'الخريطة الأساسية', fermer: 'إغلاق',
    aideMesure: 'انقر على الخريطة لوضع النقاط: المقاطع تتبع الطرق. Alt + نقرة: خط مستقيم.',
    grTitre: 'الدرك الملكي', grDecoupage: 'الدوائر',
    grEchelon_auto: 'تلقائي', grEchelon_reg: 'الجهات', grEchelon_cie: 'السرايا', grEchelon_bt: 'المراكز', grEchelon_aucun: 'لا شيء',
    grEchelonCourt_reg: 'الجهات', grEchelonCourt_cie: 'السرايا', grEchelonCourt_bt: 'المراكز',
    grAffiche: (n) => `حسب التكبير · المعروض: ${n}`, grAucunAffiche: 'حسب التكبير · لا شيء', grImpose: (n) => `${n} في كل مستويات التكبير`,
    grUnites: 'مقرات الوحدات', grExcel: 'وحدات الجدول', grInfra: 'البنيات التحتية',
    grNiveauCourt_reg: 'جهة', grNiveauCourt_cie: 'سرية', grNiveauCourt_bt: 'مركز', grInfraCourt_gare: 'محطة قطار',
    grRegionCourt: 'جهة', grMesurerDepuis: 'القياس من هنا',
    grCompteur_reg: 'جهات', grCompteur_cie: 'سرايا', grCompteur_bt: 'مراكز',
    grAbsent: 'معطيات الدرك غير موجودة: شغّل « npm run gendarmerie ».',
    grNiveau_reg: 'القيادة الجهوية', grNiveau_cie: 'سرية', grNiveau_bt: 'مركز الدرك الترابي',
    grCirco: 'دائرة', grCirconscription: 'الدائرة', grParPosition: '(حسب الموقع)',
    grCompagnie: 'السرية', grRegion: 'الجهة', grNbCie: 'السرايا', grNbBt: 'المراكز',
    grPopulation: 'السكان', grSuperficie: 'المساحة', grDensite: 'الكثافة', grParKm2: 'نسمة/كم²',
    grPosition: 'الموقع', grAutreNom: 'اسم آخر',
    grVoirCirco: 'عرض الدائرة', grCadrer: 'تأطير',
    grConfiance: (p) => `اسم منسوب بنسبة توافق ${p} %: الحدود تحتاج إلى تحقق.`,
    grSurSite: (n) => `الوحدات بنفس الموقع (${n})`,
    grRattachees: (n) => `الوحدات التابعة · الجدول (${n})`, grEgalementSurSite: (n) => `أيضًا بهذا الموقع (${n})`,
    grSurSiteDe: (nom) => `بموقع ${nom}`, grAilleurs: 'موقع آخر', grDependDe: (nom) => `تابعة لـ ${nom}`,
    grMemePosition: (noms) => `نفس موقع ${noms} في المصدر: أحدهما يحتاج إلى تحقق.`,
    grMemeSite: 'بنفس الموقع:',
    grDepend: 'تابعة لـ', grChefLieuClasseur: 'المقر غير موجود في الخريطة التكتيكية: موقع هيئة أركان السرية (EMCIE) من الجدول.',
    grInfra_peage: 'محطة أداء', grInfra_gare: 'محطة قطار', grInfra_aeroport: 'مطار', grInfra_port: 'ميناء',
    ongletAnalyse: 'التحليل', anCouverture: 'تغطية المراكز', anCouvertureLibelle: 'زمن الوصول إلى أقرب مركز',
    anZone: 'منطقة التدخل', anZoneAide: 'افتح بطاقة وحدة أو انقر بالزر الأيمن على الخريطة: « منطقة التدخل ».',
    anBouclage: 'التطويق', anBouclagePlacer: 'وضع المركز', anRayon: 'الشعاع', anAxes: 'المحاور الرئيسية', anToutes: 'كل الطرق',
    anCopierListe: 'نسخ القائمة', anTournee: 'جولة الدورية', anTourneePlacer: 'إضافة مراحل',
    anRetour: 'العودة إلى نقطة الانطلاق', anOptimiser: 'ترتيب أمثل',
    anActionZone: 'منطقة التدخل', anActionTournee: 'إضافة إلى الجولة', anActionBouclage: 'تطويق هنا',
    compTitre: 'الاختصاص الترابي', compHors: 'خارج دوائر الدرك',
    compBrigade: 'المركز', compCompagnie: 'السرية', compRegion: 'الجهة',
    compDepuis: (nom) => `من ${nom}`, compCalcul: 'جارٍ حساب المسار…', compEchec: 'لم يتم العثور على مسار',
    compTrajet: (d, t) => `${d} · ≈ ${t} عبر الطريق`, compTracer: 'رسم المسار',
    copierLambert: 'نسخ لامبير', coordonnees: 'الإحداثيات', coordDms: 'درجات', coordLambert: 'لامبير',
    ongletCroquis: 'الرسم', croquisSymbole: 'الرمز', croquisCouleur: 'اللون', croquisLibelle: 'التسمية', supprimer: 'حذف',
    croquisGeojson: 'تصدير GeoJSON', croquisKml: 'تصدير KML', croquisImporter: 'استيراد…', croquisEffacer: 'مسح الكل',
    croquisStockage: 'يُحفظ الرسم في هذا المتصفح؛ صدّره لإرساله أو لفتحه في Google Earth أو جهاز GPS.',
    ongletImpression: 'الطباعة', impTitre: 'العنوان', impFormat: 'الحجم', impOrientation: 'الاتجاه', impPaysage: 'أفقي', impPortrait: 'عمودي',
    impEchelle: 'المقياس', impQuadrillage: 'الشبكة', impLambert: 'لامبير', impGeo: 'جغرافية', impAucun: 'بدون',
    impMention: 'إشارة (اختياري)', impMentionAide: 'مثال: نشر محدود', impNotes: 'ملاحظات', impLancer: 'طباعة / PDF',
    impAide: 'الإطار الذهبي يبين المنطقة المطبوعة. في نافذة الطباعة اختر « حفظ بتنسيق PDF » للحصول على ملف.',
    lgMesure: (d) => `القياس · ${d}`,
    brTitre: 'الحواجز', brSimulation: 'محاكاة', brCouche: 'الحواجز (نقاط المراقبة)', brLegende: 'مفتاح الحواجز',
    brRegion: 'الجهة', brCompagnie: 'السرية', brBrigade: 'المركز', brType: 'النوع', brFaction: 'الفرقة', brOrigine: 'المصدر',
    brReinit: 'إعادة ضبط المرشحات',
    brEdition: 'التعديل', brNom: 'الاسم', brDonneeSimulee: 'معطى محاكاة', brDeplacer: 'نقل', brTerminer: 'إنهاء',
    brExporter: 'تصدير barages.json', brAnnulerEditions: 'إلغاء التعديلات المحلية', brRetirerSimules: 'إزالة حواجز المحاكاة',
    brAvertissementSimulation: 'مواقع وهمية مولَّدة للاختبار: ليست مواقع عملياتية.',
  },
};

const CLE_PREFS = 'maroc-carte:prefs:v1';
const ONGLETS = ['couches', 'mesure', 'analyse', 'croquis', 'impression', 'affichage'];
// Sur un petit écran, le panneau couvrirait la carte : fermé à l'ouverture.
const ONGLET_DEFAUT = window.matchMedia('(max-width: 640px)').matches ? null : 'couches';
const DEFAUTS = { theme: 'light', langue: 'fr', regions: false, priorite: 'autoroute', echelon: 'auto', unites: true, excel: true, infra: false, barages: false, coords: 'dms', onglet: ONGLET_DEFAUT };

function lirePrefs() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_PREFS) || '{}');
    return {
      theme: brut.theme === 'dark' ? 'dark' : 'light',
      langue: brut.langue === 'ar' ? 'ar' : 'fr',
      // Les 12 régions administratives ne coïncident pas avec les commandements : masquées par défaut.
      regions: brut.regions === true,
      priorite: brut.priorite === 'court' ? 'court' : 'autoroute',
      echelon: ECHELONS.includes(brut.echelon) ? brut.echelon : 'auto',
      unites: brut.unites !== false,
      excel: brut.excel !== false,
      infra: brut.infra === true,
      // Barages : données simulées, masquées tant qu'on ne les demande pas.
      barages: brut.barages === true,
      coords: brut.coords === 'lambert' ? 'lambert' : 'dms',
      onglet: brut.onglet === null || ONGLETS.includes(brut.onglet) ? brut.onglet : ONGLET_DEFAUT,
    };
  } catch {
    return { ...DEFAUTS };
  }
}

function ecrirePrefs(prefs) {
  try { localStorage.setItem(CLE_PREFS, JSON.stringify(prefs)); } catch { /* stockage indisponible */ }
}

/** Charge un JSON (null s'il est absent ou illisible). */
async function lireJson(url) {
  try {
    const reponse = await fetch(url);
    return reponse.ok ? await reponse.json() : null;
  } catch {
    return null;
  }
}

// Session d'abord (serveur de comptes) : sans session, la page de connexion ; les données
// chargées ensuite sont celles que le serveur autorise (région d'un compte régional).
const session = await ouvrirSession();
if (session) surveillerSession();
const regionSession = session?.compte?.role === 'commandement' ? session.region : null;

const prefs = lirePrefs();
const origine = window.location.origin;
const [rapportGr, etiquettesGr] = await Promise.all([
  lireJson(`${origine}/gendarmerie/rapport.json`),
  lireJson(`${origine}/gendarmerie/etiquettes.geojson`),
]);
const avecGendarmerie = Boolean(rapportGr && etiquettesGr);
const COMMANDEMENTS = (etiquettesGr?.features ?? [])
  .filter((f) => f.properties.niveau === 'reg')
  .map((f) => ({ nom: f.properties.nom, id: f.properties.id, emprise: f.properties.emprise }))
  .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
const excelDisponible = Boolean(rapportGr?.excel);
const reglagesGr = () => (avecGendarmerie ? { echelon: prefs.echelon, unites: prefs.unites, excel: prefs.excel && excelDisponible, infra: prefs.infra } : null);

maplibregl.setWorkerUrl(urlTravailleur);
const protocole = new Protocol();
maplibregl.addProtocol('pmtiles', protocole.tile);
// Archive de l'affichage ; son adresse doit être celle de la source « protomaps » du style,
// sans « pmtiles:// ». Les itinéraires lisent la même archive depuis leur worker.
const archive = new PMTiles(`${origine}/tiles/maroc.pmtiles`);
protocole.add(archive);

const carte = new maplibregl.Map({
  container: 'carte',
  style: construireStyle({ origine, ...prefs, gendarmerie: reglagesGr() }),
  bounds: regionSession?.emprise ?? EMPRISE_TUILES,
  fitBoundsOptions: { padding: 24 },
  maxBounds: LIMITES_NAVIGATION,
  minZoom: 3.5,
  maxZoom: 19,
  attributionControl: { compact: true },
  // Compte régional : la carte s'ouvre toujours sur sa région (pas sur une vue d'URL ailleurs).
  hash: regionSession ? false : 'vue',
});

// En bas à droite : le haut de l'écran est pour la recherche et la fiche de sélection.
carte.addControl(new maplibregl.FullscreenControl(), 'bottom-right');
carte.addControl(new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
}), 'bottom-right');
carte.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
carte.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 140 }), 'bottom-left');

// ── Mesure ─────────────────────────────────────────────────────────────────
// Itinéraires (mesure, compétence, tournée, bouclage, barages) calculés dans un worker :
// construire un graphe routier prend de 50 à 800 ms, ce qui figeait la carte.
const reseau = new ReseauRoutierDistant(
  () => new Worker(new URL('./itineraire-worker.js', import.meta.url), { type: 'module' }),
  { urlTuiles: `${origine}/tiles/maroc.pmtiles`, urlNational: `${origine}/data/reseau-national.bin` },
);
const mesure = new OutilMesure(carte, { reseau, priorite: prefs.priorite, surChangement: afficherMesure });
// Chaque style (premier chargement, thème, langue) repart de zéro : réinstaller les couches de mesure.
carte.on('style.load', () => mesure.installer({ theme: prefs.theme, langue: prefs.langue }));

function afficherMesure({ mode, resultat, details, aide }) {
  for (const bouton of document.querySelectorAll('[data-mesure]')) {
    bouton.setAttribute('aria-pressed', String(bouton.dataset.mesure === mode));
  }
  const sortie = document.getElementById('mesure-sortie');
  sortie.hidden = !mode;
  document.getElementById('mesure-resultat').textContent = resultat ?? '';
  document.getElementById('mesure-details').replaceChildren(...details.map((texte) => {
    const li = document.createElement('li');
    li.textContent = texte;
    return li;
  }));
  document.getElementById('mesure-aide').textContent = aide ?? '';
}

/** Arrête les outils de l'analyse et du croquis, et ferme la fiche : la mesure prend les clics. */
function preparerMesure() {
  analyse.arreterOutil();
  croquis.arreter();
  barages?.arreterOutil();
  gendarmerie?.fermer();
}

/** Mesure à partir de points venus d'ailleurs (fiche, compétence territoriale). */
function mesurerDepuis(...points) {
  preparerMesure();
  for (const p of points) mesure.ajouterPoint(p);
  ouvrirOnglet('mesure');
}

for (const bouton of document.querySelectorAll('[data-mesure]')) {
  bouton.addEventListener('click', () => {
    preparerMesure();
    mesure.activer(bouton.dataset.mesure);
  });
}
document.getElementById('mesure-effacer').addEventListener('click', () => mesure.effacer());

// ── Analyse : couverture, zone d'intervention, bouclage, tournée ───────────
const $ = (id) => document.getElementById(id);
const analyse = new Analyse(carte, {
  reseau, origine, $, priorite: prefs.priorite, langue: prefs.langue,
  // Un outil de l'analyse prend les clics : la mesure s'arrête, la fiche se ferme.
  surOutil: () => {
    mesure.arreter();
    croquis.arreter();
    barages?.arreterOutil();
    gendarmerie?.fermer();
  },
});
carte.on('style.load', () => analyse.installer({ theme: prefs.theme }));

// ── Croquis : points, lignes, zones, textes ────────────────────────────────
const croquis = new Croquis(carte, {
  $, langue: prefs.langue,
  surOutil: () => {
    mesure.arreter();
    analyse.arreterOutil();
    barages?.arreterOutil();
    gendarmerie?.fermer();
  },
  autreOutilActif: () => Boolean(mesure.mode || analyse.outil || barages?.outil),
});
carte.on('style.load', () => croquis.installer());

// Icônes générées : croquis et barages (un seul résolveur par carte).
const resoudreIcone = (c, id) => {
  fournirIcone(c, id);
  fournirIconeBarage(c, id);
};
carte.setMissingStyleImageResolver((id) => resoudreIcone(carte, id));

// ── Barages (jeu à part, simulé pour l'instant : voir barages.js) ──────────
const barages = avecGendarmerie ? new CoucheBarages(carte, {
  $, langue: prefs.langue,
  url: `${origine}/barages/barages.json`,
  // Circonscriptions déjà chargées pour la compétence territoriale : un seul chargement.
  circos: () => competence.charger(),
  importeLe: rapportGr?.importeLe ?? null,
  montrerCirco: (id) => gendarmerie?.montrerCirco(id),
  // Routes des tuiles locales, lues comme pour la mesure : un barage n'est posé que sur une route.
  routes: (bbox, zMax) => reseau.lignes(bbox, { zMax }),
  // Ajouter ou déplacer un barage prend les clics : les autres outils s'arrêtent.
  surOutil: () => {
    mesure.arreter();
    analyse.arreterOutil();
    croquis.arreter();
    gendarmerie?.fermer();
  },
  ouvrirPanneau: () => ouvrirOnglet('couches'),
  fermerFiche: () => gendarmerie?.fermer(),
}) : null;
carte.on('style.load', () => barages?.installer({ theme: prefs.theme }));
barages?.definirLectureSeule(Boolean(regionSession));

// ── Optimisation des barrages (optimisation-ui.js) : analyse en lecture seule, corrections approuvées ─
// URL absolues : le worker résout les chemins relatifs depuis son propre script.
const absolue = (chemin) => new URL(chemin, location.href).href;
const optimisation = barages ? new TableauOptimisation(carte, {
  $, couche: barages, session,
  urls: {
    circos: { reg: absolue(`${origine}/gendarmerie/circo-reg.geojson`), cie: absolue(`${origine}/gendarmerie/circo-cie.geojson`), bt: absolue(`${origine}/gendarmerie/circo-bt.geojson`) },
    tuiles: absolue(`${origine}/tiles/maroc.pmtiles`),
  },
  activerCouche: () => {
    caseBarages.checked = true;
    changer('barages', true);
  },
  fermerFiche: () => gendarmerie?.fermer(),
  // Itinéraires des distances par la route : le moteur de la carte (worker), comme la mesure.
  reseau,
  // Choisir un emplacement sur la carte prend les clics : les autres outils s'arrêtent.
  arreterOutils: () => {
    mesure.arreter();
    analyse.arreterOutil();
    croquis.arreter();
    barages?.arreterOutil();
    gendarmerie?.fermer();
  },
}) : null;
carte.on('style.load', () => optimisation?.installer());
for (const bouton of document.querySelectorAll('[data-tableau="optimisation"]')) {
  bouton.hidden = !optimisation;
  bouton.addEventListener('click', () => optimisation?.basculer());
}

// ── Impression ─────────────────────────────────────────────────────────────

/**
 * Style imprimé : celui de l'écran, mais toujours en thème clair (encre, lisibilité),
 * avec les couches ajoutées en cours de route (mesure, analyse, croquis) à leur place.
 */
function stylePourImpression() {
  const courant = carte.getStyle();
  if (prefs.theme !== 'dark') return courant;
  const clair = construireStyle({ origine, ...prefs, theme: 'light', gendarmerie: reglagesGr() });
  const idsClair = new Set(clair.layers.map((c) => c.id));
  for (const [id, source] of Object.entries(courant.sources)) {
    if (!clair.sources[id] || (source.type === 'geojson' && typeof source.data === 'object')) clair.sources[id] = source;
  }
  courant.layers.forEach((couche, i) => {
    if (idsClair.has(couche.id)) return;
    const suivante = courant.layers.slice(i + 1).find((c) => idsClair.has(c.id));
    const j = suivante ? clair.layers.findIndex((c) => c.id === suivante.id) : clair.layers.length;
    clair.layers.splice(j, 0, couche);
  });
  return clair;
}

/** Légende et listes de la feuille, d'après ce qui est affiché au zoom imprimé. */
function contenuImpression(zoom) {
  const t = TEXTES[prefs.langue];
  const c = COULEURS_GR.light;
  const legende = [];
  if (gendarmerie) {
    const gr = [];
    const niveau = echelonAuZoom(prefs.echelon, zoom);
    if (niveau) gr.push({ type: 'trait', couleur: c[niveau], libelle: `${t.grCirco} · ${t[`grEchelon_${niveau}`]}` });
    if (prefs.unites) for (const n of ['reg', 'cie', 'bt']) gr.push({ type: 'pastille', couleur: c[n], libelle: t[`grNiveau_${n}`] });
    if (prefs.excel && excelDisponible) gr.push({ type: 'pastille', couleur: c.excel, libelle: t.grExcel });
    if (prefs.infra) for (const k of ['peage', 'gare', 'aeroport', 'port']) gr.push({ type: 'pastille', couleur: c.infra[k], libelle: t[`grInfra_${k}`] });
    if (gr.length) legende.push({ type: 'titre', libelle: t.grTitre }, ...gr);
  }
  const resume = mesure.resume();
  if (resume.mode === 'distance' && resume.resultat) legende.push({ type: 'trait', couleur: '#c1272d', libelle: t.lgMesure(resume.resultat) });
  const a = analyse.pourImpression();
  legende.push(...a.legende);
  const dessins = croquis.pourImpression().map((i) => ({
    type: i.genre === 'point' ? 'image' : i.genre === 'zone' ? 'zone' : 'trait', couleur: i.couleur, image: i.image, libelle: i.libelle,
  }));
  if (dessins.length) legende.push({ type: 'titre', libelle: t.ongletCroquis }, ...dessins);
  if (barages) legende.push(...barages.pourImpression());
  return { legende, listes: a.listes };
}

const impression = new Impression(carte, {
  $, langue: prefs.langue, logo: logoGendarmerie,
  style: stylePourImpression,
  contenu: contenuImpression,
  visible: () => prefs.onglet === 'impression',
  resoudreIcone,
});

/** Actions d'analyse proposées pour un point (fiches d'unité, clic droit). */
function actionsAnalyse(position, nom) {
  const t = TEXTES[prefs.langue];
  return [
    [t.anActionZone, () => { analyse.zone(position, nom); ouvrirOnglet('analyse'); }, true],
    [t.anActionTournee, () => { analyse.ajouterEtape(position, nom); ouvrirOnglet('analyse'); }, true],
  ];
}

// ── Gendarmerie ────────────────────────────────────────────────────────────
const gendarmerie = avecGendarmerie ? new CouchesGendarmerie(carte, {
  inspecteur: $('inspecteur'),
  textes: () => TEXTES[prefs.langue],
  langue: () => prefs.langue,
  // Un outil a les clics, ou le clic tombe sur un élément du croquis : pas de fiche.
  mesureActive: (e) => Boolean(mesure.mode || analyse.outil || croquis.outil || barages?.outil || optimisation?.proximite.capteClic(e) || (e?.type === 'click' && croquis.sousLeClic(e))),
  actionsPoint: actionsAnalyse,
  ajouterAMesure: (point) => mesurerDepuis(point),
  surChangement: afficherEchelon,
  extensions: barages ? [barages.extension()] : [],
}) : null;
gendarmerie?.regler(reglagesGr());

const COULEUR_ECHELON = { reg: 'var(--gr-reg)', cie: 'var(--gr-cie)', bt: 'var(--gr-bt)' };

/** Panneau et barre d'état : découpage affiché au zoom courant. */
function afficherEchelon() {
  if (!gendarmerie) return;
  const t = TEXTES[prefs.langue];
  const niveau = gendarmerie.echelonAffiche();
  const statut = $('gr-statut');
  if (prefs.echelon === 'aucun') statut.textContent = '';
  else if (prefs.echelon === 'auto') statut.textContent = niveau ? t.grAffiche(t[`grEchelon_${niveau}`]) : t.grAucunAffiche;
  else statut.textContent = t.grImpose(t[`grEchelon_${prefs.echelon}`]);
  const etat = $('etat-echelon');
  etat.textContent = niveau ? t[`grEchelon_${niveau}`] : '';
  etat.style.setProperty('--c', COULEUR_ECHELON[niveau] ?? '');
}

$('gr-reglages').hidden = !avecGendarmerie;
$('gr-absent').hidden = avecGendarmerie;
// Les barages se rattachent aux brigades : sans couches de la Gendarmerie, pas de barages.
$('barages-groupe').hidden = !barages;
$('bandeau-fictif').hidden = !rapportGr?.fictif;
// Sans carte graphique, chaque image coûte 10 à 20 fois plus : le dire plutôt que laisser croire à un défaut de la carte.
const rendu = diagnostiquerRendu();
$('bandeau-rendu').hidden = !rendu.logiciel;
$('bandeau-rendu').title = rendu.rendu ?? '';
if (rendu.logiciel) console.warn(`Rendu WebGL logiciel (${rendu.rendu ?? 'inconnu'}) : la carte sera lente.`);

// ── Onglets : un panneau à la fois ─────────────────────────────────────────
const panneau = $('panneau');
function ouvrirOnglet(onglet) {
  prefs.onglet = onglet;
  ecrirePrefs(prefs);
  panneau.hidden = !onglet;
  for (const volet of panneau.querySelectorAll('[data-volet]')) volet.hidden = volet.dataset.volet !== onglet;
  for (const bouton of document.querySelectorAll('[data-onglet]')) bouton.setAttribute('aria-pressed', String(bouton.dataset.onglet === onglet));
  impression.rendreCadre();
}
for (const bouton of document.querySelectorAll('[data-onglet]')) {
  bouton.addEventListener('click', () => ouvrirOnglet(prefs.onglet === bouton.dataset.onglet ? null : bouton.dataset.onglet));
}

// ── Panneau ────────────────────────────────────────────────────────────────
const choixVille = $('villes');
const caseRegions = $('regions');
const caseCircos = $('gr-circos');
const caseUnites = $('gr-unites');
const caseExcel = $('gr-excel');
const caseInfra = $('gr-infra');
const caseBarages = $('barages-actif');
caseExcel.disabled = !excelDisponible;
// Échelon rendu quand on rallume les circonscriptions.
let dernierEchelon = prefs.echelon === 'aucun' ? 'auto' : prefs.echelon;

function afficherCompteurs() {
  const t = TEXTES[prefs.langue];
  const c = rapportGr?.circonscriptions;
  $('gr-compteurs').replaceChildren(...(c ? ['reg', 'cie', 'bt'] : []).map((n) => {
    const li = document.createElement('li');
    li.style.setProperty('--couleur', COULEUR_ECHELON[n]);
    const b = document.createElement('b');
    b.textContent = new Intl.NumberFormat('fr-FR').format(c[n]);
    const span = document.createElement('span');
    span.textContent = t[`grCompteur_${n}`];
    li.append(b, span);
    return li;
  }));
}

function appliquerTextes() {
  const t = TEXTES[prefs.langue];
  document.documentElement.lang = prefs.langue;
  document.documentElement.dir = prefs.langue === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.dataset.theme = prefs.theme;
  document.title = `${t.titre} — ${t.titrePage}`;
  for (const el of document.querySelectorAll('[data-texte]')) el.textContent = t[el.dataset.texte];
  for (const el of document.querySelectorAll('[data-texte-aria]')) el.setAttribute('aria-label', t[el.dataset.texteAria]);
  for (const el of document.querySelectorAll('[data-placeholder]')) {
    el.placeholder = t[el.dataset.placeholder];
    el.setAttribute('aria-label', t[el.dataset.placeholder]);
  }
  const selection = choixVille.value;
  const groupe = (libelle, options) => {
    const g = document.createElement('optgroup');
    g.label = libelle;
    g.append(...options);
    return g;
  };
  choixVille.replaceChildren(
    new Option(t.royaume, ''),
    ...(COMMANDEMENTS.length ? [groupe(t.commandements, COMMANDEMENTS.map((c, i) => new Option(c.nom, `c:${i}`)))] : []),
    groupe(t.villes, VILLES.map((v, i) => new Option(v[prefs.langue], `v:${i}`))),
  );
  choixVille.value = selection;
  for (const bouton of document.querySelectorAll('[data-choix]')) {
    const [cle, valeur] = bouton.dataset.choix.split(':');
    bouton.setAttribute('aria-pressed', String(prefs[cle] === valeur));
  }
  caseRegions.checked = prefs.regions;
  caseCircos.checked = prefs.echelon !== 'aucun';
  $('gr-echelons').setAttribute('aria-disabled', String(prefs.echelon === 'aucun'));
  caseUnites.checked = prefs.unites;
  caseExcel.checked = prefs.excel;
  caseInfra.checked = prefs.infra;
  caseBarages.checked = prefs.barages;
  afficherCompteurs();
  afficherEchelon();
}

function changer(cle, valeur) {
  if (prefs[cle] === valeur) return;
  prefs[cle] = valeur;
  if (cle === 'echelon' && valeur !== 'aucun') dernierEchelon = valeur;
  ecrirePrefs(prefs);
  appliquerTextes();
  if (cle === 'regions') {
    for (const id of ['regions-trait', 'regions-nom']) {
      if (carte.getLayer(id)) carte.setLayoutProperty(id, 'visibility', valeur ? 'visible' : 'none');
    }
  } else if (cle === 'priorite') {
    mesure.definirPriorite(valeur);
    analyse.definirPriorite(valeur);
  } else if (cle === 'barages') {
    barages?.definirVisibilite(valeur);
  } else if (cle === 'coords') {
    afficherPosition(carte.getCenter());
  } else if (cle === 'echelon' || cle === 'unites' || cle === 'excel' || cle === 'infra') {
    gendarmerie?.regler(reglagesGr());
  } else {
    // Rechargement complet : `style.load` est émis et l'outil de mesure se réinstalle.
    carte.setStyle(construireStyle({ origine, ...prefs, gendarmerie: reglagesGr() }), { diff: false });
    mesure.definirLangue(prefs.langue);
    analyse.definirLangue(prefs.langue);
    croquis.definirLangue(prefs.langue);
    barages?.definirLangue(prefs.langue);
    impression.definirLangue(prefs.langue);
    barre.rafraichir();
    gendarmerie?.fermer();
  }
}

for (const bouton of document.querySelectorAll('[data-choix]')) {
  bouton.addEventListener('click', () => {
    const [cle, valeur] = bouton.dataset.choix.split(':');
    changer(cle, valeur);
  });
}
caseRegions.addEventListener('change', () => changer('regions', caseRegions.checked));
caseCircos.addEventListener('change', () => changer('echelon', caseCircos.checked ? dernierEchelon : 'aucun'));
caseUnites.addEventListener('change', () => changer('unites', caseUnites.checked));
caseExcel.addEventListener('change', () => changer('excel', caseExcel.checked));
caseInfra.addEventListener('change', () => changer('infra', caseInfra.checked));
caseBarages.addEventListener('change', () => changer('barages', caseBarages.checked));
choixVille.addEventListener('change', () => {
  const [sorte, indice] = choixVille.value.split(':');
  if (sorte === 'v') {
    carte.flyTo({ center: VILLES[Number(indice)].centre, zoom: 12.5, speed: 1.4 });
  } else if (sorte === 'c') {
    gendarmerie?.montrerCirco(COMMANDEMENTS[Number(indice)].id);
  } else {
    carte.fitBounds(EMPRISE_TUILES, { padding: 24 });
  }
});

// ── Recherche ──────────────────────────────────────────────────────────────
// L'index est chargé et interrogé dans un worker : la carte reste fluide.
const barre = new BarreRecherche(carte, {
  entree: document.getElementById('recherche'),
  liste: document.getElementById('resultats'),
  statut: document.getElementById('recherche-statut'),
  worker: new Worker(new URL('./recherche-worker.js', import.meta.url), { type: 'module' }),
  urlIndex: `${origine}/data/recherche.json`,
  indexOptionnels: avecGendarmerie ? [`${origine}/gendarmerie/recherche-gendarmerie.json`] : [],
  textes: () => TEXTES[prefs.langue],
  langue: () => prefs.langue,
  // Un résultat de recherche s'ajoute à la mesure en cours.
  ajouterAMesure: (point) => {
    preparerMesure();
    mesure.ajouterPoint(point);
  },
});

// ── Coordonnées ────────────────────────────────────────────────────────────
const lecture = $('coordonnees');
function afficherPosition({ lng, lat }) {
  const position = prefs.coords === 'lambert'
    ? formaterLambert(versLambert([lng, lat]), { langue: prefs.langue })
    : `${enDMS(lat, 'N', 'S')}  ${enDMS(lng, 'E', 'O')}`;
  lecture.textContent = `${position}  ·  z ${carte.getZoom().toFixed(1)}`;
}
carte.on('mousemove', (e) => afficherPosition(e.lngLat));
carte.on('moveend', () => afficherPosition(carte.getCenter()));
carte.once('load', () => afficherPosition(carte.getCenter()));

let fenetre = null;
carte.on('contextmenu', (e) => {
  const { lng, lat } = e.lngLat;
  const t = TEXTES[prefs.langue];
  const decimal = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const contenu = document.createElement('div');
  contenu.className = 'fenetre-coord';
  const dms = document.createElement('strong');
  dms.textContent = `${enDMS(lat, 'N', 'S')}  ${enDMS(lng, 'E', 'O')}`;
  const code = document.createElement('code');
  code.textContent = decimal;
  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.textContent = t.copier;
  bouton.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(decimal); bouton.textContent = t.copie; } catch { /* presse-papiers refusé */ }
  });
  const position = [lng, lat];
  const lambert = formaterLambert(versLambert(position), { langue: prefs.langue });
  const codeLambert = document.createElement('code');
  codeLambert.textContent = lambert;
  const boutonLambert = document.createElement('button');
  boutonLambert.type = 'button';
  boutonLambert.className = 'secondaire';
  boutonLambert.textContent = t.copierLambert;
  boutonLambert.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(lambert); boutonLambert.textContent = t.copie; } catch { /* presse-papiers refusé */ }
  });
  const copies = document.createElement('div');
  copies.className = 'fenetre-copies';
  copies.append(bouton, boutonLambert);
  contenu.append(dms, code, codeLambert, copies);
  if (competence) contenu.append(blocCompetence(position));
  const actions = document.createElement('div');
  actions.className = 'fenetre-actions';
  for (const [texte, action] of [
    ...actionsAnalyse(position, null),
    [t.anActionBouclage, () => { analyse.placerBouclage(position); ouvrirOnglet('analyse'); }],
  ]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'secondaire';
    b.textContent = texte;
    b.addEventListener('click', () => { fenetre?.remove(); action(); });
    actions.append(b);
  }
  contenu.append(actions);
  fenetre?.remove();
  fenetre = new maplibregl.Popup({ maxWidth: '340px' }).setLngLat(e.lngLat).setDOMContent(contenu).addTo(carte);
});

// ── Compétence territoriale (clic droit) ───────────────────────────────────
const competence = avecGendarmerie ? new Competence(origine) : null;

/** Brigade, compagnie et région compétentes, et trajet depuis le siège ; rempli à mesure des calculs. */
function blocCompetence(position) {
  const t = TEXTES[prefs.langue];
  const bloc = document.createElement('div');
  bloc.className = 'competence';
  const titre = document.createElement('span');
  titre.className = 'competence-titre';
  titre.textContent = t.compTitre;
  const corps = document.createElement('div');
  corps.textContent = '…';
  bloc.append(titre, corps);
  competence.en(position).then(({ bt, cie, reg, siege }) => {
    if (!bt && !cie && !reg) {
      corps.textContent = t.compHors;
      return;
    }
    const dl = document.createElement('dl');
    for (const [terme, valeur] of [[t.compBrigade, bt?.nom], [t.compCompagnie, cie?.nom], [t.compRegion, reg?.nom]]) {
      if (!valeur) continue;
      const dt = document.createElement('dt');
      dt.textContent = terme;
      const dd = document.createElement('dd');
      dd.textContent = valeur;
      dl.append(dt, dd);
    }
    corps.replaceChildren(dl);
    if (!siege) return;
    const trajet = document.createElement('p');
    trajet.className = 'competence-trajet';
    trajet.textContent = `${t.compDepuis(siege.nom)} : ${t.compCalcul}`;
    const tracer = document.createElement('button');
    tracer.type = 'button';
    tracer.textContent = t.compTracer;
    tracer.addEventListener('click', () => {
      fenetre?.remove();
      mesure.arreter(); // nouveau tracé, pas une suite de la mesure en cours
      mesurerDepuis(siege.position, position);
    });
    corps.append(trajet, tracer);
    reseau.itineraire(siege.position, position, { priorite: prefs.priorite }).catch(() => null).then((r) => {
      const l = prefs.langue;
      trajet.textContent = `${t.compDepuis(siege.nom)} : ${r
        ? t.compTrajet(`${r.approximatif ? '≈ ' : ''}${formaterDistance(r.distance, l)}`, formaterDuree(r.secondes, l))
        : t.compEchec}`;
    });
  }).catch(() => { corps.textContent = t.compHors; });
  return bloc;
}

appliquerTextes();
ouvrirOnglet(prefs.onglet);
// Après la création de `competence` : le jeu de barages se charge à la première activation.
barages?.definirVisibilite(prefs.barages);
