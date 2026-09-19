"use client";

import { useEffect, useRef, useState } from "react";

type Ripple = { id: number; x: number; y: number } | null;

/** Touch-only polish: never intercepts an action and only uses audio after a user gesture. */
export default function TouchFeedback() {
  const [ripple, setRipple] = useState<Ripple>(null);
  const context = useRef<AudioContext | null>(null);
  const lastTouch = useRef(0);

  useEffect(() => {
    const isMobileTouch = () => window.matchMedia("(max-width: 820px) and (pointer: coarse)").matches;
    const playGlassTap = () => {
      const Audio = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) return;
      const audio = context.current ?? new Audio();
      context.current = audio;
      if (audio.state === "suspended") void audio.resume();
      const now = audio.currentTime;
      const gain = audio.createGain();
      const tone = audio.createOscillator();
      const shimmer = audio.createOscillator();
      tone.type = "sine";
      shimmer.type = "triangle";
      tone.frequency.setValueAtTime(820, now);
      tone.frequency.exponentialRampToValueAtTime(390, now + .14);
      shimmer.frequency.setValueAtTime(1450, now);
      shimmer.frequency.exponentialRampToValueAtTime(760, now + .12);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.045, now + .008);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .17);
      tone.connect(gain); shimmer.connect(gain); gain.connect(audio.destination);
      tone.start(now); shimmer.start(now); tone.stop(now + .18); shimmer.stop(now + .18);
    };
    const onPointerDown = (event: PointerEvent) => {
      const interactive = (event.target as Element).closest("button,a,[role=button],[role=radio]");
      if (!interactive || (interactive as HTMLButtonElement).disabled) return;
      const now = Date.now();
      if (now - lastTouch.current < 450) return;
      lastTouch.current = now;
      setRipple({ id: now, x: event.clientX, y: event.clientY });
      playGlassTap();
      if (event.pointerType === "touch" && isMobileTouch() && "vibrate" in navigator) navigator.vibrate(Array.from({ length: 10 }, () => [45, 55]).flat());
    };
    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    return () => { document.removeEventListener("pointerdown", onPointerDown); context.current?.close(); };
  }, []);

  return ripple ? <i className="mobile-touch-ripple" aria-hidden="true" key={ripple.id} style={{ left: ripple.x, top: ripple.y }} onAnimationEnd={() => setRipple(null)} /> : null;
}
