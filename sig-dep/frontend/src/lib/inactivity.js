import { useEffect, useRef, useState } from 'react';

const MINUTES = Number(import.meta.env.VITE_INACTIVITY_MINUTES || 30);
// Avertissement 60 s avant la déconnexion (au plus le quart du délai pour les délais très courts)
const WARNING_SECONDS = Math.min(60, Math.floor((MINUTES * 60) / 4));
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];

/**
 * Déconnexion automatique après inactivité. Renvoie le nombre de secondes restantes
 * pendant la phase d’avertissement (null sinon) et une fonction pour prolonger la session.
 * L’activité est partagée entre onglets via localStorage.
 */
export function useInactivity(onTimeout) {
  const [remaining, setRemaining] = useState(null);
  const last = useRef(Date.now());
  const cb = useRef(onTimeout);
  cb.current = onTimeout;

  const touch = () => {
    last.current = Date.now();
    try { localStorage.setItem('sigdep_activite', String(last.current)); } catch { /* stockage indisponible */ }
  };

  useEffect(() => {
    if (!MINUTES) return undefined;
    let throttle = 0;
    const onActivity = () => { const now = Date.now(); if (now - throttle > 5000 && remainingRef.current === null) { throttle = now; touch(); } };
    const onStorage = (e) => { if (e.key === 'sigdep_activite') last.current = Number(e.newValue) || Date.now(); };
    EVENTS.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    window.addEventListener('storage', onStorage);
    const t = setInterval(() => {
      const left = Math.round((last.current + MINUTES * 60000 - Date.now()) / 1000);
      if (left <= 0) { clearInterval(t); cb.current(); } else setRemaining(left <= WARNING_SECONDS ? left : null);
    }, 1000);
    return () => { clearInterval(t); EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity)); window.removeEventListener('storage', onStorage); };
  }, []);

  const remainingRef = useRef(remaining);
  remainingRef.current = remaining;
  return { remaining, prolonger: () => { touch(); setRemaining(null); } };
}
