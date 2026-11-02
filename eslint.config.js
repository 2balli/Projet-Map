/**
 * CONTRÔLE MINIMAL — une seule règle, et elle a sa raison d'être.
 *
 * `no-use-before-define` attrape la faute qui a produit quatre écrans blancs :
 * une constante lue avant sa déclaration dans le même corps de fonction. Le
 * cas typique est un tableau de dépendances de `useEffect` — évalué PENDANT le
 * rendu, pas au moment où l'effet s'exécute — qui cite une valeur déclarée
 * plus bas. Le build passe, le bundle se construit, et l'application meurt à
 * l'ouverture sur « Cannot access 'x' before initialization ».
 *
 * Rien d'autre n'est activé : ce fichier n'est pas un style à imposer, c'est
 * un filet sous une chute qui s'est déjà produite. `functions: false` parce
 * qu'une déclaration de fonction est hissée — l'appeler plus haut est légal et
 * courant dans ce dépôt.
 */
export default [
  {
    /* Des `eslint-disable` du dépôt citent `react-hooks/…`, dont le plugin
       n'est pas installé. Sans cette tolérance, ESLint 9 en fait une erreur et
       le contrôle échouerait pour une raison étrangère à ce qu'il surveille. */
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    files: ['src/**/*.{js,jsx}'],
    /**
     * `react-hooks/exhaustive-deps` DÉCLARÉE MAIS INERTE.
     *
     * Le dépôt porte des `eslint-disable-next-line react-hooks/exhaustive-deps`
     * — des décisions d'écriture délibérées, qu'on ne va pas effacer. Le plugin
     * n'étant pas installé, ESLint 9 refuse la directive et échoue. Cette règle
     * vide rend la directive valide sans rien contrôler.
     *
     * À REMPLACER par le vrai plugin le jour où l'on voudra ce contrôle : tel
     * quel, il ne vérifie RIEN, et il ne faut pas croire le contraire.
     */
    plugins: {
      'react-hooks': { rules: { 'exhaustive-deps': { create: () => ({}) } } },
    },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      /**
       * Ce que le navigateur fournit. Énuméré à la main plutôt qu'importé d'un
       * paquet `globals` : le dépôt n'a pas de dépendance superflue, et cette
       * liste dit exactement sur quoi le code s'appuie.
       */
      globals: Object.fromEntries(
        [
          'window', 'document', 'navigator', 'location', 'history', 'screen',
          'console', 'fetch', 'Headers', 'Request', 'Response', 'AbortController',
          'localStorage', 'sessionStorage', 'URL', 'URLSearchParams', 'Blob',
          'FileReader', 'File', 'FormData', 'Image', 'CustomEvent', 'Event',
          'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
          'requestAnimationFrame', 'cancelAnimationFrame',
          'ResizeObserver', 'IntersectionObserver', 'MutationObserver',
          'performance', 'structuredClone', 'queueMicrotask', 'alert', 'confirm',
          'getComputedStyle', 'matchMedia', 'DOMParser', 'XMLSerializer',
          'HTMLElement', 'SVGElement', 'Node', 'process',
        ].map((n) => [n, 'readonly'])
      ),
    },
    rules: {
      /**
       * `variables: false` ne veut PAS dire « ne vérifie pas les variables » :
       * cela restreint le contrôle à la portée courante. Une constante de
       * module citée dans une fonction définie plus haut est légale — la
       * fonction s'exécute bien après l'évaluation du module — et la signaler
       * noierait la vraie faute sous huit fausses. Ce qui reste signalé est
       * exactement le cas mortel : lire, dans le corps où elle est déclarée,
       * une constante qui ne l'est pas encore.
       */
      /**
       * UN IDENTIFIANT NON DÉFINI EST UN ÉCRAN BLANC.
       *
       * `IconClose` puis `useEffect` ont été employés sans être importés : le
       * build passait, le bundle se construisait, et l'application mourait à
       * l'ouverture. Le contrôle des icônes ne voyait que les `IconXxx` ;
       * celui-ci voit tout.
       */
      'no-undef': 'error',

      'no-use-before-define': [
        'error',
        { functions: false, classes: false, variables: false, allowNamedExports: true },
      ],
    },
  },
];
