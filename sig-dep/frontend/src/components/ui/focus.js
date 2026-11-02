import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Éléments atteignables au clavier et visibles dans `node`. */
export const focusables = (node) => [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);

// Pile des zones piégées : seule la plus récente (fenêtre au premier plan) réagit au clavier.
const pile = [];

/**
 * Garde le focus dans `ref` tant que `active` est vrai : focus initial ([data-autofocus],
 * sinon premier champ, sinon le conteneur), boucle Tab / Maj+Tab, Échap → onEscape,
 * puis retour du focus à l’élément d’origine à la fermeture.
 */
export function useFocusTrap(ref, active, onEscape) {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    const node = ref.current;
    if (!active || !node) return undefined;
    const precedent = document.activeElement;
    pile.push(node);
    const cible = node.querySelector('[data-autofocus]') || focusables(node).find((el) => el.matches('input, select, textarea')) || node;
    cible.focus({ preventScroll: true });
    const onKey = (e) => {
      if (pile[pile.length - 1] !== node) return;
      if (e.key === 'Escape') {
        if (escape.current) { e.preventDefault(); escape.current(); }
        return;
      }
      if (e.key !== 'Tab') return;
      const liste = focusables(node);
      if (!liste.length) { e.preventDefault(); node.focus(); return; }
      const premier = liste[0];
      const dernier = liste[liste.length - 1];
      const dedans = node.contains(document.activeElement);
      if (e.shiftKey && (!dedans || document.activeElement === premier || document.activeElement === node)) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && (!dedans || document.activeElement === dernier)) { e.preventDefault(); premier.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      pile.splice(pile.indexOf(node), 1);
      if (precedent instanceof HTMLElement && document.contains(precedent)) precedent.focus({ preventScroll: true });
    };
  }, [active, ref]);
}

let verrous = 0;

/** Bloque le défilement de la page derrière une fenêtre ou un tiroir (compteur partagé). */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    if (verrous++ === 0) document.body.style.overflow = 'hidden';
    return () => { if (--verrous === 0) document.body.style.overflow = ''; };
  }, [active]);
}
