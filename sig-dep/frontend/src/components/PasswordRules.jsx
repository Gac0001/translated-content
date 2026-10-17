import { useApi } from './ui';

/** Règles de mot de passe en vigueur (politique configurée par l’Admin Système). */
export default function PasswordRules() {
  const { data } = useApi('/auth/politique-mot-de-passe');
  if (!data) return null;
  return <p className="text-xs text-slate-500">Le mot de passe doit comporter : {data.regles.join(', ')}.</p>;
}
