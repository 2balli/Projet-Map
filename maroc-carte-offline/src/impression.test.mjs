import assert from 'node:assert/strict';
import test from 'node:test';
import { depuisLambert, formaterLambert, versLambert, zoneDe } from './lambert.js';
import { depuisGeoJson, depuisKml, lireFichier, versKml } from './croquis.js';
import {
  croisement, degresCourts, dispositionPage, echelleDe, formaterEchelle, longueurRonde, mppDeZoom, mppPourEchelle,
  pasDegres, pasMetres, quadrillage, zoomPourMpp,
} from './impression.js';

const proche = (reel, attendu, tol) => assert.ok(Math.abs(reel - attendu) <= tol, `${reel} ≉ ${attendu}`);

// ── Lambert Maroc ──────────────────────────────────────────────────────────

test('Lambert : valeurs de référence (proj4, EPSG 26191 à 26195)', () => {
  const references = [
    [[-6.8416, 34.0209], 'nord', 366745, 381142], // Rabat
    [[-1.9086, 34.6814], 'nord', 819722, 458828], // Oujda
    [[-7.9811, 31.6295], 'nord', 254992, 118111], // Marrakech, juste au nord de 31,5°
    [[-9.5981, 30.4278], 'sud', 96749, 388237], // Agadir
    [[-13.2033, 27.1536], 'sahara-nord', 427011, 540100], // Laâyoune
    [[-15.957, 23.6848], 'sahara-sud', 424120, 569322], // Dakhla
  ];
  for (const [point, zone, x, y] of references) {
    const l = versLambert(point);
    assert.equal(l.zone.id, zone);
    proche(l.x, x, 1);
    proche(l.y, y, 1);
  }
});

test('Lambert : aller-retour au centimètre, zone imposée hors de sa bande', () => {
  for (const p of [[-5.8, 35.7], [-8.5, 30.1], [-14.1, 25.2], [-16.5, 21.4]]) {
    const l = versLambert(p);
    const [lon, lat] = depuisLambert([l.x, l.y], l.zone);
    proche(lon, p[0], 1e-6);
    proche(lat, p[1], 1e-6);
  }
  const imposee = versLambert([-7.6, 31.2], zoneDe(31.7)); // au sud de la zone Nord, prolongée
  const [lon, lat] = depuisLambert([imposee.x, imposee.y], imposee.zone);
  proche(lon, -7.6, 1e-6);
  proche(lat, 31.2, 1e-6);
});

test('Lambert : affichage', () => {
  const texte = formaterLambert(versLambert([-6.8416, 34.0209]));
  assert.match(texte, /^X 366 745 · Y 381 142 \(Lambert Nord Maroc\)$/);
  assert.match(formaterLambert(versLambert([-6.8416, 34.0209]), { langue: 'ar' }), /لامبير شمال المغرب/);
});

// ── Croquis : import / export ──────────────────────────────────────────────

const exemple = () => depuisGeoJson({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { genre: 'point', symbole: 'barrage', couleur: 'bleu', libelle: 'Barrage <N8> & “nord”' }, geometry: { type: 'Point', coordinates: [-7.6, 33.5] } },
    { type: 'Feature', properties: { libelle: 'Itinéraire' }, geometry: { type: 'LineString', coordinates: [[-7.6, 33.5], [-7.5, 33.6]] } },
    { type: 'Feature', properties: { couleur: 'vert' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    { type: 'Feature', properties: { genre: 'texte', libelle: 'PC avancé' }, geometry: { type: 'Point', coordinates: [-7.55, 33.55] } },
  ],
});

test('croquis : GeoJSON quelconque normalisé (attributs inconnus remplacés, Multi* éclatés)', () => {
  const e = exemple();
  assert.deepEqual(e.map((f) => f.properties.genre), ['point', 'ligne', 'zone', 'texte']);
  assert.equal(e[0].properties.symbole, 'barrage');
  assert.equal(e[1].properties.couleur, 'rouge'); // par défaut
  const multi = depuisGeoJson({ type: 'MultiPoint', coordinates: [[1, 2], [3, 4], ['x', 5]] });
  assert.equal(multi.length, 2);
  assert.equal(depuisGeoJson({ type: 'Feature', properties: { symbole: 'inconnu' }, geometry: { type: 'Point', coordinates: [1, 2] } })[0].properties.symbole, 'repere');
});

test('croquis : KML aller-retour (géométries, libellés échappés, symboles et couleurs)', () => {
  const e = exemple();
  const kml = versKml(e);
  assert.match(kml, /&lt;N8&gt; &amp;/);
  const relu = lireFichier(kml);
  assert.deepEqual(relu.map((f) => [f.properties.genre, f.properties.symbole, f.properties.couleur, f.properties.libelle]),
    e.map((f) => [f.properties.genre, f.properties.symbole, f.properties.couleur, f.properties.libelle]));
  assert.deepEqual(relu[1].geometry.coordinates, [[-7.6, 33.5], [-7.5, 33.6]]);
});

test('croquis : KML d’un autre logiciel (sans attributs, MultiGeometry, CDATA)', () => {
  const kml = `<?xml version="1.0"?><kml><Document>
    <Placemark><name><![CDATA[Point A]]></name><Point><coordinates>-7.1,33.2,0</coordinates></Point></Placemark>
    <Placemark><name>Secteur</name><MultiGeometry>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon>
      <LineString><coordinates>0,0 2,2</coordinates></LineString>
    </MultiGeometry></Placemark></Document></kml>`;
  const e = depuisKml(kml);
  assert.deepEqual(e.map((f) => [f.properties.genre, f.properties.libelle]).sort(), [['ligne', 'Secteur'], ['point', 'Point A'], ['zone', 'Secteur']]);
  assert.throws(() => lireFichier('pas du json'));
});

// ── Impression ─────────────────────────────────────────────────────────────

test('feuille : la carte et le côté remplissent la page sans la dépasser', () => {
  for (const format of ['A4', 'A3']) {
    for (const orientation of ['paysage', 'portrait']) {
      const d = dispositionPage(format, orientation);
      const utileL = d.page[0] - 2 * d.marge;
      const utileH = d.page[1] - 2 * d.marge - d.tete - d.pied - 2 * d.ecart;
      if (orientation === 'paysage') {
        proche(d.carte[0] + d.ecart + d.cote.taille, utileL, 1e-9);
        proche(d.carte[1], utileH, 1e-9);
      } else {
        proche(d.carte[0], utileL, 1e-9);
        proche(d.carte[1] + d.ecart + d.cote.taille, utileH, 1e-9);
      }
    }
  }
  assert.deepEqual(dispositionPage('A4', 'paysage').page, [297, 210]);
});

test('échelle : zoom ↔ mètres par pixel ↔ 1:n', () => {
  const lat = 33.5;
  const mpp = mppPourEchelle(50_000); // 50 000 × 0,2646 mm ≈ 13,2 m par pixel CSS
  proche(mpp, 13.229, 1e-3);
  proche(mppDeZoom(zoomPourMpp(mpp, lat), lat), mpp, 1e-9);
  proche(echelleDe(mpp), 50_000, 1e-6);
  assert.equal(formaterEchelle(50_000), '1:50 000');
  assert.equal(formaterEchelle(48_712), '1:48 700');
  assert.equal(longueurRonde(3700), 2000);
  assert.equal(longueurRonde(560), 500);
});

test('quadrillage : pas, libellés, lignes Lambert presque droites dans la projection de la carte', () => {
  assert.equal(pasMetres(28_000), 5000);
  assert.equal(pasDegres(0.4), 1 / 12);
  assert.equal(degresCourts(33.5, 'N', 'S'), '33°30′N');
  assert.equal(degresCourts(-7.0125, 'E', 'O'), '7°00′45″O');
  assert.deepEqual(croisement([[0, 0], [10, 10]], 1, 5), [5, 5]);
  // Carte de 800 × 600 px autour de Rabat, ≈ 13 m par pixel (projection simplifiée).
  const centre = [-6.84, 34.02];
  const k = 13 / 111_195;
  const kx = k / Math.cos((centre[1] * Math.PI) / 180);
  const projeter = ([lon, lat]) => [400 + (lon - centre[0]) / kx, 300 - (lat - centre[1]) / k];
  const deprojeter = ([x, y]) => [centre[0] + (x - 400) * kx, centre[1] - (y - 300) * k];
  const geo = quadrillage('geo', { projeter, deprojeter, largeur: 800, hauteur: 600 });
  assert.ok(geo.lignes.some((l) => l.bord === 'bas') && geo.lignes.some((l) => l.bord === 'gauche'));
  // Arrondis de la projection réelle : le bord bas retombe un poil à l'intérieur du cadre.
  const arrondi = (p) => { const [x, y] = projeter(p); return [x + 1e-7, y - 1e-7]; };
  const geoArrondi = quadrillage('geo', { projeter: arrondi, deprojeter, largeur: 800, hauteur: 600 });
  assert.equal(geoArrondi.lignes.length, geo.lignes.length);
  assert.ok(geoArrondi.lignes.length >= 6);
  const lambert = quadrillage('lambert', { projeter, deprojeter, largeur: 800, hauteur: 600 });
  assert.equal(lambert.zone.id, 'nord');
  const verticales = lambert.lignes.filter((l) => l.bord === 'bas');
  assert.ok(verticales.length >= 3);
  for (const l of verticales) {
    const xs = l.points.map((p) => p[0]);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 40, 'une ligne X = cte reste presque verticale (convergence < 1°)');
  }
});
