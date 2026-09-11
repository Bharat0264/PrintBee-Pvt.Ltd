"use client";
import { GlassNav } from "../components/LiquidGlass";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
export default function ProjectNavigation() {
  const path = usePathname();
  return <nav className="project-nav" aria-label="Projects navigation"><Link href="/" className="brand"><Image src="/printbee-logo.png" width={40} height={40} alt="" unoptimized />PrintBee <span aria-hidden="true">/</span> Projects</Link><GlassNav className="project-nav-links" aria-label="Project sections">{[["/projects", "Explore"], ["/projects/buy", "Buy"], ["/projects/sell", "Sell"], ["/projects/build", "Build"]].map(([href, text]) => <Link href={href} key={href} aria-current={path === href ? "page" : undefined}>{text}</Link>)}</GlassNav></nav>;
}
