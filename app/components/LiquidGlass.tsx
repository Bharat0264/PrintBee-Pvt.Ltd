"use client";

import { Children, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { usePathname } from "next/navigation";

export const glassMotion = { fast: 160, normal: 250, page: 350, spring: "cubic-bezier(.2,.85,.25,1.12)" };
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const classes = (...values: (string | undefined)[]) => values.filter(Boolean).join(" ");

export function GlassCard({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={classes("glass-card", className)} {...props} />;
}
export function GlassPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={classes("glass-panel", className)} {...props} />;
}
export function GlassButton({ busy, children, className, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button className={classes("glass-button", className)} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>{busy && <LoadingAnimation label="Processing" compact />}{children}</button>;
}
export function GlassInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={classes("glass-input", className)} {...props} />;
}
export function GlassSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={classes("glass-input", className)} {...props} />;
}
export function GlassNav({ children, className, ...props }: HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLElement>(null);
  const path = usePathname();
  useEffect(() => {
    const nav = ref.current, capsule = indicator.current;
    if (!nav || !capsule) return;
    let active = nav.querySelector<HTMLElement>('[aria-current="page"], [aria-current="location"], .active') || nav.querySelector<HTMLElement>("a,button");
    const position = () => {
      if (!active || !active.isConnected) return;
      const box = active.getBoundingClientRect(), parent = nav.getBoundingClientRect();
      capsule.style.width = `${box.width}px`; capsule.style.height = `${box.height}px`;
      capsule.style.transform = `translate(${box.left - parent.left}px,${box.top - parent.top}px)`;
    };
    const click = (event: Event) => { const item = (event.target as Element).closest<HTMLElement>("a,button"); if (item && nav.contains(item)) { active = item; position(); } };
    const resize = new ResizeObserver(position); resize.observe(nav); position();
    nav.addEventListener("click", click);
    return () => { resize.disconnect(); nav.removeEventListener("click", click); };
  }, [path]);
  return <nav ref={ref} className={classes("glass-nav", className)} {...props}><i ref={indicator} className="glass-nav-indicator" aria-hidden="true" />{children}</nav>;
}
export function LoadingAnimation({ label = "Loading", compact = false }: { label?: string; compact?: boolean }) {
  return <span className={classes("glass-loading", compact ? "is-compact" : undefined)} role={compact ? undefined : "status"}><i aria-hidden="true" />{!compact && <span>{label}</span>}</span>;
}
export function SuccessAnimation() {
  return <svg className="glass-success" viewBox="0 0 64 64" role="img" aria-label="Success"><circle cx="32" cy="32" r="28" /><path d="m19 32 9 9 18-19" /></svg>;
}
export function ActionFeedback({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "success" | "warning" | "error" }) {
  return <div className={`glass-feedback feedback-${tone}`} role={tone === "error" ? "alert" : "status"}><span aria-hidden="true">{tone === "success" ? "✓" : tone === "error" ? "!" : "i"}</span><div>{children}</div></div>;
}

/** Keeps only the outgoing visual tree briefly; inert prevents duplicate actions. */
export function GlassPresence({ children }: { children: ReactNode }) {
  const present = Children.toArray(children).length > 0;
  const [retained, setRetained] = useState<ReactNode>(null);
  useLayoutEffect(() => {
    if (present) {
      // Retain the last committed dialog for its short exit animation.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRetained(children);
      return;
    }
    const timer = setTimeout(() => setRetained(null), reduced() ? 0 : glassMotion.fast);
    return () => clearTimeout(timer);
  }, [children, present]);
  if (!present && !retained) return null;
  return <div className={`glass-presence ${present ? "is-present" : "is-leaving"}`} inert={!present} aria-hidden={!present || undefined}>{present ? children : retained}</div>;
}

export function GlassModal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return <GlassPresence>{open && <div className="modal-backdrop" onMouseDown={onClose}><section className="glass-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={event => event.stopPropagation()}><button type="button" className="close" aria-label="Close dialog" onClick={onClose}>×</button><h2>{title}</h2>{children}</section></div>}</GlassPresence>;
}

export function AnimatedCounter({ value, currency = false, onceInView = false }: { value: number; currency?: boolean; onceInView?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const before = useRef(onceInView ? 0 : value);
  const format = (n: number) => new Intl.NumberFormat("en-IN", currency ? { style: "currency", currency: "INR" } : { maximumFractionDigits: 0 }).format(n);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const from = before.current;
    before.current = value;
    const run = (startValue: number) => {
      if (reduced() || document.hidden || startValue === value) { el.textContent = format(value); return; }
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / glassMotion.normal);
        el.textContent = format(startValue + (value - startValue) * (1 - (1 - progress) ** 3));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    if (onceInView) {
      const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { run(from); observer.disconnect(); } });
      observer.observe(el);
      return () => { observer.disconnect(); cancelAnimationFrame(frame); };
    }
    run(from);
    return () => cancelAnimationFrame(frame);
    // Formatting depends only on the currency flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, currency, onceInView]);
  return <span className="animated-counter" aria-label={format(value)}><span aria-hidden="true" ref={ref}>{format(value)}</span></span>;
}

export function PageTransition({ children }: { children: ReactNode }) {
  const path = usePathname();
  return <div className="glass-page" key={path}>{children}</div>;
}

export function AnimatedList({ children, className, ...props }: HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    if (!ref.current) return;
    const next = new Map<string, DOMRect>();
    const animations: Animation[] = [];
    for (const child of ref.current.children) {
      const key = child.getAttribute("data-motion-key");
      if (!key) continue;
      const box = child.getBoundingClientRect(), old = previous.current.get(key);
      next.set(key, box);
      if (!reduced() && old && (old.x !== box.x || old.y !== box.y)) animations.push(child.animate([{ transform: `translate(${old.x - box.x}px,${old.y - box.y}px)` }, { transform: "none" }], { duration: glassMotion.page, easing: glassMotion.spring }));
    }
    previous.current = next;
    return () => animations.forEach(animation => animation.cancel());
  }, [children]);
  return <section ref={ref} className={className} {...props}>{children}</section>;
}

export function FloatingBackground() {
  return <div className="floating-background" aria-hidden="true"><i /><i /><i /></div>;
}

export function CheckoutProgress({ step }: { step: number }) {
  return <ol className="glass-checkout-progress" aria-label="Checkout progress">{["Details", "Delivery", "Payment", "Confirmed"].map((label, index) => <li key={label} className={index < step ? "complete" : index === step ? "current" : ""} aria-current={index === step ? "step" : undefined}><span>{index < step ? "✓" : index + 1}</span><small>{label}</small></li>)}</ol>;
}

export async function animateCartRemoval(id: string) {
  const cards = [...document.querySelectorAll<HTMLElement>("[data-cart-id]")];
  const target = cards.find(card => card.dataset.cartId === id);
  const positions = new Map(cards.map(card => [card, card.getBoundingClientRect()]));
  if (target && !reduced()) {
    const animation = target.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.97) translateY(-6px)" }], { duration: glassMotion.fast, fill: "forwards" });
    await animation.finished.catch(() => {});
  }
  return () => requestAnimationFrame(() => {
    if (reduced()) return;
    positions.forEach((before, card) => {
      if (!card.isConnected || card === target) return;
      const after = card.getBoundingClientRect();
      const distance = before.top - after.top;
      if (distance) card.animate([{ transform: `translateY(${distance}px)` }, { transform: "none" }], { duration: glassMotion.normal, easing: glassMotion.spring });
    });
  });
}

/** Progressive enhancement for existing controls; never intercepts actions or API calls. */
export function GlassInteractionSystem() {
  useEffect(() => {
    const activeAnimations = new Set<Animation>();
    const animate = (el: Element, frames: Keyframe[], duration = glassMotion.normal) => {
      if (reduced() || document.hidden || !el.getClientRects().length) return;
      const animation = el.animate(frames, { duration, easing: glassMotion.spring });
      activeAnimations.add(animation);
      animation.onfinish = animation.oncancel = () => activeAnimations.delete(animation);
    };
    const seen = new WeakSet<Element>();
    const reveal = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { animate(entry.target, [{ opacity: .35, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], glassMotion.page); reveal.unobserve(entry.target); }
    }), { threshold: .08 });
    const scan = (root: ParentNode) => root.querySelectorAll(".how,.points-guide,.pricing,.projects-home-cta,.market-grid>article,.projects-grid>a,.partner-earnings,.assigned-orders,.glass-card").forEach(el => { if (!seen.has(el)) { seen.add(el); reveal.observe(el); } });
    scan(document);
    const scroll = () => document.documentElement.classList.toggle("glass-scrolled", window.scrollY > 32);
    const change = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const output = target.closest(".quantity-stepper")?.querySelector("output");
      if (output) animate(output, [{ opacity: .3, transform: "translateY(5px)" }, { opacity: 1, transform: "none" }]);
    };
    const invalid = (event: Event) => { if (event.target instanceof Element) animate(event.target, [{ transform: "translateX(0)" }, { transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }]); };
    const move = (event: PointerEvent) => {
      if (reduced() || event.pointerType !== "mouse") return;
      const hero = (event.target as Element).closest<HTMLElement>(".hero-intro");
      if (!hero) return;
      const box = hero.getBoundingClientRect();
      hero.style.setProperty("--glass-x", `${((event.clientX - box.left) / box.width - .5) * 5}px`);
      hero.style.setProperty("--glass-y", `${((event.clientY - box.top) / box.height - .5) * 5}px`);
    };
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "childList") {
          record.addedNodes.forEach(node => { if (node instanceof Element) scan(node); });
          const target = record.target instanceof Element ? record.target : record.target.parentElement;
          const counter = target?.closest(".quantity-stepper output,.mobile-dock b,.home-wallet-button b,.wallet-heading h2");
          if (counter) animate(counter, [{ transform: "scale(.88)", opacity: .5 }, { transform: "scale(1)", opacity: 1 }]);
        }
        if (record.type === "attributes" && record.target instanceof Element && record.target.matches(".print-option.selected,.service-option-grid>.selected,.order-journey .current")) {
          animate(record.target, [{ transform: "scale(.98)" }, { transform: "translateY(-2px)" }]);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-checked", "aria-current"] });
    window.addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("click", change);
    document.addEventListener("invalid", invalid, true);
    document.addEventListener("pointermove", move, { passive: true });
    scroll();
    return () => { observer.disconnect(); reveal.disconnect(); activeAnimations.forEach(animation => animation.cancel()); window.removeEventListener("scroll", scroll); document.removeEventListener("click", change); document.removeEventListener("invalid", invalid, true); document.removeEventListener("pointermove", move); };
  }, []);
  return null;
}
