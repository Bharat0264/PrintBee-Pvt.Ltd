import { NextResponse } from "next/server";
import { database, fileBucket } from "../db";
import { getViewer } from "../../supabase/server";

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json([]);
  const rows = await database().prepare("SELECT c.item_json FROM cart_items c LEFT JOIN uploads u ON u.id=c.upload_id WHERE c.customer_email=? AND (c.upload_id LIKE 'addon:%' OR (u.customer_email=? AND u.order_id IS NULL AND u.deleted_at IS NULL)) ORDER BY c.created_at")
    .bind(viewer.email, viewer.email).all<{ item_json: string }>();
  return NextResponse.json(rows.results.flatMap((row) => { try { return [JSON.parse(row.item_json)]; } catch { return []; } }));
}

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const item = await request.json() as any;
  if (!item.id || !item.uploadId) return NextResponse.json({ error: "Invalid cart item" }, { status: 400 });
  if (item.kind === "ADDON") {
    const addon = await database().prepare("SELECT id,name,description,price_paise FROM addons WHERE id=? AND active=1").bind(item.addonId).first<{ id: string; name: string; description: string; price_paise: number }>();
    if (!addon || item.uploadId !== `addon:${addon.id}`) return NextResponse.json({ error: "This add-on is unavailable" }, { status: 400 });
    const price = addon.price_paise / 100;
    Object.assign(item, { fileName: addon.name, total: price, addonsTotal: price, addons: [{ id: addon.id, name: addon.name, description: addon.description, price }] });
  }
  const itemJson = JSON.stringify(item);
  if (itemJson.length > 20_000) return NextResponse.json({ error: "Invalid cart item" }, { status: 400 });
  if (item.kind !== "ADDON") {
    const upload = await database().prepare("SELECT id,original_name,content_type FROM uploads WHERE id=? AND customer_email=? AND order_id IS NULL AND deleted_at IS NULL").bind(item.uploadId, viewer.email).first<{ id: string; original_name: string; content_type: string }>();
    if (!upload) return NextResponse.json({ error: "The uploaded file is unavailable" }, { status: 400 });
    if (item.serviceId === "turnitin-plagiarism-check") {
      if (!String(upload.original_name).toLowerCase().endsWith(".pdf") || (upload.content_type && upload.content_type !== "application/pdf")) return NextResponse.json({ error: "Plagiarism reports accept PDF files only." }, { status: 400 });
      Object.assign(item, { copies: 1, mode: "bw-single", unitPrice: 0, total: 175, servicePrice: 175, addons: [], addonsTotal: 0, countsForPackaging: false });
    }
  }
  await database().prepare("INSERT INTO cart_items (id,customer_email,upload_id,item_json,created_at) VALUES (?,?,?,?,?) ON CONFLICT(upload_id) DO UPDATE SET item_json=excluded.item_json")
    .bind(item.id, viewer.email, item.uploadId, itemJson, new Date().toISOString()).run();
  return NextResponse.json({ saved: true });
}

export async function DELETE(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const uploadId = new URL(request.url).searchParams.get("uploadId") ?? "";
  if (uploadId.startsWith("addon:")) {
    await database().prepare("DELETE FROM cart_items WHERE upload_id=? AND customer_email=?").bind(uploadId, viewer.email).run();
    return NextResponse.json({ removed: true });
  }
  const upload = await database().prepare("SELECT storage_key FROM uploads WHERE id=? AND customer_email=? AND order_id IS NULL").bind(uploadId, viewer.email).first<{ storage_key: string }>();
  if (!upload) return NextResponse.json({ removed: true });
  await fileBucket().delete(upload.storage_key);
  const db = database();
  await db.batch([
    db.prepare("DELETE FROM cart_items WHERE upload_id=? AND customer_email=?").bind(uploadId, viewer.email),
    db.prepare("DELETE FROM uploads WHERE id=? AND customer_email=? AND order_id IS NULL").bind(uploadId, viewer.email),
  ]);
  return NextResponse.json({ removed: true });
}
