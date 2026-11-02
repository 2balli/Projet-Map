/**
 * Lecteur minimal du format OpenStreetMap PBF (.osm.pbf), sans dépendance.
 *
 * Seul `node:zlib` est utilisé : le paquet livré n'embarque aucun binaire
 * natif, et `npm install` est impossible hors ligne (voir RECONSTRUIRE.txt).
 * Le format est décrit sur https://wiki.openstreetmap.org/wiki/PBF_Format —
 * on n'en décode que ce que l'import du réseau routier utilise : en-tête,
 * nœuds (denses et simples) et chemins. Les relations sont ignorées.
 *
 *   for (const bloc of blocsPbf(fichier)) {
 *     if (bloc.type === 'OSMHeader') lireEntete(bloc.donnees)
 *     else lireBloc(bloc.donnees, { chemin(way) {…}, noeuds(ids, lng, lat, n) {…} })
 *   }
 */
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/* ------------------------------------------------------------------ */
/*  Protobuf : lecture des champs                                     */
/* ------------------------------------------------------------------ */

const DEUX32 = 4294967296;

/** Lecteur séquentiel d'un message protobuf, sur un Buffer. */
class Lecteur {
  constructor(buf, debut = 0, fin = buf.length) {
    this.buf = buf;
    this.pos = debut;
    this.fin = fin;
  }

  /** Varint non signé — exact jusqu'à 2^53, au-delà des identifiants OSM. */
  varint() {
    const b = this.buf;
    let bas = 0;
    let decal = 0;
    let octet;
    do {
      octet = b[this.pos++];
      if (decal < 28) bas |= (octet & 0x7f) << decal;
      else if (decal === 28) {
        bas = (bas >>> 0) + (octet & 0x0f) * 268435456;
        let haut = (octet & 0x70) >> 4;
        let d = 3;
        while (octet & 0x80) {
          octet = b[this.pos++];
          haut |= (octet & 0x7f) << d;
          d += 7;
        }
        return bas + haut * DEUX32;
      }
      decal += 7;
    } while (octet & 0x80);
    return bas >>> 0;
  }

  /** Varint zigzag (sint32/sint64). */
  svarint() {
    const v = this.varint();
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }

  /** Clé de champ : [numéro, type]. */
  cle() {
    const k = this.varint();
    return [Math.floor(k / 8), k & 7];
  }

  /** Sous-message ou chaîne : renvoie [debut, fin]. */
  longueur() {
    const n = this.varint();
    const d = this.pos;
    this.pos += n;
    return [d, d + n];
  }

  sauter(type) {
    if (type === 0) this.varint();
    else if (type === 1) this.pos += 8;
    else if (type === 2) {
      // Longueur lue AVANT l'addition : `this.pos += this.varint()` lirait
      // `pos` d'abord et oublierait les octets du préfixe de longueur.
      const n = this.varint();
      this.pos += n;
    }
    else if (type === 5) this.pos += 4;
    else throw new Error(`type de champ protobuf inconnu : ${type}`);
  }

  get fini() {
    return this.pos >= this.fin;
  }
}

/** Varints non signés emballés (packed) d'un intervalle. */
function emballes(buf, [d, f], signe = false) {
  const l = new Lecteur(buf, d, f);
  const out = [];
  while (!l.fini) out.push(signe ? l.svarint() : l.varint());
  return out;
}

/* ------------------------------------------------------------------ */
/*  Fichier : suite de blocs [longueur][BlobHeader][Blob]             */
/* ------------------------------------------------------------------ */

/**
 * Parcourt les blocs du fichier, décompressés.
 * @returns {Generator<{type: string, donnees: Buffer}>}
 */
export function* blocsPbf(chemin) {
  const fd = openSync(chemin, 'r');
  const taille = fstatSync(fd).size;
  let pos = 0;
  const lire = (n) => {
    const b = Buffer.allocUnsafe(n);
    let lu = 0;
    while (lu < n) {
      const k = readSync(fd, b, lu, n - lu, pos + lu);
      if (k === 0) throw new Error('fichier PBF tronqué');
      lu += k;
    }
    pos += n;
    return b;
  };

  try {
    while (pos < taille) {
      const nEntete = lire(4).readUInt32BE(0);
      const entete = lire(nEntete);
      let type = '';
      let nDonnees = 0;
      for (const l = new Lecteur(entete); !l.fini; ) {
        const [champ, t] = l.cle();
        if (champ === 1) {
          const [d, f] = l.longueur();
          type = entete.toString('utf8', d, f);
        } else if (champ === 3) nDonnees = l.varint();
        else l.sauter(t);
      }

      const blob = lire(nDonnees);
      let donnees = null;
      for (const l = new Lecteur(blob); !l.fini; ) {
        const [champ, t] = l.cle();
        if (champ === 1) donnees = blob.subarray(...l.longueur());
        else if (champ === 3) donnees = inflateSync(blob.subarray(...l.longueur()));
        else if (champ === 4 || champ === 6 || champ === 7) {
          throw new Error('compression PBF non prise en charge (seuls brut et zlib le sont)');
        } else l.sauter(t);
      }
      yield { type, donnees };
    }
  } finally {
    closeSync(fd);
  }
}

/* ------------------------------------------------------------------ */
/*  En-tête                                                           */
/* ------------------------------------------------------------------ */

/** Ce que l'en-tête dit de la source : emprise, date de réplication, outils. */
export function lireEntete(buf) {
  const out = { fonctions: [], emprise: null, horodatage: null, programme: null };
  for (const l = new Lecteur(buf); !l.fini; ) {
    const [champ, t] = l.cle();
    if (champ === 1) {
      const e = {};
      for (const m = new Lecteur(buf, ...l.longueur()); !m.fini; ) {
        const [c] = m.cle();
        e[{ 1: 'ouest', 2: 'est', 3: 'nord', 4: 'sud' }[c]] = m.svarint() / 1e9;
      }
      out.emprise = e;
    } else if (champ === 4 || champ === 5) {
      const [d, f] = l.longueur();
      out.fonctions.push(buf.toString('utf8', d, f));
    } else if (champ === 16) {
      const [d, f] = l.longueur();
      out.programme = buf.toString('utf8', d, f);
    } else if (champ === 32) {
      out.horodatage = new Date(l.varint() * 1000).toISOString();
    } else l.sauter(t);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Bloc de primitives                                                */
/* ------------------------------------------------------------------ */

/**
 * Décode un PrimitiveBlock.
 *
 * @param {Buffer} buf
 * @param {object} rappels
 *   chemin(way)                    way = {id, refs:number[], tags:object}
 *   noeuds(ids, lng, lat, n)       tableaux de n nœuds (sans leurs tags)
 * Un rappel absent n'est pas décodé : la passe des chemins ne paie pas
 * le décodage des nœuds, et inversement.
 */
export function lireBloc(buf, { chemin, noeuds } = {}) {
  let chaines = null;
  let granularite = 100;
  let decalLat = 0;
  let decalLng = 0;
  const groupes = [];

  for (const l = new Lecteur(buf); !l.fini; ) {
    const [champ, t] = l.cle();
    if (champ === 1) {
      chaines = [];
      for (const m = new Lecteur(buf, ...l.longueur()); !m.fini; ) {
        const [c, tt] = m.cle();
        if (c === 1) {
          const [d, f] = m.longueur();
          chaines.push(buf.toString('utf8', d, f));
        } else m.sauter(tt);
      }
    } else if (champ === 2) groupes.push(l.longueur());
    else if (champ === 17) granularite = l.varint();
    else if (champ === 19) decalLat = l.varint();
    else if (champ === 20) decalLng = l.varint();
    else l.sauter(t);
  }

  const echelle = granularite / 1e9;

  for (const g of groupes) {
    for (const l = new Lecteur(buf, ...g); !l.fini; ) {
      const [champ, t] = l.cle();
      if (champ === 2 && noeuds) {
        lireDenses(buf, l.longueur(), echelle, decalLat, decalLng, noeuds);
      } else if (champ === 1 && noeuds) {
        lireNoeud(buf, l.longueur(), echelle, decalLat, decalLng, noeuds);
      } else if (champ === 3 && chemin) {
        chemin(lireChemin(buf, l.longueur(), chaines));
      } else l.sauter(t);
    }
  }
}

function lireDenses(buf, intervalle, echelle, decalLat, decalLng, rappel) {
  let ids = null;
  let lats = null;
  let lngs = null;
  for (const l = new Lecteur(buf, ...intervalle); !l.fini; ) {
    const [champ, t] = l.cle();
    if (champ === 1) ids = emballes(buf, l.longueur(), true);
    else if (champ === 8) lats = emballes(buf, l.longueur(), true);
    else if (champ === 9) lngs = emballes(buf, l.longueur(), true);
    else l.sauter(t);
  }
  if (!ids) return;
  const n = ids.length;
  const I = new Float64Array(n);
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  let id = 0;
  let la = 0;
  let lo = 0;
  for (let k = 0; k < n; k++) {
    id += ids[k];
    la += lats[k];
    lo += lngs[k];
    I[k] = id;
    Y[k] = (decalLat + la * (echelle * 1e9)) / 1e9;
    X[k] = (decalLng + lo * (echelle * 1e9)) / 1e9;
  }
  rappel(I, X, Y, n);
}

function lireNoeud(buf, intervalle, echelle, decalLat, decalLng, rappel) {
  let id = 0;
  let la = 0;
  let lo = 0;
  for (const l = new Lecteur(buf, ...intervalle); !l.fini; ) {
    const [champ, t] = l.cle();
    if (champ === 1) id = l.svarint();
    else if (champ === 8) la = l.svarint();
    else if (champ === 9) lo = l.svarint();
    else l.sauter(t);
  }
  rappel(
    Float64Array.of(id),
    Float64Array.of((decalLng + lo * (echelle * 1e9)) / 1e9),
    Float64Array.of((decalLat + la * (echelle * 1e9)) / 1e9),
    1
  );
}

function lireChemin(buf, intervalle, chaines) {
  let id = 0;
  let cles = [];
  let vals = [];
  let refs = [];
  for (const l = new Lecteur(buf, ...intervalle); !l.fini; ) {
    const [champ, t] = l.cle();
    if (champ === 1) id = l.varint();
    else if (champ === 2) cles = emballes(buf, l.longueur());
    else if (champ === 3) vals = emballes(buf, l.longueur());
    else if (champ === 8) refs = emballes(buf, l.longueur(), true);
    else l.sauter(t);
  }
  for (let k = 1; k < refs.length; k++) refs[k] += refs[k - 1];
  const tags = {};
  for (let k = 0; k < cles.length; k++) tags[chaines[cles[k]]] = chaines[vals[k]];
  return { id, refs, tags };
}
