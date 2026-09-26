import { useState } from 'react';
import { Upload } from 'lucide-react';
import api, { errorMessage } from '../../lib/api';
import { useApi, Loadable, PageHeader, toast } from '../../components/ui';
import AgentView from './AgentView';

export default function Profil() {
  const state = useApi('/agents/moi');
  const [v, setV] = useState(0);
  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData(); fd.append('photo', file);
    try { await api.post(`/agents/${state.data.id}/photo`, fd); toast.success('Photo mise à jour.'); setV((x) => x + 1); state.reload(); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <>
      <PageHeader title="Mon profil" subtitle="Votre affectation ne peut être modifiée que par l’autorité compétente." breadcrumb={[{ label: 'Mon profil' }]} />
      <Loadable state={state}>
        {(a) => <AgentView a={a} photoVersion={v} extraActions={<label className="btn-ghost mt-2 cursor-pointer text-xs"><Upload size={14} /> Changer la photo<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files[0])} /></label>} />}
      </Loadable>
    </>
  );
}
