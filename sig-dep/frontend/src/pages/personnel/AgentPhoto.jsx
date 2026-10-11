import { useEffect, useState } from 'react';
import { UserCircle } from 'lucide-react';
import api from '../../lib/api';

/** Photo chargée via une requête authentifiée (jamais d’URL publique). */
export default function AgentPhoto({ agentId, hasPhoto, size = 96, version = 0 }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url;
    if (hasPhoto) {
      api.get(`/agents/${agentId}/photo`, { responseType: 'blob' }).then((r) => { url = URL.createObjectURL(r.data); setSrc(url); }).catch(() => setSrc(null));
    } else setSrc(null);
    return () => url && URL.revokeObjectURL(url);
  }, [agentId, hasPhoto, version]);
  return src
    ? <img src={src} alt="Portrait de l’Agent" className="rounded-md border object-cover" style={{ width: size, height: size }} />
    : <div className="flex items-center justify-center rounded-md border bg-slate-50 text-slate-300" style={{ width: size, height: size }}><UserCircle size={size * 0.7} /></div>;
}
