"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ActionFeedback, GlassButton, GlassInput, GlassModal, LoadingAnimation } from "../../components/LiquidGlass";
import { DialogAccessibility } from "../../components/PrintBeeExperience";

type Listing = { id: string; project_code: string; title: string; category: string; short_description: string; problem_statement: string; description: string; final_price_paise: number; status: string; seller_name: string; seller_email: string };
type Request = { id: string; status: string; title: string; category: string; name: string; mobile: string; whatsapp: string; user_email: string; problem_statement: string; requirements: string; quoted_price_paise?: number; estimated_delivery?: string };
type Edit = { item: Listing; status: string };
const label = (value: string) => value.replaceAll("_", " ");
export default function ProjectsAdminClient() {
  const [data, setData] = useState<{ projects: Listing[]; buildRequests: Request[] }>({ projects: [], buildRequests: [] });
  const [tab, setTab] = useState("listings"), [note, setNote] = useState(""), [error, setError] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [edit, setEdit] = useState<Edit | null>(null), [quote, setQuote] = useState<Request | null>(null);
  const lock = useRef(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/projects"), result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load project controls.");
      setData({ projects: result.projects ?? [], buildRequests: result.buildRequests ?? [] });
    } catch (failure) { setError(true); setNote(failure instanceof Error ? failure.message : "Could not load project controls."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    // Fetch completion updates state; no synchronous derived-state update.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const act = async (body: Record<string, unknown>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNote("");
    try {
      const response = await fetch("/api/admin/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      setError(!response.ok); setNote(response.ok ? "Changes saved." : result.error ?? "Could not save.");
      if (response.ok) { setEdit(null); setQuote(null); await load(); }
    } catch { setError(true); setNote("Could not confirm the update. Refresh before retrying."); }
    finally { lock.current = false; setBusy(false); }
  };
  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!edit) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    void act({ ...fields, kind: "project", id: edit.item.id, status: edit.status, price: Number(fields.price) });
  };
  return <main className="projects admin-projects"><DialogAccessibility />
    <header className="project-admin-header"><div><span className="project-kicker">PRINTBEE ADMIN</span><h1>Projects controls</h1><p>Review listings, refine the details, and keep build orders moving.</p></div><nav aria-label="Project controls">{[["listings", "Buy & sell listings"], ["build", "Build orders"]].map(([key, text]) => <button key={key} aria-pressed={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{text} <small>{key === "listings" ? data.projects.length : data.buildRequests.length}</small></button>)}</nav></header>
    {note && <ActionFeedback tone={error ? "error" : "success"}>{note}</ActionFeedback>}
    {loading ? <LoadingAnimation label="Loading project controls…" /> : <section className="admin-project-list" key={tab}>
      {tab === "listings" ? data.projects.map(item => <article key={item.id}><div><span className="project-status">{label(item.status)}</span><small> · {item.project_code || item.id.slice(0, 8)}</small><h3>{item.title}</h3><p>{item.category} · ₹{(item.final_price_paise || 0) / 100}</p><p>{item.seller_name} · {item.seller_email}</p></div><div className="admin-project-actions"><GlassButton disabled={busy} onClick={() => setEdit({ item, status: "UNDER_REVIEW" })}>Edit</GlassButton><GlassButton disabled={busy} onClick={() => setEdit({ item, status: "PUBLISHED" })}>Edit & publish</GlassButton><GlassButton disabled={busy} onClick={() => setEdit({ item, status: "REJECTED" })}>Reject</GlassButton></div></article>) : data.buildRequests.map(request => <article key={request.id}><div><span className="project-status">{label(request.status)}</span><h3>{request.title}</h3><p>{request.category} · {request.name}</p><p>{request.mobile} · WhatsApp {request.whatsapp}</p><p>{request.user_email}</p><details><summary>Requirements & problem statement</summary><p>{request.problem_statement}</p><p>{request.requirements}</p></details>{request.quoted_price_paise != null && <p>Quote: ₹{request.quoted_price_paise / 100} · {request.estimated_delivery}</p>}</div><div className="admin-project-actions"><GlassButton busy={busy} onClick={() => void act({ kind: "build", id: request.id, status: "UNDER_REVIEW" })}>Review</GlassButton><GlassButton disabled={busy} onClick={() => setQuote(request)}>Send quote</GlassButton><GlassButton disabled={busy} onClick={() => void act({ kind: "build", id: request.id, status: "DELIVERED" })}>Delivered</GlassButton><GlassButton disabled={busy} onClick={() => void act({ kind: "build", id: request.id, status: "REJECTED" })}>Reject</GlassButton></div></article>)}
      {(tab === "listings" ? data.projects : data.buildRequests).length === 0 && <div className="glass-panel market-empty"><h2>No {tab === "listings" ? "listings" : "build orders"} here yet.</h2><p>New submissions will appear here for review.</p><GlassButton onClick={() => void load()}>Refresh</GlassButton></div>}
    </section>}
    <GlassModal open={Boolean(edit)} onClose={() => { if (!busy) setEdit(null); }} title={edit?.status === "PUBLISHED" ? "Review & publish" : edit?.status === "REJECTED" ? "Reject project" : "Edit project"}>{edit && <form className="project-form" onSubmit={submitEdit} key={edit.item.id}><fieldset disabled={busy}><div className="project-form-grid">{[["title", "Project title", edit.item.title], ["category", "Category", edit.item.category]].map(([name, text, value]) => <label className="project-field" key={name}>{text}<GlassInput name={name} defaultValue={value} required /></label>)}{[["shortDescription", "Short description", edit.item.short_description], ["problemStatement", "Problem statement", edit.item.problem_statement], ["description", "Detailed description", edit.item.description]].map(([name, text, value]) => <label className="project-field wide" key={name}>{text}<textarea name={name} defaultValue={value ?? ""} /></label>)}<label className="project-field">Price (₹)<GlassInput name="price" type="number" min={0} step="0.01" required defaultValue={(edit.item.final_price_paise || 0) / 100} /></label></div></fieldset><GlassButton busy={busy} type="submit">{busy ? "Saving…" : edit.status === "PUBLISHED" ? "Publish project" : edit.status === "REJECTED" ? "Confirm rejection" : "Save changes"}</GlassButton></form>}</GlassModal>
    <GlassModal open={Boolean(quote)} onClose={() => { if (!busy) setQuote(null); }} title="Send a project quote">{quote && <form className="project-form" onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); void act({ kind: "build", id: quote.id, status: "QUOTE_SENT", quotedPrice: Number(fields.get("price")), delivery: fields.get("delivery") }); }}><p>{quote.title}</p><label className="project-field">Quote (₹)<GlassInput name="price" type="number" min={0} step="0.01" required /></label><label className="project-field">Delivery estimate<GlassInput name="delivery" placeholder="e.g. 2 weeks after acceptance" /></label><GlassButton type="submit" busy={busy}>{busy ? "Sending…" : "Send quote"}</GlassButton></form>}</GlassModal>
  </main>;
}
