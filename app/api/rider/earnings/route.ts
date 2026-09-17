import { NextResponse } from "next/server";
import { database } from "../../db";
import { getViewer } from "../../../supabase/server";

async function riderAccount(email: string) {
  const db = database();
  const rider = await db.prepare("SELECT approval_status FROM app_users WHERE email=? AND role='AGENT'").bind(email).first<{ approval_status: string }>();
  if (!rider || rider.approval_status !== "APPROVED") return null;
  const earnings = await db.prepare("SELECT COUNT(*) total_rides, COALESCE(SUM(CAST(delivery_fee_paise * 3 / 4 AS INTEGER) + incampus_fee_paise), 0) earned_paise FROM orders WHERE rider_email=? AND status='DELIVERED' AND hidden_at IS NULL").bind(email).first<{ total_rides: number; earned_paise: number }>();
  const reserved = await db.prepare("SELECT COALESCE(SUM(amount_paise), 0) reserved_paise FROM rider_withdrawals WHERE rider_email=?").bind(email).first<{ reserved_paise: number }>();
  const history = await db.prepare("SELECT id, upi_id, amount_paise, status, requested_at, updated_at FROM rider_withdrawals WHERE rider_email=? ORDER BY requested_at DESC LIMIT 25").bind(email).all();
  const deliveredOrders = await db.prepare("SELECT id,order_number,location_name,delivery_fee_paise,incampus_fee_paise,CAST(delivery_fee_paise * 3 / 4 AS INTEGER) + incampus_fee_paise earned_paise,delivered_at FROM orders WHERE rider_email=? AND status='DELIVERED' AND hidden_at IS NULL ORDER BY delivered_at DESC LIMIT 100").bind(email).all();
  return { totalRides: earnings?.total_rides ?? 0, earnedPaise: earnings?.earned_paise ?? 0, availablePaise: Math.max(0, (earnings?.earned_paise ?? 0) - (reserved?.reserved_paise ?? 0)), withdrawals: history.results, deliveredOrders: deliveredOrders.results };
}

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (viewer.isAdmin) return NextResponse.json({ totalRides: 0, earnedPaise: 0, availablePaise: 0, withdrawals: [], deliveredOrders: [] });
  const account = await riderAccount(viewer.email);
  if (!account) return NextResponse.json({ error: "Approved delivery-partner access required" }, { status: 403 });
  return NextResponse.json(account);
}

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer || viewer.isAdmin) return NextResponse.json({ error: "Delivery-partner access required" }, { status: 403 });
  const { upiId } = await request.json() as { upiId?: string };
  const cleanUpi = upiId?.trim().toLowerCase();
  if (!cleanUpi || !/^[a-z0-9._-]{2,}@[a-z0-9.-]{2,}$/i.test(cleanUpi)) return NextResponse.json({ error: "Enter a valid UPI ID" }, { status: 400 });
  const account = await riderAccount(viewer.email);
  if (!account) return NextResponse.json({ error: "Approved delivery-partner access required" }, { status: 403 });
  if (account.availablePaise <= 0) return NextResponse.json({ error: "No available earnings to withdraw" }, { status: 400 });
  const now = new Date().toISOString();
  await database().prepare("INSERT INTO rider_withdrawals (id, rider_email, upi_id, amount_paise, status, requested_at, updated_at) VALUES (?, ?, ?, ?, 'REQUESTED', ?, ?)").bind(crypto.randomUUID(), viewer.email, cleanUpi, account.availablePaise, now, now).run();
  return NextResponse.json({ requested: true, amountPaise: account.availablePaise });
}
