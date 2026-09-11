"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ActionFeedback, AnimatedList, AnimatedCounter, GlassButton, GlassInput, GlassSelect, LoadingAnimation, SuccessAnimation } from "../components/LiquidGlass";
import ProjectNavigation from "./ProjectNavigation";

const cats = ["AI", "Machine Learning", "Data Science", "Web Development", "Mobile Development", "IoT", "Cybersecurity", "Cloud", "Blockchain", "Big Data", "Electronics", "Robotics", "Other"];
type View = "home" | "buy" | "sell" | "build" | "mine" | "requests";
type Project = { id: string; title: string; slug?: string; category: string; status?: string; short_description?: string; final_price_paise?: number; quoted_price_paise?: number; estimated_delivery?: string; user_message?: string };
function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={`project-field ${wide ? "wide" : ""}`}><span>{label}</span>{children}</label>;
}
function Category() {
  return <Field label="Category"><GlassSelect name="category" required><option value="">Choose a category</option>{cats.map(category => <option key={category}>{category}</option>)}</GlassSelect></Field>;
}
const headings: Record<View, [string, string]> = {
  home: ["Big ideas. Meet possibility.", "Find a project, share what you’ve built, or get help bringing your idea to life."],
  buy: ["Find your next big idea.", "Explore published projects and discover the implementation that fits your interests."],
  sell: ["Built something good?", "Share your project with the PrintBee community. We’ll review the details before it goes live."],
  build: ["Your idea. Let’s build it.", "Tell us what you have in mind. Clear requirements help our team understand exactly what you need."],
  mine: ["Your project collection.", "Follow the progress of the projects you’ve shared with PrintBee."],
  requests: ["From idea to delivery.", "Your build requests, quotes, and the latest updates from the team."],
};
export default function ProjectsClient({ view }: { view: View }) {
  const [items, setItems] = useState<Project[]>([]), [message, setMessage] = useState(""), [success, setSuccess] = useState(false);
  const [q, setQ] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(""), [retry, setRetry] = useState(0);
  const submitting = useRef(false);
  const url = view === "buy" ? `/api/projects?q=${encodeURIComponent(q)}` : view === "mine" ? "/api/projects/my" : view === "requests" ? "/api/projects/build-requests" : "";
  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setLoadError("");
      try {
        const response = await fetch(url, { signal: abort.signal }), data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load projects.");
        if (!abort.signal.aborted) setItems(data.projects ?? data.requests ?? []);
      } catch (error) { if (!abort.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load projects."); }
      finally { if (!abort.signal.aborted) setLoading(false); }
    }, q ? 200 : 0);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [url, retry, q]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (submitting.current) return; submitting.current = true;
    const form = event.currentTarget;
    setBusy(true); setMessage(""); setSuccess(false);
    try {
      const fields = new FormData(form);
      const response = await fetch(view === "build" ? "/api/projects/build-requests" : "/api/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(fields), ownershipConfirmed: fields.get("ownershipConfirmed") === "on", features: String(fields.get("features") ?? "").split(","), techStack: String(fields.get("techStack") ?? "").split(",") }),
      });
      const data = await response.json(); setSuccess(response.ok);
      setMessage(response.ok ? "Submitted for review. Follow the progress from your requests." : data.error ?? "Please check the details.");
      if (response.ok) form.reset();
    } catch { setMessage("We couldn’t confirm the submission. Check your requests before trying again."); }
    finally { submitting.current = false; setBusy(false); }
  };
  const [title, description] = headings[view], build = view === "build";
  return <main className="projects"><ProjectNavigation />
    <header className="project-heading"><span className="project-kicker">PRINTBEE PROJECTS</span><h1>{title}</h1><p>{description}</p></header>
    {view === "home" ? <>
      <section className="projects-grid" aria-label="Explore PrintBee Projects">{[
        { title: "Buy projects", href: "/projects/buy", icon: "▤", description: "Browse published projects. Explore the details and find the right fit.", action: "Explore projects" },
        { title: "Sell a project", href: "/projects/sell", icon: "↗", description: "Give your hard work a new audience. Submit your project for review.", action: "List your project" },
        { title: "Build my project", href: "/projects/build", icon: "✳", description: "Start with a problem worth solving. Tell our team what you want to create.", action: "Share your idea" },
      ].map(item => <Link href={item.href} key={item.href}><span className="project-visual" aria-hidden="true">{item.icon}</span><b>{item.title}</b><p>{item.description}</p><em>{item.action} <span aria-hidden="true">→</span></em></Link>)}</section>
      <div className="glass-panel"><span className="project-kicker">ALREADY STARTED?</span><h2>Keep your ideas moving.</h2><p>Check your listings or follow an existing build request.</p><div className="project-form-footer"><Link className="glass-button" href="/projects/my-projects">My projects →</Link><Link className="glass-button" href="/projects/my-requests">My build requests →</Link></div></div>
    </> : view === "buy" || view === "mine" || view === "requests" ? <>
      {view === "buy" && <div className="project-search"><label className="project-field"><span>Search projects</span><GlassInput type="search" value={q} onChange={event => setQ(event.target.value)} placeholder="Title, technology, or an idea…" /></label>{loading && <LoadingAnimation compact />}</div>}
      {loadError ? <ActionFeedback tone="error">{loadError} <GlassButton onClick={() => setRetry(value => value + 1)}>Try again</GlassButton><Link href="/">Go to PrintBee to sign in</Link></ActionFeedback> : loading && !items.length ? <section className="market-grid" aria-label="Loading projects" aria-busy="true">{[0, 1, 2].map(index => <article className="skeleton-card" key={index} aria-hidden="true"><div className="skeleton-line" /><div className="skeleton-line" /><div className="skeleton-line" /><div className="skeleton-line" /></article>)}</section> : items.length ? <AnimatedList className="market-grid" aria-label="Projects" aria-busy={loading}>{items.map(item => <article key={item.id} data-motion-key={item.id}><span className="project-status">{(item.status || item.category).replaceAll("_", " ")}</span><h2>{item.title}</h2><p>{item.short_description || item.category}</p>{item.final_price_paise != null && <strong><AnimatedCounter value={item.final_price_paise / 100} currency /></strong>}{item.quoted_price_paise != null && <p>Quote: <AnimatedCounter value={item.quoted_price_paise / 100} currency />{item.estimated_delivery && ` · ${item.estimated_delivery}`}</p>}{item.user_message && <p>{item.user_message}</p>}{view === "buy" && item.slug && <Link className="glass-button" href={`/projects/project/${item.slug}`}>View project →</Link>}</article>)}</AnimatedList> : <div className="glass-panel market-empty" role="status"><span className="project-visual" aria-hidden="true">▤</span><h2>{q ? "No matching projects yet." : "A little space for your next idea."}</h2><p>{q ? "Try another title or technology." : "Your projects will appear here when they’re available."}</p>{view !== "buy" && <Link className="glass-button" href={view === "mine" ? "/projects/sell" : "/projects/build"}>Start a request →</Link>}</div>}
    </> : <>
      <form className="project-form" onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy}><legend>{build ? "Tell us about your idea" : "Project details"}</legend><div className="project-form-grid">
          {build && <Field label="Your name"><GlassInput name="name" required autoComplete="name" placeholder="Full name" /></Field>}
          <Field label="Project title"><GlassInput name="title" required minLength={3} maxLength={140} placeholder="Give your project a clear title" /></Field><Category />
          {build ? <><Field label="Contact number"><GlassInput name="mobile" required type="tel" inputMode="tel" autoComplete="tel" placeholder="Your contact number" /></Field><Field label="WhatsApp number"><GlassInput name="whatsapp" required type="tel" inputMode="tel" placeholder="Where we can reach you" /></Field><Field wide label="Problem statement"><textarea name="problemStatement" required minLength={15} maxLength={3000} placeholder="What problem should this project solve?" /></Field><Field wide label="Detailed requirements"><textarea name="requirements" required minLength={20} maxLength={12000} placeholder="Describe the features, expected behavior, and what a successful result looks like." /></Field></> : <><Field wide label="Short description"><textarea name="shortDescription" required minLength={20} maxLength={360} placeholder="What does your project do, and who is it for?" /></Field><Field label="Expected price (₹)"><GlassInput name="requestedPrice" type="number" required min={0} max={1000000} step="0.01" placeholder="Your listing price" /></Field><Field label="Your name"><GlassInput name="sellerName" required autoComplete="name" placeholder="Full name" /></Field><Field label="Contact number"><GlassInput name="sellerMobile" required type="tel" autoComplete="tel" placeholder="Your contact number" /></Field><Field label="WhatsApp number"><GlassInput name="sellerWhatsapp" required type="tel" placeholder="Your WhatsApp number" /></Field><Field label="UPI ID"><GlassInput name="sellerUpi" required placeholder="name@bank" /></Field></>}
        </div></fieldset>
        {!build && <label className="ownership"><input name="ownershipConfirmed" type="checkbox" required disabled={busy} /> I own this work.</label>}
        <div className="project-form-footer"><GlassButton type="submit" busy={busy}>{busy ? "Submitting…" : "Submit request →"}</GlassButton><p>{build ? "The team will review your requirements and follow up with the next steps." : "Your project is reviewed before publication. Your contact and payout details are used to process your listing."}</p></div>
      </form>
      {message && <ActionFeedback tone={success ? "success" : "error"}>{success && <SuccessAnimation />}{message}{success && <p><Link href={build ? "/projects/my-requests" : "/projects/my-projects"}>View your {build ? "requests" : "projects"} →</Link></p>}</ActionFeedback>}
    </>}
  </main>;
}
