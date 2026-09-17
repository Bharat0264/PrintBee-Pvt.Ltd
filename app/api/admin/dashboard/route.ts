import { NextResponse } from "next/server";
import { database } from "../../db";
import { getViewer } from "../../../supabase/server";
import { cleanupAbandonedCheckouts } from "../../maintenance";

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  await cleanupAbandonedCheckouts();
  const db = database();
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize")) || 25));
  const offset = (page - 1) * pageSize;
  const [summary, orders, orderCount, hiddenOrders, revenueOrders, activeUsers, walletUsers, riders, riderApplications, locations, locationStats, files, riderPayments, riderWithdrawals, dailySales, summaryOrders, adminMembers, trafficSummary, trafficDaily, launchOrders] = await Promise.all([
    db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN status='DELIVERED' THEN 1 ELSE 0 END) delivered, COUNT(*) paid, 0 unpaid, SUM(total_paise) revenue_paise, SUM(CASE WHEN status='READY_FOR_PICKUP' THEN 1 ELSE 0 END) ready FROM orders WHERE hidden_at IS NULL AND payment_status='PAID'`).first(),
    db.prepare(`SELECT id, order_number, customer_email, customer_name, mobile_number, location_name, incampus_delivery, incampus_type, campus_building, classroom_number, incampus_fee_paise, items_json, printing_subtotal_paise, delivery_fee_paise, platform_fee_paise, packaging_fee_paise, payment_gateway_fee_paise, surge_fee_paise, late_night_fee_paise, total_paise, payment_status, payment_reference, payment_rejection_reason, payment_verified_at, payment_verified_by, payment_qr_storage_key IS NOT NULL has_payment_qr, payment_qr_file_name, payment_qr_deleted_at, status, rider_email, cancellation_reason, cancelled_at, cancelled_by, delivered_at, created_at FROM orders WHERE hidden_at IS NULL AND payment_status='PAID' ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(pageSize, offset).all(),
    db.prepare("SELECT COUNT(*) count FROM orders WHERE hidden_at IS NULL AND payment_status='PAID'").first<{ count: number }>(),
    db.prepare(`SELECT id, order_number, customer_name, location_name, total_paise, payment_status, status, hidden_at, hidden_by, created_at FROM orders WHERE hidden_at IS NOT NULL ORDER BY hidden_at DESC LIMIT 100`).all(),
    db.prepare(`SELECT o.order_number, o.total_paise revenue_paise, o.printing_subtotal_paise, o.delivery_fee_paise, o.incampus_fee_paise, o.platform_fee_paise, o.packaging_fee_paise, o.rider_email, COALESCE(u.name, o.rider_email, 'Not assigned') rider_name, CAST(o.delivery_fee_paise * 3 / 4 AS INTEGER) + o.incampus_fee_paise rider_fee_paise, o.printing_subtotal_paise + o.platform_fee_paise + o.packaging_fee_paise + CAST(o.delivery_fee_paise / 4 AS INTEGER) admin_revenue_paise, o.created_at FROM orders o LEFT JOIN app_users u ON u.email=o.rider_email WHERE o.payment_status='PAID' AND o.hidden_at IS NULL ORDER BY o.created_at DESC LIMIT 100`).all(),
    db.prepare(`SELECT customer_email email, MAX(customer_name) name, MAX(mobile_number) mobile_number, COUNT(*) order_count, SUM(CASE WHEN payment_status='PAID' THEN total_paise ELSE 0 END) paid_spend_paise, MAX(created_at) last_order_at FROM orders WHERE hidden_at IS NULL GROUP BY customer_email ORDER BY last_order_at DESC LIMIT 100`).all(),
    db.prepare(`SELECT p.email, p.referral_code, p.points_balance available_points, COALESCE(SUM(o.points_redeemed),0) spent_points, p.points_balance + COALESCE(SUM(o.points_redeemed),0) total_credited_points, COALESCE(SUM(o.spend_points_awarded),0) delivered_spend_points, MAX(o.order_number) latest_order_number, MAX(o.created_at) latest_order_at FROM customer_profiles p LEFT JOIN orders o ON o.customer_email=p.email GROUP BY p.email,p.referral_code,p.points_balance ORDER BY COALESCE(MAX(o.created_at),p.created_at) DESC`).all(),
    db.prepare(`SELECT u.email, u.name, u.mobile_number, u.is_available, COUNT(DISTINCT o.id) assigned, SUM(CASE WHEN o.status='DELIVERED' THEN 1 ELSE 0 END) delivered, COALESCE(SUM(CASE WHEN o.status='DELIVERED' THEN CAST(o.delivery_fee_paise * 3 / 4 AS INTEGER) + o.incampus_fee_paise ELSE 0 END), 0) earned_paise, COALESCE((SELECT SUM(rw.amount_paise) FROM rider_withdrawals rw WHERE rw.rider_email=u.email), 0) withdrawn_paise FROM app_users u LEFT JOIN orders o ON o.rider_email=u.email AND o.hidden_at IS NULL WHERE u.role='AGENT' AND u.approval_status='APPROVED' GROUP BY u.email ORDER BY u.is_available DESC, delivered DESC`).all(),
    db.prepare("SELECT email, name, mobile_number, created_at FROM app_users WHERE role='AGENT' AND approval_status='PENDING' ORDER BY created_at").all(),
    db.prepare("SELECT id, name, active, delivery_fee_paise, platform_fee_paise FROM locations ORDER BY name").all(),
    db.prepare(`SELECT l.id, l.name, l.active, l.delivery_fee_paise, l.platform_fee_paise, COUNT(o.id) orders, SUM(CASE WHEN o.status='DELIVERED' THEN 1 ELSE 0 END) delivered, COALESCE(SUM(CASE WHEN o.payment_status='PAID' THEN o.total_paise ELSE 0 END), 0) revenue_paise FROM locations l LEFT JOIN orders o ON o.location_id=l.id AND o.hidden_at IS NULL GROUP BY l.id, l.name, l.active ORDER BY revenue_paise DESC, l.name`).all(),
    db.prepare("SELECT id, order_id, original_name, deleted_at FROM uploads WHERE order_id IS NOT NULL ORDER BY created_at").all(),
    db.prepare("SELECT id, rider_email, amount_paise, payment_date, note, recorded_by, created_at FROM rider_payments ORDER BY payment_date DESC, created_at DESC LIMIT 100").all(),
    db.prepare("SELECT id, rider_email, upi_id, amount_paise, status, requested_at, updated_at, updated_by FROM rider_withdrawals ORDER BY requested_at DESC LIMIT 100").all(),
    db.prepare("SELECT substr(created_at,1,10) day,COUNT(*) orders,SUM(total_paise) revenue_paise FROM orders WHERE payment_status='PAID' AND hidden_at IS NULL AND created_at>=datetime('now','-29 days') GROUP BY substr(created_at,1,10) ORDER BY day").all(),
    db.prepare(`SELECT order_number, items_json, printing_subtotal_paise, delivery_fee_paise, platform_fee_paise, packaging_fee_paise, payment_gateway_fee_paise, surge_fee_paise, late_night_fee_paise, total_paise, payment_status, status, created_at FROM orders WHERE hidden_at IS NULL AND payment_status='PAID' ORDER BY created_at DESC`).all(),
    db.prepare("SELECT email,role,created_at,created_by,updated_at FROM admin_members ORDER BY CASE role WHEN 'OWNER' THEN 1 WHEN 'OPERATIONS' THEN 2 WHEN 'ACCOUNTANT' THEN 3 ELSE 4 END,email").all(),
    db.prepare("SELECT COUNT(DISTINCT CASE WHEN event='PAGE_VIEW' THEN visitor_id END) visitors, SUM(CASE WHEN event='PAGE_VIEW' THEN 1 ELSE 0 END) page_views, SUM(CASE WHEN event='CHECKOUT_STARTED' THEN 1 ELSE 0 END) checkout_starts FROM traffic_events").first<any>(),
    db.prepare("SELECT substr(created_at,1,10) day, COUNT(DISTINCT CASE WHEN event='PAGE_VIEW' THEN visitor_id END) visitors, SUM(CASE WHEN event='PAGE_VIEW' THEN 1 ELSE 0 END) page_views, SUM(CASE WHEN event='CHECKOUT_STARTED' THEN 1 ELSE 0 END) checkout_starts FROM traffic_events GROUP BY substr(created_at,1,10) ORDER BY day DESC LIMIT 60").all(),
    db.prepare("SELECT COUNT(*) paid_orders, COALESCE(SUM(total_paise),0) revenue_paise FROM orders WHERE payment_status='PAID' AND hidden_at IS NULL AND created_at >= '2026-08-10T00:00:00.000Z'").first<any>(),
  ]);
  const filesByOrder = new Map<string, unknown[]>();
  for (const file of files.results as Array<{ id: string; order_id: string; original_name: string; deleted_at: string | null }>) {
    const current = filesByOrder.get(file.order_id) ?? [];
    current.push(file);
    filesByOrder.set(file.order_id, current);
  }
  return NextResponse.json({
    summary,
    pagination: { page, pageSize, total: Number(orderCount?.count) || 0, pages: Math.max(1, Math.ceil((Number(orderCount?.count) || 0) / pageSize)) },
    dailySales: dailySales.results,
    summaryOrders: (summaryOrders.results as Array<{ items_json: string }>).map((order) => {
      let items: unknown[] = [];
      try {
        const parsed = JSON.parse(order.items_json);
        if (Array.isArray(parsed)) items = parsed;
      } catch {}
      return { ...order, items };
    }),
    adminMembers: adminMembers.results,
    revenueOrders: revenueOrders.results,
    activeUsers: activeUsers.results,
    walletUsers: walletUsers.results,
    orders: (orders.results as Array<{ id: string; items_json: string }>).map((order) => {
      let items: unknown[] = [];
      try {
        const parsed = JSON.parse(order.items_json);
        if (Array.isArray(parsed)) items = parsed;
      } catch {}
      return { ...order, items, files: filesByOrder.get(order.id) ?? [] };
    }),
    hiddenOrders: hiddenOrders.results,
    riders: riders.results,
    riderApplications: riderApplications.results,
    locations: locations.results,
    locationStats: locationStats.results,
    riderPayments: riderPayments.results,
    riderWithdrawals: riderWithdrawals.results,
    traffic: { visitors: Number(trafficSummary?.visitors) || 0, pageViews: Number(trafficSummary?.page_views) || 0, checkoutStarts: Number(trafficSummary?.checkout_starts) || 0, paidOrders: Number(launchOrders?.paid_orders) || 0, revenuePaise: Number(launchOrders?.revenue_paise) || 0, daily: trafficDaily.results },
  });
}
