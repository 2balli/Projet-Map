import { Component } from 'react';

/**
 * GARDE D'ERREUR — une erreur de rendu ne doit jamais laisser une page blanche.
 *
 *   <GardeErreur nom="radar" silencieux>…</GardeErreur>
 *     un module d'appoint (radar, alerte) qui échoue disparaît seul ; la carte,
 *     les panneaux et le workflow continuent.
 *
 *   <GardeErreur nom="application">…</GardeErreur>
 *     dernier rempart : le message de l'erreur s'affiche (à transmettre au
 *     support) avec un bouton pour recharger, au lieu d'un écran vide.
 *
 * L'erreur est toujours écrite dans la console, avec la pile des composants.
 *
 * `cle` (facultatif) : quand elle change — nouvelles données —, la garde
 * réessaie le rendu. Sans elle, un module d'appoint tombé une fois restait
 * masqué jusqu'au rechargement de la page.
 */
export default class GardeErreur extends Component {
  constructor(props) {
    super(props);
    this.state = { erreur: null };
  }

  static getDerivedStateFromError(erreur) {
    return { erreur };
  }

  componentDidUpdate(avant) {
    if (this.state.erreur && avant.cle !== this.props.cle) this.setState({ erreur: null });
  }

  componentDidCatch(erreur, info) {
    console.error(`[GardeErreur:${this.props.nom ?? '?'}]`, erreur, info?.componentStack);
  }

  render() {
    const { erreur } = this.state;
    if (!erreur) return this.props.children;
    if (this.props.silencieux) return null;
    return (
      <div role="alert" className="grid min-h-dvh place-items-center bg-gr-navy p-6 text-text-primary">
        <div className="max-w-lg rounded-xl border border-border-default bg-gr-card p-5 shadow-panel">
          <p className="text-[15px] font-bold">Une erreur d’affichage est survenue.</p>
          <p className="mt-1 text-[12.5px] text-text-secondary">
            Aucune donnée n’a été modifiée. Rechargez la page ; si l’erreur revient, transmettez le message ci-dessous.
          </p>
          <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-gr-navy p-3 font-mono text-[11px] whitespace-pre-wrap text-text-secondary">
            {String(erreur?.stack || erreur?.message || erreur).slice(0, 1500)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="gr-bouton mt-3 rounded-lg bg-gr-primary px-3 py-1.5 text-[12px] font-bold text-gr-primary-contrast hover:bg-gr-primary-hover"
          >
            Recharger la page
          </button>
        </div>
      </div>
    );
  }
}
