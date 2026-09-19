"use client";
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AnimatedCounter, GlassPresence } from './LiquidGlass';

const PrintStudio = lazy(() => import('./PrintStudio'));
export const motion = { fast: 160, normal: 260, success: 520, easing: 'cubic-bezier(.2,.7,.2,1)' };
type Feedback = 'cart-added' | 'cart-updated' | 'cart-removed' | 'file-ready' | 'file-removed' | 'payment-verified' | 'checkout';
const feedbackText: Record<Feedback, string> = { 'cart-added':'Added to your print basket ✓', 'cart-updated':'Print choices saved ✓', 'cart-removed':'Item removed', 'file-ready':'Document ready to configure ✓', 'file-removed':'Document removed', 'payment-verified':'Payment verified. Order confirmed ✓', checkout:'Your order summary is ready' };
export function customerFeedback(kind: Feedback) {
  window.dispatchEvent(new CustomEvent('printbee:feedback', { detail: kind }));
}

/** Explicit success events only: restoring a cart never triggers an added animation. */
export function CustomerMotion({ hidden = false }: { hidden?: boolean }) {
  const [message, setMessage] = useState('');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const animations = new Set<Animation>();
    const feedback = (event: Event) => {
      const kind = (event as CustomEvent<Feedback>).detail;
      if (!(kind in feedbackText)) return;
      setMessage(feedbackText[kind]);
      clearTimeout(timer); timer = setTimeout(() => setMessage(''), 2500);
      if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const target = document.querySelector(kind === 'cart-added' ? '.mobile-dock a[href="#cart"]' : kind.startsWith('cart') ? '.cart-section' : '.document-preview');
      if (target) {
        const animation = target.animate([{ transform:'scale(1)' }, { transform:'scale(1.04)', offset:.45 }, { transform:'scale(1)' }], { duration:motion.normal, easing:motion.easing });
        animations.add(animation); animation.onfinish = () => animations.delete(animation);
      }
      if (kind === 'cart-added') {
        const source = document.querySelector('.order-card');
        const destination = [...document.querySelectorAll('.mobile-dock a[href="#cart"],.topbar a[href="#cart"],#cart')].find(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.top >= 0 && rect.top < innerHeight; });
        if (!source || !destination) return;
        const from = source.getBoundingClientRect(), to = destination.getBoundingClientRect();
        if (to.top < 0 || to.top > innerHeight) return;
        const paper = document.createElement('span');
        paper.textContent = '▤'; paper.className = 'flying-paper'; paper.setAttribute('aria-hidden','true');
        const x = Math.min(innerWidth - 40, Math.max(20, from.left + from.width / 2));
        const y = Math.min(innerHeight - 100, Math.max(60, from.top + 80));
        Object.assign(paper.style, { position:'fixed', left:`${x}px`, top:`${y}px`, zIndex:'50', pointerEvents:'none', fontSize:'28px', color:'#386841' });
        document.body.append(paper);
        const dx = to.left + to.width / 2 - x, dy = to.top + Math.min(to.height / 2, 30) - y;
        const animation = paper.animate([{ transform:'translate(0,0) scale(1)', opacity:1 }, { transform:`translate(${dx * .45}px,${Math.min(-65, dy - 70)}px) rotate(-12deg) scale(.8)`, opacity:1, offset:.45 }, { transform:`translate(${dx}px,${dy}px) rotate(8deg) scale(.15)`, opacity:0 }], { duration:650, easing:motion.easing });
        animations.add(animation); animation.onfinish = animation.oncancel = () => { paper.remove(); animations.delete(animation); };
      }
    };
    window.addEventListener('printbee:feedback', feedback);
    return () => { clearTimeout(timer); window.removeEventListener('printbee:feedback', feedback); animations.forEach(animation => animation.cancel()); };
  }, []);
  return message && !hidden ? <div className="action-feedback" role="status">{message}</div> : null;
}

export function AnimatedPrice({ value }: { value: number }) {
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(value);
  useEffect(() => {
    const before = previous.current; previous.current = value;
    if (before === value || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches || !ref.current) return;
    const animation = ref.current.animate([{ opacity:.5, transform:'translateY(3px)' }, { opacity:1, transform:'translateY(0)' }], { duration:motion.fast });
    return () => animation.cancel();
  }, [value]);
  return <strong ref={ref} aria-live="polite" aria-atomic="true"><AnimatedCounter value={value} currency /></strong>;
}

export function StudioLauncher() {
  const [open, setOpen] = useState(false);
  return <><button className="studio-launch" onClick={() => setOpen(true)}>Explore the PrintBee mini studio ↗</button><GlassPresence>{open && <Suspense fallback={<div className="modal-backdrop"><section className="studio-modal" role="dialog" aria-modal="true" aria-label="Opening PrintBee studio"><button aria-label="Close studio" onClick={() => setOpen(false)}>Close</button><p>Opening the print studio…</p></section></div>}><PrintStudio close={() => setOpen(false)} /></Suspense>}</GlassPresence></>;
}
