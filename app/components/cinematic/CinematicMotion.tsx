"use client";

import { useEffect, useRef } from "react";

/** Cosmetic event listeners never cancel clicks, scrolling, or form events. */
export default function CinematicMotion() {
  const cursor = useRef<HTMLDivElement>(null);
  const trail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let lastTarget: HTMLElement | null = null;
    const move = (event: PointerEvent) => {
      if (reduced.matches || event.pointerType !== "mouse") return;
      if (cursor.current) {
        cursor.current.style.transform = `translate3d(${event.clientX}px,${event.clientY}px,0)`;
        cursor.current.dataset.active = String(Boolean((event.target as Element).closest("a,button,.upload-zone")));
      }
      const target = (event.target as Element).closest<HTMLElement>(".primary-cta,.price-list>article,.cinema-portals>a,.printer-stage");
      if (lastTarget && lastTarget !== target) lastTarget.style.removeProperty("transform");
      lastTarget = target;
      if (!target) return;
      const box = target.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - .5, y = (event.clientY - box.top) / box.height - .5;
      target.style.setProperty("--pointer-x", `${(x + .5) * 100}%`);
      target.style.setProperty("--pointer-y", `${(y + .5) * 100}%`);
      target.style.transform = target.matches(".primary-cta") ? `translate(${x * 8}px,${y * 8}px)` : `perspective(1000px) rotateX(${-y * 4}deg) rotateY(${x * 8}deg)`;
    };
    const reset = () => { if (lastTarget) lastTarget.style.removeProperty("transform"); lastTarget = null; };
    const update = () => {
      frame = 0;
      if (trail.current) trail.current.style.transform = `scaleY(${scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)})`;
    };
    const scroll = () => { reset(); if (!frame) frame = requestAnimationFrame(update); };
    const visibility = new IntersectionObserver(entries => entries.forEach(entry => entry.target.classList.toggle("cinema-in-view", entry.isIntersecting)), { threshold: .15 });
    document.querySelectorAll(".hero-printer,.how,.points-guide,.price-list,.cinema-portals").forEach(el => visibility.observe(el));
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", reset);
    window.addEventListener("scroll", scroll, { passive: true });
    update();
    return () => { visibility.disconnect(); reset(); cancelAnimationFrame(frame); document.removeEventListener("pointermove", move); document.removeEventListener("pointerleave", reset); window.removeEventListener("scroll", scroll); };
  }, []);
  return <><div className="cinema-cursor" ref={cursor} aria-hidden="true" /><div className="honey-trail" aria-hidden="true"><i ref={trail} /></div></>;
}
