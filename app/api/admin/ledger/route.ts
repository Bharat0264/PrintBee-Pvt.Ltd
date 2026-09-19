import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { database } from "../../db";
import { getViewer } from "../../../supabase/server";

const PASSWORD_HASH = "d37f1766fb8548adf59aaf7d2c2024e2b0c16fcad5b8a875cf2f57a102e6c5a3";
const ACCESS_TOKEN = "eae7e51b12310bb2cc9878dbded316dc96a242d99ec69c51f877f178d0c3307e";
const COOKIE_NAME = "printbee-ledger-access";

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requireLedgerAccess() {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) return false;
  return (await cookies()).get(COOKIE_NAME)?.value === ACCESS_TOKEN;
}

type LedgerValues = {
  orders: number;
  bwPages: number;
  bwRevenuePaise: number;
  bwCostPaise: number;
  colourPages: number;
  colourRevenuePaise: number;
  colourCostPaise: number;
  plagiarismRevenuePaise: number;
  plagiarismOperationalCostPaise: number;
  addonRevenuePaise: number;
  packagingOrders: number;
  amountCollectedPaise: number;
  printingCollectedPaise: number;
  deliveryCollectedPaise: number;
  incampusDeliveryCollectedPaise: number;
  platformCollectedPaise: number;
  packagingCollectedPaise: number;
  gatewayCollectedPaise: number;
  surgeCollectedPaise: number;
  lateNightCollectedPaise: number;
  lateNightPartnerCostPaise: number;
  pointsDiscountPaise: number;
  riderCostPaise: number;
  projectPlatformRevenuePaise: number;
  otherServiceRevenuePaise: number;
  otherServiceOperatingCostPaise: number;
  otherServiceCount: number;
};

function emptyValues(): LedgerValues {
  return { orders: 0, bwPages: 0, bwRevenuePaise: 0, bwCostPaise: 0, colourPages: 0, colourRevenuePaise: 0, colourCostPaise: 0, plagiarismRevenuePaise: 0, plagiarismOperationalCostPaise: 0, addonRevenuePaise: 0, packagingOrders: 0, amountCollectedPaise: 0, printingCollectedPaise: 0, deliveryCollectedPaise: 0, incampusDeliveryCollectedPaise: 0, platformCollectedPaise: 0, packagingCollectedPaise: 0, gatewayCollectedPaise: 0, surgeCollectedPaise: 0, lateNightCollectedPaise: 0, lateNightPartnerCostPaise: 0, pointsDiscountPaise: 0, riderCostPaise: 0, projectPlatformRevenuePaise: 0, otherServiceRevenuePaise: 0, otherServiceOperatingCostPaise: 0, otherServiceCount: 0 };
}

function addItem(values: LedgerValues, item: any) {
  if (item?.serviceId === "turnitin-plagiarism-check") {
    const revenue = Math.round((Number(item?.servicePrice ?? item?.total) || 175) * 100);
    values.plagiarismRevenuePaise += revenue;
    values.plagiarismOperationalCostPaise += 15000;
    return;
  }
  // Binding and any future paid non-printing service are accounted for
  // separately from the page-printing charge. Their fixed operating cost is ₹35.
  const serviceId = String(item?.serviceId ?? "document-printing");
  const otherServiceCharge = Math.round(Number(item?.servicePrice ?? 0) * 100);
  if (serviceId !== "document-printing" && serviceId !== "turnitin-plagiarism-check" && otherServiceCharge > 0) {
    values.otherServiceRevenuePaise += otherServiceCharge;
    values.otherServiceOperatingCostPaise += 3500;
    values.otherServiceCount += 1;
  }
  if (item?.kind === "ADDON") {
    values.addonRevenuePaise += Math.round((Number(item?.total ?? item?.addonsTotal) || 0) * 100);
    return;
  }
  values.addonRevenuePaise += Math.round((Number(item?.addonsTotal) || 0) * 100);
  const pages = Math.max(1, Number(item?.pages) || 1);
  const copies = Math.max(1, Number(item?.copies) || 1);
  const isDouble = String(item?.mode || "").endsWith("double");
  const divisor = isDouble ? 2 : 1;
  const colourPerCopy = item?.colourPageNumbers !== undefined
    ? Math.max(0, Math.min(pages, Number(item?.colourPages) || 0))
    : String(item?.mode || "").startsWith("colour") ? pages : 0;
  const bwPerCopy = pages - colourPerCopy;
  const bwPages = bwPerCopy * copies;
  const colourPages = colourPerCopy * copies;
  const bwUnitPrice = Number(item?.bwUnitPrice ?? (String(item?.mode || "").startsWith("bw") ? item?.unitPrice : 0)) || 0;
  const colourUnitPrice = Number(item?.colourUnitPrice ?? (String(item?.mode || "").startsWith("colour") ? item?.unitPrice : 0)) || 0;
  values.bwPages += bwPages;
  values.colourPages += colourPages;
  values.bwRevenuePaise += Math.round((bwPages / divisor) * bwUnitPrice * 100);
  values.colourRevenuePaise += Math.round((colourPages / divisor) * colourUnitPrice * 100);
  // Double-sided jobs consume one sheet for every two printed pages.
  // Costs are therefore calculated per printed page for single-sided work
  // and per sheet for double-sided work.
  values.bwCostPaise += (bwPages / divisor) * (isDouble ? 80 : 65);
  values.colourCostPaise += (colourPages / divisor) * (isDouble ? 200 : 150);
}

function finish(values: LedgerValues) {
  const bwProfitPaise = values.bwRevenuePaise - values.bwCostPaise;
  const colourProfitPaise = values.colourRevenuePaise - values.colourCostPaise;
  const printingRevenuePaise = Math.max(0, values.printingCollectedPaise - values.plagiarismRevenuePaise - values.otherServiceRevenuePaise - values.addonRevenuePaise);
  const plagiarismProfitPaise = values.plagiarismRevenuePaise - values.plagiarismOperationalCostPaise;
  const ramyaOtherServiceProfitPaise = values.otherServiceRevenuePaise - values.otherServiceOperatingCostPaise;
  // Keep the established service-revenue calculation intact; ₹25 per paid
  // plagiarism report is an additional Bharat profit allocation.
  const serviceRevenuePaise = values.printingCollectedPaise - printingRevenuePaise - values.addonRevenuePaise;
  // Rewards redeemed against an order are a printing cost, so they reduce
  // printing profit and are included in the total operating cost.
  const printingOperationalCostPaise = values.bwCostPaise + values.colourCostPaise + values.pointsDiscountPaise;
  const printingProfitPaise = printingRevenuePaise - printingOperationalCostPaise;
  const deliveryProfitPaise = values.deliveryCollectedPaise - (values.riderCostPaise - values.incampusDeliveryCollectedPaise);
  const packagingProfitPaise = Math.min(values.packagingCollectedPaise, values.packagingOrders * 170);
  const packagingCostPaise = values.packagingCollectedPaise - packagingProfitPaise;
  const operationalCostPaise = printingOperationalCostPaise + values.plagiarismOperationalCostPaise + values.otherServiceOperatingCostPaise + values.riderCostPaise + values.lateNightPartnerCostPaise + packagingCostPaise + values.gatewayCollectedPaise;
  const netProfitPaise = values.amountCollectedPaise + values.projectPlatformRevenuePaise - operationalCostPaise;
  // Ramya shares only the profit earned from printing. All other revenue belongs to Bharat.
  const ramyaPrintingProfitPaise = Math.round(printingProfitPaise * 0.65);
  const bharatPrintingProfitPaise = printingProfitPaise - ramyaPrintingProfitPaise;
  // Delivery profit is exactly the 25% retained after the delivery partner receives 75%.
  // Allocate every non-printing result from reconciled net profit. This keeps
  // the Bharat/Ramya share tally correct when a points discount is recorded
  // as a printing operating cost and the collected total is already net of it.
  const bharatOtherProfitPaise = netProfitPaise - printingProfitPaise - ramyaOtherServiceProfitPaise;
  const bharatTotalProfitPaise = bharatPrintingProfitPaise + bharatOtherProfitPaise;
  const ramyaTotalProfitPaise = ramyaPrintingProfitPaise + ramyaOtherServiceProfitPaise;
  return { ...values, bwProfitPaise, colourProfitPaise, printingRevenuePaise, plagiarismProfitPaise, serviceRevenuePaise, otherServiceProfitPaise: ramyaOtherServiceProfitPaise, printingOperationalCostPaise, printingProfitPaise, addonProfitPaise: values.addonRevenuePaise, deliveryProfitPaise, lateNightOwnerProfitPaise: values.lateNightCollectedPaise - values.lateNightPartnerCostPaise, packagingCostPaise, packagingProfitPaise, operationalCostPaise, netProfitPaise, ownerPrintingProfitPaise: bharatPrintingProfitPaise, ownerOtherProfitPaise: bharatOtherProfitPaise, operatorPrintingProfitPaise: ramyaPrintingProfitPaise, ownerTotalProfitPaise: bharatTotalProfitPaise, operatorTotalProfitPaise: ramyaTotalProfitPaise, shareTallyPaise: bharatTotalProfitPaise + ramyaTotalProfitPaise };
}

function addValues(target: LedgerValues, source: LedgerValues) {
  for (const key of Object.keys(target) as Array<keyof LedgerValues>) target[key] += source[key];
}

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const { password } = await request.json() as { password?: string };
  if (await sha256(password || "") !== PASSWORD_HASH) return NextResponse.json({ error: "Incorrect ledger password" }, { status: 401 });
  const response = NextResponse.json({ authorized: true });
  response.cookies.set(COOKIE_NAME, ACCESS_TOKEN, { httpOnly: true, secure: true, sameSite: "strict", path: "/" });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authorized: false });
  response.cookies.set(COOKIE_NAME, "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}

export async function GET() {
  if (!(await requireLedgerAccess())) return NextResponse.json({ error: "Ledger password required" }, { status: 401 });
  const franchiseSummary = await database().prepare("SELECT COALESCE(franchise_store_name,'Unassigned') name, franchise_store_id store_id, COUNT(*) orders, COALESCE(SUM(total_paise),0) revenue_paise, CAST(COALESCE(SUM(total_paise),0) * 0.125 AS INTEGER) admin_revenue_paise, CAST(COALESCE(SUM(total_paise),0) * 0.875 AS INTEGER) franchise_revenue_paise FROM orders WHERE payment_status='PAID' AND hidden_at IS NULL AND franchise_store_id IS NOT NULL GROUP BY franchise_store_id, franchise_store_name ORDER BY revenue_paise DESC").all<any>();
  const result = await database().prepare(`SELECT order_number,customer_name,mobile_number,customer_email,location_name,items_json,printing_subtotal_paise,delivery_fee_paise,incampus_fee_paise,platform_fee_paise,packaging_fee_paise,payment_gateway_fee_paise,surge_fee_paise,late_night_fee_paise,points_discount_paise,total_paise,status,created_at FROM orders WHERE payment_status='PAID' AND hidden_at IS NULL ORDER BY created_at DESC`).all<any>();
  const days = new Map<string, LedgerValues>();
  const totals = emptyValues();
  const orderBreakdowns: any[] = [];
  for (const order of result.results) {
    const day = String(order.created_at).slice(0, 10);
    const daily = days.get(day) ?? emptyValues();
    const values = emptyValues();
    values.orders = 1;
    values.amountCollectedPaise = Number(order.total_paise) || 0;
    values.printingCollectedPaise = Number(order.printing_subtotal_paise) || 0;
    values.deliveryCollectedPaise = Number(order.delivery_fee_paise) || 0;
    values.incampusDeliveryCollectedPaise = Number(order.incampus_fee_paise) || 0;
    values.platformCollectedPaise = Number(order.platform_fee_paise) || 0;
    values.packagingCollectedPaise = Number(order.packaging_fee_paise) || 0;
    values.packagingOrders = values.packagingCollectedPaise > 0 ? 1 : 0;
    values.gatewayCollectedPaise = Number(order.payment_gateway_fee_paise) || 0;
    values.surgeCollectedPaise = Number(order.surge_fee_paise) || 0;
    values.lateNightCollectedPaise = Number(order.late_night_fee_paise) || 0;
    values.lateNightPartnerCostPaise = Math.floor(values.lateNightCollectedPaise * 0.6);
    values.pointsDiscountPaise = Number(order.points_discount_paise) || 0;
    values.riderCostPaise = Math.floor(values.deliveryCollectedPaise * 0.75) + values.incampusDeliveryCollectedPaise;
    let items: any[] = [];
    try { const parsed = JSON.parse(order.items_json || "[]"); if (Array.isArray(parsed)) items = parsed; } catch {}
    for (const item of items) addItem(values, item);
    addValues(daily, values);
    addValues(totals, values);
    days.set(day, daily);
    orderBreakdowns.push({ ...order, ...finish(values) });
  }
  const projectRevenue = await database().prepare("SELECT substr(paid_at,1,10) day,COALESCE(SUM(platform_fee_paise),0) revenue FROM project_orders WHERE payment_status='PAID' GROUP BY substr(paid_at,1,10)").all<any>();
  for (const row of projectRevenue.results) { const daily=days.get(String(row.day))??emptyValues(); daily.projectPlatformRevenuePaise+=Number(row.revenue)||0; totals.projectPlatformRevenuePaise+=Number(row.revenue)||0; days.set(String(row.day),daily); }
  return NextResponse.json({
    totals: finish(totals),
    daily: Array.from(days, ([date, values]) => ({ date, ...finish(values) })).sort((a, b) => b.date.localeCompare(a.date)),
    orders: orderBreakdowns.map(({ items_json, ...order }) => order),
    franchises: franchiseSummary.results,
    franchiseAdminRevenuePaise: (franchiseSummary.results as any[]).reduce((sum, store) => sum + Number(store.admin_revenue_paise || 0), 0),
  });
}
