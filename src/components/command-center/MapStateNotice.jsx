import { IconAlert, IconSpinner } from '../../icons.jsx';

export default function MapStateNotice({ service, total }) {
  if (service === null) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-white/12 bg-gr-deep/92 px-3 py-2 text-[10px] text-white/65 shadow-panel backdrop-blur">
        <IconSpinner size={13} className="text-gr-gold" /> Chargement des barrages...
      </p>
    );
  }

  if (service?.indisponible) {
    return (
      <p className="flex max-w-[360px] items-start gap-2 rounded-xl border border-gr-red/30 bg-gr-deep/94 px-3 py-2 text-[10px] leading-relaxed text-white/65 shadow-panel backdrop-blur">
        <IconAlert size={13} className="mt-0.5 shrink-0 text-gr-red" />
        <span><b className="text-white/85">Données opérationnelles indisponibles.</b> Vérifiez la connexion au service d’habilitation.</span>
      </p>
    );
  }

  if (total === 0) {
    return <p className="rounded-xl border border-white/12 bg-gr-deep/92 px-3 py-2 text-[10px] text-white/60 shadow-panel backdrop-blur">0 barrage dans cette zone</p>;
  }

  return null;
}
