/**
 * Carte de risque — où le danger se concentre.
 *
 * DEUX SIGNAUX, normalisés séparément :
 *
 *   ACCIDENTS — points noirs et barrages portant un relevé d'accidents. C'est
 *   le risque constaté, celui qui se compte en victimes.
 *
 *   POPULATION — chaque circonscription de brigade porte sa population (voir
 *   `circo_bt.geojson`). Là où il y a du monde, il y a du trafic, donc de
 *   l'exposition. C'est ce qui fait ressortir les grandes agglomérations :
 *   Casablanca, Tanger, Fès, Marrakech.
 *
 * CE QUI A ÉTÉ CORRIGÉ
 * --------------------
 * La version précédente comptait CHAQUE barrage comme un point de risque, à
 * poids fixe 2. Avec un parc de plus de mille barrages pour 38 points noirs,
 * 97 % des points rendaient une intensité de 0,07 — invisible — tout en
 * écrasant l'échelle. Et le principe était inversé : un barrage signale une
 * zone COUVERTE, pas un danger. Un barrage ne pèse donc plus que par les
 * accidents qu'il a relevés, jamais par sa seule présence.
 *
 * Les deux familles sont normalisées chacune de son côté, puis additionnées :
 * sans cela, la population (des centaines de milliers) écraserait le nombre
 * d'accidents (quelques dizaines).
 *
 * Aucune dépendance ajoutée (pas de `leaflet.heat`) : même principe qu'un tel
 * plugin, réécrit ici avec l'API Leaflet déjà utilisée directement ailleurs
 * dans ce fichier (`import L from 'leaflet'`) — un canevas hors-écran
 * accumule des gradients radiaux en mode `lighter` (les intensités
 * s'additionnent aux recoupements), puis une table de correspondance (LUT)
 * convertit l'intensité cumulée en couleur (vert → jaune → orange → rouge).
 *
 * Alignement carte : le canevas est positionné en repère LAYER (pas
 * container) via `L.DomUtil.setPosition`, à l'intérieur d'un pane dédié —
 * comme les tuiles, il suit alors le déplacement de la carte gratuitement
 * (transform CSS déjà appliqué par Leaflet à `.leaflet-map-pane`) et n'a
 * besoin d'être redessiné qu'à `moveend`/`zoomend`/`resize`, pas à chaque
 * frame d'un glisser.
 *
 * Les rayons sont GÉOGRAPHIQUES, pas en pixels : une zone de risque couvre un
 * nombre de kilomètres, pas un nombre de points d'écran. Elle grandit donc à
 * l'écran quand on zoome, comme n'importe quel objet posé sur la carte. Les
 * bornes en pixels servent uniquement à garder la couche lisible aux zooms
 * extrêmes (invisible à l'échelle du pays, envahissante à l'échelle du
 * quartier).
 *
 * Limite assumée : aucune source de densité de circulation n'existe dans ce
 * projet. La population sert d'approximation de l'exposition — elle en est
 * proche sans s'y confondre : un axe de transit très fréquenté traversant une
 * zone peu peuplée reste sous-évalué.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { scoreImportance } from './marquages.js';
import * as MQ from './marquages.js';


/* Rayon d'influence d'un accident constaté, en kilomètres. Un point noir pèse
   sur son tronçon, pas sur la province. */
const RAYON_ACCIDENT_KM = 7;

/* Opacité maximale de chaque famille au centre de son gradient. Les deux
   couches s'additionnent à la fin : une ville qui cumule des accidents monte
   au rouge, ce qui est le résultat recherché.
 *
 * Le pic des accidents reste bas volontairement : ils s'accumulent entre eux,
 * et une valeur élevée ferait saturer un point ISOLÉ — la carte se réduirait
 * à des taches pleines sans dégradé. La saturation doit se mériter par le
 * recoupement, puisque c'est le recoupement qui signale la concentration.
 * La population, elle, ne s'accumule pas (voir plus bas) : son pic peut donc
 * monter sans risque de saturation parasite. */
const PIC_ACCIDENT = 0.42;
const PIC_POPULATION = 0.8;

/* Plancher d'opacité des accidents : un accident isolé doit rester visible,
   si léger soit son bilan. La population n'a PAS de plancher — sans quoi les
   quatre cents circonscriptions rurales couvriraient le pays d'un voile vert
   permanent. */
const PLANCHER_ACCIDENT = 0.15;

/* Bornes de lisibilité, en pixels.
 *
 * Le plancher n'est PAS un détail de confort. À l'échelle du pays — la vue par
 * défaut — un kilomètre vaut un demi-pixel : une circonscription urbaine de
 * 6 km de rayon tomberait à 3 px. La couche se réduirait à cinq cents points
 * isolés au lieu d'une surface, et ne montrerait plus rien. Sous ce plancher,
 * c'est l'INTENSITÉ qui continue de distinguer les zones — une brigade d'un
 * million d'habitants et une de vingt mille ont alors le même rayon, mais pas
 * du tout la même chaleur. */
const RAYON_PX_MIN = 22;
const RAYON_PX_MAX = 150;

/*
 * Échelle de couleurs. Le premier palier est un SEUIL MORT : en dessous de
 * 10 % d'intensité cumulée, rien ne s'affiche.
 *
 * Sans lui, les quelques centaines de pôles ruraux et de points noirs isolés
 * — chacun très faible, mais dessiné sur un fond sombre où le moindre voile
 * se voit — recouvraient le pays entier d'une brume verte, jusqu'au Sahara.
 * Les villes ressortaient malgré tout, mais noyées : la carte disait « il y a
 * du risque partout », ce qui revient à ne rien dire. Le seuil rend le bas de
 * l'échelle réellement vide, et l'œil va droit aux concentrations.
 */
const ETAPES_LUT = [
  { p: 0, r: 0, g: 0, b: 0, a: 0 },
  { p: 0.1, r: 46, g: 160, b: 67, a: 0 }, // seuil : en dessous, transparent
  { p: 0.22, r: 46, g: 160, b: 67, a: 70 }, // vert
  { p: 0.45, r: 210, g: 190, b: 40, a: 135 }, // jaune
  { p: 0.7, r: 230, g: 130, b: 30, a: 180 }, // orange
  { p: 1, r: 214, g: 40, b: 40, a: 220 }, // rouge
];

/** Table intensité (0-255) -> [r,g,b,a] — construite une seule fois. */
function construireLUT() {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a0 = ETAPES_LUT[0];
    let a1 = ETAPES_LUT[ETAPES_LUT.length - 1];
    for (let k = 0; k < ETAPES_LUT.length - 1; k++) {
      if (t >= ETAPES_LUT[k].p && t <= ETAPES_LUT[k + 1].p) {
        a0 = ETAPES_LUT[k];
        a1 = ETAPES_LUT[k + 1];
        break;
      }
    }
    const f = (t - a0.p) / (a1.p - a0.p || 1);
    lut[i * 4 + 0] = a0.r + (a1.r - a0.r) * f;
    lut[i * 4 + 1] = a0.g + (a1.g - a0.g) * f;
    lut[i * 4 + 2] = a0.b + (a1.b - a0.b) * f;
    lut[i * 4 + 3] = a0.a + (a1.a - a0.a) * f;
  }
  return lut;
}

export default function HeatmapLayer({ items }) {
  const map = useMap();
  const canvasRef = useRef(null);
  const lut = useMemo(construireLUT, []);
  const [poles, setPoles] = useState([]);

  /* Pôles de population — fichier réduit produit par
     `scripts/build-poles-population.mjs` (46 Ko, contre 1,6 Mo pour la couche
     de contours dont il est tiré). Chargé une seule fois, à l'affichage. */
  useEffect(() => {
    let vivant = true;
    fetch('layers/poles-population.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivant && Array.isArray(d?.poles)) setPoles(d.poles);
      })
      .catch(() => {
        /* Fichier absent : la carte se limite aux accidents, sans casser. */
      });
    return () => {
      vivant = false;
    };
  }, []);

  /**
   * Accidents constatés. Un barrage n'entre ici QUE s'il a relevé des
   * accidents : sa présence seule signale une zone couverte, pas dangereuse.
   */
  const pointsAccident = useMemo(() => {
    const pts = [];
    for (const m of items) {
      if (m.type === 'accident') {
        pts.push({ lat: m.lat, lng: m.lng, poids: Math.max(1, scoreImportance(m)) });
      } else if (MQ.estBarrage(m)) {
        const n = Number(m.accidentCount) || 0;
        if (n > 0) pts.push({ lat: m.lat, lng: m.lng, poids: n });
      }
    }
    const max = pts.reduce((mx, p) => Math.max(mx, p.poids), 1);
    /* Racine carrée : sans elle, un seul point noir très chargé écrase tous les
       autres et la carte ne montre plus qu'un point. */
    return pts.map((p) => ({ ...p, intensite: Math.sqrt(p.poids / max), rayonKm: RAYON_ACCIDENT_KM }));
  }, [items]);

  /**
   * Pôles de population, pesés par la DENSITÉ et non par la population brute.
   *
   * La distinction n'est pas cosmétique. Une brigade rurale peut compter
   * quinze mille habitants sur cinquante mille kilomètres carrés ; une brigade
   * d'Ain Sebâa en compte un million sept cent mille sur quatre-vingt-seize.
   * À population brute, la première pèse encore un dixième de la seconde et
   * — comme ces circonscriptions rurales sont nombreuses et se recouvrent à
   * l'échelle du pays — l'ensemble finissait par saturer la carte en rase
   * campagne. À la densité, l'écart est de mille pour un : les agglomérations
   * ressortent seules, le Sahara reste froid.
   */
  const pointsPopulation = useMemo(() => {
    if (!poles.length) return [];
    const maxPop = poles.reduce((mx, p) => Math.max(mx, p.pop || 0), 1);
    const maxDensite = poles.reduce((mx, p) => Math.max(mx, p.densite || 0), 1);
    return poles.map((p) => {
      const rPop = Math.max(0, p.pop || 0) / maxPop;
      const rDensite = Math.max(0, p.densite || 0) / maxDensite;
      return {
        lat: p.lat,
        lng: p.lng,
        /* Moyenne géométrique des deux rapports. Il faut être peuplé ET dense
           pour peser : un vaste territoire faiblement peuplé est écarté par la
           densité, un quartier minuscule par la population. La puissance 1/4
           (racine du produit de deux rapports) comprime un écart de 1 à 60 000
           en un écart de 1 à 50 — assez pour hiérarchiser sans faire
           disparaître tout ce qui n'est pas Ain Sebâa. */
        intensite: (rPop * rDensite) ** 0.25,
        rayonKm: p.rayonKm,
      };
    });
  }, [poles]);

  /** Pane + canevas, créés une fois. */
  useEffect(() => {
    let pane = map.getPane('gr-heatmap');
    if (!pane) {
      pane = map.createPane('gr-heatmap');
      pane.style.zIndex = 350; // au-dessus des tuiles (200), en dessous des vecteurs/marqueurs (400+)
      pane.style.pointerEvents = 'none';
    }
    const canvas = L.DomUtil.create('canvas', '', pane);
    canvasRef.current = canvas;
    return () => {
      pane.removeChild(canvas);
      canvasRef.current = null;
    };
  }, [map]);

  /** Redessine sur changement de données, de vue ou de taille — voir le commentaire d'en-tête. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const redessiner = () => {
      const taille = map.getSize();
      canvas.width = taille.x;
      canvas.height = taille.y;
      canvas.style.width = `${taille.x}px`;
      canvas.style.height = `${taille.y}px`;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!pointsAccident.length && !pointsPopulation.length) return;

      /* Échelle du moment : combien de pixels vaut un kilomètre au centre de la
         vue. C'est ce qui rend les rayons géographiques plutôt que fixes. On
         mesure l'écart à l'écran entre le centre et un point situé un
         kilomètre à l'est. */
      const centre = map.getCenter();
      const kmEnDegresLng = 1 / (111.32 * Math.cos((centre.lat * Math.PI) / 180));
      const pxParKm = Math.max(
        0.001,
        Math.abs(
          map.latLngToContainerPoint([centre.lat, centre.lng + kmEnDegresLng]).x -
            map.latLngToContainerPoint([centre.lat, centre.lng]).x
        )
      );

      /*
       * Passe 1 — deux accumulations SÉPARÉES, car les deux grandeurs ne se
       * composent pas de la même façon.
       *
       * ACCIDENTS : 'lighter', qui additionne. Deux points noirs voisins font
       * bien deux fois plus d'accidents ; leur recoupement doit chauffer.
       *
       * POPULATION : 'lighten', qui prend le MAXIMUM. C'est le correctif
       * essentiel. En additionnant, la carte mesurait non pas la taille d'une
       * ville mais la FINESSE DE SON DÉCOUPAGE administratif : Rabat, Salé et
       * Témara, trois circonscriptions voisines, saturaient au rouge plein,
       * tandis que Tanger et ses 1,4 million d'habitants — une seule
       * circonscription — restait à un quart de l'échelle. La densité d'un
       * lieu est une propriété de ce lieu, pas une somme de ses voisins : on
       * en retient donc la valeur locale la plus forte, et le résultat ne
       * dépend plus de la façon dont le territoire a été divisé.
       */
      const marge = RAYON_PX_MAX;
      const accumuler = (liste, pic, plancher, composition, dilue) => {
        const c = document.createElement('canvas');
        c.width = canvas.width;
        c.height = canvas.height;
        const cx = c.getContext('2d');
        cx.globalCompositeOperation = composition;

        for (const p of liste) {
          const rayonVrai = p.rayonKm * pxParKm;
          const rayon = Math.min(RAYON_PX_MAX, Math.max(RAYON_PX_MIN, rayonVrai));
          const pt = map.latLngToContainerPoint([p.lat, p.lng]);
          if (
            pt.x < -marge ||
            pt.y < -marge ||
            pt.x > canvas.width + marge ||
            pt.y > canvas.height + marge
          )
            continue;

          /*
           * DILUTION À L'ÉTALEMENT — n'est appliquée qu'aux accidents.
           *
           * Un nombre d'accidents est une quantité qui se COMPTE : l'étaler
           * sur une tache plus large que sa portée réelle revient à prétendre
           * qu'il concerne plus de terrain qu'il n'en concerne. À l'échelle du
           * pays, un point noir de 7 km dessiné au plancher de 22 px
           * revendiquerait 46 km d'influence — assez pour que des points noirs
           * ruraux isolés paraissent aussi chauds qu'une ville. On abaisse
           * donc son opacité dans la même proportion qu'il a été étalé.
           *
           * La densité de population, elle, ne se dilue pas : c'est une
           * quantité PAR UNITÉ DE SURFACE. Dix mille habitants au kilomètre
           * carré restent dix mille habitants au kilomètre carré, que la tache
           * qui les représente fasse trois pixels ou vingt-deux. L'y appliquer
           * affaiblirait les villes — dont les circonscriptions sont petites —
           * au profit des circonscriptions rurales, assez vastes pour n'être
           * jamais étalées. Exactement l'inverse du but recherché.
           */
          const dilution = dilue && rayon > rayonVrai ? Math.sqrt(rayonVrai / rayon) : 1;
          const alpha = (plancher + p.intensite * (1 - plancher)) * pic * dilution;

          /* Décroissance en cloche plutôt que linéaire. Une rampe droite
             laisse un bord net : à l'échelle du pays, où des centaines de
             noyaux se juxtaposent, la carte prenait l'aspect d'un semis de
             disques cerclés au lieu d'une surface continue. Ces paliers
             approchent une gaussienne — le bord s'éteint en douceur et les
             noyaux voisins se fondent. */
          const grad = cx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, rayon);
          grad.addColorStop(0, `rgba(0,0,0,${alpha})`);
          grad.addColorStop(0.3, `rgba(0,0,0,${alpha * 0.78})`);
          grad.addColorStop(0.6, `rgba(0,0,0,${alpha * 0.38})`);
          grad.addColorStop(0.85, `rgba(0,0,0,${alpha * 0.09})`);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          cx.fillStyle = grad;
          cx.beginPath();
          cx.arc(pt.x, pt.y, rayon, 0, Math.PI * 2);
          cx.fill();
        }
        return cx.getImageData(0, 0, c.width, c.height).data;
      };

      const aPop = accumuler(pointsPopulation, PIC_POPULATION, 0, 'lighten', false);
      const aAcc = accumuler(pointsAccident, PIC_ACCIDENT, PLANCHER_ACCIDENT, 'lighter', true);

      /* Passe 2 : les deux champs s'additionnent (une ville dangereuse est
         pire qu'une ville seule), puis la LUT convertit en couleur. */
      const sortie = ctx.createImageData(canvas.width, canvas.height);
      for (let i = 3; i < aPop.length; i += 4) {
        const alpha = Math.min(255, aPop[i] + aAcc[i]);
        if (alpha === 0) continue;
        const idx = alpha * 4;
        sortie.data[i - 3] = lut[idx];
        sortie.data[i - 2] = lut[idx + 1];
        sortie.data[i - 1] = lut[idx + 2];
        sortie.data[i] = lut[idx + 3];
      }
      ctx.putImageData(sortie, 0, 0);
    };

    redessiner();
    map.on('moveend zoomend resize', redessiner);
    return () => map.off('moveend zoomend resize', redessiner);
  }, [map, pointsAccident, pointsPopulation, lut]);

  return null;
}
