import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./experience.css";
import "./order-motion.css";
import "./liquid-glass.css";
import "./cinematic.css";
import CinematicMotion from "./components/cinematic/CinematicMotion";
import { FloatingBackground, GlassInteractionSystem, PageTransition } from "./components/LiquidGlass";


export const metadata: Metadata = {
  title: "PrintBee | Upload. Print. Delivered.",
  description: "Simple A4 document printing in black-and-white or colour, delivered to your door.",
  icons: {
    icon: "/printbee-logo.png",
    shortcut: "/printbee-logo.png",
  },
};

// Keep Safari's layout viewport tied to the device width. Without this, each
// file-picker return can cause the page to be rendered against Safari's wider
// desktop viewport and visually scale the review form down.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body
        className="antialiased"
      >
        <FloatingBackground />
        <GlassInteractionSystem />
        <CinematicMotion />
        <PageTransition>{children}</PageTransition>
      </body>
    </html>
  );
}
