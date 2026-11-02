/**
 * Tracés SVG partagés entre le panneau latéral (React, `icons.jsx`) et les
 * marqueurs de la carte (HTML injecté dans Leaflet, `markerIcons.js`).
 *
 * Source unique : un glyphe modifié ici change au même endroit dans la légende
 * et sur la carte, sans risque de divergence.
 *
 * Convention : boîte 24x24, trait 1.75, coins arrondis.
 */
export const GLYPHS = {
  /** Région — étoile dans un écu. */
  region: [
    'M12 3 4.5 6v6c0 4.2 3 7.6 7.5 9 4.5-1.4 7.5-4.8 7.5-9V6L12 3Z',
    'm12 8.5 1.3 2.7 2.9.4-2.1 2.1.5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2.1 2.9-.4L12 8.5Z',
  ],

  /** Compagnie — bâtiment à étages. */
  compagnie: [
    'M4 20V7.5L12 4l8 3.5V20',
    'M3 20h18',
    'M9.5 20v-4.5h5V20',
    'M8.5 10h1.5M14 10h1.5M8.5 13h1.5M14 13h1.5',
  ],

  /** Brigade territoriale — écu avec coche. */
  brigade: [
    'M12 3 4.5 6v6c0 4.2 3 7.6 7.5 9 4.5-1.4 7.5-4.8 7.5-9V6L12 3Z',
    'm8.8 12.2 2.2 2.2 4.2-4.4',
  ],

  /** Pointage / contrôle routier — cône de chantier. */
  pointage: ['M12 3.5 18.5 19h-13L12 3.5Z', 'M9.6 11h4.8M8.2 15h7.6', 'M4 19h16'],

  /* ---------------- Marquages du chef de compagnie ---------------- */

  /** Congestion — file de véhicules entre deux bords de chaussée. */
  zahma: [
    'M4 3.5v17M20 3.5v17',
    'M8.5 5.6h7v3.1h-7z',
    'M8.5 10.4h7v3.1h-7z',
    'M8.5 15.2h7v3.1h-7z',
  ],

  /** Point noir accidents — étoile de choc. */
  accident: [
    'm12 3.6 1.7 4.1 4-1.5-1.5 4 4.2 1.8-4.2 1.8 1.5 4-4-1.5-1.7 4.1-1.7-4.1-4 1.5 1.5-4L3.6 11.8l4.2-1.8-1.5-4 4 1.5L12 3.6Z',
    'M12 9.6v2.6M12 14.4h.01',
  ],

  /** Barrage fixe — barrière abaissée sur son fût. */
  barrage_fixe: [
    'M5 20.5V4.5',
    'M6.4 7.2h13.4v3.4H6.4z',
    'M11 7.2v3.4M15.4 7.2v3.4',
    'M3.4 20.5h6',
  ],

  /* ---------------- Réseau routier ---------------- */

  /** Autoroute — chaussées séparées par un terre-plein. */
  autoroute: [
    'M6.5 3.5 4 20.5M17.5 3.5 20 20.5',
    'M12 4v3M12 10.5v3M12 17v3',
  ],

  /** Route — tracé sinueux. */
  route: [
    'M8 20.5c0-4 2.5-5 2.5-8.5S7.5 8 7.5 4.5',
    'M16.5 20.5c0-5 -3-6.5 -3-10.5S16 5 16 3.5',
  ],

  /** Distance — jalon d'un point à un autre. */
  distance: [
    'M5.5 17.5 18.5 6.5',
    'M4 19a1.9 1.9 0 1 0 2.7-2.7A1.9 1.9 0 0 0 4 19Z',
    'M17.3 5.7A1.9 1.9 0 1 0 20 8.4a1.9 1.9 0 0 0-2.7-2.7Z',
    'M9.5 9.5l1.7 1.7M12.8 12.8l1.7 1.7',
  ],

  /** Barrage mobile — barrière relevable + flèche de déplacement. */
  barrage_mobile: [
    'M5.5 20.5V6.5',
    'm7 9.2 11.6-3.1.9 3.3L7.9 12.5z',
    'M3.5 20.5h5',
    'm14.5 16.5 3.4 2.4-3.4 2.4',
    'M9.5 18.9h8',
  ],

  /** Barrage fixe intouchable — forteresse et symbole d'inviolabilité. */
  barrage_intouchable: [
    'M4 7.5V4h3.5v2.5h2.5V4h4v2.5h2.5V4H20v3.5',
    'M3 7.5h18',
    'M5.5 7.5v13.5M18.5 7.5v13.5M3.5 21h17',
    'M9.5 21v-4a2.5 2.5 0 0 1 5 0v4',
    'M12 10.5v3M10.5 11.7h3',
  ],

  /**
   * Barrage VIP — barrière abaissée, surmontée d'un écusson.
   *
   * La barrière reprend trait pour trait celle du barrage fixe : c'est le même
   * objet sur le terrain, et l'œil doit le reconnaître comme tel. L'écusson
   * est ce qui s'ajoute — la protection d'un passage officiel — et non un
   * second symbole qui ferait lire « autre chose qu'un barrage ».
   */
  barrage_vip: [
    'M5 20.5V9.5',
    'M6.4 12h13.2v3.2H6.4z',
    'M11 12v3.2M15.4 12v3.2',
    'M3.4 20.5h6',
    'm12.6 2.6 4.2 1.5v3c0 2.2-1.7 3.8-4.2 4.6-2.5-.8-4.2-2.4-4.2-4.6v-3z',
  ],

  /** Mission (VIP / interception) — cible. */
  mission: [
    'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z',
    'M12 2.7v2.6M12 18.7v2.6M2.7 12h2.6M18.7 12h2.6',
    'M12 11.3a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4Z',
  ],

  /* ---------------- Points stratégiques (sous-types de zahma) ---------------- */

  /** Entrée de ville — portique routier (panneau sur deux mâts). */
  entree_ville: [
    'M5 20.5V8.8M19 20.5V8.8',
    'M3.5 8.8h17v3.2h-17z',
    'M8 20.5h8',
  ],

  /** Péage — guérite et barrière relevée. */
  peage: [
    'M5 20.5v-6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 11 14.5v6',
    'm11.3 12.6 8.8-2.4.8 3-8.8 2.4z',
    'M3.5 20.5h17',
  ],

  /* ---------------- Infrastructures de transport (données réelles) ---------------- */

  /** Gare ferroviaire — cabine de train de face. */
  gare: [
    'M6 20V10a6 6 0 0 1 12 0v10',
    'M4 20h16',
    'M9 20v-2M15 20v-2',
    'M9 10h6',
  ],

  /** Aéroport — avion vu de dessus. */
  aeroport: [
    'M12 3v14',
    'M4 10.5 12 8l8 2.5',
    'M9 17 12 15.5 15 17',
    'M12 17v3',
  ],

  /** Port — ancre marine. */
  port: [
    'M10.3,5.3 A1.7,1.7 0 1,0 13.7,5.3 A1.7,1.7 0 1,0 10.3,5.3',
    'M12 7v11',
    'M7 13h10',
    'M8 19c0 1.7 1.8 3 4 3M16 19c0 1.7-1.8 3-4 3',
  ],
};
