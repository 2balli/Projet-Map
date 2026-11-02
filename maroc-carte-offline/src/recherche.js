/**
 * Recherche hors ligne : villes, villages, quartiers, lieux (POI), rues, régions
 * et coordonnées. L'index (`donnees/data/recherche.json`) est construit une fois
 * par `npm run data` (scripts/index-recherche.mjs) à partir des tuiles locales.
 *
 * Format de l'index :
 *   { version: 1, contextes: [[fr, ar]], kinds: [kind OSM], e: [entrée] }
 *   entrée = [type, nomFr, nomAr, lon × 1e5, lat × 1e5, rang 0–100, contexte | -1, kind | -1, autres noms]
 */
import { distanceMetres } from './mesure.js';

export const VERSION_INDEX = 1;
// Les unités de la Gendarmerie (index séparé, voir scripts/importer-gendarmerie.mjs) sont
// ajoutées en fin de liste : les index déjà construits restent valables.
export const TYPES = Object.freeze(['region', 'ville', 'village', 'quartier', 'lieu', 'rue', 'commandement', 'compagnie', 'brigade']);

const LIBELLES_TYPES = {
  fr: {
    region: 'Région', ville: 'Ville', village: 'Village', quartier: 'Quartier', lieu: 'Lieu', rue: 'Rue', coordonnees: 'Coordonnées',
    commandement: 'Commandement régional', compagnie: 'Compagnie', brigade: 'Brigade territoriale',
  },
  ar: {
    region: 'جهة', ville: 'مدينة', village: 'قرية', quartier: 'حي', lieu: 'مكان', rue: 'شارع', coordonnees: 'إحداثيات',
    commandement: 'القيادة الجهوية', compagnie: 'سرية', brigade: 'مركز الدرك الترابي',
  },
};

/** Libellés des catégories de lieux les plus courantes (kind OSM / Protomaps). */
const LIBELLES_LIEUX = {
  aerodrome: ['Aéroport', 'مطار'], airport: ['Aéroport', 'مطار'],
  hospital: ['Hôpital', 'مستشفى'], clinic: ['Clinique', 'مصحة'], doctors: ['Médecin', 'طبيب'], dentist: ['Dentiste', 'طبيب أسنان'],
  pharmacy: ['Pharmacie', 'صيدلية'],
  school: ['École', 'مدرسة'], college: ['Établissement scolaire', 'مؤسسة تعليمية'], university: ['Université', 'جامعة'],
  kindergarten: ['Crèche', 'روض أطفال'],
  place_of_worship: ['Mosquée / lieu de culte', 'مسجد'],
  police: ['Police / Gendarmerie', 'شرطة / درك'], fire_station: ['Protection civile', 'الوقاية المدنية'],
  townhall: ['Commune', 'جماعة'], administrative: ['Administration', 'إدارة'], courthouse: ['Tribunal', 'محكمة'],
  prison: ['Prison', 'سجن'], military: ['Site militaire', 'موقع عسكري'], embassy: ['Ambassade', 'سفارة'],
  post_office: ['Poste', 'بريد'], bank: ['Banque', 'بنك'], atm: ['Distributeur', 'شباك آلي'],
  fuel: ['Station-service', 'محطة وقود'], car_repair: ['Garage', 'مرآب'], parking: ['Parking', 'موقف سيارات'],
  hotel: ['Hôtel', 'فندق'], restaurant: ['Restaurant', 'مطعم'], cafe: ['Café', 'مقهى'], fast_food: ['Restauration rapide', 'وجبات سريعة'],
  supermarket: ['Supermarché', 'متجر كبير'], mall: ['Centre commercial', 'مركز تجاري'], marketplace: ['Souk / marché', 'سوق'],
  bakery: ['Boulangerie', 'مخبزة'],
  station: ['Gare', 'محطة'], bus_station: ['Gare routière', 'محطة طرقية'], bus_stop: ['Arrêt de bus', 'موقف حافلات'],
  tram_stop: ['Arrêt de tram', 'محطة ترامواي'], ferry_terminal: ['Port / gare maritime', 'ميناء'], harbour: ['Port', 'ميناء'],
  stadium: ['Stade', 'ملعب'], sports_centre: ['Centre sportif', 'مركز رياضي'], park: ['Parc', 'حديقة'], garden: ['Jardin', 'حديقة'],
  museum: ['Musée', 'متحف'], attraction: ['Site touristique', 'موقع سياحي'], monument: ['Monument', 'معلمة'], beach: ['Plage', 'شاطئ'],
  cemetery: ['Cimetière', 'مقبرة'], library: ['Bibliothèque', 'خزانة'], theatre: ['Théâtre', 'مسرح'], cinema: ['Cinéma', 'سينما'],
  peak: ['Sommet', 'قمة'], industrial: ['Zone industrielle', 'منطقة صناعية'],
  guest_house: ["Maison d'hôtes", 'دار الضيافة'], hostel: ['Auberge', 'نزل'], apartment: ['Appartements', 'شقق'],
  chalet: ['Chalet', 'شاليه'], camp_site: ['Camping', 'مخيم'],
  bar: ['Bar', 'حانة'], pub: ['Bar', 'حانة'], ice_cream: ['Glacier', 'مثلجات'], pastry: ['Pâtisserie', 'حلويات'],
  clothes: ['Vêtements', 'ملابس'], shoes: ['Chaussures', 'أحذية'], convenience: ['Épicerie', 'بقالة'],
  greengrocer: ['Primeur', 'خضار'], butcher: ['Boucherie', 'جزارة'], department_store: ['Grand magasin', 'متجر كبير'],
  variety_store: ['Bazar', 'بازار'], kiosk: ['Kiosque', 'كشك'], gift: ['Cadeaux', 'هدايا'], jewelry: ['Bijouterie', 'مجوهرات'],
  books: ['Librairie', 'مكتبة'], copyshop: ['Photocopie', 'نسخ'], electronics: ['Électronique', 'إلكترونيات'],
  mobile_phone: ['Téléphonie', 'هواتف'], computer: ['Informatique', 'حواسيب'], furniture: ['Meubles', 'أثاث'],
  hardware: ['Quincaillerie', 'عقاقير'], optician: ['Opticien', 'نظاراتي'], cosmetics: ['Cosmétiques', 'مستحضرات تجميل'],
  beauty: ['Institut de beauté', 'تجميل'], hairdresser: ['Coiffeur', 'حلاق'], tailor: ['Couturier', 'خياط'],
  car: ['Concessionnaire auto', 'وكالة سيارات'], car_rental: ['Location de voitures', 'كراء السيارات'],
  car_parts: ['Pièces auto', 'قطع غيار'], car_wash: ['Lavage auto', 'غسل السيارات'], taxi: ['Taxi', 'طاكسي'],
  driving_school: ['Auto-école', 'مدرسة تعليم السياقة'], travel_agency: ['Agence de voyages', 'وكالة أسفار'],
  money_transfer: ["Transfert d'argent", 'تحويل الأموال'], telecommunication: ['Télécommunications', 'اتصالات'],
  veterinary: ['Vétérinaire', 'بيطري'], community_centre: ['Centre culturel / social', 'مركز اجتماعي'],
  information: ['Information touristique', 'معلومات سياحية'], viewpoint: ['Point de vue', 'منظر'],
  artwork: ['Œuvre d’art', 'عمل فني'], memorial: ['Mémorial', 'نصب تذكاري'], ruins: ['Ruines', 'أطلال'],
  archaeological_site: ['Site archéologique', 'موقع أثري'], tomb: ['Tombeau / marabout', 'ضريح'],
  cave_entrance: ['Grotte', 'مغارة'], cape: ['Cap', 'رأس'], volcano: ['Volcan', 'بركان'], saddle: ['Col', 'ممر جبلي'],
  water: ["Plan d'eau", 'مسطح مائي'], basin: ['Bassin', 'حوض'], drinking_water: ['Point d’eau', 'ماء الشرب'],
  swimming_pool: ['Piscine', 'مسبح'], pitch: ['Terrain de sport', 'ملعب'], sports: ['Sports', 'رياضة'],
  fitness_centre: ['Salle de sport', 'قاعة رياضة'], playground: ['Aire de jeux', 'ساحة ألعاب'],
  motorway_junction: ['Échangeur', 'بدال'], pedestrian: ['Rue piétonne', 'شارع للراجلين'],
  residential: ['Zone résidentielle', 'منطقة سكنية'], commercial: ['Zone commerciale', 'منطقة تجارية'],
  farmland: ['Terres agricoles', 'أراض فلاحية'],
  // Gendarmerie Royale : « brigade », « compagnie », « gendarmerie »… donnent les unités les plus proches.
  gr_reg: ['Commandement régional · Gendarmerie', 'القيادة الجهوية · الدرك'],
  gr_cie: ['Compagnie · Gendarmerie', 'سرية · الدرك'],
  gr_bt: ['Brigade territoriale · Gendarmerie', 'مركز الدرك الترابي'],
  gr_excel: ['Unité · Gendarmerie', 'وحدة · الدرك'],
};

/**
 * Variantes d'un mot de la requête (forme normalisée, lettres doublées réduites) :
 * abréviations et chiffres romains des noms de rois et de dates (Hassan 2 = Hassan II).
 */
const ABREVIATIONS = {
  bd: ['boulevard'], bld: ['boulevard'], blvd: ['boulevard'], av: ['avenue'], ave: ['avenue'], pl: ['place'],
  hop: ['hopital'], ste: ['sainte'], st: ['saint'], aerop: ['aeroport'], fac: ['faculte'], univ: ['universite'],
  mosq: ['mosque'], pharma: ['pharmacie'], gend: ['gendarmerie'],
  1: ['i', '1er'], i: ['1'], 2: ['i'], 3: ['i'], 4: ['iv'], iv: ['4'], 5: ['v'], v: ['5'], 6: ['vi'], vi: ['6'],
};
// « ii » et « iii » deviennent « i » une fois les lettres doublées réduites : 2 et 3 renvoient donc à « i ».

export function libelleLieu(kind, langue = 'fr') {
  const l = LIBELLES_LIEUX[kind];
  if (l) return langue === 'ar' ? l[1] : l[0];
  const brut = String(kind || '').replace(/_/g, ' ');
  return brut ? brut[0].toUpperCase() + brut.slice(1) : LIBELLES_TYPES[langue]?.lieu ?? 'Lieu';
}

/**
 * Forme de comparaison : minuscules, sans accents ni ponctuation ; en arabe, sans
 * tashkil ni tatwil, alef / hamza / tâ marbouta / alif maqsoura unifiés.
 */
export function normaliser(texte) {
  return String(texte ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')            // accents latins
    .replace(/[ً-ٰٟـ]/g, '')  // tashkil, hamza / madda décomposées, tatwil
    .replace(/[آأإٱ]/g, 'ا')  // آ أ إ ٱ (si non décomposés)
    .replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[ڭگ]/g, 'ك').replace(/ڤ/g, 'ف')
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    // Lettres doublées ignorées : Mohammed / Mohamed, Hassane / Hassan, Allal / Alal…
    .replace(/(\p{L})\1+/gu, '$1')
    .trim();
}

// ── Coordonnées ────────────────────────────────────────────────────────────

const DANS_LA_ZONE = (lon, lat) => lon >= -20 && lon <= 2 && lat >= 18 && lat <= 38;

function lireDMS(morceau) {
  const m = /^\s*(\d{1,3})\s*[°º]\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′’]?\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:["″”]|''|′′)?\s*)?([NSEOW])\s*$/i.exec(morceau);
  if (!m) return null;
  const v = Number(m[1]) + Number((m[2] ?? '0').replace(',', '.')) / 60 + Number((m[3] ?? '0').replace(',', '.')) / 3600;
  const h = m[4].toUpperCase();
  return { valeur: h === 'S' || h === 'O' || h === 'W' ? -v : v, axe: h === 'N' || h === 'S' ? 'lat' : 'lon' };
}

/**
 * « 33.5731, -7.5898 », « 33,5731 -7,5898 », « 33°34′23″N 7°35′23″O »… → [lon, lat],
 * ou null. L'ordre latitude / longitude est déduit quand c'est possible.
 */
export function analyserCoordonnees(texte) {
  const s = String(texte ?? '').trim();
  const dms = /^(.+?[NS])\s*[,;]?\s*(.+?[EOW])$/i.exec(s) ?? /^(.+?[EOW])\s*[,;]?\s*(.+?[NS])$/i.exec(s);
  if (dms) {
    const [a, b] = [lireDMS(dms[1]), lireDMS(dms[2])];
    if (a && b && a.axe !== b.axe) {
      const [lat, lon] = a.axe === 'lat' ? [a.valeur, b.valeur] : [b.valeur, a.valeur];
      return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
    }
  }
  const m = /^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*(?:[,;]\s*|\s+)(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(s);
  if (!m) return null;
  const [x, y] = [Number(m[1].replace(',', '.')), Number(m[2].replace(',', '.'))];
  if (DANS_LA_ZONE(y, x)) return [y, x];      // « lat, lon » (usage courant)
  if (DANS_LA_ZONE(x, y)) return [x, y];      // « lon, lat »
  return Math.abs(x) <= 90 && Math.abs(y) <= 180 ? [y, x] : null;
}

// ── Index ──────────────────────────────────────────────────────────────────

// Par type (region … rue, puis commandement, compagnie, brigade). Une région reste
// au-dessous d'une ville de même nom (« casablanca » → la ville, pas Casablanca-Settat).
const BASE = [50, 60, 40, 35, 20, 20, 55, 50, 45];
const ZOOM = [7, 12, 14, 15, 17, 16, 9, 11, 13];
/** Poids de la distance au centre de la carte, par type (les lieux et rues proches d'abord). */
const PROXIMITE = [0, 1.5, 3, 5, 8, 8, 0, 1.5, 3];

export class IndexRecherche {
  constructor(donnees) {
    if (donnees?.version !== VERSION_INDEX) throw new Error('index de recherche : version inconnue');
    this.contextes = donnees.contextes;
    this.kinds = donnees.kinds;
    this.entrees = donnees.e;
    const n = this.entrees.length;
    this.cles = new Array(n);
    this.nomsNormalises = new Array(n);
    // Libellés de catégorie (fr + ar) normalisés, pour chercher « pharmacie », « مسجد »…
    const categories = this.kinds.map((k) => ` ${normaliser(libelleLieu(k, 'fr'))} ${normaliser(libelleLieu(k, 'ar'))}`);
    for (let i = 0; i < n; i++) {
      const [, fr, ar, , , , , kind, autres] = this.entrees[i];
      const noms = ` ${normaliser(fr)} ${normaliser(ar)} ${normaliser(autres)} `;
      this.nomsNormalises[i] = [normaliser(fr), normaliser(ar)];
      this.cles[i] = { noms, categorie: kind >= 0 ? categories[kind] : '' };
    }
  }

  get taille() { return this.entrees.length; }

  /**
   * @param {string} requete
   * @param {{ centre?: number[], langue?: 'fr'|'ar', max?: number }} options  centre = [lon, lat] de la carte
   * @returns {{ type, nom, nomSecondaire, contexte, libelle, point: number[], zoom: number }[]}
   */
  chercher(requete, { centre = null, langue = 'fr', max = 8 } = {}) {
    const coord = analyserCoordonnees(requete);
    const resultats = [];
    if (coord) {
      resultats.push({
        type: 'coordonnees', nom: `${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`, nomSecondaire: '',
        contexte: '', libelle: LIBELLES_TYPES[langue].coordonnees, point: coord, zoom: 16,
      });
    }
    const q = normaliser(requete);
    if (q.length < 2) return resultats;
    // Chaque mot : lui-même et son éventuelle forme développée (« bd » → « boulevard »).
    const mots = q.split(' ').map((m) => [m, ...(ABREVIATIONS[m] ?? [])].map((v) => ` ${v}`));
    const qDeveloppee = q.split(' ').map((m) => ABREVIATIONS[m]?.[0] ?? m).join(' ');
    const garder = max * 3; // marge pour les doublons écartés à la fin
    let meilleurs = [];
    let seuil = -Infinity;
    for (let i = 0; i < this.entrees.length; i++) {
      const { noms, categorie } = this.cles[i];
      let parNom = true;
      let parCategorie = Boolean(categorie);
      for (const variantes of mots) {
        if (parNom && !variantes.some((v) => noms.includes(v))) parNom = false;
        if (parCategorie && !variantes.some((v) => categorie.includes(v) || noms.includes(v))) parCategorie = false;
        if (!parNom && !parCategorie) break;
      }
      if (!parNom && !parCategorie) continue;
      const e = this.entrees[i];
      const type = e[0];
      const [frN, arN] = this.nomsNormalises[i];
      let qualite = 10;
      if (parNom) {
        if ([q, qDeveloppee].some((x) => frN === x || arN === x)) qualite = 50;
        else if ([q, qDeveloppee].some((x) => frN.startsWith(x) || arN.startsWith(x))) qualite = 40;
        else qualite = 20;
        // Mots trouvés en entier (« v » ≠ « vi ») plutôt qu'en début de mot.
        if (mots.every((variantes) => variantes.some((v) => noms.includes(`${v} `)))) qualite += 15;
      }
      let score = BASE[type] + e[5] * 0.3 + qualite;
      if (centre) {
        const km = distanceMetres(centre, [e[3] / 1e5, e[4] / 1e5]) / 1000;
        // Une recherche par catégorie (« pharmacie ») cherche surtout le plus proche.
        score -= Math.min(60, Math.log2(1 + km) * (parNom ? PROXIMITE[type] : 12));
      }
      if (meilleurs.length >= garder && score <= seuil) continue;
      meilleurs.push([score, i]);
      if (meilleurs.length > garder * 4) {
        meilleurs.sort((a, b) => b[0] - a[0]);
        meilleurs = meilleurs.slice(0, garder);
        seuil = meilleurs.at(-1)[0];
      }
    }
    meilleurs.sort((a, b) => b[0] - a[0]);
    // Une même rue découpée en plusieurs tronçons, ou un même lieu en double : une seule ligne.
    const vus = new Set();
    for (const [, i] of meilleurs) {
      if (resultats.length >= max) break;
      const r = this.decrire(i, langue);
      const cle = `${r.type}|${normaliser(r.nom)}|${r.contexte}|${r.libelle}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      resultats.push(r);
    }
    return resultats;
  }

  decrire(i, langue = 'fr') {
    const [type, fr, ar, lon, lat, , ctx, kind] = this.entrees[i];
    const nomType = TYPES[type];
    const [principal, secondaire] = langue === 'ar' && ar ? [ar, fr] : [fr || ar, ar];
    const contexte = ctx >= 0 ? (langue === 'ar' && this.contextes[ctx][1] ? this.contextes[ctx][1] : this.contextes[ctx][0]) : '';
    return {
      type: nomType,
      nom: principal,
      nomSecondaire: secondaire && secondaire !== principal ? secondaire : '',
      contexte: contexte === principal ? '' : contexte,
      libelle: kind >= 0 ? libelleLieu(this.kinds[kind], langue) : LIBELLES_TYPES[langue][nomType],
      point: [lon / 1e5, lat / 1e5],
      zoom: ZOOM[type],
    };
  }
}

/**
 * Ajoute les entrées de `b` à celles de `a` (mêmes formats), en renumérotant
 * contextes et catégories. Ni `a` ni `b` ne sont modifiés.
 */
export function fusionnerIndex(a, b) {
  if (a?.version !== VERSION_INDEX || b?.version !== VERSION_INDEX) throw new Error('index de recherche : version inconnue');
  const contextes = [...a.contextes];
  const kinds = [...a.kinds];
  const ctxB = b.contextes.map((c) => contextes.push(c) - 1);
  const kindB = b.kinds.map((k) => {
    const i = kinds.indexOf(k);
    return i >= 0 ? i : kinds.push(k) - 1;
  });
  const e = [...a.e, ...b.e.map((x) => {
    const y = [...x];
    y[6] = x[6] >= 0 ? ctxB[x[6]] : -1;
    y[7] = x[7] >= 0 ? kindB[x[7]] : -1;
    return y;
  })];
  return { version: VERSION_INDEX, contextes, kinds, e };
}

const lireJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));

/**
 * Index chargé à la demande depuis le serveur local. `optionnels` : index
 * complémentaires (unités de la Gendarmerie) — leur absence n'empêche pas la recherche.
 */
export class Recherche {
  constructor(url, optionnels = []) {
    this.url = url;
    this.optionnels = optionnels;
    this._chargement = null;
  }

  charger() {
    this._chargement ??= Promise.all([
      lireJson(this.url),
      ...this.optionnels.map((url) => lireJson(url).catch(() => null)),
    ])
      .then(([principal, ...autres]) => new IndexRecherche(
        autres.filter(Boolean).reduce((index, autre) => fusionnerIndex(index, autre), principal),
      ))
      .catch((erreur) => {
        this._chargement = null; // nouvel essai au prochain appel
        throw erreur;
      });
    return this._chargement;
  }
}
