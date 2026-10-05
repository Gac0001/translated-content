import { useEffect, useState } from 'react';
import api, { errorMessage } from '../lib/api';
import { Spinner, ErrorAlert } from './ui';

/** Aperçu d’un PDF obtenu par une requête authentifiée (affiché dans un cadre). */
export default function PdfApercu({ url, titre = 'Aperçu', hauteur = 520 }) {
  const [src, setSrc] = useState(null);
  const [erreur, setErreur] = useState(null);
  useEffect(() => {
    let lien = null;
    api.get(url, { responseType: 'blob' })
      .then((r) => { lien = URL.createObjectURL(r.data); setSrc(lien); })
      .catch((e) => setErreur(errorMessage(e)));
    return () => { if (lien) URL.revokeObjectURL(lien); };
  }, [url]);
  if (erreur) return <ErrorAlert message={erreur} />;
  if (!src) return <Spinner label="Préparation de l’aperçu…" />;
  return <iframe title={titre} src={src} className="w-full rounded border border-slate-200" style={{ height: hauteur }} />;
}
