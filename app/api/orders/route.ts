import { NextResponse } from "next/server";
import { database, encryptDeliveryCode, hashDeliveryCode } from "../db";
import { getViewer } from "../../supabase/server";
import { cleanupAbandonedCheckouts } from "../maintenance";
import { calculateDeliveryFeePaise, calculateDistanceMeters, MAX_DELIVERY_DISTANCE_METERS, readCoordinates } from "../delivery/fees";

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  await cleanupAbandonedCheckouts();
  const availability = await database().prepare("SELECT accepting_orders FROM order_availability WHERE id='main'").first<{ accepting_orders: number }>();
  if (availability?.accepting_orders === 0) return NextResponse.json({ error: "Service will be live soon. We are not accepting orders right now." }, { status: 503 });
  const body = await request.json() as { customerName?: string; mobileNumber?: string; deliveryAddress?: string; deliveryLandmark?: string; incampusDelivery?: boolean; incampusType?: "CLASSROOM" | "HOSTEL"; campusBuilding?: string; classroomNumber?: string; items?: unknown[]; totalPaise?: number; usePoints?: boolean; needsPackaging?: boolean; latitude?: unknown; longitude?: unknown; accuracy?: unknown };
  const plagiarismItems = Array.isArray(body.items) ? body.items.filter((item: any) => item?.serviceId === "turnitin-plagiarism-check") : [];
  const plagiarismOnly = Array.isArray(body.items) && body.items.length > 0 && plagiarismItems.length === body.items.length;
  if (plagiarismItems.length && !plagiarismOnly) return NextResponse.json({ error: "Complete plagiarism-report PDFs in a separate checkout from printing items." }, { status: 400 });
  const name = body.customerName?.trim();
  const mobile = body.mobileNumber?.replace(/\D/g, "");
  const deliveryAddress = body.deliveryAddress?.trim();
  const deliveryLandmark = body.deliveryLandmark?.trim() || null;
  const incampusDelivery = body.incampusDelivery === true;
  const incampusType = body.incampusType === "HOSTEL" ? "HOSTEL" : "CLASSROOM";
  const campusBuilding = body.campusBuilding?.trim() || null;
  const classroomNumber = body.classroomNumber?.trim() || null;
  if (!name || !mobile || mobile.length !== 10 || (!plagiarismOnly && (!deliveryAddress || deliveryAddress.length > 500)) || !body.items?.length) {
    return NextResponse.json({ error: "Name, 10-digit mobile, delivery address and cart items are required" }, { status: 400 });
  }
  if (incampusDelivery && (!campusBuilding || campusBuilding.length > 160 || (incampusType === "CLASSROOM" && (!classroomNumber || classroomNumber.length > 80)))) return NextResponse.json({ error: incampusType === "CLASSROOM" ? "Enter the classroom number and building name" : "Enter the hostel building name" }, { status: 400 });
  const customerLocation = plagiarismOnly ? { latitude: 0, longitude: 0 } : readCoordinates(body);
  if (!customerLocation) return NextResponse.json({ error: "Use your current location before checkout" }, { status: 400 });
  const stores = plagiarismOnly ? [] : (await database().prepare("SELECT s.id,s.name,s.latitude,s.longitude,s.radius_meters,fs.platform_fee_paise,fs.delivery_base_fee_paise,fs.delivery_fee_per_100m_paise FROM franchise_stores s LEFT JOIN franchise_settings fs ON fs.store_id=s.id WHERE s.active=1").all<any>()).results;
  const selectedStoreId = typeof body.selectedStoreId === "string" ? body.selectedStoreId : "";
  const selectedMainStore = selectedStoreId === "main";
  const requestedStore = selectedStoreId ? stores.find((store: any) => store.id === selectedStoreId) : null;
  if (selectedStoreId && !requestedStore && !selectedMainStore) return NextResponse.json({ error: "Please select an available PrintBee store" }, { status: 400 });
  const nearbyStores = !plagiarismOnly ? stores.map((store: any) => ({ ...store, distance: calculateDistanceMeters({ latitude: Number(store.latitude), longitude: Number(store.longitude) }, customerLocation!) })).filter((store: any) => store.distance <= Number(store.radius_meters || 5000)).sort((a: any, b: any) => a.distance - b.distance) : [];
  const nearest = selectedMainStore ? null : (requestedStore ? nearbyStores.find((store: any) => store.id === requestedStore.id) : nearbyStores[0]);
  if (requestedStore && !nearest) return NextResponse.json({ error: "This selected store does not serve your current delivery address. Choose a store within 5 km." }, { status: 422 });
  const legacyStore = !plagiarismOnly && !nearest ? await database().prepare("SELECT latitude,longitude FROM store_location WHERE id='main'").first<{ latitude: number; longitude: number }>() : null;
  if (selectedMainStore && legacyStore && calculateDistanceMeters({ latitude: Number(legacyStore.latitude), longitude: Number(legacyStore.longitude) }, customerLocation) > MAX_DELIVERY_DISTANCE_METERS) return NextResponse.json({ error: "This selected store does not serve your current delivery address. Choose a store within 4 km." }, { status: 422 });
  const storeLocation = nearest ? { latitude: Number(nearest.latitude), longitude: Number(nearest.longitude) } : readCoordinates(legacyStore);
  if (!storeLocation && !plagiarismOnly) return NextResponse.json({ error: stores.length ? "No PrintBee franchise currently serves this address. Delivery is available within 5 km of a registered store." : "Delivery is temporarily unavailable" }, { status: 422 });
  const id = crypto.randomUUID();
  const code = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const deliveryCode = code.toString().padStart(6, "0");
  const printingSubtotalPaise = plagiarismOnly ? body.items!.length * 17_500 : Math.max(0, Math.round(Number(body.totalPaise) || 0));
  const deliveryDistanceMeters = plagiarismOnly ? 0 : Math.round(calculateDistanceMeters(storeLocation!, customerLocation));
  if (!plagiarismOnly && !nearest && deliveryDistanceMeters > MAX_DELIVERY_DISTANCE_METERS) return NextResponse.json({ error: "We are unable to deliver to this location. Delivery is available within 4 km of the store." }, { status: 422 });
  const deliveryAccuracy = typeof body.accuracy === "number" && Number.isFinite(body.accuracy) && body.accuracy >= 0 ? body.accuracy : null;
  const uploadIds = body.items.filter((item: any) => item.kind !== "ADDON").map((item: any) => item.uploadId).filter(Boolean);
  if (uploadIds.length !== body.items.filter((item: any) => item.kind !== "ADDON").length) return NextResponse.json({ error: "Every print item must finish uploading" }, { status: 400 });
  const plagiarismUploadIds = new Set<string>();
  for (const item of body.items as Array<{ kind?: string; addonId?: string; uploadId?: string; copies?: number; serviceId?: string }>) {
    if (item.kind === "ADDON") {
      const addon = await database().prepare("SELECT id FROM addons WHERE id=? AND active=1").bind(item.addonId).first<{ id: string }>();
      if (!addon) return NextResponse.json({ error: "One or more selected add-ons are unavailable" }, { status: 400 });
      continue;
    }
    const upload = await database().prepare("SELECT id, page_count, original_name, content_type FROM uploads WHERE id=? AND customer_email=? AND order_id IS NULL").bind(item.uploadId, viewer.email).first<{ id: string; page_count: number; original_name: string; content_type: string }>();
    if (!upload) return NextResponse.json({ error: "One or more uploaded files are unavailable" }, { status: 400 });
    const service = await database().prepare("SELECT id FROM print_services WHERE id=? AND active=1").bind(item.serviceId || "document-printing").first<{ id: string }>();
    if (!service) return NextResponse.json({ error: "One or more selected services are unavailable" }, { status: 400 });
    if (plagiarismOnly) {
      if (item.kind === "ADDON" || item.copies !== 1 || !String(upload.original_name).toLowerCase().endsWith(".pdf") || (upload.content_type && upload.content_type !== "application/pdf")) return NextResponse.json({ error: "Each plagiarism-report cart item must be one PDF file." }, { status: 400 });
      if (plagiarismUploadIds.has(String(item.uploadId))) return NextResponse.json({ error: "Add each PDF only once to the plagiarism cart." }, { status: 400 });
      plagiarismUploadIds.add(String(item.uploadId));
      Object.assign(item, { copies: 1, servicePrice: 175, total: 175, addons: [], addonsTotal: 0 });
    }
  }
  const feeSettings = await database().prepare("SELECT gateway_enabled,gateway_fee_percent,surge_enabled,surge_type,surge_value,late_night_enabled,late_night_type,late_night_value,platform_fee_paise,delivery_base_fee_paise,delivery_fee_per_100m_paise,packaging_enabled,packaging_fee_paise FROM checkout_fee_settings WHERE id='main'").first<any>();
  const storedPlatformFee = Number(nearest ? 150 : feeSettings?.platform_fee_paise);
  const platformFeePaise = plagiarismOnly ? 0 : Number.isFinite(storedPlatformFee) ? Math.max(0, storedPlatformFee) : 150;
  const baseDeliveryFeePaise = Number(nearest?.delivery_base_fee_paise ?? feeSettings?.delivery_base_fee_paise);
  const deliveryFeePer100MetersPaise = Number(nearest?.delivery_fee_per_100m_paise ?? feeSettings?.delivery_fee_per_100m_paise);
  const deliveryFeePaise = plagiarismOnly ? 0 : calculateDeliveryFeePaise(deliveryDistanceMeters, Number.isFinite(baseDeliveryFeePaise) ? baseDeliveryFeePaise : 1000, Number.isFinite(deliveryFeePer100MetersPaise) ? deliveryFeePer100MetersPaise : 100);
  const incampusFeePaise = plagiarismOnly ? 0 : incampusDelivery ? 1000 : 0;
  const packagingFeePaise = !plagiarismOnly && body.needsPackaging && feeSettings?.packaging_enabled ? Math.max(0, Number(feeSettings.packaging_fee_paise) || 0) : 0;
  const feeBasePaise = printingSubtotalPaise + deliveryFeePaise + incampusFeePaise + platformFeePaise;
  const surgeFeePaise = !plagiarismOnly && feeSettings?.surge_enabled ? feeSettings.surge_type === "FIXED" ? Math.round(Number(feeSettings.surge_value) * 100) : Math.round(feeBasePaise * Number(feeSettings.surge_value) / 100) : 0;
  const lateNightFeePaise = !plagiarismOnly && feeSettings?.late_night_enabled ? feeSettings.late_night_type === "FIXED" ? Math.round(Number(feeSettings.late_night_value) * 100) : Math.round(feeBasePaise * Number(feeSettings.late_night_value) / 100) : 0;
  const paymentGatewayFeePaise = plagiarismOnly ? Math.round(printingSubtotalPaise * 2.36 / 100) : feeSettings?.gateway_enabled ? Math.round(feeBasePaise * Math.max(0, Number(feeSettings.gateway_fee_percent) || 0) / 100) : 0;
  const grossTotalPaise = feeBasePaise + packagingFeePaise + surgeFeePaise + lateNightFeePaise + paymentGatewayFeePaise;
  const profile = await database().prepare("SELECT points_balance FROM customer_profiles WHERE email=?").bind(viewer.email).first<{ points_balance: number }>();
  const maxRedeemablePoints = Math.max(0, Math.floor((grossTotalPaise - 100) * 15 / 100));
  const pointsRedeemed = body.usePoints ? Math.min(profile?.points_balance ?? 0, maxRedeemablePoints) : 0;
  const pointsDiscountPaise = Math.floor(pointsRedeemed * 100 / 15);
  const totalPaise = grossTotalPaise - pointsDiscountPaise;
  const hash = await hashDeliveryCode(id, deliveryCode);
  const encryptedCode = await encryptDeliveryCode(deliveryCode);
  const db = database();
  const existing = await db.prepare("SELECT id,order_number,location_name,total_paise,late_night_fee_paise,points_redeemed,points_discount_paise FROM orders WHERE customer_email=? AND payment_status='PENDING' AND status='PAYMENT_PENDING' AND location_id=? AND items_json=? AND total_paise=? ORDER BY created_at DESC LIMIT 1")
    .bind(viewer.email, nearest?.id ?? "CURRENT_GPS", JSON.stringify(body.items), totalPaise).first<any>();
  if (existing) return NextResponse.json({ id: existing.id, orderNumber: null, locationName: existing.location_name, totalPaise: existing.total_paise, lateNightFeePaise: existing.late_night_fee_paise, pointsRedeemed: existing.points_redeemed, pointsDiscountPaise: existing.points_discount_paise, paymentMode: "RAZORPAY" });
  const orderNumber = `CHECKOUT-${id}`;
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO orders (id, order_number, customer_email, customer_name, mobile_number, location_id, location_name, items_json, printing_subtotal_paise, delivery_fee_paise, delivery_latitude, delivery_longitude, delivery_accuracy, delivery_address, delivery_landmark, delivery_captured_at, delivery_distance_meters, store_latitude, store_longitude, platform_fee_paise, packaging_fee_paise, payment_gateway_fee_paise, surge_fee_paise, late_night_fee_paise, incampus_delivery, incampus_type, campus_building, classroom_number, incampus_fee_paise, points_redeemed, points_discount_paise, total_paise, delivery_code_hash, delivery_code_encrypted, status, payment_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAYMENT_PENDING', 'PENDING', ?)`)
    .bind(id, orderNumber, viewer.email, name, mobile, "CURRENT_GPS", incampusDelivery ? `In-campus ${incampusType === "CLASSROOM" ? "classroom" : "hostel"}: ${campusBuilding}${classroomNumber ? ` · Room ${classroomNumber}` : ""}` : deliveryAddress, JSON.stringify(body.items), printingSubtotalPaise, deliveryFeePaise, customerLocation.latitude, customerLocation.longitude, deliveryAccuracy, deliveryAddress, deliveryLandmark, now, deliveryDistanceMeters, storeLocation?.latitude ?? 0, storeLocation?.longitude ?? 0, platformFeePaise, packagingFeePaise, paymentGatewayFeePaise, surgeFeePaise, lateNightFeePaise, incampusDelivery ? 1 : 0, incampusDelivery ? incampusType : null, campusBuilding, classroomNumber, incampusFeePaise, pointsRedeemed, pointsDiscountPaise, totalPaise, hash, encryptedCode, now)
    .run();
  if (nearest) await db.prepare("UPDATE orders SET franchise_store_id=?, franchise_store_name=?, location_id=? WHERE id=?").bind(nearest.id, nearest.name, nearest.id, id).run();
  return NextResponse.json({ id, orderNumber: null, locationName: incampusDelivery ? `In-campus ${incampusType === "CLASSROOM" ? "classroom" : "hostel"}: ${campusBuilding}${classroomNumber ? ` · Room ${classroomNumber}` : ""}` : deliveryAddress, totalPaise, lateNightFeePaise, pointsRedeemed, pointsDiscountPaise, paymentMode: "RAZORPAY" });
}
