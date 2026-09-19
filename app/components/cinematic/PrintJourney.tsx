"use client";

import { useEffect, useRef, type CSSProperties } from "react";

/** Decorative CSS geometry: real forms, headings and prices remain in the DOM. */
export function PrinterScene() {
  return <div className="printer-stage" aria-hidden="true">
    <div className="scene-orbit orbit-one" /><div className="scene-orbit orbit-two" />
    <div className="scene-particles">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}</div>
    <div className="floating-note note-one"><small>NOTES / 01</small><b>Good ideas<br />deserve paper.</b><i /><i /><i /></div>
    <div className="floating-note note-two"><small>ASSIGNMENT</small><b>A4</b><i /><i /></div>
    <div className="printer-rig">
      <div className="printer-paper"><span>YOUR NEXT BIG IDEA</span><b>Make it<br />real.</b><i /><i /><i /></div>
      <div className="printer-top"><span>PRECISION IN EVERY PAGE</span><i /></div>
      <div className="printer-body"><div className="printer-brand">Print<span>Bee</span><small>DESIGNED FOR CAMPUS LIFE</small></div><div className="printer-screen"><i /> READY TO PRINT</div><div className="printer-slot"><i /></div><div className="printer-output"><small>PRINTBEE / A4</small><b>Good ideas.<br />Delivered.</b><i /><i /></div><div className="printer-vents">||||||||||||</div></div>
      <div className="printer-side" /><div className="printer-tray" />
    </div>
    <div className="delivery-parcel"><span>PrintBee</span><small>UPLOAD. PRINT. DELIVERED.</small><i>↗</i></div>
    <svg className="delivery-route" viewBox="0 0 600 300"><path d="M80 200 C180 280 200 50 320 140 S460 270 540 70" /><circle cx="540" cy="70" r="7" /></svg>
    <div className="scene-caption"><span>01 — DIGITAL TO PHYSICAL</span><span>A4 / MADE FOR YOU</span></div>
  </div>;
}

export function PrintJourney() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, -rect.top / Math.max(1, rect.height - innerHeight)));
      el.style.setProperty("--journey", String(reduced.matches ? 0 : progress));
      el.dataset.scene = progress < .32 ? "upload" : progress < .68 ? "print" : "delivered";
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new IntersectionObserver(([entry]) => el.classList.toggle("scene-visible", entry.isIntersecting));
    observer.observe(el);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    reduced.addEventListener("change", schedule);
    update();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); reduced.removeEventListener("change", schedule); };
  }, []);
  return <section ref={ref} className="print-journey" id="journey" aria-label="From your screen to your doorstep" data-scene="upload">
    <div className="journey-sticky">
      <div className="journey-copy"><span className="cinema-kicker">THREE STEPS. ZERO PRINT-SHOP QUEUES.</span>
        <div className="journey-headlines"><div className="journey-upload"><small>01 / YOUR IDEAS BEGIN HERE</small><h2>Upload.</h2><p>From a late-night assignment to your next big idea. Send it into the PrintBee world.</p></div><div className="journey-print"><small>02 / PRECISION MEETS PAPER</small><h2>Print.</h2><p>Black & white or full colour. Every page, just the way you chose it.</p></div><div className="journey-delivered"><small>03 / THE LAST MILE, SORTED</small><h2>Delivered.</h2><p>Fresh prints. Your doorstep. Get back to what matters.</p></div></div>
        <a href="#upload" className="primary-cta">Start your print <span>↗</span></a>
        <div className="journey-steps" aria-hidden="true"><span>01 UPLOAD</span><span>02 PRINT</span><span>03 DELIVER</span></div>
      </div><PrinterScene />
    </div>
  </section>;
}

export function ProjectPortals({ baseUrl = "" }: { baseUrl?: string }) {
  return <div className="cinema-portals">{[
    ["01", "BUY", "Your next breakthrough.", "Explore ready-built projects", "/projects/buy"],
    ["02", "SELL", "Built it? Share it.", "Turn your work into opportunity", "/projects/sell"],
    ["03", "BUILD", "From what if to what’s next.", "Bring your idea to life", "/projects/build"],
  ].map(([number, title, line, detail, href]) => <a href={`${baseUrl}${href}`} key={title}><small>{number} / PRINTBEE PROJECTS</small><div className={`portal-object portal-${title.toLowerCase()}`} aria-hidden="true"><i /><i /><i /></div><h3>{title}</h3><strong>{line}</strong><p>{detail}</p><span className="portal-arrow" aria-hidden="true">↗</span></a>)}</div>;
}

export function PaymentCelebration() {
  return <div className="payment-print-confirmation" role="status"><div className="confirmation-slot" /><div className="confirmation-paper"><small>PRINTBEE</small><strong>ORDER CONFIRMED ✓</strong><span>Your next chapter is on its way.</span></div><div className="confirmation-sparks" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}</div></div>;
}
