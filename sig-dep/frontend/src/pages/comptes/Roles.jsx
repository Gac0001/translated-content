import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, Badge, InfoAlert, runCritique } from '../../components/ui';

export default function Roles() {
  const state = useApi('/users/roles');
  const [matrix, setMatrix] = useState({});
  useEffect(() => { if (state.data) setMatrix(Object.fromEntries(state.data.roles.map((r) => [r.code, new Set(r.permissions)]))); }, [state.data]);
  const toggle = (role, perm) => setMatrix((m) => { const s = new Set(m[role]); if (s.has(perm)) s.delete(perm); else s.add(perm); return { ...m, [role]: s }; });
  const save = async (role) => { await runCritique(() => api.put(`/users/roles/${role}/permissions`, { permissions: [...matrix[role]] }), 'Permissions enregistrées.'); state.reload(); };
  return (
    <>
      <PageHeader title="Rôles et permissions" subtitle="Matrice des permissions par rôle. Chaque accès reste en outre limité par le périmètre administratif." breadcrumb={[{ label: 'Administration' }, { label: 'Rôles et permissions' }]} />
      <InfoAlert>Les permissions marquées « Réservée aux Divisions » ne peuvent jamais être attribuées au Bureau Secrétariat de Direction ni à son Chef (contrôle applicatif et contrainte de base de données). Le rôle Admin ne peut recevoir que des permissions techniques.</InfoAlert>
      <Loadable state={state}>
        {(d) => {
          const modules = [...new Set(d.permissions.map((p) => p.module))];
          return (
            <Card className="mt-4" bodyClass="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr><th className="th sticky left-0 z-10 min-w-[260px]">Permission</th>{d.roles.map((r) => <th key={r.code} className="th text-center">{r.libelle}<div className="mt-1"><button type="button" className="btn-primary px-2 py-1 text-xs normal-case" onClick={() => save(r.code)}><Save size={12} /> Enregistrer</button></div></th>)}</tr>
                  </thead>
                  <tbody>
                    {modules.map((m) => [
                      <tr key={m}><td colSpan={d.roles.length + 1} className="bg-dep-50 px-3 py-1.5 text-xs font-semibold uppercase text-dep-800">{m}</td></tr>,
                      ...d.permissions.filter((p) => p.module === m).map((p) => (
                        <tr key={p.code} className="hover:bg-slate-50">
                          <td className="td sticky left-0 bg-white"><div className="font-medium">{p.libelle}</div><div className="flex flex-wrap gap-1 text-xs text-slate-500"><code>{p.code}</code>{p.reservee_division && <Badge tone="indigo">Réservée aux Divisions</Badge>}{p.delegable && <Badge tone="attention">Délégable</Badge>}</div></td>
                          {d.roles.map((r) => <td key={r.code} className="td text-center"><input type="checkbox" aria-label={`${p.code} pour ${r.libelle}`} checked={!!matrix[r.code]?.has(p.code)} onChange={() => toggle(r.code, p.code)} /></td>)}
                        </tr>
                      )),
                    ])}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        }}
      </Loadable>
    </>
  );
}
