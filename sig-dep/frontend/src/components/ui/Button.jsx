import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

export const VARIANTES = { primary: 'btn-primary', secondary: 'btn-secondary', danger: 'btn-danger', success: 'btn-success', ghost: 'btn-ghost' };

/**
 * Bouton standard. Les classes `.btn-*` restent utilisables directement ;
 * ce composant ajoute l’icône, l’état de chargement et `type="button"` par défaut.
 */
export const Button = forwardRef(function Button({ variant = 'secondary', size, icon: Icon, loading = false, className = '', type = 'button', disabled, children, ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={`${VARIANTES[variant]}${size === 'sm' ? ' btn-sm' : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : Icon && <Icon size={16} aria-hidden />}
      {children}
    </button>
  );
});

/** Bouton réduit à une icône : le libellé est obligatoire (lu par les lecteurs d’écran, affiché au survol). */
export const IconButton = forwardRef(function IconButton({ label, icon: Icon, variant = 'ghost', size = 16, className = '', type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} className={`${VARIANTES[variant]} btn-icon${className ? ` ${className}` : ''}`} {...rest}>
      <Icon size={size} aria-hidden />
    </button>
  );
});
