"use client";
import { GlassNav } from "../components/LiquidGlass";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
export default function ProjectNavigation() {
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  return <nav className={`project-nav ${menuOpen ? "menu-open" : ""}`} aria-label="Projects navigation"><Link href="/" className="brand"><Image src="/printbee-logo.png" width={40} height={40} alt="" unoptimized />PrintBee <span aria-hidden="true">/</span> Projects</Link><button type="button" className="project-menu-toggle" aria-expanded={menuOpen} aria-controls="project-sections" onClick={() => setMenuOpen((open) => !open)}><span aria-hidden="true">☰</span> Menu</button><GlassNav id="project-sections" className="project-nav-links" aria-label="Project sections">{[["/projects", "Explore"], ["/projects/buy", "Buy"], ["/projects/sell", "Sell"], ["/projects/build", "Build"]].map(([href, text]) => <Link href={href} key={href} aria-current={path === href ? "page" : undefined} onClick={() => setMenuOpen(false)}>{text}</Link>)}</GlassNav></nav>;
}
