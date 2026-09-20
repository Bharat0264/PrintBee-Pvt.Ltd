"use client";

import { AnimatedCounter, CheckoutProgress, GlassPresence, GlassNav, LoadingAnimation, SuccessAnimation, animateCartRemoval } from "./components/LiquidGlass";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { BeeMascot, DocumentPreview, MobileNavigation, DialogAccessibility } from "./components/PrintBeeExperience";
import { ActiveOrderWidget, ActiveOrderLinks, OrderDocuments, OrderJourney, OTPCard } from "./components/ActiveOrderWidget";
import { useCustomerOrders } from "./components/useCustomerOrders";
import { formatFileSize } from "./components/order-model";
import { CustomerMotion, customerFeedback, AnimatedPrice, StudioLauncher } from "./components/CustomerMotion";
import { loadRazorpayCheckout } from "./components/razorpay-checkout";
import { PrintJourney, PrinterScene, ProjectPortals, PaymentCelebration } from "./components/cinematic/PrintJourney";

type PrintMode = "bw-single" | "bw-double" | "colour-single" | "colour-double";
type Prices = Record<PrintMode, number>;

const defaultPrices: Prices = {
  "bw-single": 2,
  "bw-double": 3,
  "colour-single": 8,
  "colour-double": 14,
};

const options: Array<{ id: PrintMode; title: string; note: string; icon: string }> = [
  { id: "bw-single", title: "B&W · Single side", note: "One printed side per A4 sheet", icon: "◐" },
  { id: "bw-double", title: "B&W · Double side", note: "Two printed pages per A4 sheet", icon: "◐" },
  { id: "colour-single", title: "Colour · Single side", note: "Full colour on one side", icon: "●" },
  { id: "colour-double", title: "Colour · Double side", note: "Full colour on both sides", icon: "●" },
];

function printModeLabel(mode?: string) {
  return `${mode?.startsWith("colour") ? "Colour" : "B&W"} · ${mode?.endsWith("double") ? "Double side" : "Single side"}`;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const HOSTED_IMAGE_TARGET_BYTES = 700 * 1024;
const CHUNKED_UPLOAD_THRESHOLD_BYTES = 700 * 1024;
const IMAGE_EXTENSIONS = /\.(heic|jpe?g|png|webp)$/i;
const OPTIMIZABLE_IMAGE_EXTENSIONS = /\.(jpe?g|png)$/i;
const PRINTABLE_FILE_EXTENSIONS = /\.(pdf|heic|jpe?g|png|webp)$/i;
const MIXED_PRINT_SERVICES = new Set([
  "document-printing",
  "document-binding",
  // Soft Binding Blue Sheet SRM
  "70d778dc-2d81-4302-a383-2d53724616e3",
]);
const PLAGIARISM_SERVICE_ID = "turnitin-plagiarism-check";
const PLAGIARISM_PRICE = 175;
const PLAGIARISM_GATEWAY_PERCENT = 2.36;
const GEN_Z_MEMES = [
  "POV: You skipped the Xerox queue and chose peace. 😌",
  "Your assignment is printing itself. Main-character logistics. ✨",
  "Queue for printouts? Bestie, we have delivery now. 🛵",
  "Scan. Relax. Let PrintBee carry the academic comeback. 🐝",
  "No cash hunt, no queue arc — just upload and vibe. 📄",
  "Deadline approaching? Stay calm; the bee is on the way. 🚀",
];

function parsePageNumbers(value: string, totalPages: number) {
  const pageNumbers = new Set<number>();
  const invalid: string[] = [];
  for (const part of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) { invalid.push(part); continue; }
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > totalPages) { invalid.push(part); continue; }
    for (let page = start; page <= end; page += 1) pageNumbers.add(page);
  }
  return { count: pageNumbers.size, invalid, pages: [...pageNumbers].sort((a, b) => a - b) };
}

function formatPageRanges(pageNumbers: number[]) {
  if (!pageNumbers.length) return "NA";
  const ranges: string[] = [];
  let start = pageNumbers[0];
  let end = start;
  for (const page of pageNumbers.slice(1)) {
    if (page === end + 1) { end = page; continue; }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    start = page;
    end = page;
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return ranges.join(", ");
}

async function optimizeImageForUpload(file: File) {
  if (!OPTIMIZABLE_IMAGE_EXTENSIONS.test(file.name) || file.size <= HOSTED_IMAGE_TARGET_BYTES) return file;
  const bitmap = await createImageBitmap(file);
  try {
    const maxSide = 5000;
    const initialScale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    let width = Math.max(1, Math.round(bitmap.width * initialScale));
    let height = Math.max(1, Math.round(bitmap.height * initialScale));
    let blob: Blob | null = null;
    for (const quality of [0.92, 0.84, 0.76, 0.68]) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This image could not be prepared for upload.");
      context.drawImage(bitmap, 0, 0, width, height);
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
      if (blob && blob.size <= HOSTED_IMAGE_TARGET_BYTES) break;
      width = Math.max(1, Math.round(width * 0.82));
      height = Math.max(1, Math.round(height * 0.82));
    }
    if (!blob) throw new Error("This image could not be prepared for upload.");
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp", lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}

async function fetchUpload(input: RequestInfo | URL, init: RequestInit, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(input, { ...init, signal: AbortSignal.timeout(60_000) });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function uploadPrintableFile(file: File, pageCount: number, onProgress?: (percent: number) => void) {
  if (file.size <= CHUNKED_UPLOAD_THRESHOLD_BYTES) {
    const form = new FormData();
    form.append("file", file);
    form.append("pageCount", String(pageCount));
    const response = await fetchUpload("/api/uploads", { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.uploadId) throw new Error(data.error ?? "Document upload failed. Please try again.");
    return data;
  }

  const details = { fileName: file.name, fileSize: file.size, pageCount, contentType: file.type };
  const initResponse = await fetchUpload("/api/uploads/chunked?action=init", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(details) });
  const init = await initResponse.json().catch(() => ({}));
  if (!initResponse.ok || !init.sessionId || !init.uploadId || !init.chunkSize) throw new Error(init.error ?? "Document upload could not start. Please try again.");
  const chunkCount = Math.ceil(file.size / init.chunkSize);
  let uploadedChunks = 0;
  const uploadedParts: Array<{ partNumber: number; etag: string }> = [];
  const uploadChunk = async (index: number) => {
    const chunk = file.slice(index * init.chunkSize, Math.min(file.size, (index + 1) * init.chunkSize));
    const partResponse = await fetchUpload(`/api/uploads/chunked?action=part&sessionId=${encodeURIComponent(init.sessionId)}&uploadId=${encodeURIComponent(init.uploadId)}&fileName=${encodeURIComponent(file.name)}&index=${index}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: chunk });
    const part = await partResponse.json().catch(() => ({}));
    if (!partResponse.ok) {
      throw new Error(part.error ?? `Upload stopped at part ${index + 1}. Please try again.`);
    }
    if (!part.partNumber || !part.etag) throw new Error(`Upload part ${index + 1} could not be verified. Please try again.`);
    uploadedParts[index] = { partNumber: part.partNumber, etag: part.etag };
    uploadedChunks += 1;
    onProgress?.(Math.round((uploadedChunks / chunkCount) * 100));
  };
  for (let start = 0; start < chunkCount; start += 4) {
    await Promise.all(Array.from({ length: Math.min(4, chunkCount - start) }, (_, offset) => uploadChunk(start + offset)));
  }
  const completeResponse = await fetchUpload("/api/uploads/chunked?action=complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...details, sessionId: init.sessionId, uploadId: init.uploadId, parts: uploadedParts }) });
  const completed = await completeResponse.json().catch(() => ({}));
  if (!completeResponse.ok || !completed.uploadId) throw new Error(completed.error ?? "Document upload could not be completed. Please try again.");
  return completed;
}

type Viewer = { email: string; isAdmin: boolean; isFranchise?: boolean } | null;

declare global {
  interface Window { google?: { accounts: { id: { initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void; renderButton: (element: HTMLElement, options: Record<string, unknown>) => void } } } }
}
const GOOGLE_CLIENT_ID = "365409440317-vn99jp0h6jd5suom0gppbjoubvs8sqio.apps.googleusercontent.com";
type LocationOption = { id: string; name: string; delivery_fee_paise?: number; platform_fee_paise?: number };
type StoreChoice = { id: string; name: string; radius_meters: number };
type PrintService = { id: string; name: string; description: string; active: number; is_binding: number; price_paise: number; counts_for_packaging: number };
type Addon = { id: string; name: string; description: string; active: number; price_paise: number };
type RazorpayResult = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type ColourChoice = "" | "bw" | "colour" | "mixed";

function printSummary(items: any[] = []) {
  const totals = { bwSingle: 0, bwDouble: 0, colourSingle: 0, colourDouble: 0 };
  for (const item of items) {
    if (item.kind === "ADDON") continue;
    const pages = Math.max(1, Number(item.pages) || 1) * Math.max(1, Number(item.copies) || 1);
    const colourPages = Math.max(0, Math.min(Number(item.pages) || 1, Number(item.colourPages) || 0)) * Math.max(1, Number(item.copies) || 1);
    if (item.colourPageNumbers !== undefined) {
      if (item.mode?.endsWith("double")) { totals.bwDouble += pages - colourPages; totals.colourDouble += colourPages; }
      else { totals.bwSingle += pages - colourPages; totals.colourSingle += colourPages; }
      continue;
    }
    if (item.mode === "bw-single") totals.bwSingle += pages;
    if (item.mode === "bw-double") totals.bwDouble += pages;
    if (item.mode === "colour-single") totals.colourSingle += pages;
    if (item.mode === "colour-double") totals.colourDouble += pages;
  }
  return totals;
}

function revenueSummary(orders: any[] = [], fallbackPrices: Prices) {
  const totals = { colourPrints: 0, colourPages: 0, colourAmount: 0, bwPrints: 0, bwPages: 0, bwAmount: 0, delivery: 0, packaging: 0, platform: 0 };
  for (const order of orders) {
    totals.delivery += Number(order.delivery_fee_paise) || 0;
    totals.packaging += Number(order.packaging_fee_paise) || 0;
    totals.platform += Number(order.platform_fee_paise) || 0;
    for (const item of order.items ?? []) {
      if (item.kind === "ADDON") continue;
      const documentPages = Math.max(1, Number(item.pages) || 1);
      const copies = Math.max(1, Number(item.copies) || 1);
      const priceDivisor = item.mode?.endsWith("double") ? 2 : 1;
      const colourPerCopy = item.colourPageNumbers !== undefined ? Math.max(0, Math.min(documentPages, Number(item.colourPages) || 0)) : item.mode?.startsWith("colour") ? documentPages : 0;
      const bwPerCopy = documentPages - colourPerCopy;
      if (colourPerCopy > 0) totals.colourPrints += copies;
      if (bwPerCopy > 0) totals.bwPrints += copies;
      totals.colourPages += colourPerCopy * copies;
      totals.bwPages += bwPerCopy * copies;
      totals.colourAmount += (colourPerCopy / priceDivisor) * copies * Number(item.colourUnitPrice ?? (item.mode?.startsWith("colour") ? item.unitPrice : fallbackPrices[`colour-${priceDivisor === 2 ? "double" : "single"}`]));
      totals.bwAmount += (bwPerCopy / priceDivisor) * copies * Number(item.bwUnitPrice ?? (item.mode?.startsWith("bw") && item.colourPageNumbers === undefined ? item.unitPrice : fallbackPrices[`bw-${priceDivisor === 2 ? "double" : "single"}`]));
    }
  }
  return totals;
}

function downloadLedgerCsv(ledger: any) {
  const safeCell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rupees = (paise: unknown) => (Number(paise) / 100).toFixed(2);
  const ledgerHeaders = ["Date / order", "Orders", "Collected (INR)", "Printing revenue", "Printing operational cost", "Points discount (printing cost)", "Printing profit", "Plagiarism revenue", "Plagiarism operating cost", "Plagiarism profit", "Other printing-service revenue", "Other printing-service operating cost", "Operator other printing-service profit", "Add-ons revenue", "Delivery collected", "In-campus delivery", "Delivery partner fee", "Owner delivery profit (25%)", "Platform fee", "Packing revenue", "Packing cost", "Packing profit", "Payment gateway operating cost", "Surcharge", "Late-night delivery fee", "Late-night partner payment (60%)", "Late-night owner profit (40%)", "Total operational cost", "Total profit", "Owner (Bharat) 35% printing profit", "Owner (Bharat) other profit", "Owner (Bharat) total", "Operator (Ramya) 65% printing profit", "Operator (Ramya) other printing-service profit", "Operator (Ramya) total", "Share tally"];
  const ledgerRow = (row: any, label: string) => [label, row.orders, rupees(row.amountCollectedPaise), rupees(row.printingRevenuePaise), rupees(row.printingOperationalCostPaise), rupees(row.pointsDiscountPaise), rupees(row.printingProfitPaise), rupees(row.plagiarismRevenuePaise), rupees(row.plagiarismOperationalCostPaise), rupees(row.plagiarismProfitPaise), rupees(row.otherServiceRevenuePaise), rupees(row.otherServiceOperatingCostPaise), rupees(row.otherServiceProfitPaise), rupees(row.addonRevenuePaise), rupees(row.deliveryCollectedPaise), rupees(row.incampusDeliveryCollectedPaise), rupees(row.riderCostPaise), rupees(row.deliveryProfitPaise), rupees(row.platformCollectedPaise), rupees(row.packagingCollectedPaise), rupees(row.packagingCostPaise), rupees(row.packagingProfitPaise), rupees(row.gatewayCollectedPaise), rupees(row.surgeCollectedPaise), rupees(row.lateNightCollectedPaise), rupees(row.lateNightPartnerCostPaise), rupees(row.lateNightOwnerProfitPaise), rupees(row.operationalCostPaise), rupees(row.netProfitPaise), rupees(row.ownerPrintingProfitPaise), rupees(row.ownerOtherProfitPaise), rupees(row.ownerTotalProfitPaise), rupees(row.operatorPrintingProfitPaise), rupees(row.otherServiceProfitPaise), rupees(row.operatorTotalProfitPaise), rupees(row.shareTallyPaise)];
  const rows: unknown[][] = [
    ["PrintBee ledger — all paid orders through", new Date().toLocaleString("en-IN")],
    [],
    ledgerHeaders,
    ...ledger.daily.map((row: any) => ledgerRow(row, row.date)),
    ledgerRow(ledger.totals, "GRAND TOTAL"),
    [],
    ["ORDER-BY-ORDER FINANCIAL BREAKDOWN"],
    ledgerHeaders,
    ...ledger.orders.map((order: any) => ledgerRow(order, order.order_number)),
    [],
    ["ORDER DATA"],
    ["Order number", "Name", "Mobile number", "Order value (INR)", "Date and time", "Email", "Location", "Status"],
    ...ledger.orders.map((order: any) => [order.order_number, order.customer_name, order.mobile_number, rupees(order.total_paise), new Date(order.created_at).toLocaleString("en-IN"), order.customer_email, order.location_name, String(order.status).replaceAll("_", " ")]),
  ];
  const blob = new Blob(["\uFEFF", rows.map((row) => row.map(safeCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `printbee-ledger-through-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const ledgerFinancialColumns = [
  ["Collected", "amountCollectedPaise"], ["Printing revenue", "printingRevenuePaise"], ["Printing op. cost", "printingOperationalCostPaise"], ["Points discount (printing cost)", "pointsDiscountPaise"], ["Printing profit", "printingProfitPaise"],
  ["Plagiarism revenue", "plagiarismRevenuePaise"], ["Plagiarism op. cost", "plagiarismOperationalCostPaise"], ["Plagiarism profit", "plagiarismProfitPaise"],
  ["Other printing-service revenue", "otherServiceRevenuePaise"], ["Other printing-service op. cost", "otherServiceOperatingCostPaise"], ["Operator other printing-service profit", "otherServiceProfitPaise"], ["Add-ons revenue / profit", "addonRevenuePaise"], ["Delivery collected", "deliveryCollectedPaise"], ["In-campus delivery", "incampusDeliveryCollectedPaise"], ["Delivery partner fee", "riderCostPaise"],
  ["Owner delivery profit (25%)", "deliveryProfitPaise"], ["Platform fee", "platformCollectedPaise"], ["Packing revenue", "packagingCollectedPaise"], ["Packing cost", "packagingCostPaise"], ["Packing profit", "packagingProfitPaise"],
  ["Payment gateway op. cost", "gatewayCollectedPaise"], ["Surcharge", "surgeCollectedPaise"], ["Late-night delivery fee", "lateNightCollectedPaise"], ["Late-night partner payment (60%)", "lateNightPartnerCostPaise"], ["Late-night owner profit (40%)", "lateNightOwnerProfitPaise"], ["Total op. cost", "operationalCostPaise"],
  ["Total profit", "netProfitPaise"], ["Owner (Bharat) 35% printing profit", "ownerPrintingProfitPaise"], ["Owner (Bharat) other profit", "ownerOtherProfitPaise"], ["Owner (Bharat) total", "ownerTotalProfitPaise"], ["Operator (Ramya) 65% printing profit", "operatorPrintingProfitPaise"], ["Operator (Ramya) other printing-service profit", "otherServiceProfitPaise"], ["Operator (Ramya) total", "operatorTotalProfitPaise"], ["Share tally", "shareTallyPaise"],
] as const;

function LedgerFinancialTable({ rows, total, orderView = false }: { rows: any[]; total?: any; orderView?: boolean }) {
  const label = (row: any) => orderView ? row.order_number : new Date(`${row.date}T00:00:00`).toLocaleDateString("en-IN");
  return <div className="ledger-sheet"><table><thead><tr><th>{orderView ? "Order" : "Date"}</th>{!orderView && <th>Orders</th>}{ledgerFinancialColumns.map(([title]) => <th key={title}>{title}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={orderView ? row.order_number : row.date}><td>{label(row)}</td>{!orderView && <td>{row.orders}</td>}{ledgerFinancialColumns.map(([title, key]) => <td key={title}>{inr.format((Number(row[key]) || 0) / 100)}</td>)}</tr>)}</tbody>{total && <tfoot><tr><th>Grand total</th><th>{total.orders}</th>{ledgerFinancialColumns.map(([title, key]) => <th key={title}>{inr.format((Number(total[key]) || 0) / 100)}</th>)}</tr></tfoot>}</table></div>;
}

function PlagiarismTracker({ status }: { status: string }) {
  const current = status === "DELIVERED" ? 2 : status === "PLAGIARISM_REPORT_RECEIVED" ? 1 : 0;
  const steps = ["Document submitted", "Report received", "Sent to WhatsApp"];
  return <div className="plagiarism-tracker" aria-label="Plagiarism report progress">{steps.map((step, index) => <span className={index <= current ? "done" : ""} key={step}><i>{index < current ? "✓" : index + 1}</i><b>{step}</b>{index === 2 && current === 2 && <small>Completed</small>}</span>)}</div>;
}

type CartItem = {
  kind?: "PRINT" | "ADDON";
  addonId?: string;
  id: string;
  uploadId: string;
  fileName: string;
  displayReference?: string;
  fileType: "PDF" | "IMAGE" | "DOCUMENT";
  pages: number;
  copies: number;
  mode: PrintMode;
  unitPrice: number;
  bwUnitPrice?: number;
  colourUnitPrice?: number;
  total: number;
  serviceId: string;
  serviceName: string;
  servicePrice: number;
  countsForPackaging: boolean;
  printInstructions?: string;
  colourPages?: number;
  colourPageNumbers?: string;
  bwPageNumbers?: string;
  whatsappNumber?: string;
  addons?: Array<{ id: string; name: string; description?: string; price: number }>;
  addonsTotal?: number;
};

type BatchFile = {
  file: File;
  fileName: string;
  reference: string;
  fileType: "PDF" | "IMAGE";
  pages: number;
  copies: number;
  mode: PrintMode;
  serviceId: string;
  // An empty string means the customer chose mixed printing but has not yet
  // entered their colour pages. Undefined means the normal all-B&W/all-colour flow.
  colourPageNumbers?: string;
};

export default function PrintBeeApp({ viewer, appwriteConfigured }: { viewer: Viewer; appwriteConfigured: boolean }) {
  const [prices, setPrices] = useState<Prices>(defaultPrices);
  const [draftPrices, setDraftPrices] = useState<Prices>(defaultPrices);
  const [mode, setMode] = useState<PrintMode>("bw-single");
  const [pages, setPages] = useState(12);
  const [copies, setCopies] = useState(1);
  const [fileName, setFileName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileQueue, setFileQueue] = useState<File[]>([]);
  const [batchFiles, setBatchFiles] = useState<BatchFile[]>([]);
  const [batchIndex, setBatchIndex] = useState(0);
  const [swipeStartX, setSwipeStartX] = useState<number | null>(null);
  const [fileType, setFileType] = useState<"PDF" | "IMAGE" | "DOCUMENT">("PDF");
  const [countingPages, setCountingPages] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editingCartItem, setEditingCartItem] = useState<CartItem | null>(null);
  const [cartEditMode, setCartEditMode] = useState<PrintMode>("bw-single");
  const [cartEditCopies, setCartEditCopies] = useState(1);
  const [cartEditServiceId, setCartEditServiceId] = useState("document-printing");
  const [adminOpen, setAdminOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [franchiseApplyOpen, setFranchiseApplyOpen] = useState(false);
  const [franchiseApplyMessage, setFranchiseApplyMessage] = useState("");
  const [franchiseApplication, setFranchiseApplication] = useState({ fullName: "", location: "", mobileNumber: "", whatsappNumber: "", address: "" });
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const [role, setRole] = useState<string | null>(viewer?.isAdmin ? "ADMIN" : null);
  const [adminRole, setAdminRole] = useState<string | null>(viewer?.isAdmin ? "OWNER" : null);
  // Franchise access can be changed by an administrator while this tab is open.
  // Keep it separate from the server-rendered viewer snapshot so a removed
  // manager is not left in the franchise portal until they sign out.
  const [hasFranchiseAccess, setHasFranchiseAccess] = useState(Boolean(viewer?.isFranchise));
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);
  const [isRiderAvailable, setIsRiderAvailable] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  const [myReferralCode, setMyReferralCode] = useState("");
  const [hasReferrer, setHasReferrer] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletMessage, setWalletMessage] = useState("");
  const [pointsBalance, setPointsBalance] = useState(0);
  const [usePoints, setUsePoints] = useState(false);
  const [feedbackOrder, setFeedbackOrder] = useState<any>(null);
  const [feedback, setFeedback] = useState({ serviceRating: 0, riderRating: 0, printQualityRating: 0, overallRating: 0, description: "" });
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [loginMode, setLoginMode] = useState<"CUSTOMER" | "PARTNER">("CUSTOMER");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [safariUpiNoticeOpen, setSafariUpiNoticeOpen] = useState(false);
  const [memeQuote, setMemeQuote] = useState(GEN_Z_MEMES[0]);
  const [acceptingOrders, setAcceptingOrders] = useState(true);
  const [launchAt, setLaunchAt] = useState("2026-08-10T03:30:00.000Z");
  const [launchInput, setLaunchInput] = useState("2026-08-10T09:00");
  const [launchMessage, setLaunchMessage] = useState("Site will be live from Aug 10 2026, 9 A.M. IST");
  const [countdownNow, setCountdownNow] = useState(Date.now());
  const [gatewayEnabled, setGatewayEnabled] = useState(true);
  const [gatewayFeePercent, setGatewayFeePercent] = useState(0);
  const [surgeEnabled, setSurgeEnabled] = useState(false);
  const [surgeType, setSurgeType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [surgeValue, setSurgeValue] = useState(0);
  const [lateNightEnabled, setLateNightEnabled] = useState(false);
  const [lateNightType, setLateNightType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [lateNightValue, setLateNightValue] = useState(0);
  const [platformFee, setPlatformFee] = useState(1.5);
  const [baseDeliveryFee, setBaseDeliveryFee] = useState(10);
  const [deliveryFeePer100Meters, setDeliveryFeePer100Meters] = useState(1);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const trackTraffic = (event: "PAGE_VIEW" | "CHECKOUT_STARTED") => {
    try {
      const key = "printbee-traffic-visitor";
      let visitorId = localStorage.getItem(key);
      if (!visitorId) { visitorId = crypto.randomUUID(); localStorage.setItem(key, visitorId); }
      void fetch("/api/traffic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, visitorId, path: window.location.pathname }) });
    } catch {}
  };
  useEffect(() => { trackTraffic("PAGE_VIEW"); }, []);
  // Warm up Razorpay before the payment click. This keeps iPhone Safari from
  // having to fetch the checkout library midway through its payment flow.
  useEffect(() => { void loadRazorpayCheckout().catch(() => {}); }, []);
  const [customerName, setCustomerName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryLandmark, setDeliveryLandmark] = useState("");
  const [incampusDelivery, setIncampusDelivery] = useState(false);
  const [incampusType, setIncampusType] = useState<"CLASSROOM" | "HOSTEL">("CLASSROOM");
  const [campusBuilding, setCampusBuilding] = useState("");
  const [classroomNumber, setClassroomNumber] = useState("");
  const [customerCoordinates, setCustomerCoordinates] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [calculatedDeliveryFee, setCalculatedDeliveryFee] = useState<number | null>(null);
  const [locationMessage, setLocationMessage] = useState("");
  const [storeLocation, setStoreLocation] = useState<any>(null);
  const [orderError, setOrderError] = useState("");
  const [orderResult, setOrderResult] = useState<{ id: string; orderNumber: string; deliveryCode?: string | null; locationName: string; totalPaise: number; lateNightFeePaise?: number; paid: boolean; paymentMode?: string } | null>(null);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const orderSubmissionLock = useRef(false);
  const paymentDialogLock = useRef(false);
  const [newLocation, setNewLocation] = useState("");
  const [agentEmail, setAgentEmail] = useState("");
  const [adminMessage, setAdminMessage] = useState("");
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [deliveryOrderNumber, setDeliveryOrderNumber] = useState("");
  const [deliveryCode, setDeliveryCode] = useState("");
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [dashboard, setDashboard] = useState<any>(null);
  const [myOrdersOpen, setMyOrdersOpen] = useState(false);
  const { orders: myOrders, setOrders: setMyOrders, refresh: refreshCustomerOrders, error: customerOrderError } = useCustomerOrders(viewer?.email, Boolean(viewer) && loginMode === "CUSTOMER" && !adminOpen, myOrdersOpen);
  const [riderOrders, setRiderOrders] = useState<any[]>([]);
  const [franchiseOrders, setFranchiseOrders] = useState<any[]>([]);
  const [franchiseSettings, setFranchiseSettings] = useState<any[]>([]);
  const [riderStoreLocation, setRiderStoreLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [riderEarnings, setRiderEarnings] = useState<any>(null);
  const [withdrawUpi, setWithdrawUpi] = useState("");
  const [saved, setSaved] = useState(false);
  const [riderPayment, setRiderPayment] = useState({ riderEmail: "", amount: "", paymentDate: new Date().toISOString().slice(0, 10), note: "" });
  const [grantPointDrafts, setGrantPointDrafts] = useState<Record<string, string>>({});
  const [riderApplicationOpen, setRiderApplicationOpen] = useState(false);
  const [riderApplication, setRiderApplication] = useState({ name: "", mobileNumber: "" });
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [expandedScanner, setExpandedScanner] = useState<{ src: string; alt: string } | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [notificationToast, setNotificationToast] = useState<{ title: string; body: string } | null>(null);
  const [notificationPromptOpen, setNotificationPromptOpen] = useState(false);
  const [adminSection, setAdminSection] = useState<"dashboard" | "traffic" | "revenue" | "ledger" | "orders" | "riders" | "services" | "franchise" | "projects">("dashboard");
  const [franchiseStores, setFranchiseStores] = useState<any[]>([]);
  const [franchiseApplications, setFranchiseApplications] = useState<any[]>([]);
  const [newFranchise, setNewFranchise] = useState({ name: "" });
  const [franchiseManagerEmails, setFranchiseManagerEmails] = useState<Record<string, string>>({});
  const [availableStores, setAvailableStores] = useState<StoreChoice[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [storeSelectionReady, setStoreSelectionReady] = useState(false);
  const [ledgerPassword, setLedgerPassword] = useState("");
  const [ledger, setLedger] = useState<any>(null);
  const [ledgerMessage, setLedgerMessage] = useState("");
  const [dashboardRange, setDashboardRange] = useState<"today" | "week" | "month" | "lifetime">("today");
  const [adminOrderSearch, setAdminOrderSearch] = useState("");
  const [adminOrderStatus, setAdminOrderStatus] = useState("ALL");
  const [adminPage, setAdminPage] = useState(1);
  const [expandedAdminOrders, setExpandedAdminOrders] = useState<Record<string, boolean>>({});
  const [printServices, setPrintServices] = useState<PrintService[]>([]);
  const [packagingEnabled, setPackagingEnabled] = useState(false);
  const [packagingFee, setPackagingFee] = useState(0);
  const [needsPackaging, setNeedsPackaging] = useState(false);
  const [serviceId, setServiceId] = useState("document-printing");
  const [printInstructions, setPrintInstructions] = useState("");
  const [colourPageNumbers, setColourPageNumbers] = useState("");
  const [colourChoice, setColourChoice] = useState<ColourChoice>("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [newService, setNewService] = useState({ id: "", name: "", description: "", isBinding: false, countsForPackaging: true, price: 0 });
  const [addons, setAddons] = useState<Addon[]>([]);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  const [newAddon, setNewAddon] = useState({ id: "", name: "", description: "", price: 0 });
  const [newAdminMember, setNewAdminMember] = useState({ email: "", role: "OPERATIONS" });
  const [addonMessage, setAddonMessage] = useState("");

  useEffect(() => {
    const randomValues = new Uint32Array(1);
    crypto.getRandomValues(randomValues);
    setMemeQuote(GEN_Z_MEMES[randomValues[0] % GEN_Z_MEMES.length]);
  }, [viewer?.email]);

  useEffect(() => {
    const loadPrices = async (syncAdminDraft = false) => {
      const response = await fetch("/api/print-prices", { cache: "no-store" });
      if (!response.ok) return;
      const pricePaise = await response.json() as Record<PrintMode, number>;
      const sharedPrices = Object.fromEntries(Object.entries(pricePaise).map(([id, value]) => [id, value / 100])) as Prices;
      setPrices(sharedPrices);
      if (syncAdminDraft) setDraftPrices(sharedPrices);
    };
    loadPrices(true).catch(() => {});
    const refresh = window.setInterval(() => loadPrices().catch(() => {}), 15000);
    const refreshOnFocus = () => loadPrices().catch(() => {});
    window.addEventListener("focus", refreshOnFocus);
    return () => { window.clearInterval(refresh); window.removeEventListener("focus", refreshOnFocus); };
  }, []);

  useEffect(() => { fetch("/api/fee-settings", { cache: "no-store" }).then((r) => r.ok ? r.json() : {}).then((data) => { if (typeof data.gatewayEnabled === "boolean") setGatewayEnabled(data.gatewayEnabled); setGatewayFeePercent(Math.max(0, Number(data.gatewayFeePercent) || 0)); setSurgeEnabled(Boolean(data.surgeEnabled)); setSurgeType(data.surgeType === "FIXED" ? "FIXED" : "PERCENT"); setSurgeValue(Number(data.surgeValue) || 0); setLateNightEnabled(Boolean(data.lateNightEnabled)); setLateNightType(data.lateNightType === "FIXED" ? "FIXED" : "PERCENT"); setLateNightValue(Number(data.lateNightValue) || 0); setPlatformFee(Math.max(0, Number(data.platformFee) || 0)); setBaseDeliveryFee(Math.max(0, Number(data.baseDeliveryFee) || 0)); setDeliveryFeePer100Meters(Math.max(0, Number(data.deliveryFeePer100Meters) || 0)); setPackagingEnabled(Boolean(data.packagingEnabled)); setPackagingFee(Math.max(0, Number(data.packagingFee) || 0)); }).catch(() => {}); }, []);

  useEffect(() => {
    const loadAvailability = async () => {
      const response = await fetch("/api/order-availability", { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        setAcceptingOrders(Boolean(data.acceptingOrders));
        setLaunchAt(data.launchAt);
        setLaunchMessage(data.launchMessage);
        const ist = new Date(new Date(data.launchAt).getTime() + 330 * 60 * 1000).toISOString().slice(0, 16);
        setLaunchInput(ist);
      }
    };
    loadAvailability().catch(() => {});
    const refresh = window.setInterval(() => loadAvailability().catch(() => {}), 15000);
    return () => window.clearInterval(refresh);
  }, []);

  useEffect(() => {
    if (acceptingOrders) return;
    const timer = window.setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [acceptingOrders]);

  useEffect(() => {
    fetch("/api/stores", { cache: "no-store" }).then((response) => response.ok ? response.json() : []).then((stores: StoreChoice[]) => {
      const choices = Array.isArray(stores) ? stores : [];
      setAvailableStores(choices);
      const saved = window.localStorage.getItem("printbee-selected-store");
      if (saved && choices.some((store) => store.id === saved)) setSelectedStoreId(saved);
      setStoreSelectionReady(true);
    }).catch(() => setStoreSelectionReady(true));
  }, []);

  useEffect(() => {
    if (!viewer) return;
    const refreshAccount = async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setRole(data.role); setAdminRole(data.adminRole ?? null); setHasFranchiseAccess(Boolean(data.isFranchise)); setApprovalStatus(data.approvalStatus ?? null); setIsRiderAvailable(Boolean(data.isAvailable)); setMyReferralCode(data.referralCode ?? ""); setPointsBalance(Number(data.pointsBalance) || 0); setHasReferrer(Boolean(data.hasReferrer));
      const pendingCode = window.localStorage.getItem("printbee-referral-code");
      if (pendingCode && !data.hasReferrer) {
        const linked = await fetch("/api/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ referralCode: pendingCode }) });
        const result = await linked.json().catch(() => ({}));
        setAuthMessage(linked.ok ? "Referral code verified and linked to your account." : result.error ?? "Referral code could not be verified.");
        if (linked.ok) setHasReferrer(true);
      }
      window.localStorage.removeItem("printbee-referral-code");
    };
    void refreshAccount();
    const refresh = window.setInterval(() => void refreshAccount(), 10_000);
    return () => window.clearInterval(refresh);
  }, [viewer]);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("ref")?.trim().toUpperCase();
    if (!code) return;
    setReferralCode(code);
    window.localStorage.setItem("printbee-referral-code", code);
    if (!viewer) setLoginOpen(true); else setWalletOpen(true);
  }, [viewer?.email]);

  useEffect(() => {
    if (!viewer || viewer.isAdmin) return;
    const checkWalletCredits = async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setPointsBalance(Number(data.pointsBalance) || 0);
      const credit = data.latestCredit;
      if (!credit?.id) return;
      const seenKey = `printbee-wallet-credit-${viewer.email}`;
      if (window.localStorage.getItem(seenKey) === credit.id) return;
      window.localStorage.setItem(seenKey, credit.id);
      setNotificationToast({ title: `+${credit.points} wallet points`, body: credit.description });
      await sendOrderNotification(`+${credit.points} PrintBee wallet points`, credit.description, `wallet-${credit.id}`);
    };
    checkWalletCredits().catch(() => {});
    const refresh = window.setInterval(() => checkWalletCredits().catch(() => {}), 15000);
    return () => window.clearInterval(refresh);
  }, [viewer?.email]);

  useEffect(() => {
    if (!viewer) return;
    fetch("/api/cart", { cache: "no-store" }).then((response) => response.ok ? response.json() : []).then((items) => setCart(Array.isArray(items) ? items : [])).catch(() => {});
  }, [viewer?.email]);

  useEffect(() => {
    const storedMode = window.localStorage.getItem("printbee-login-mode");
    if (storedMode === "PARTNER") setLoginMode("PARTNER");
  }, []);

  useEffect(() => {
    if (!viewer || viewer.isAdmin || loginMode !== "PARTNER") return;
    loadRiderOrders();
    const refresh = window.setInterval(loadRiderOrders, 15000);
    return () => window.clearInterval(refresh);
  }, [viewer, loginMode, approvalStatus]);


  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => setNotificationMessage("Notification setup failed. Reload the page and try again."));
    }
    if ("Notification" in window) {
      setNotificationPermission(Notification.permission);
      if (Notification.permission === "default") setNotificationPromptOpen(true);
    }
    fetch("/api/print-services", { cache: "no-store" }).then((response) => response.ok ? response.json() : []).then(setPrintServices).catch(() => {});
    fetch("/api/addons", { cache: "no-store" }).then((response) => response.ok ? response.json() : []).then(setAddons).catch(() => {});
  }, []);

  useEffect(() => {
    if (!notificationToast) return;
    const timer = window.setTimeout(() => setNotificationToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notificationToast]);

  useEffect(() => {
    if (!adminOpen || adminSection !== "orders") return;
    let lastNewest = dashboard?.orders?.[0]?.id ?? "";
    const refresh = window.setInterval(async () => {
      const response = await fetch(`/api/admin/dashboard?page=${adminPage}&pageSize=100`, { cache: "no-store" });
      if (!response.ok) return;
      const next = await response.json();
      const newest = next.orders?.[0]?.id ?? "";
      if (lastNewest && newest && newest !== lastNewest) {
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const context = new AudioContextClass();
          [0, 0.22].forEach((delay) => {
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, context.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.35, context.currentTime + delay + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + delay + 0.18);
            oscillator.connect(gain).connect(context.destination);
            oscillator.start(context.currentTime + delay);
            oscillator.stop(context.currentTime + delay + 0.2);
          });
        } catch {}
        sendOrderNotification("New PrintBee order", `${next.orders[0].order_number} has just arrived.`, `admin-${newest}`);
      }
      lastNewest = newest;
      setDashboard(next);
    }, 5000);
    return () => window.clearInterval(refresh);
  }, [adminOpen, adminSection, adminPage]);


  const selected = options.find((item) => item.id === mode)!;
  const selectedService = printServices.find((service) => service.id === serviceId);
  const isPlagiarismService = serviceId === PLAGIARISM_SERVICE_ID;
  const servicePrice = isPlagiarismService ? PLAGIARISM_PRICE : (selectedService?.price_paise ?? 0) / 100;
  const usesMixedPagePricing = MIXED_PRINT_SERVICES.has(serviceId);
  const colourPageResult = useMemo(() => parsePageNumbers(colourPageNumbers, pages), [colourPageNumbers, pages]);
  const colourPageCount = colourChoice === "colour" ? pages : colourChoice === "mixed" ? colourPageResult.count : 0;
  const bwPageCount = pages - colourPageCount;
  const bwPageNumbers = useMemo(() => {
    if (colourChoice === "bw") return formatPageRanges(Array.from({ length: pages }, (_, index) => index + 1));
    if (colourChoice === "colour") return "NA";
    if (colourChoice !== "mixed" || colourPageResult.invalid.length) return "";
    const colourSet = new Set(colourPageResult.pages);
    return formatPageRanges(Array.from({ length: pages }, (_, index) => index + 1).filter((page) => !colourSet.has(page)));
  }, [colourChoice, colourPageResult, pages]);
  const side = mode.endsWith("double") ? "double" : "single";
  const sideDivisor = side === "double" ? 2 : 1;
  const selectedAddons = addons.filter((addon) => selectedAddonIds.includes(addon.id));
  const addonsTotal = selectedAddons.reduce((sum, addon) => sum + addon.price_paise / 100, 0);
  const mixedPrintTotal = ((bwPageCount / sideDivisor) * prices[`bw-${side}`] + (colourPageCount / sideDivisor) * prices[`colour-${side}`]) * copies;
  const printTotal = isPlagiarismService ? 0 : usesMixedPagePricing ? mixedPrintTotal : (pages / sideDivisor) * copies * prices[mode];
  const total = printTotal + servicePrice + addonsTotal;
  const colourPagesValid = colourChoice === "bw" || colourChoice === "colour" || (colourChoice === "mixed" && colourPageNumbers.trim().length > 0 && colourPageResult.invalid.length === 0);

  const selectFile = async (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      setFileName("");
      setSelectedFile(null);
      setUploadError(`"${file.name}" is too large. Please upload a PDF or image smaller than 50 MB.`);
      return;
    }
    if (!PRINTABLE_FILE_EXTENSIONS.test(file.name)) {
      setUploadError("Only PDF, JPG/JPEG, PNG, WEBP and HEIC files are accepted.");
      return;
    }
    setFileName(file.name);
    setSelectedFile(file);
    setColourChoice("");
    setColourPageNumbers("");
    setUploadError("");
    setCountingPages(true);
    try {
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const pdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
        setPages(pdf.getPageCount());
        setFileType("PDF");
      } else if (IMAGE_EXTENSIONS.test(file.name)) {
        setPages(1);
        setFileType("IMAGE");
      } else {
        throw new Error("Only PDF, JPG/JPEG, PNG, WEBP and HEIC files are accepted.");
      }
    } catch (error) {
      setFileName("");
      setSelectedFile(null);
      setUploadError(error instanceof Error ? error.message : "This file could not be read.");
    } finally {
      setCountingPages(false);
    }
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const validFiles = files.filter((file) => file.size <= MAX_UPLOAD_BYTES && PRINTABLE_FILE_EXTENSIONS.test(file.name));
    if (!validFiles.length) return setUploadError("Choose PDF, JPG/JPEG, PNG, WEBP or HEIC files smaller than 50 MB.");
    if (isPlagiarismService) {
      const pdf = validFiles[0];
      if (!pdf || !(pdf.type === "application/pdf" || pdf.name.toLowerCase().endsWith(".pdf"))) return setUploadError("For plagiarism reports, upload one PDF file only.");
      if (files.length > 1) setUploadError("Add one PDF at a time. You can add another PDF after this one is in your cart.");
      return selectFile(pdf);
    }
    setCountingPages(true);
    setUploadError("");
    try {
      const prepared = await Promise.all(validFiles.map(async (file, index): Promise<BatchFile> => {
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        const filePages = isPdf ? (await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })).getPageCount() : 1;
        return { file, fileName: file.name, reference: `File ${batchFiles.length + index + 1}`, fileType: isPdf ? "PDF" : "IMAGE", pages: filePages, copies: 1, mode: "bw-single", serviceId: "document-printing" };
      }));
      setBatchFiles((items) => [...items, ...prepared]);
      customerFeedback('file-ready');
      setBatchIndex(batchFiles.length);
      setFileQueue([]);
      setFileName("");
      setSelectedFile(null);
      setUploadError(validFiles.length === files.length ? "" : "Unsupported or oversized files were skipped. Each accepted file must be 50 MB or smaller.");
    } catch (error) {
      setBatchFiles([]);
      setBatchIndex(0);
      setUploadError(error instanceof Error ? error.message : "One of the selected files could not be read.");
    } finally {
      setCountingPages(false);
    }
  };

  const batchTotal = (item: BatchFile) => {
    const service = printServices.find((candidate) => candidate.id === item.serviceId);
    const sides = item.mode.endsWith("double") ? 2 : 1;
    if (item.colourPageNumbers !== undefined) {
      const colourPages = parsePageNumbers(item.colourPageNumbers, item.pages).count;
      const bwPages = item.pages - colourPages;
      return ((bwPages / sides) * prices[`bw-${sides === 2 ? "double" : "single"}`] + (colourPages / sides) * prices[`colour-${sides === 2 ? "double" : "single"}`]) * item.copies + (service?.price_paise ?? 0) / 100;
    }
    return (item.pages / sides) * item.copies * prices[item.mode] + (service?.price_paise ?? 0) / 100;
  };

  const updateBatchFile = (index: number, updates: Partial<BatchFile>) => setBatchFiles((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...updates } : item));

  const addBatchToCart = async () => {
    if (!viewer) return setLoginOpen(true);
    if (!batchFiles.length || countingPages) return;
    const invalidMixedFile = batchFiles.find((item) => item.colourPageNumbers !== undefined && (!item.colourPageNumbers.trim() || parsePageNumbers(item.colourPageNumbers, item.pages).invalid.length));
    if (invalidMixedFile) return setUploadError(`Enter valid colour page numbers for ${invalidMixedFile.fileName}.`);
    setCountingPages(true);
    setUploadProgress(0);
    setUploadError("");
    const added: CartItem[] = [];
    try {
      for (let index = 0; index < batchFiles.length; index += 1) {
        const item = batchFiles[index];
        const uploadFile = await optimizeImageForUpload(item.file);
        const uploaded = await uploadPrintableFile(uploadFile, item.pages, (progress) => setUploadProgress(Math.round(((index + progress / 100) / batchFiles.length) * 100)));
        const service = printServices.find((candidate) => candidate.id === item.serviceId);
        const mixedResult = item.colourPageNumbers !== undefined ? parsePageNumbers(item.colourPageNumbers, item.pages) : null;
        const bwPages = mixedResult ? formatPageRanges(Array.from({ length: item.pages }, (_, pageIndex) => pageIndex + 1).filter((page) => !mixedResult.pages.includes(page))) : undefined;
        const cartItem: CartItem = { id: crypto.randomUUID(), uploadId: uploaded.uploadId, fileName: item.fileName, displayReference: item.reference, fileType: item.fileType, pages: item.pages, copies: item.copies, mode: item.mode, unitPrice: prices[item.mode], bwUnitPrice: prices[`bw-${item.mode.endsWith("double") ? "double" : "single"}`], colourUnitPrice: prices[`colour-${item.mode.endsWith("double") ? "double" : "single"}`], total: batchTotal(item), serviceId: item.serviceId, serviceName: service?.name ?? "Document printing", servicePrice: (service?.price_paise ?? 0) / 100, countsForPackaging: Boolean(service?.counts_for_packaging ?? 1), colourPages: mixedResult?.count, colourPageNumbers: mixedResult ? formatPageRanges(mixedResult.pages) : undefined, bwPageNumbers: bwPages, addons: [], addonsTotal: 0 };
        const response = await fetch("/api/cart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cartItem) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error ?? `Could not add ${item.fileName} to the cart.`);
        added.push(cartItem);
      }
      setCart((items) => [...items, ...added]);
      customerFeedback('cart-added');
      setBatchFiles([]);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "The selected files could not be added to the cart.");
    } finally {
      setCountingPages(false);
      setUploadProgress(null);
    }
  };

  const addToCart = async () => {
    if (!viewer) return setLoginOpen(true);
    if (!fileName || !selectedFile || countingPages) return;
    if (isPlagiarismService && !(selectedFile.type === "application/pdf" || selectedFile.name.toLowerCase().endsWith(".pdf"))) return setUploadError("For plagiarism reports, upload one PDF file only.");
    if (usesMixedPagePricing && !colourPagesValid) return setUploadError("Enter valid colour page numbers, or select NA if there are no colour pages.");
    if (selectedFile.size > MAX_UPLOAD_BYTES) return setUploadError("This file is larger than the 50 MB upload limit.");
    setCountingPages(true);
    setUploadProgress(0);
    setUploadError("");
    let uploadFile = selectedFile;
    try {
      uploadFile = await optimizeImageForUpload(selectedFile);
    } catch {
      setCountingPages(false);
      return setUploadError("This image could not be optimized for upload. Please save it as JPG or WebP and try again.");
    }
    let uploaded: any;
    try {
      uploaded = await uploadPrintableFile(uploadFile, pages, setUploadProgress);
    } catch (error) {
      return setUploadError(error instanceof Error ? error.message : "The document could not be uploaded. Check your connection and try again.");
    } finally {
      setCountingPages(false);
      setUploadProgress(null);
    }
    const service = printServices.find((item) => item.id === serviceId);
    const cartItem: CartItem = {
        id: crypto.randomUUID(),
        uploadId: uploaded.uploadId,
        fileName,
        displayReference: "File 1",
        fileType,
        pages,
        copies,
        mode: usesMixedPagePricing ? `${colourChoice === "colour" ? "colour" : "bw"}-${side}` as PrintMode : mode,
        unitPrice: isPlagiarismService ? 0 : usesMixedPagePricing ? (mixedPrintTotal / Math.max(1, pages * copies)) : prices[mode],
        bwUnitPrice: prices[`bw-${side}`],
        colourUnitPrice: prices[`colour-${side}`],
        total,
        serviceId,
        serviceName: service?.name ?? "Document printing",
        servicePrice: isPlagiarismService ? PLAGIARISM_PRICE : (service?.price_paise ?? 0) / 100,
        countsForPackaging: Boolean(service?.counts_for_packaging ?? 1),
        printInstructions: printInstructions.trim(),
        colourPages: usesMixedPagePricing ? colourPageCount : undefined,
        colourPageNumbers: usesMixedPagePricing ? (colourChoice === "bw" ? "NA" : colourChoice === "colour" ? "All pages" : colourPageNumbers.trim()) : undefined,
        bwPageNumbers: usesMixedPagePricing ? bwPageNumbers : undefined,
        whatsappNumber: whatsappNumber.replace(/\D/g, ""),
        addons: selectedAddons.map((addon) => ({ id: addon.id, name: addon.name, description: addon.description, price: addon.price_paise / 100 })),
        addonsTotal,
      };
    try {
      const cartResponse = await fetch("/api/cart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cartItem) });
      const cartResult = await cartResponse.json().catch(() => ({}));
      if (!cartResponse.ok) throw new Error(cartResult.error ?? "The cart could not be saved.");
    } catch (error) {
      await fetch(`/api/cart?uploadId=${encodeURIComponent(cartItem.uploadId)}`, { method: "DELETE" }).catch(() => {});
      return setUploadError(error instanceof Error ? error.message : "The cart could not be saved. Please try again.");
    }
    setCart((items) => [...items, cartItem]);
    customerFeedback('cart-added');
    setFileName("");
    setSelectedFile(null);
    setPages(1);
    setCopies(1);
    setPrintInstructions("");
    setColourPageNumbers("");
    setColourChoice("");
    setSelectedAddonIds([]);
  };

  const removeFromCart = async (item: CartItem) => {
    const response = await fetch(`/api/cart?uploadId=${encodeURIComponent(item.uploadId)}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return setUploadError(data.error ?? "This item could not be removed. Please try again.");
    }
    const reposition = await animateCartRemoval(item.id);
    setCart((items) => items.filter((current) => current.id !== item.id));
    reposition();
    customerFeedback('cart-removed');
  };

  const openCartEditor = (item: CartItem) => {
    setEditingCartItem(item);
    setCartEditMode(item.mode);
    setCartEditCopies(item.copies);
    setCartEditServiceId(item.serviceId);
  };

  const saveCartEdit = async () => {
    if (!editingCartItem) return;
    const service = printServices.find((candidate) => candidate.id === cartEditServiceId);
    if (!service) return setUploadError("That print service is no longer available.");
    const sides = cartEditMode.endsWith("double") ? 2 : 1;
    const servicePrice = (service.price_paise ?? 0) / 100;
    const updated: CartItem = { ...editingCartItem, mode: cartEditMode, copies: cartEditCopies, unitPrice: prices[cartEditMode], bwUnitPrice: prices[`bw-${cartEditMode.endsWith("double") ? "double" : "single"}`], colourUnitPrice: prices[`colour-${cartEditMode.endsWith("double") ? "double" : "single"}`], serviceId: service.id, serviceName: service.name, servicePrice, countsForPackaging: Boolean(service.counts_for_packaging ?? 1), total: (editingCartItem.pages / sides) * cartEditCopies * prices[cartEditMode] + servicePrice + (editingCartItem.addonsTotal ?? 0), colourPages: undefined, colourPageNumbers: undefined, bwPageNumbers: undefined };
    const response = await fetch("/api/cart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setUploadError(data.error ?? "Your changes could not be saved. Please try again.");
    setCart((items) => items.map((item) => item.id === updated.id ? updated : item));
    customerFeedback('cart-updated');
    setEditingCartItem(null);
  };

  const addStandaloneAddon = async (addon: Addon) => {
    if (!viewer) return setLoginOpen(true);
    const price = addon.price_paise / 100;
    const item: CartItem = {
      kind: "ADDON", addonId: addon.id, id: `addon-${addon.id}`, uploadId: `addon:${addon.id}`,
      fileName: addon.name, fileType: "DOCUMENT", pages: 0, copies: 1, mode: "bw-single", unitPrice: 0,
      total: price, serviceId: "addon-only", serviceName: "Add-on only", servicePrice: 0,
      countsForPackaging: false, addons: [{ id: addon.id, name: addon.name, description: addon.description, price }], addonsTotal: price,
    };
    const response = await fetch("/api/cart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setAddonMessage(data.error ?? "This add-on could not be added.");
    setCart((items) => [...items.filter((current) => current.uploadId !== item.uploadId), item]);
    customerFeedback('cart-added');
    setAddonMessage(`${addon.name} added to your cart.`);
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.total, 0);
  const cartServiceCharges = cart.reduce((sum, item) => sum + (item.servicePrice || 0), 0);
  const cartAddonCharges = cart.reduce((sum, item) => sum + (item.addonsTotal || 0), 0);
  const cartPrintingTotal = cartTotal - cartServiceCharges - cartAddonCharges;

  const savePrices = async () => {
    const response = await fetch("/api/print-prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draftPrices) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setNotificationMessage(data.error ?? "Prices could not be saved."); return; }
    setPrices(Object.fromEntries(Object.entries(data).map(([id, value]) => [id, Number(value) / 100])) as Prices);
    setNotificationMessage("");
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const toggleOrderAvailability = async () => {
    const next = !acceptingOrders;
    const response = await fetch("/api/order-availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acceptingOrders: next, launchAt, launchMessage }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setNotificationMessage(data.error ?? "Order availability could not be updated."); return; }
    setAcceptingOrders(Boolean(data.acceptingOrders));
    setNotificationMessage(data.acceptingOrders ? "Orders are ON. Customers can place orders now." : "Orders are OFF. Customers will see that service will be live soon.");
  };

  const saveLaunchSchedule = async () => {
    const parsedSchedule = new Date(`${launchInput}:00+05:30`);
    if (!launchInput || Number.isNaN(parsedSchedule.getTime()) || !launchMessage.trim()) { setNotificationMessage("Enter a valid IST launch time and message."); return; }
    const scheduledAt = parsedSchedule.toISOString();
    const response = await fetch("/api/order-availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acceptingOrders, launchAt: scheduledAt, launchMessage }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setNotificationMessage(data.error ?? "Launch schedule could not be saved."); return; }
    setLaunchAt(data.launchAt);
    setLaunchMessage(data.launchMessage);
    setCountdownNow(Date.now());
    setNotificationMessage("Launch countdown and message saved.");
  };

  const countdownMs = Math.max(0, new Date(launchAt).getTime() - countdownNow);
  const countdown = {
    days: Math.floor(countdownMs / 86400000),
    hours: Math.floor((countdownMs % 86400000) / 3600000),
    minutes: Math.floor((countdownMs % 3600000) / 60000),
    seconds: Math.floor((countdownMs % 60000) / 1000),
  };

  const saveFeeSettings = async (updates: Partial<{ gatewayEnabled: boolean; gatewayFeePercent: number; surgeEnabled: boolean; surgeType: "PERCENT" | "FIXED"; surgeValue: number; lateNightEnabled: boolean; lateNightType: "PERCENT" | "FIXED"; lateNightValue: number; platformFee: number; baseDeliveryFee: number; deliveryFeePer100Meters: number; packagingEnabled: boolean; packagingFee: number }> = {}) => {
    const settings = { gatewayEnabled, gatewayFeePercent, surgeEnabled, surgeType, surgeValue, lateNightEnabled, lateNightType, lateNightValue, platformFee, baseDeliveryFee, deliveryFeePer100Meters, packagingEnabled, packagingFee, ...updates };
    const response = await fetch("/api/fee-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setNotificationMessage(data.error ?? "Fee settings could not be saved."); return; }
    setGatewayEnabled(data.gatewayEnabled); setGatewayFeePercent(data.gatewayFeePercent); setSurgeEnabled(data.surgeEnabled); setSurgeType(data.surgeType); setSurgeValue(data.surgeValue); setLateNightEnabled(data.lateNightEnabled); setLateNightType(data.lateNightType); setLateNightValue(data.lateNightValue); setPlatformFee(data.platformFee); setBaseDeliveryFee(data.baseDeliveryFee); setDeliveryFeePer100Meters(data.deliveryFeePer100Meters); setPackagingEnabled(data.packagingEnabled); setPackagingFee(data.packagingFee); if (!data.packagingEnabled) setNeedsPackaging(false); setNotificationMessage("Checkout fee settings saved.");
  };

  const signInWithGoogle = async (credential: string) => {
    window.localStorage.setItem("printbee-login-mode", loginMode);
    if (referralCode.trim()) window.localStorage.setItem("printbee-referral-code", referralCode.trim().toUpperCase());
    setAuthMessage("Signing you in securely…");
    const response = await fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setAuthMessage(data.error ?? "Google sign-in could not be completed."); return; }
    window.location.reload();
  };

  useEffect(() => {
    if (!loginOpen || !googleButtonRef.current) return;
    const render = () => {
      if (!window.google || !googleButtonRef.current) return;
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (response) => { void signInWithGoogle(response.credential); } });
      googleButtonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(googleButtonRef.current, { theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width: 300, logo_alignment: "left" });
    };
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) { const timer = window.setInterval(() => { if (window.google) { window.clearInterval(timer); render(); } }, 50); return () => window.clearInterval(timer); }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.defer = true; script.onload = render;
    document.head.appendChild(script);
  }, [loginOpen, loginMode, referralCode]);

  const signOut = async () => {
    window.localStorage.removeItem("printbee-login-mode");
    await fetch("/auth/signout", { method: "POST" });
    window.location.reload();
  };

  const switchLoginMode = (mode: "CUSTOMER" | "PARTNER") => {
    window.localStorage.setItem("printbee-login-mode", mode);
    setLoginMode(mode);
    setLoginOpen(false);
  };

  const openCheckout = async () => {
    if (!viewer) return setLoginOpen(true);
    setCheckoutOpen(true);
    customerFeedback('checkout');
  };

  const useCurrentLocation = () => {
    setLocationMessage("");
    setCalculatedDeliveryFee(null);
    if (!navigator.geolocation) return setLocationMessage("Location is not available in this browser.");
    navigator.geolocation.getCurrentPosition(async (position) => {
      const coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
      setCustomerCoordinates(coordinates);
      if (coordinates.accuracy > 500) setLocationMessage("Your location may not be very accurate. Please enable precise location or move to an open area and try again.");
      const response = await fetch("/api/delivery/calculate-fee", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(coordinates) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setLocationMessage(data.error ?? "We could not calculate the delivery fee.");
      setCalculatedDeliveryFee(Number(data.deliveryFee));
      const addressResponse = await fetch(`/api/delivery/reverse-geocode?latitude=${encodeURIComponent(String(coordinates.latitude))}&longitude=${encodeURIComponent(String(coordinates.longitude))}`);
      const addressData = await addressResponse.json().catch(() => ({}));
      if (addressResponse.ok && addressData.address) setDeliveryAddress(addressData.address);
      setLocationMessage(coordinates.accuracy > 500 ? "Your location may not be very accurate. Please enable precise location or move to an open area and try again." : addressResponse.ok ? "Address found. Please add or confirm your building / house number." : "Location found. Please enter your complete delivery address.");
    }, () => setLocationMessage("We need your current location to prepare delivery."), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };

  const setCurrentStoreLocation = () => {
    if (!navigator.geolocation) return setAdminMessage("Location is not available in this browser.");
    navigator.geolocation.getCurrentPosition(async (position) => {
      const response = await fetch("/api/admin/store-location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setAdminMessage(data.error ?? "Store location could not be saved.");
      setStoreLocation(data); setAdminMessage("Store location configured.");
    }, () => setAdminMessage("Location permission is required to set the store location."), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };

  const placeOrder = async (skipSafariNotice = false) => {
    if (paymentProcessing || orderSubmissionLock.current || paymentDialogLock.current) return;
    // Razorpay's UPI app handoff is not consistently exposed by Safari. Warn
    // before a pending order is created, so the customer can switch browsers
    // without having to restart checkout.
    const isSafari = /safari/i.test(navigator.userAgent) && !/(chrome|crios|fxios|edgios|android)/i.test(navigator.userAgent);
    if (isSafari && !skipSafariNotice) {
      setSafariUpiNoticeOpen(true);
      return;
    }
    orderSubmissionLock.current = true;
    setPaymentProcessing(true);
    setOrderError("");
    try {
      trackTraffic("CHECKOUT_STARTED");
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName, mobileNumber, deliveryAddress, deliveryLandmark, incampusDelivery, incampusType, campusBuilding, classroomNumber, items: cart, totalPaise: Math.round(cartTotal * 100), usePoints, needsPackaging, selectedStoreId, ...customerCoordinates }),
      });
      const data = await response.json();
      if (!response.ok) return setOrderError(data.error ?? "Payment checkout could not be prepared");
      const pendingResult = { ...data, paid: false };
      setOrderResult(pendingResult);
      await startRazorpayPayment(pendingResult);
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : "Checkout could not be prepared. Please check your orders before trying again.");
    } finally { orderSubmissionLock.current = false; if (!paymentDialogLock.current) setPaymentProcessing(false); }
  };

  const startRazorpayPayment = async (order: { id: string; orderNumber?: string; totalPaise?: number }) => {
    if (paymentDialogLock.current) return;
    paymentDialogLock.current = true;
    setOrderError("");
    setPaymentProcessing(true);
    try {
      await loadRazorpayCheckout();
      const createResponse = await fetch("/api/payments/razorpay/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: order.id }) });
      const paymentOrder = await createResponse.json();
      if (!createResponse.ok) throw new Error(paymentOrder.error ?? "Payment could not be started");
      const RazorpayCheckout = (window as unknown as { Razorpay?: new (options: Record<string, unknown>) => { open(): void } }).Razorpay;
      if (!RazorpayCheckout) throw new Error("Razorpay Checkout is unavailable");
      const checkout = new RazorpayCheckout({
        key: paymentOrder.keyId,
        amount: paymentOrder.amount,
        currency: paymentOrder.currency,
        name: "PrintBee",
        description: `Payment for ${paymentOrder.orderNumber}`,
        order_id: paymentOrder.razorpayOrderId,
        // Razorpay requires an E.164 contact for the mobile UPI Intent flow.
        // Indian customer numbers are collected as ten digits elsewhere in this app.
        prefill: { name: customerName, email: viewer?.email, contact: mobileNumber ? `+91${mobileNumber}` : undefined },
        // Use Razorpay's documented display configuration to put its enabled UPI
        // methods first. On iPhone Safari this opens the UPI Intent app flow;
        // Razorpay shows a QR code automatically on desktop instead.
        config: {
          display: {
            blocks: {
              upi: { name: "Pay via UPI", instruments: [{ method: "upi" }] },
            },
            sequence: ["block.upi"],
            preferences: { show_default_blocks: true },
          },
        },
        theme: { color: "#e0ad00" },
        handler: async (result: RazorpayResult) => {
          try {
          const verifyResponse = await fetch("/api/payments/razorpay/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: order.id, ...result }) });
          const verified = await verifyResponse.json();
          if (!verifyResponse.ok) return setOrderError(verified.error ?? "Payment verification failed");
          setOrderResult((current) => current?.id === order.id ? { ...current, orderNumber: verified.orderNumber, paid: true, deliveryCode: verified.deliveryCode } : current);
          setCart([]);
          setNeedsPackaging(false);
          if ((order as any).pointsRedeemed) setPointsBalance((current) => Math.max(0, current - Number((order as any).pointsRedeemed)));
          customerFeedback('payment-verified');
          await checkCustomerNotifications();
          } catch (error) {
            setOrderError(error instanceof Error ? error.message : "Payment verification could not be completed. Please check your orders.");
          } finally { paymentDialogLock.current = false; setPaymentProcessing(false); }
        },
        modal: { ondismiss: () => { paymentDialogLock.current = false; setPaymentProcessing(false); } },
      });
      checkout.open();
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : "Payment could not be started");
      paymentDialogLock.current = false;
      setPaymentProcessing(false);
    }
  };

  const openMyOrders = async () => {
    if (!viewer) return setLoginOpen(true);
    setMyOrdersOpen(true);
    await refreshCustomerOrders();
  };

  const sendOrderNotification = async (title: string, body: string, tag: string) => {
    setNotificationToast({ title, body });
    navigator.vibrate?.([180, 80, 180]);
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.36);
    } catch {}
    if (!("Notification" in window) || Notification.permission !== "granted") return false;
    try {
      if ("serviceWorker" in navigator) {
        const registration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Service worker timeout")), 3000)),
        ]);
        await registration.showNotification(title, { body, tag, icon: "/printbee-logo.png", badge: "/printbee-logo.png" });
      } else {
        new Notification(title, { body, tag, icon: "/printbee-logo.png" });
      }
      return true;
    } catch {
      try {
        new Notification(title, { body, tag, icon: "/printbee-logo.png" });
        return true;
      } catch {
        return false;
      }
    }
  };

  const subscribeToBackgroundPush = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Background push is not supported on this device");
    const keyResponse = await fetch("/api/push/subscribe", { cache: "no-store" });
    const keyData = await keyResponse.json();
    if (!keyResponse.ok) throw new Error(keyData.error ?? "Push service is unavailable");
    const padding = "=".repeat((4 - keyData.publicKey.length % 4) % 4);
    const bytes = Uint8Array.from(atob((keyData.publicKey + padding).replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0));
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    const response = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription) });
    if (!response.ok) throw new Error("This device could not be registered for background alerts");
  };

  const enableNotifications = async () => {
    setNotificationMessage("");
    if (!("Notification" in window)) return setNotificationMessage("This browser does not support notifications. On iPhone, add PrintBee to the Home Screen and open it from there.");
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted") {
      setNotificationPromptOpen(false);
      window.localStorage.removeItem(`printbee-order-notifications-${viewer?.email ?? "user"}`);
      try { await subscribeToBackgroundPush(); } catch (error) { setNotificationMessage(error instanceof Error ? error.message : "Background push setup failed"); return; }
      const sent = await sendOrderNotification("PrintBee notifications enabled", "This is a test. Order updates will appear like this while PrintBee is open.", `printbee-enabled-${Date.now()}`);
      setNotificationMessage(sent ? "Background alerts enabled. Updates can arrive even when PrintBee is closed." : "Background alerts enabled for this device.");
    } else if (permission === "denied") {
      setNotificationPromptOpen(false);
      setNotificationMessage("Notifications are blocked. Allow them in your browser’s site settings, then reload PrintBee.");
    }
  };

  const testNotifications = async () => {
    const sent = await sendOrderNotification("PrintBee test notification", "Notifications are working on this device.", `printbee-test-${Date.now()}`);
    setNotificationMessage(sent ? "Test notification sent. Check your notification tray." : "The browser did not deliver the notification. Check site and device notification settings.");
  };

  const checkCustomerNotifications = refreshCustomerOrders;



  const markPaid = async (orderId: string) => {
    const response = await fetch("/api/admin/orders/mark-paid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }) });
    const data = await response.json();
    setAdminMessage(response.ok ? "Order marked paid." : data.error);
    await openAdminDashboard();
  };

  const cancelOrder = async (orderId: string) => {
    if (!window.confirm("Cancel this order because the paid amount does not match?")) return;
    const response = await fetch("/api/admin/orders/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, reason: "Payment amount mismatch" }),
    });
    const data = await response.json();
    setAdminMessage(response.ok ? "Order cancelled for payment amount mismatch." : data.error);
    await openAdminDashboard();
  };

  const reviewPayment = async (orderId: string, decision: "APPROVE" | "REJECT", missing?: "REFERENCE" | "AMOUNT" | "BOTH") => {
    const response = await fetch("/api/admin/orders/payment-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, decision, missing }) });
    const data = await response.json();
    setAdminMessage(response.ok ? (decision === "APPROVE" ? "Payment approved. Order can now move to printing." : data.reason) : data.error);
    await openAdminDashboard();
  };

  const deleteOrderFiles = async (orderId: string) => {
    if (!window.confirm("Delete the stored documents for this completed order? Order, customer and payment records will be preserved.")) return;
    const response = await fetch("/api/admin/orders/delete-files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }) });
    const data = await response.json();
    setAdminMessage(response.ok ? `${data.deleted} stored document${data.deleted === 1 ? "" : "s"} deleted. All order and payment records were preserved.` : data.error);
    await openAdminDashboard();
  };

  const uploadPaymentQr = async (orderId: string, file?: File) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/orders/${orderId}/payment-qr`, { method: "POST", body: form });
    const data = await response.json();
    setAdminMessage(response.ok ? "Order payment scanner uploaded. It is now visible to the customer and assigned rider." : data.error);
    await openAdminDashboard();
  };

  const deleteOrder = async (order: any) => {
    const confirmation = window.prompt(`Permanently delete only order ${order.order_number} and its stored documents? This cannot be undone. Type ${order.order_number} to continue.`);
    if (confirmation?.trim().toUpperCase() !== order.order_number) return setAdminMessage("Order deletion cancelled.");
    const response = await fetch("/api/admin/orders/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: order.id }),
    });
    const data = await response.json();
    setAdminMessage(response.ok ? `${data.orderNumber} and ${data.deletedFiles} stored file${data.deletedFiles === 1 ? "" : "s"} permanently deleted.` : data.error);
    if (response.ok) await openAdminDashboard();
  };

  const setOrderHidden = async (orderId: string, hidden: boolean) => {
    if (hidden && !window.confirm("Hide this order from the main dashboard, revenue, profit, location and rider totals, and all exports? You can restore it from Hidden orders.")) return;
    const response = await fetch("/api/admin/orders/visibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, hidden }),
    });
    const data = await response.json();
    setAdminMessage(response.ok ? (hidden ? "Order moved to Hidden orders." : "Order restored to the main dashboard and calculations.") : data.error);
    if (response.ok) await openAdminDashboard();
  };

  const exportOrdersPdf = async (range: "1d" | "30d" | "custom") => {
    if (range === "custom" && (!exportFrom || !exportTo)) return setAdminMessage("Choose both custom export dates.");
    setExporting(true);
    setAdminMessage("");
    try {
      const query = new URLSearchParams({ range });
      if (range === "custom") {
        query.set("from", exportFrom);
        query.set("to", exportTo);
      }
      const response = await fetch(`/api/admin/orders/export?${query}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Export could not be created");
      const pdf = await PDFDocument.create();
      const regular = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const pageSize: [number, number] = [841.89, 595.28];
      let page = pdf.addPage(pageSize);
      let y = 558;
      const columns = [36, 120, 252, 350, 442, 555, 664];
      const widths = [80, 128, 94, 88, 109, 105, 140];
      const clean = (value: unknown, width: number) => String(value ?? "-").replace(/[^\x20-\x7E]/g, " ").slice(0, width);
      const money = (value: unknown) => `INR ${(Number(value) / 100).toFixed(2)}`;
      const drawHeader = () => {
        page.drawRectangle({ x: 0, y: 528, width: pageSize[0], height: 68, color: rgb(0.07, 0.08, 0.11) });
        page.drawText("PRINTBEE", { x: 36, y: 566, size: 10, font: bold, color: rgb(0.96, 0.72, 0.02) });
        page.drawText("Orders report", { x: 36, y: 542, size: 20, font: bold, color: rgb(1, 1, 1) });
        page.drawText(`${new Date(data.from).toLocaleDateString("en-IN")} - ${new Date(data.to).toLocaleDateString("en-IN")}  |  Paid orders`, { x: 570, y: 545, size: 8, font: regular, color: rgb(.82, .84, .88) });
        y = 508;
        page.drawRectangle({ x: 32, y: y - 6, width: 778, height: 24, color: rgb(.94, .94, .92) });
        ["ORDER / DATE", "CUSTOMER", "LOCATION / RIDER", "PRINTING", "FEES", "TOTAL", "PAYMENT / STATUS"].forEach((label, index) => page.drawText(label, { x: columns[index], y: y + 2, size: 7, font: bold, color: rgb(.25, .27, .3) }));
        y -= 20;
      };
      drawHeader();
      let collected = 0;
      for (const order of data.orders as any[]) {
        if (y < 58) {
          page = pdf.addPage(pageSize);
          drawHeader();
        }
        collected += order.payment_status === "PAID" ? Number(order.total_paise) : 0;
        if ((data.orders.indexOf(order) % 2) === 0) page.drawRectangle({ x: 32, y: y - 30, width: 778, height: 44, color: rgb(.985, .982, .97) });
        const feeLine1 = `D ${money(order.delivery_fee_paise)} | P ${money(order.platform_fee_paise)}`;
        const extras = Number(order.packaging_fee_paise) + Number(order.payment_gateway_fee_paise) + Number(order.surge_fee_paise) + Number(order.late_night_fee_paise);
        const cells = [
          [clean(order.order_number, 18), new Date(order.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })],
          [clean(order.customer_name, 24), clean(`${order.mobile_number} | ${order.customer_email}`, 34)],
          [clean(order.location_name, 22), clean(order.rider_email || "Not assigned", 24)],
          [money(order.printing_subtotal_paise), `${JSON.parse(order.items_json || "[]").length} item(s)`],
          [feeLine1, `Other ${money(extras)}`],
          [money(order.total_paise), Number(order.points_discount_paise) ? `Discount ${money(order.points_discount_paise)}` : "No discount"],
          [clean(order.payment_reference || order.payment_status, 26), clean(order.status, 24)],
        ];
        cells.forEach((lines, index) => { page.drawText(clean(lines[0], Math.floor(widths[index] / 4.2)), { x: columns[index], y, size: 7.4, font: bold }); page.drawText(clean(lines[1], Math.floor(widths[index] / 3.7)), { x: columns[index], y: y - 13, size: 6.5, font: regular, color: rgb(.38, .4, .44) }); });
        page.drawLine({ start: { x: 32, y: y - 31 }, end: { x: 810, y: y - 31 }, thickness: .5, color: rgb(.86, .86, .83) });
        y -= 44;
      }
      if (!data.orders.length) page.drawText("No paid orders were found in this date range.", { x: 36, y, size: 11, font: regular });
      pdf.getPages().forEach((reportPage, index) => { reportPage.drawText(`Paid orders: ${data.orders.length}   |   Collected: INR ${(collected / 100).toFixed(2)}`, { x: 36, y: 24, size: 8, font: bold }); reportPage.drawText(`Page ${index + 1} of ${pdf.getPageCount()}`, { x: 750, y: 24, size: 7, font: regular }); });
      const bytes = await pdf.save();
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `printbee-orders-${range === "custom" ? `${exportFrom}-to-${exportTo}` : range}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      setAdminMessage(`PDF exported with ${data.orders.length} visible order${data.orders.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : "Export could not be created");
    } finally {
      setExporting(false);
    }
  };

  const openAdminDashboard = async (page = adminPage) => {
    setAdminOpen(true);
    const [response, storeResponse] = await Promise.all([fetch(`/api/admin/dashboard?page=${page}&pageSize=100`), fetch("/api/admin/store-location")]);
    if (response.ok) { setDashboard(await response.json()); setAdminPage(page); }
    if (storeResponse.ok) { const store = await storeResponse.json(); if (store.latitude != null) { setStoreLocation(store); setNewFranchise((current) => ({ ...current, name: current.name || store.name || "" })); } }
    const franchiseResponse = await fetch("/api/franchise/stores", { cache: "no-store" });
    if (franchiseResponse.ok) setFranchiseStores(await franchiseResponse.json());
    const applicationsResponse = await fetch("/api/franchise/applications", { cache: "no-store" });
    if (applicationsResponse.ok) setFranchiseApplications(await applicationsResponse.json());
  };

  const submitFranchiseApplication = async () => {
    const response = await fetch("/api/franchise/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(franchiseApplication) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setFranchiseApplyMessage(data.error ?? "Application could not be submitted.");
    setFranchiseApplyMessage("Application submitted. The PrintBee team will review it shortly.");
  };

  const nameCurrentStore = async () => {
    if (storeLocation?.latitude == null) return setAdminMessage("Set the current store location before naming it.");
    const name = window.prompt("Name this store", storeLocation?.name ?? "");
    if (name == null) return;
    const response = await fetch("/api/admin/store-location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setAdminMessage(data.error ?? "Store name could not be saved.");
    setStoreLocation(data);
    setNewFranchise((current) => ({ ...current, name: data.name }));
    setAdminMessage(`Current store named ${data.name}.`);
  };

  const openLedger = async () => {
    setAdminSection("ledger");
    setLedgerMessage("");
    let response = await fetch("/api/admin/ledger", { cache: "no-store" });
    if (response.ok) {
      setLedger(await response.json());
      window.setTimeout(() => document.getElementById("admin-ledger")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      return;
    }
    window.setTimeout(() => document.getElementById("admin-ledger")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  const addFranchiseStore = async () => {
    const response = await fetch("/api/franchise/stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newFranchise) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setAdminMessage(data.error ?? "Franchise store could not be added.");
    setNewFranchise({ name: "" });
    setAdminMessage(`${data.name} is ready with a 5 km delivery radius.`);
    const refreshed = await fetch("/api/franchise/stores", { cache: "no-store" });
    if (refreshed.ok) setFranchiseStores(await refreshed.json());
  };

  const addFranchiseManager = async (storeId: string) => {
    const email = franchiseManagerEmails[storeId] ?? "";
    const response = await fetch(`/api/franchise/stores/${storeId}/managers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setAdminMessage(data.error ?? "Store manager could not be added.");
    setFranchiseManagerEmails((current) => ({ ...current, [storeId]: "" }));
    setAdminMessage(`${data.email} can now manage this store's orders.`);
    const refreshed = await fetch("/api/franchise/stores", { cache: "no-store" });
    if (refreshed.ok) setFranchiseStores(await refreshed.json());
  };

  const removeFranchiseManager = async (storeId: string, email: string) => {
    const response = await fetch(`/api/franchise/stores/${storeId}/managers`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setAdminMessage(data.error ?? "Store manager could not be removed.");
    setAdminMessage(`${email} no longer has access to this store.`);
    const refreshed = await fetch("/api/franchise/stores", { cache: "no-store" });
    if (refreshed.ok) setFranchiseStores(await refreshed.json());
  };

  const updateFranchiseApplication = async (id: string, status: string) => {
    const response = await fetch("/api/franchise/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    if (!response.ok) return setAdminMessage("Application status could not be updated.");
    setFranchiseApplications((current) => current.map((application) => application.id === id ? { ...application, status } : application));
  };

  const lockLedger = async () => {
    await fetch("/api/admin/ledger", { method: "DELETE", keepalive: true }).catch(() => {});
    setLedger(null);
    setLedgerPassword("");
    setLedgerMessage("");
  };

  const selectAdminSection = async (section: typeof adminSection) => {
    if (section === "ledger") { await openLedger(); return; }
    if (ledger || adminSection === "ledger") await lockLedger();
    setAdminSection(section);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeAdminDashboard = async () => {
    if (ledger || adminSection === "ledger") await lockLedger();
    setAdminSection("dashboard");
    setAdminOpen(false);
  };

  useEffect(() => {
    if (!ledger) return;
    const lockOnExit = () => { void lockLedger(); };
    window.addEventListener("pagehide", lockOnExit);
    return () => window.removeEventListener("pagehide", lockOnExit);
  }, [ledger]);

  const unlockLedger = async () => {
    setLedgerMessage("");
    const response = await fetch("/api/admin/ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: ledgerPassword }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setLedgerMessage(result.error ?? "Ledger could not be unlocked"); return; }
    setLedgerPassword("");
    const dataResponse = await fetch("/api/admin/ledger", { cache: "no-store" });
    if (dataResponse.ok) setLedger(await dataResponse.json());
  };

  const updateOrderStatus = async (orderId: string, status: string) => {
    await fetch("/api/admin/orders/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, status }) });
    await openAdminDashboard();
  };

  const assignRider = async (orderId: string, riderEmail: string) => {
    if (!riderEmail) return;
    const response = await fetch("/api/admin/orders/assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, riderEmail }) });
    const data = await response.json();
    if (!response.ok) setAdminMessage(data.error);
    await openAdminDashboard();
  };

  const setRiderAvailability = async (available: boolean) => {
    const response = await fetch("/api/rider/availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ available }) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setIsRiderAvailable(Boolean(data.isAvailable)); else setDeliveryMessage(data.error ?? "Availability could not be updated");
  };

  const rejectRiderOrder = async (orderId: string) => {
    const response = await fetch("/api/rider/orders/reject", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }) });
    const data = await response.json().catch(() => ({}));
    setDeliveryMessage(response.ok ? "Assignment rejected. The admin can now choose another available rider." : data.error);
    if (response.ok) await loadRiderOrders();
  };

  const grantOrderPoints = async (orderId: string) => {
    const points = Math.round(Number(grantPointDrafts[orderId]));
    if (!points) return;
    const response = await fetch("/api/admin/orders/points", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, points }) });
    const data = await response.json().catch(() => ({}));
    setAdminMessage(response.ok ? `${points} wallet points credited to the customer.` : data.error ?? "Points could not be credited");
    if (response.ok) setGrantPointDrafts((drafts) => ({ ...drafts, [orderId]: "" }));
  };

  const saveAdminMember = async () => {
    const response = await fetch("/api/admin/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newAdminMember) });
    const data = await response.json();
    setAdminMessage(response.ok ? `${data.email} saved as ${data.role.toLowerCase()}.` : data.error ?? "Admin member could not be saved");
    if (response.ok) { setNewAdminMember({ email: "", role: "OPERATIONS" }); await openAdminDashboard(); }
  };

  const removeAdminMember = async (email: string) => {
    if (!window.confirm(`Remove admin access for ${email}?`)) return;
    const response = await fetch("/api/admin/members", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const data = await response.json();
    setAdminMessage(response.ok ? `${email} removed from the admin team.` : data.error ?? "Admin member could not be removed");
    if (response.ok) await openAdminDashboard();
  };

  const linkExistingReferral = async () => {
    setWalletMessage("");
    const response = await fetch("/api/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ referralCode }) });
    const data = await response.json().catch(() => ({}));
    setWalletMessage(response.ok ? "Referral code verified. You are now linked to future referral offers." : data.error ?? "Referral code could not be verified");
    if (response.ok) { setHasReferrer(true); window.localStorage.removeItem("printbee-referral-code"); }
  };

  const shareReferral = async () => {
    const link = `${window.location.origin}/?ref=${encodeURIComponent(myReferralCode)}`;
    try {
      if (navigator.share) await navigator.share({ title: "PrintBee", text: `Use my PrintBee referral code ${myReferralCode}`, url: link });
      else { await navigator.clipboard.writeText(link); setWalletMessage("Referral link copied to your clipboard."); }
    } catch { /* The user can cancel the share sheet. */ }
  };

  const submitFeedback = async () => {
    setFeedbackMessage("");
    const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: feedbackOrder?.id, ...feedback }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setFeedbackMessage(data.error ?? "Feedback could not be submitted");
    setFeedbackMessage("Thank you! Your feedback was submitted.");
    setMyOrders((orders) => orders.map((order) => order.id === feedbackOrder.id ? { ...order, feedback_submitted: 1 } : order));
    window.setTimeout(() => { setFeedbackOrder(null); setFeedbackMessage(""); }, 900);
  };

  const addLocation = async () => {
    const response = await fetch("/api/locations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newLocation }) });
    const data = await response.json();
    setAdminMessage(response.ok ? `Location “${data.name}” added.` : data.error);
    if (response.ok) setNewLocation("");
  };

  const addAgent = async () => {
    const response = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: agentEmail }) });
    const data = await response.json();
    setAdminMessage(response.ok ? `${data.email} can now verify deliveries.` : data.error);
    if (response.ok) setAgentEmail("");
  };

  const addPrintService = async () => {
    const response = await fetch("/api/print-services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newService) });
    const data = await response.json();
    setAdminMessage(response.ok ? `${data.name} saved in the customer service options.` : data.error);
    if (response.ok) {
      setNewService({ id: "", name: "", description: "", isBinding: false, countsForPackaging: true, price: 0 });
      const servicesResponse = await fetch("/api/print-services");
      if (servicesResponse.ok) setPrintServices(await servicesResponse.json());
    }
  };

  const removePrintService = async (id: string) => {
    const response = await fetch("/api/print-services", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (response.ok) setPrintServices((items) => items.filter((item) => item.id !== id));
  };

  const saveAddon = async () => {
    const response = await fetch("/api/addons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newAddon) });
    const data = await response.json().catch(() => ({}));
    setAdminMessage(response.ok ? `${data.name} saved in add-ons.` : data.error ?? "Add-on could not be saved.");
    if (response.ok) {
      setNewAddon({ id: "", name: "", description: "", price: 0 });
      const addonsResponse = await fetch("/api/addons", { cache: "no-store" });
      if (addonsResponse.ok) setAddons(await addonsResponse.json());
    }
  };

  const removeAddon = async (id: string) => {
    const response = await fetch("/api/addons", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (response.ok) {
      setAddons((items) => items.filter((item) => item.id !== id));
      setSelectedAddonIds((ids) => ids.filter((item) => item !== id));
    }
  };

  const recordRiderPayment = async () => {
    const response = await fetch("/api/admin/rider-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...riderPayment, amount: Number(riderPayment.amount) }),
    });
    const data = await response.json();
    setAdminMessage(response.ok ? "Rider payment recorded successfully." : data.error);
    if (response.ok) {
      setRiderPayment((current) => ({ ...current, amount: "", note: "" }));
      await openAdminDashboard();
    }
  };

  const updateLocationFees = async (locationId: string, deliveryFee: number, platformFee: number) => {
    const response = await fetch("/api/admin/locations/fees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId, deliveryFee, platformFee }) });
    const data = await response.json();
    setAdminMessage(response.ok ? "Location fees updated." : data.error);
    await openAdminDashboard();
  };

  const editLocationFees = async (location: any) => {
    const delivery = window.prompt(`Delivery charge for ${location.name} (₹)`, String((location.delivery_fee_paise ?? 1500) / 100));
    if (delivery === null) return;
    const platform = window.prompt(`Platform fee for ${location.name} (₹)`, String((location.platform_fee_paise ?? 350) / 100));
    if (platform === null) return;
    await updateLocationFees(location.id, Number(delivery), Number(platform));
  };

  const renameLocation = async (location: any) => {
    const name = window.prompt("Enter the new delivery location name", location.name);
    if (!name || name.trim() === location.name) return;
    const response = await fetch("/api/admin/locations/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId: location.id, action: "RENAME", name }) });
    const data = await response.json();
    setAdminMessage(response.ok ? `Location renamed to ${data.name}.` : data.error);
    await openAdminDashboard();
  };

  const deleteLocation = async (location: any) => {
    if (!window.confirm(`Remove "${location.name}" from customer delivery options? Historical order records will be preserved.`)) return;
    const response = await fetch("/api/admin/locations/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId: location.id, action: "DELETE" }) });
    const data = await response.json();
    setAdminMessage(response.ok ? `${location.name} removed from delivery options.` : data.error);
    await openAdminDashboard();
  };

  const approveRider = async (email: string, approved: boolean) => {
    const response = await fetch("/api/admin/riders/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, approved }) });
    const data = await response.json();
    setAdminMessage(response.ok ? `Rider application ${approved ? "approved" : "rejected"}.` : data.error);
    await openAdminDashboard();
  };

  const removeRider = async (email: string) => {
    if (!window.confirm(`Remove ${email} from the delivery application? Their completed ride and payment history will be preserved.`)) return;
    const response = await fetch("/api/admin/riders/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const data = await response.json();
    setAdminMessage(response.ok ? "Delivery partner removed. Active assigned orders were returned to ready for pickup." : data.error);
    await openAdminDashboard();
  };

  const updateWithdrawalStatus = async (withdrawalId: string, status: string) => {
    const response = await fetch("/api/admin/withdrawals/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ withdrawalId, status }) });
    const data = await response.json();
    setAdminMessage(response.ok ? "Withdrawal status updated." : data.error);
    await openAdminDashboard();
  };

  const submitRiderApplication = async () => {
    if (!viewer) return setAuthMessage("Sign in with Google first, then choose delivery partner registration again.");
    const response = await fetch("/api/rider/application", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(riderApplication) });
    const data = await response.json();
    setAuthMessage(response.ok ? "Details submitted. Once verified by admin, you can continue as a delivery partner." : data.error);
    if (response.ok) setApprovalStatus("PENDING");
  };

  const verifyDelivery = async () => {
    const response = await fetch("/api/orders/verify-delivery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderNumber: deliveryOrderNumber, code: deliveryCode }) });
    const data = await response.json();
    setDeliveryMessage(response.ok ? "Delivery verified. Order marked delivered ✓" : data.error);
    if (response.ok) {
      await sendOrderNotification("Delivery completed", `${deliveryOrderNumber} was delivered. Its uploaded documents have been permanently deleted.`, `${deliveryOrderNumber}-delivered`);
      setDeliveryOrderNumber("");
      setDeliveryCode("");
      await loadRiderOrders();
    }
  };

  const loadRiderOrders = async () => {
    const [response, storeResponse] = await Promise.all([fetch("/api/rider/orders"), fetch("/api/rider/store-location")]);
    if (storeResponse.ok) {
      const store = await storeResponse.json();
      setRiderStoreLocation(store.latitude != null && store.longitude != null ? store : null);
    }
    if (response.ok) {
      const orders = await response.json() as any[];
      setRiderOrders(orders);
      if (!viewer?.isAdmin) {
        const storageKey = `printbee-rider-notifications-${viewer?.email ?? "rider"}`;
        const previous = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Record<string, any>;
        for (const order of orders) {
          const before = previous[order.id];
          if (!before) await sendOrderNotification("Order assigned", `${order.order_number} is assigned to you for delivery.`, `${order.id}-rider-assigned`);
          if (order.has_payment_qr && !before?.has_payment_qr) await sendOrderNotification("Payment QR ready", `${order.order_number}: the admin payment scanner is ready to show the customer.`, `${order.id}-rider-qr`);
          if (order.payment_status === "PAID" && before?.payment_status !== "PAID") await sendOrderNotification("Payment verified", `${order.order_number} is paid. The scanner has been removed; collect only the delivery OTP.`, `${order.id}-rider-paid`);
          if (before?.status && order.status !== before.status) await sendOrderNotification("Order updated", `${order.order_number} is now ${String(order.status).replaceAll("_", " ").toLowerCase()}.`, `${order.id}-${order.status}`);
        }
        const snapshot = Object.fromEntries(orders.map((order) => [order.id, { status: order.status, payment_status: order.payment_status, has_payment_qr: Boolean(order.has_payment_qr) }]));
        window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
      }
    }
    if (!viewer?.isAdmin) {
      const earningsResponse = await fetch("/api/rider/earnings");
      if (earningsResponse.ok) setRiderEarnings(await earningsResponse.json());
    }
  };

  const loadFranchiseOrders = async () => { const response = await fetch("/api/franchise/operations", { cache: "no-store" }); if (response.ok) setFranchiseOrders((await response.json()).orders ?? []); };
  const loadFranchiseSettings = async () => { const response = await fetch("/api/franchise/settings", { cache: "no-store" }); if (response.ok) setFranchiseSettings(await response.json()); };
  const saveFranchiseSettings = async (setting: any) => { const response = await fetch("/api/franchise/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(setting) }); if (!response.ok) return; await loadFranchiseSettings(); };

  const requestWithdrawal = async () => {
    const response = await fetch("/api/rider/earnings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ upiId: withdrawUpi }) });
    const data = await response.json();
    setDeliveryMessage(response.ok ? `Withdrawal requested for ${inr.format(data.amountPaise / 100)}.` : data.error);
    if (response.ok) { setWithdrawUpi(""); await loadRiderOrders(); }
  };

  const openDeliveryQueue = async () => {
    await loadRiderOrders();
    setDeliveryOpen(true);
  };

  const isPlagiarismOnly = cart.length > 0 && cart.every((item) => item.serviceId === PLAGIARISM_SERVICE_ID);
  const checkoutDeliveryFee = isPlagiarismOnly ? 0 : calculatedDeliveryFee ?? 0;
  const checkoutIncampusFee = isPlagiarismOnly ? 0 : incampusDelivery ? 10 : 0;
  const checkoutPlatformFee = isPlagiarismOnly ? 0 : platformFee;
  const surgeBase = cartTotal + checkoutDeliveryFee + checkoutPlatformFee;
  const checkoutSurgeFee = isPlagiarismOnly ? 0 : surgeEnabled ? surgeType === "FIXED" ? surgeValue : surgeBase * surgeValue / 100 : 0;
  const checkoutLateNightFee = isPlagiarismOnly ? 0 : lateNightEnabled ? lateNightType === "FIXED" ? lateNightValue : surgeBase * lateNightValue / 100 : 0;
  const checkoutGatewayFee = isPlagiarismOnly ? cartTotal * PLAGIARISM_GATEWAY_PERCENT / 100 : gatewayEnabled ? (cartTotal + checkoutDeliveryFee + checkoutIncampusFee + checkoutPlatformFee) * gatewayFeePercent / 100 : 0;
  const checkoutPackagingFee = isPlagiarismOnly ? 0 : packagingEnabled && needsPackaging ? packagingFee : 0;
  const checkoutBeforePoints = cartTotal + checkoutDeliveryFee + checkoutIncampusFee + checkoutPlatformFee + checkoutPackagingFee + checkoutSurgeFee + checkoutLateNightFee + checkoutGatewayFee;
  const redeemablePoints = Math.min(pointsBalance, Math.max(0, Math.floor((checkoutBeforePoints - 1) * 15)));
  const pointsDiscount = usePoints ? Math.floor(redeemablePoints * 100 / 15) / 100 : 0;
  const revenueNow = new Date();
  const revenueStart = dashboardRange === "today" ? new Date(revenueNow.getFullYear(), revenueNow.getMonth(), revenueNow.getDate()) : dashboardRange === "week" ? new Date(revenueNow.getFullYear(), revenueNow.getMonth(), revenueNow.getDate() - 6) : dashboardRange === "month" ? new Date(revenueNow.getFullYear(), revenueNow.getMonth(), 1) : null;
  const dashboardOrdersForRange = (dashboard?.summaryOrders ?? dashboard?.orders ?? []).filter((order: any) => !revenueStart || new Date(order.created_at) >= revenueStart);
  const paidDashboardOrdersForRange = dashboardOrdersForRange.filter((order: any) => order.payment_status === "PAID");
  const revenueTotals = revenueSummary(paidDashboardOrdersForRange, prices);
  const dashboardSummaryForRange = {
    total: dashboardOrdersForRange.length,
    paid: dashboardOrdersForRange.filter((order: any) => order.payment_status === "PAID").length,
    unpaid: dashboardOrdersForRange.filter((order: any) => order.payment_status !== "PAID").length,
    delivered: dashboardOrdersForRange.filter((order: any) => order.status === "DELIVERED").length,
    ready: dashboardOrdersForRange.filter((order: any) => order.status === "READY_FOR_PICKUP").length,
    revenuePaise: paidDashboardOrdersForRange.reduce((sum: number, order: any) => sum + (Number(order.total_paise) || 0), 0),
  };
  const printTotalsForRange = printSummary(dashboardOrdersForRange.flatMap((order: any) => order.items || []));
  const visibleAdminOrders = (dashboard?.orders ?? []).filter((order: any) => {
    const term = adminOrderSearch.trim().toLowerCase();
    const matchesSearch = !term || [order.order_number, order.customer_name, order.customer_email, order.mobile_number, order.location_name, order.rider_email].some((value) => String(value ?? "").toLowerCase().includes(term));
    return matchesSearch && (adminOrderStatus === "ALL" || order.status === adminOrderStatus);
  });

  if (viewer && !viewer.isAdmin && hasFranchiseAccess && loginMode !== "PARTNER") {
    return <main className="partner-portal"><header className="partner-topbar"><div className="partner-brand"><img src="/printbee-logo.png" alt="PrintBee" /><span><b>PrintBee</b><small>Franchise operations</small></span></div><button onClick={signOut}>Sign out</button></header><section className="partner-portal-main"><div className="partner-welcome"><div><div className="admin-badge">FRANCHISE STORE</div><h1>Your store orders</h1><p>Only orders routed to your assigned franchise are visible here.</p></div><button onClick={() => { void loadFranchiseOrders(); void loadFranchiseSettings(); }}>Refresh orders</button></div><div className="assigned-orders">{franchiseOrders.length ? franchiseOrders.map((order) => <article key={order.id}><div><strong>{order.order_number}</strong><small>{order.franchise_store_name} · {order.customer_name} · {order.mobile_number}</small><small>{order.location_name}</small></div><strong>{inr.format(order.total_paise / 100)}</strong><select value={order.status} onChange={async (event) => { await fetch("/api/franchise/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: order.id, status: event.target.value }) }); await loadFranchiseOrders(); }}><option value="CONFIRMED">Confirmed</option><option value="PRINTING">Printing</option><option value="READY_FOR_PICKUP">Ready for pickup</option><option value="RIDER_ASSIGNED">Rider assigned</option><option value="DELIVERED">Delivered</option></select></article>) : <div className="empty-partner-orders">No assigned franchise orders yet. Refresh after customers place orders near your store.</div>}</div><section className="assigned-orders"><div className="section-title"><div><h2>Store prices & delivery</h2><p>These settings apply only to your franchise. Platform fee is fixed at ₹1.50 and gateway fee is 1%.</p></div></div>{franchiseSettings.map((setting) => <div className="franchise-setting-grid" key={setting.store_id}>{[["B&W single", "bw_single_paise"],["B&W double", "bw_double_paise"],["Colour single", "colour_single_paise"],["Colour double", "colour_double_paise"],["Base delivery", "delivery_base_fee_paise"],["Extra / 100m", "delivery_fee_per_100m_paise"]].map(([label,key]) => <label key={key}>{label} (₹)<input type="number" min="0" step=".01" value={Number(setting[key]) / 100} onChange={(e) => setFranchiseSettings((current) => current.map((row) => row.store_id === setting.store_id ? { ...row, [key]: Math.round(Number(e.target.value) * 100) } : row))} /></label>)}<button onClick={() => saveFranchiseSettings({ storeId: setting.store_id, bwSinglePaise: setting.bw_single_paise, bwDoublePaise: setting.bw_double_paise, colourSinglePaise: setting.colour_single_paise, colourDoublePaise: setting.colour_double_paise, deliveryBaseFeePaise: setting.delivery_base_fee_paise, deliveryFeePer100mPaise: setting.delivery_fee_per_100m_paise })}>Save store pricing</button></div>)}</section></section></main>;
  }

  if (!viewer?.isAdmin && storeSelectionReady && !selectedStoreId && availableStores.length) {
    return <main className="store-selection-screen"><section className="store-selection-card"><img src="/printbee-logo.png" alt="PrintBee" /><p className="eyebrow">CHOOSE YOUR PRINTBEE STORE</p><h1>Which location should serve you?</h1><p>Select your nearest store to continue. We will confirm that your delivery address is within its 5 km service area at checkout.</p><div className="store-choice-grid">{availableStores.map((store) => <button key={store.id} type="button" className="store-choice" onClick={() => { window.localStorage.setItem("printbee-selected-store", store.id); setSelectedStoreId(store.id); }}><span>⌖</span><strong>{store.name}</strong><small>Serves within {Math.round(store.radius_meters / 1000)} km</small><b>Choose store →</b></button>)}</div></section></main>;
  }

  if (viewer && !viewer.isAdmin && loginMode === "PARTNER") {
    const partnerApproved = role === "AGENT" && approvalStatus === "APPROVED";
    return (
      <main className="partner-portal">
        <header className="partner-topbar">
          <a className="brand" href="#" aria-label="PrintBee delivery partner"><img src="/printbee-logo.png" width={60} height={60} alt="PrintBee" /><span><strong>Print<span>Bee</span></strong><small>Delivery Partner</small></span></a>
          <div><button onClick={() => switchLoginMode("CUSTOMER")}>Use PrintBee as customer</button><button onClick={signOut}>Sign out</button></div>
        </header>
        {!partnerApproved ? (
          <section className="partner-application-card">
            <div className="admin-badge">DELIVERY PARTNER APPLICATION</div>
            <h1>{approvalStatus === "PENDING" ? "Verification pending" : "Complete your rider profile"}</h1>
            {approvalStatus === "PENDING" ? <p>Your details were submitted successfully. Once verified by the admin, you can continue as a delivery partner.</p> : <>
              <p>You are signed in with <strong>{viewer.email}</strong>. Enter your details and submit them for admin verification.</p>
              <label>Full name<input value={riderApplication.name} onChange={(e) => setRiderApplication({ ...riderApplication, name: e.target.value })} placeholder="Your full name" /></label>
              <label>Mobile number<input inputMode="numeric" value={riderApplication.mobileNumber} onChange={(e) => setRiderApplication({ ...riderApplication, mobileNumber: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="10-digit mobile number" /></label>
              <button disabled={!riderApplication.name.trim() || riderApplication.mobileNumber.length !== 10} onClick={submitRiderApplication}>Submit for admin verification</button>
            </>}
            {approvalStatus === "REMOVED" && <p className="customer-error">Your delivery-partner access was removed. You may submit your details again for a new admin review.</p>}
            {authMessage && <p className="auth-message">{authMessage}</p>}
          </section>
        ) : (
          <div className="partner-dashboard">
            <section className="partner-welcome"><div><div className="admin-badge">DELIVERY PARTNER</div><h1>Your delivery dashboard</h1><p>Only orders assigned to your account are shown here.</p></div><div className="availability-control"><span>Available for delivery</span><button role="switch" aria-checked={isRiderAvailable} className={`availability-toggle ${isRiderAvailable ? "available" : ""}`} onClick={() => setRiderAvailability(!isRiderAvailable)}><i /><b>{isRiderAvailable ? "YES" : "NO"}</b></button>{riderStoreLocation && <a href={`https://www.google.com/maps/dir/?api=1&destination=${riderStoreLocation.latitude},${riderStoreLocation.longitude}`} target="_blank" rel="noreferrer">Navigate to store</a>}<button onClick={loadRiderOrders}>Refresh orders</button></div></section>
            {riderEarnings && <section className="partner-earnings">
              <div><small>Successful rides</small><strong>{riderEarnings.totalRides}</strong></div><div><small>Total earnings</small><strong>{inr.format(riderEarnings.earnedPaise / 100)}</strong></div><div><small>Available balance</small><strong>{inr.format(riderEarnings.availablePaise / 100)}</strong></div>
              <p>You earn 75% of the delivery fee plus the full ₹10 in-campus delivery fee for each OTP-verified in-campus delivery.</p>
              <label>UPI ID<input value={withdrawUpi} onChange={(e) => setWithdrawUpi(e.target.value)} placeholder="yourname@upi" /></label><button disabled={riderEarnings.availablePaise <= 0 || !withdrawUpi.trim()} onClick={requestWithdrawal}>Withdraw available earnings</button>
              <div className="partner-withdrawal-history">{riderEarnings.withdrawals?.map((withdrawal: any) => <span key={withdrawal.id}><b>{inr.format(withdrawal.amount_paise / 100)}</b><small>{withdrawal.status === "REQUESTED" ? "Withdraw requested" : withdrawal.status === "IN_PROGRESS" ? "In progress" : "Amount sent to bank"} · {withdrawal.upi_id}</small></span>)}</div>
              <div className="rider-order-earnings"><h3>Earnings by delivered order</h3>{riderEarnings.deliveredOrders?.length ? riderEarnings.deliveredOrders.map((order: any) => <article key={order.id}><span><b>{order.order_number}</b><small>{order.location_name} · {new Date(order.delivered_at).toLocaleDateString("en-IN")}</small></span><strong>{inr.format(order.earned_paise / 100)}<small>75% of {inr.format(order.delivery_fee_paise / 100)}</small></strong></article>) : <p>No completed delivery earnings yet.</p>}</div>
            </section>}
            <section className="assigned-orders"><div className="section-title"><div><h2>Assigned orders</h2><p>One rider can receive multiple orders, including several orders at the same location.</p></div><span>{riderOrders.length} active</span></div>
              {riderOrders.length ? riderOrders.map((order) => <article key={order.order_number} className={deliveryOrderNumber === order.order_number ? "selected" : ""}><div><strong>{order.order_number}</strong><small>{order.location_name}</small>{Boolean(order.incampus_delivery) && <small><b>In-campus {order.incampus_type === "CLASSROOM" ? "classroom" : "hostel"}:</b> {order.campus_building}{order.classroom_number ? ` · Room ${order.classroom_number}` : ""}</small>}</div><div><strong>{order.customer_name}</strong><small className="customer-phone">{order.mobile_number}</small></div><span className="status-chip">{order.payment_status === "PAID" ? "PAYMENT VERIFIED" : order.status}</span><div className="delivery-actions"><a href={`tel:${order.mobile_number}`} aria-label={`Call ${order.customer_name} at ${order.mobile_number}`}>Call customer</a>{order.delivery_latitude != null && order.delivery_longitude != null && <a href={`https://www.google.com/maps/dir/?api=1&destination=${order.delivery_latitude},${order.delivery_longitude}`} target="_blank" rel="noreferrer">Navigate</a>}<button onClick={() => { setDeliveryOrderNumber(order.order_number); setDeliveryCode(""); }}>{order.payment_status === "PAID" ? "Enter delivery OTP" : "Deliver & verify OTP"}</button><button className="reject-assignment" onClick={() => rejectRiderOrder(order.id)}>Reject assignment</button></div>{Boolean(order.has_payment_qr) && order.payment_status !== "PAID" && <div className="order-payment-qr"><div><strong>Collect {inr.format(order.total_paise / 100)}</strong><small>Show this scanner to the customer for pay on delivery. Tap the scanner to enlarge.</small></div><button className="scanner-expand-button" onClick={() => setExpandedScanner({ src: `/api/orders/${order.id}/payment-qr`, alt: `Payment scanner for ${order.order_number}` })}><img src={`/api/orders/${order.id}/payment-qr`} alt={`Payment scanner for ${order.order_number}`} /></button></div>}{order.payment_status === "PAID" && <div className="payment-cleared-note"><strong>Payment received and verified</strong><small>No payment scanner is required. Collect the customer OTP after handing over the order.</small></div>}</article>) : <div className="empty-partner-orders">No active orders are assigned to you.</div>}
            </section>
            {deliveryOrderNumber && <section className="otp-verification"><div><div className="admin-badge">FINAL DELIVERY STEP</div><h2>Verify customer OTP</h2><p>Order <strong>{deliveryOrderNumber}</strong>. Hand over the prints first, then ask the customer for the six-digit OTP.</p></div><label>Customer OTP<input className="code-input" value={deliveryCode} onChange={(e) => setDeliveryCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" inputMode="numeric" /></label><button disabled={deliveryCode.length !== 6} onClick={verifyDelivery}>Verify OTP & mark delivered</button></section>}
            {deliveryMessage && <p className="partner-message">{deliveryMessage}</p>}
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="printbee-experience">
      <CustomerMotion hidden={adminOpen || loginOpen || paymentProcessing} />
      {viewer && <ActiveOrderWidget key={viewer.email} email={viewer.email} orders={myOrders} error={customerOrderError} refresh={refreshCustomerOrders} details={() => void openMyOrders()} hidden={adminOpen || loginOpen || checkoutOpen || paymentProcessing || myOrdersOpen || walletOpen || profileOpen || franchiseApplyOpen || Boolean(editingCartItem) || Boolean(feedbackOrder) || Boolean(expandedScanner) || notificationPromptOpen || Boolean(notificationToast)} />}
      <DialogAccessibility />
      <a className="skip-link" href="#upload">Skip to upload</a>
      <GlassPresence>{notificationPromptOpen && (
        <div className="modal-backdrop notification-permission-backdrop" role="presentation">
          <section className="notification-permission-modal" role="dialog" aria-modal="true" aria-labelledby="notification-permission-title">
            <img src="/printbee-logo.png" width={76} height={76} alt="PrintBee" />
            <h2 id="notification-permission-title">Allow order notifications?</h2>
            <p>Get alerts when an order is created, the admin uploads a payment QR, printing starts, a rider is assigned, payment is verified, and delivery is completed.</p>
            <button className="save-button" onClick={enableNotifications}>Allow notifications</button>
            <button className="notification-later" onClick={() => setNotificationPromptOpen(false)}>Not now</button>
          </section>
        </div>
      )}</GlassPresence>
      {notificationToast && <div className="notification-toast" role="status" aria-live="assertive"><span>🔔</span><div><strong>{notificationToast.title}</strong><p>{notificationToast.body}</p></div><button onClick={() => setNotificationToast(null)} aria-label="Dismiss notification">×</button></div>}
      <header className="topbar">
        <a className="brand" href="#top" aria-label="PrintBee home">
          <img src="/printbee-logo.png" width={74} height={74} alt="PrintBee" />
          <span><strong>Print<span>Bee</span></strong><small>Upload. Print. Delivered.</small></span>
        </a>
        <GlassNav aria-label="Main navigation">
          <a href="#how">How it works</a>
          <a href="#points">Earn points</a>
          <a href="#pricing">Pricing</a>
          <a href="#cart" aria-label={`Cart, ${cart.length} items`}>Cart ({cart.length})</a>
          {viewer && !viewer.isAdmin && <button className="store-switch-button" onClick={() => { setFranchiseApplyMessage(""); setFranchiseApplyOpen(true); }}>Apply for a franchise</button>}
          {selectedStoreId && !viewer?.isAdmin && <button className="store-switch-button" onClick={() => { window.localStorage.removeItem("printbee-selected-store"); setSelectedStoreId(null); }}>Change store</button>}
          {viewer?.isAdmin && <button className="admin-link" onClick={() => openAdminDashboard(1)}>Admin dashboard</button>}
          {role === "AGENT" && approvalStatus === "APPROVED" && <button className="admin-link" onClick={() => switchLoginMode("PARTNER")}>Partner portal</button>}
          {viewer && <button className="home-wallet-button" onClick={() => { setWalletOpen(true); setWalletMessage(""); }} aria-label={`Wallet balance ${pointsBalance} points`}><span>◉</span><b><AnimatedCounter value={pointsBalance} onceInView /></b></button>}
          {viewer && <button className="admin-link" onClick={openMyOrders}>My orders</button>}
          {viewer ? (
            <button className="login-link" onClick={signOut} title={viewer.email}>Sign out</button>
          ) : (
            <><button className="login-link" onClick={() => setLoginOpen(true)}>Sign in</button><button className="login-link" onClick={() => { setLoginMode("PARTNER"); window.localStorage.setItem("printbee-login-mode", "PARTNER"); setLoginOpen(true); }}>Delivery partner</button></>
          )}
        </GlassNav>
      </header>

      <section className="hero" id="top">
          <div className="hero-copy">
          <div className="hero-intro"><div className="eyebrow">YOUR CAMPUS PRINT COMPANION</div><h1>Upload. Print.<br /><em>Delivered.</em></h1><p>Notes, assignments, big ideas. Fresh A4 prints, delivered to your door.</p><a className="primary-cta" href="#upload">Upload Files <span aria-hidden="true">↑</span></a><BeeMascot /><StudioLauncher /></div>
          <div className="eyebrow"><span>●</span> A4 printing, delivered locally</div>
          <a className="projects-hero-cta" href="/projects">Explore Projects <span aria-hidden="true">→</span></a>
          <div className="hero-printer"><PrinterScene /></div>
          <div className="trust-row">
            <span>✓ Secure files</span><span>✓ Clear pricing</span><span>✓ Doorstep delivery</span>
          </div>
          <div className="payment-home-note">
            <strong>Fed up begging for cash and long queues in DTPs and Xerox centers?</strong>
            <span>Scan and relax — we deliver your documents safely.</span>
            <blockquote className="gen-z-meme">“{memeQuote}”</blockquote>
            {viewer && !viewer.isAdmin && notificationPermission !== "granted" && <button onClick={enableNotifications}>Enable mobile order notifications</button>}
            {notificationPermission === "granted" && <button onClick={testNotifications}>Test alerts: sound + banner</button>}
            {notificationMessage && <small className="notification-message">{notificationMessage}</small>}
          </div>
        </div>

        <PrintJourney />
        <section className="order-card" id="upload" aria-label="Create print order" tabIndex={-1}>
          {acceptingOrders ? <>
          <div className="card-heading">
            <span className="step">1</span>
            <div><h2>Start your print</h2><p>PDF, JPG, PNG, WEBP or HEIC · A4 printing</p></div>
          </div>

          {!isPlagiarismService && <button type="button" className="plagiarism-start" onClick={() => { setServiceId(PLAGIARISM_SERVICE_ID); setFileName(""); setSelectedFile(null); setBatchFiles([]); setSelectedAddonIds([]); setUploadError(""); }}><span>NEW</span><div><strong>Plagiarism report</strong><small>Upload your paper or report · ₹175 · WhatsApp report within 24 hours</small></div><b>Start →</b></button>}
          {isPlagiarismService && <div className="plagiarism-flow-heading"><div><strong>Plagiarism report</strong><small>₹175 per PDF · add each file separately · 2.36% payment handling applies to the cart total</small></div><button type="button" className="plagiarism-back-button" onClick={() => { setServiceId("document-printing"); setFileName(""); setSelectedFile(null); setBatchFiles([]); }}>← Go back to printing</button></div>}

          <label className={`upload-zone ${fileName ? "has-file" : ""} ${countingPages ? "is-processing" : ""}`} aria-busy={countingPages} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("is-dragging"); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.classList.remove("is-dragging"); }} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("is-dragging"); if (!countingPages) void handleFile({ target: { files: event.dataTransfer.files, value: "" } } as ChangeEvent<HTMLInputElement>); }}>
            <input type="file" multiple={!isPlagiarismService} accept={isPlagiarismService ? ".pdf,application/pdf" : ".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"} onChange={handleFile} />
            <span className="upload-icon">{countingPages ? <LoadingAnimation compact /> : fileName ? "✓" : "↑"}</span>
            <strong>{fileName ? "Document ready" : isPlagiarismService ? "Upload PDF" : "Upload Files"}</strong>
            {fileName && <small className="original-file-name">Original: {fileName}</small>}
            <small>{uploadProgress !== null ? `Uploading… ${uploadProgress}%` : countingPages ? "Checking file…" : fileName ? `${pages} ${pages === 1 ? "page" : "pages"} detected${fileQueue.length ? ` · ${fileQueue.length} more queued` : ""}` : isPlagiarismService ? "Select one PDF file" : "Select one or more PDF or image files"}</small>
          </label>
          {uploadProgress !== null && <progress className="upload-progress" value={uploadProgress} max={100} aria-label="File upload progress" />}
          {countingPages && <div className="processing-skeleton" role="status">Preparing your document…</div>}
          {selectedFile && <p className="file-size">{formatFileSize(selectedFile.size)} · securely selected</p>}
          {fileName && !isPlagiarismService && <DocumentPreview pages={pages} copies={copies} colour={mode.startsWith("colour")} doubleSided={mode.endsWith("double")} file={selectedFile} />}
          <p className="file-retention-note">{isPlagiarismService ? <><strong>Accepted file: one PDF only.</strong> Add it to the cart before selecting another PDF. Each PDF costs ₹175; payment handling is calculated once on the complete plagiarism cart. Maximum file size: 50 MB.</> : <><strong>Accepted files: PDF, JPG/JPEG, PNG, WEBP and HEIC only.</strong> Select multiple files to review all print choices together before adding the full batch to your cart. PDFs are counted automatically; each image is treated as one printable page. Files are deleted after delivery or cancellation. Maximum file size: 50 MB per file.</>}</p>
          {uploadError && <div className="upload-error" role="alert"><p>{uploadError}</p><button type="button" onClick={() => document.querySelector<HTMLInputElement>('.upload-zone input')?.click()}>Choose file again</button></div>}

          {batchFiles.length > 0 && (() => {
            const item = batchFiles[Math.min(batchIndex, batchFiles.length - 1)];
            const moveBatch = (direction: number) => setBatchIndex((current) => Math.max(0, Math.min(batchFiles.length - 1, current + direction)));
            const removeCurrent = () => {
              setBatchFiles((items) => items.filter((_, itemIndex) => itemIndex !== batchIndex));
              customerFeedback('file-removed');
              setBatchIndex((current) => Math.max(0, Math.min(current, batchFiles.length - 2)));
            };
            return <section className="binding-fields batch-file-review" aria-labelledby="batch-file-review-title">
              <div className="field-label"><span className="step">2</span><strong id="batch-file-review-title">Review your files</strong></div>
              <p>Swipe left or right to set printing choices for each file. Your changes stay saved as you move between files.</p>
              <DocumentPreview pages={item.pages} copies={item.copies} colour={item.mode.startsWith("colour") || Boolean(item.colourPageNumbers)} doubleSided={item.mode.endsWith("double")} file={item.file} />
              <p className="file-size">{formatFileSize(item.file.size)} · {item.fileName}</p>
              <div className="batch-progress" aria-label={`File ${batchIndex + 1} of ${batchFiles.length}`}>{batchFiles.map((_, index) => <button type="button" key={index} className={index === batchIndex ? "active" : ""} onClick={() => setBatchIndex(index)} aria-label={`Review file ${index + 1}`} />)}</div>
              <label className="add-more-files"><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={handleFile} />+ Add more files</label>
              <article className="batch-file-card" key={item.reference} onTouchStart={(event) => setSwipeStartX(event.changedTouches[0]?.clientX ?? null)} onTouchEnd={(event) => { const endX = event.changedTouches[0]?.clientX; if (swipeStartX !== null && endX !== undefined && Math.abs(endX - swipeStartX) > 45) moveBatch(endX < swipeStartX ? 1 : -1); setSwipeStartX(null); }}>
                <div className="batch-file-nav"><button type="button" onClick={() => moveBatch(-1)} disabled={batchIndex === 0} aria-label="Previous file">←</button><span>File {batchIndex + 1} of {batchFiles.length}</span><button type="button" onClick={() => moveBatch(1)} disabled={batchIndex === batchFiles.length - 1} aria-label="Next file">→</button></div>
                <div className="batch-file-name"><span>{item.fileType === "PDF" ? "PDF" : "IMG"}</span><div><strong>{item.reference}</strong><small className="original-file-name">Original: {item.fileName}</small><small>{item.pages} {item.pages === 1 ? "page" : "pages"}</small></div><button type="button" className="remove-item" onClick={removeCurrent} aria-label={`Remove ${item.fileName}`}>×</button></div>
                <div className="batch-file-fields"><label>Service<select value={item.serviceId} onChange={(event) => updateBatchFile(batchIndex, { serviceId: event.target.value })}>{printServices.filter((service) => service.id !== PLAGIARISM_SERVICE_ID).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><label>Print style<select value={item.mode} onChange={(event) => updateBatchFile(batchIndex, { mode: event.target.value as PrintMode })}>{options.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}</select></label><div><small>Copies</small><div className="quantity-stepper"><button type="button" disabled={item.copies <= 1} onClick={() => updateBatchFile(batchIndex, { copies: Math.max(1, item.copies - 1) })}>−</button><output>{item.copies}</output><button type="button" onClick={() => updateBatchFile(batchIndex, { copies: item.copies + 1 })}>+</button></div></div></div>
                <div className="batch-file-choice-cards"><div className="batch-choice-group"><small>Service</small><div className="service-option-grid" role="radiogroup" aria-label="Print service">{printServices.filter((service) => service.id !== PLAGIARISM_SERVICE_ID).map((service) => <button type="button" role="radio" aria-checked={item.serviceId === service.id} className={item.serviceId === service.id ? "selected" : ""} key={service.id} onClick={() => updateBatchFile(batchIndex, { serviceId: service.id, colourPageNumbers: MIXED_PRINT_SERVICES.has(service.id) ? item.colourPageNumbers : undefined })}><span><strong>{service.name}</strong><small>{service.description}</small></span><b>{service.price_paise ? `+${inr.format(service.price_paise / 100)}` : "Included"}</b></button>)}</div></div><div className="batch-choice-group"><small>Print style</small><div className="option-grid" role="radiogroup" aria-label="Print style">{options.map((option) => <button type="button" role="radio" aria-checked={item.mode === option.id && item.colourPageNumbers === undefined} className={`print-option ${item.mode === option.id && item.colourPageNumbers === undefined ? "selected" : ""}`} key={option.id} onClick={() => updateBatchFile(batchIndex, { mode: option.id, colourPageNumbers: undefined })}><span className={`mode-icon ${option.id.startsWith("colour") ? "colour" : ""}`}>{option.icon}</span><span><strong>{option.title}</strong><small>{option.note}</small></span></button>)}</div>{MIXED_PRINT_SERVICES.has(item.serviceId) && <div className="batch-mixed-pages"><button type="button" className={item.colourPageNumbers !== undefined ? "selected" : ""} onClick={() => updateBatchFile(batchIndex, { mode: `bw-${item.mode.endsWith("double") ? "double" : "single"}` as PrintMode, colourPageNumbers: item.colourPageNumbers ?? "" })}><strong>Select colour pages</strong><small>Enter only the colour page numbers; all remaining pages print in B&amp;W.</small></button>{item.colourPageNumbers !== undefined && <label>Colour page numbers<input value={item.colourPageNumbers} onChange={(event) => updateBatchFile(batchIndex, { colourPageNumbers: event.target.value })} inputMode="text" placeholder="Example: 1-4, 12, 18-20" /></label>}{item.colourPageNumbers?.trim() && parsePageNumbers(item.colourPageNumbers, item.pages).invalid.length > 0 && <small className="upload-error">Use pages between 1 and {item.pages}.</small>}</div>}</div><div className="batch-copies"><small>Copies</small><div className="quantity-stepper"><button type="button" disabled={item.copies <= 1} onClick={() => updateBatchFile(batchIndex, { copies: Math.max(1, item.copies - 1) })}>−</button><output>{item.copies}</output><button type="button" onClick={() => updateBatchFile(batchIndex, { copies: item.copies + 1 })}>+</button></div></div></div>
                <div className="batch-file-total"><span>This file</span><AnimatedPrice value={batchTotal(item)} /></div>
              </article>
              <div className="estimate"><div><small>Batch total · {batchFiles.length} files</small><AnimatedPrice value={batchFiles.reduce((sum, batchItem) => sum + batchTotal(batchItem), 0)} /></div><button disabled={countingPages} onClick={addBatchToCart}>{uploadProgress !== null ? `Adding… ${uploadProgress}%` : "Add all to cart"} <span>→</span></button></div>
            </section>;
          })()}

          {!isPlagiarismService && addons.length > 0 && <div className="binding-fields standalone-addons">
            <strong>Don’t need printouts? Order add-ons only</strong>
            <p>No document upload is required. Choose a product below and proceed directly to checkout.</p>
            <div className="service-option-grid" role="group" aria-label="Add-on products">{addons.map((addon) => <button type="button" key={addon.id} onClick={() => addStandaloneAddon(addon)}><span><strong>{addon.name}</strong><small>{addon.description}</small></span><b>{inr.format(addon.price_paise / 100)} · Add</b></button>)}</div>
            {addonMessage && <small className="notification-message" role="status">{addonMessage}</small>}
          </div>}

          {fileName && <>
          {!isPlagiarismService && <><div className="field-label"><span className="step">2</span> Choose service</div>
          <div className="service-option-grid" role="radiogroup" aria-label="Print service">
            {printServices.filter((service) => service.id !== PLAGIARISM_SERVICE_ID).map((service) => <button type="button" role="radio" aria-checked={serviceId === service.id} className={serviceId === service.id ? "selected" : ""} key={service.id} onClick={() => setServiceId(service.id)}><span><strong>{service.name}</strong><small>{service.description}</small></span><b>{service.price_paise ? `+${inr.format(service.price_paise / 100)}` : "Included"}</b></button>)}
          </div></>}
          {Boolean(printServices.find((service) => service.id === serviceId)?.is_binding) && (
            <div className="binding-fields">
              <strong>Binding instructions</strong>
              <p>Binding work takes 15–25 minutes to deliver based on your location.</p>
              <label>WhatsApp number<input value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="10-digit WhatsApp number" /></label>
              <label>Additional binding instructions<textarea maxLength={125} value={printInstructions} onChange={(e) => setPrintInstructions(e.target.value)} placeholder="Any special instructions for binding" /><small>{printInstructions.length}/125 characters</small></label>
            </div>
          )}

          {isPlagiarismService && <div className="binding-fields plagiarism-service-note"><strong>Turnitin plagiarism check · ₹175 per PDF</strong><p>Add one PDF at a time. Add each PDF to cart before uploading the next one; the 2.36% payment handling charge is calculated once on the overall plagiarism cart value.</p><label>WhatsApp number<input value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="10-digit WhatsApp number" /></label></div>}

          {!isPlagiarismService && <div className="binding-fields">
            <strong><span className="step">3</span> Choose print sides</strong>
            <p>Choose how your document is printed. Your price updates below.</p>
            <div className="service-option-grid" role="radiogroup" aria-label="Print sides">
              <button type="button" role="radio" aria-checked={side === "single"} className={side === "single" ? "selected" : ""} onClick={() => setMode(`${mode.startsWith("colour") ? "colour" : "bw"}-single` as PrintMode)}><span><strong>Single side</strong><small>One page per sheet</small></span></button>
              <button type="button" role="radio" aria-checked={side === "double"} className={side === "double" ? "selected" : ""} onClick={() => setMode(`${mode.startsWith("colour") ? "colour" : "bw"}-double` as PrintMode)}><span><strong>Double side</strong><small>{pages} pages ÷ 2 = {pages / 2} priced units</small></span></button>
            </div>
          </div>}

          {usesMixedPagePricing && (
            <div className="binding-fields">
              <strong><span className="step">3</span> Choose colour pages</strong>
              <p>Select B&amp;W for no colour pages, Colour for every page, or enter only the pages that need colour.</p>
              <div className="service-option-grid" role="radiogroup" aria-label="Colour printing choice">
                <button type="button" role="radio" aria-checked={colourChoice === "bw"} className={colourChoice === "bw" ? "selected" : ""} onClick={() => { setColourChoice("bw"); setColourPageNumbers(""); setMode(`bw-${side}`); setUploadError(""); }}><span><strong>B&amp;W</strong><small>No colour pages</small></span><b>{inr.format(prices[`bw-${side}`])}</b></button>
                <button type="button" role="radio" aria-checked={colourChoice === "colour"} className={colourChoice === "colour" ? "selected" : ""} onClick={() => { setColourChoice("colour"); setColourPageNumbers(""); setMode(`colour-${side}`); setUploadError(""); }}><span><strong>Colour</strong><small>Print every page in colour</small></span><b>{inr.format(prices[`colour-${side}`])}</b></button>
                <button type="button" role="radio" aria-checked={colourChoice === "mixed"} className={colourChoice === "mixed" ? "selected" : ""} onClick={() => { setColourChoice("mixed"); setMode(`bw-${side}`); setUploadError(""); }}><span><strong>Select colour pages</strong><small>All remaining pages will be B&amp;W</small></span><b>Mixed pricing</b></button>
              </div>
              {colourChoice === "mixed" && <label>Colour page numbers<input value={colourPageNumbers} onChange={(e) => { setColourPageNumbers(e.target.value); setUploadError(""); }} placeholder="Example: 1-4, 12, 18-20" /></label>}
              {colourChoice === "mixed" && colourPageNumbers.trim() && colourPageResult.invalid.length > 0 && <small className="upload-error">Check: {colourPageResult.invalid.join(", ")}. Pages must be between 1 and {pages}.</small>}
              {colourChoice === "mixed" && colourPagesValid && <div className="payment-instruction" role="status"><strong>Automatic page assignment</strong><span>Colour: {formatPageRanges(colourPageResult.pages)}</span><span>B&amp;W: {bwPageNumbers}</span><span>The remaining pages are automatically priced as B&amp;W.</span></div>}
            </div>
          )}

          {!isPlagiarismService && addons.length > 0 && <div className="binding-fields addons-section">
            <strong><span className="step">4</span> Add-ons <small>Optional</small></strong>
            <p>Select any extra products you want with this document.</p>
            <div className="service-option-grid" role="group" aria-label="Optional add-ons">{addons.map((addon) => <button type="button" aria-pressed={selectedAddonIds.includes(addon.id)} className={selectedAddonIds.includes(addon.id) ? "selected" : ""} key={addon.id} onClick={() => setSelectedAddonIds((ids) => ids.includes(addon.id) ? ids.filter((id) => id !== addon.id) : [...ids, addon.id])}><span><strong>{addon.name}</strong><small>{addon.description}</small></span><b>+{inr.format(addon.price_paise / 100)}</b></button>)}</div>
          </div>}

          <div className="quantities">
            <div className="detected-pages"><small>Pages</small><strong>{pages}</strong><span>Auto-detected</span></div>
            <div className="copy-quantity">
              <small>Copies</small>
              <div className="quantity-stepper">
                <button type="button" aria-label="Decrease copies" disabled={copies <= 1} onClick={() => setCopies((value) => Math.max(1, value - 1))}>−</button>
                <output aria-live="polite" aria-label={`${copies} ${copies === 1 ? "copy" : "copies"}`}>{copies}</output>
                <button type="button" aria-label="Increase copies" onClick={() => setCopies((value) => value + 1)}>+</button>
              </div>
            </div>
            <div className="paper"><small>Paper size</small><strong>A4</strong><span>210 × 297 mm</span></div>
          </div>

          <div className="estimate">
            <div><small>Estimated print total</small><AnimatedPrice value={total} /></div>
            <button disabled={!fileName || countingPages || (usesMixedPagePricing && !colourPagesValid) || ((Boolean(printServices.find((service) => service.id === serviceId)?.is_binding) || isPlagiarismService) && whatsappNumber.length !== 10)} onClick={addToCart}>Add &amp; proceed to checkout <span>→</span></button>
          </div>
          <p className="estimate-note">{usesMixedPagePricing ? `${bwPageCount} B&W + ${colourPageCount} colour pages × ${copies} ${copies === 1 ? "copy" : "copies"} · ${side === "double" ? "Double sided (pages ÷ 2)" : "Single sided"}` : `${pages}${side === "double" ? " ÷ 2" : ""} pages × ${copies} ${copies === 1 ? "copy" : "copies"} × ${inr.format(prices[mode])} · ${selected.title}`}{servicePrice > 0 ? ` + ${inr.format(servicePrice)} ${selectedService?.name} charge` : ""}{addonsTotal > 0 ? ` + ${inr.format(addonsTotal)} add-ons` : ""}</p>
          <div className="payment-instruction" role="note">
            <strong>Secure Razorpay payment</strong>
            <span>Create your order, then pay online through Razorpay before printing begins.</span>
          </div>
          </>}
          </> : <div className="service-unavailable" role="status"><span>Coming soon</span><h2>Service will be live soon</h2><div className="launch-countdown" aria-label={`${countdown.days} days, ${countdown.hours} hours, ${countdown.minutes} minutes and ${countdown.seconds} seconds remaining`}><b>{countdown.days}<small>Days</small></b><b>{String(countdown.hours).padStart(2, "0")}<small>Hours</small></b><b>{String(countdown.minutes).padStart(2, "0")}<small>Minutes</small></b><b>{String(countdown.seconds).padStart(2, "0")}<small>Seconds</small></b></div><p className="launch-message">{launchMessage}</p></div>}
        </section>
      </section>

      <section className="cart-section" id="cart" aria-labelledby="cart-title">
        <div className="cart-heading">
          <div><div className="eyebrow"><span>●</span> Your cart</div><h2 id="cart-title">{cart.length ? `${cart.length} ${cart.length === 1 ? "item" : "items"} ready` : "Your cart is empty"}</h2></div>
          {cart.length > 0 && <AnimatedPrice value={cartTotal} />}
        </div>
        {cart.length === 0 ? (
          <div className="empty-cart"><BeeMascot /><strong>A little empty. A lot of possibility.</strong><p>Add your notes, assignments or an add-on to get started.</p><a className="primary-cta" href="#upload">Add something to print ↑</a></div>
        ) : (
          <>
            <div className="cart-items">
              {cart.map((item) => {
                const itemOption = options.find((option) => option.id === item.mode);
                return (
                  <article className="cart-item" key={item.id} data-cart-id={item.id}>
                    <div className="file-badge">{item.kind === "ADDON" ? "ADD" : item.fileType === "PDF" ? "PDF" : item.fileType === "IMAGE" ? "IMG" : "DOC"}</div>
                    {item.kind === "ADDON" ? <div className="cart-file"><h3>{item.fileName}</h3><p>Add-on only · No printout required</p><small>Fixed product price</small></div> : <div className="cart-file"><h3>{item.displayReference ?? item.fileName}</h3><small className="original-file-name">Original: {item.fileName}</small><p>{item.serviceName} · {item.pages} {item.pages === 1 ? "page" : "pages"} · A4 · {itemOption?.title ?? printModeLabel(item.mode)} · {item.copies} {item.copies === 1 ? "copy" : "copies"}</p>{item.colourPageNumbers !== undefined && <p>Colour pages: {item.colourPageNumbers} · B&amp;W pages: {item.bwPageNumbers ?? `remaining ${item.pages - (item.colourPages ?? 0)} pages`}</p>}{item.addons?.length ? <p>Add-ons: {item.addons.map((addon) => addon.name).join(", ")}</p> : null}{item.printInstructions && <p>{item.printInstructions}{item.whatsappNumber ? ` · WhatsApp ${item.whatsappNumber}` : ""}</p>}<small>{item.colourPageNumbers !== undefined ? `${item.pages - (item.colourPages ?? 0)} B&W + ${item.colourPages ?? 0} colour × ${item.copies}` : `${item.pages}${item.mode.endsWith("double") ? " ÷ 2" : ""} × ${item.copies} × ${inr.format(item.unitPrice)}`}{item.servicePrice > 0 ? ` + ${inr.format(item.servicePrice)} service charge` : ""}{item.addonsTotal ? ` + ${inr.format(item.addonsTotal)} add-ons` : ""}</small></div>}
                    <strong>{inr.format(item.total)}</strong>
                    {item.kind !== "ADDON" && item.serviceId !== PLAGIARISM_SERVICE_ID && <button className="edit-cart-item" onClick={() => openCartEditor(item)} aria-label={`Edit ${item.fileName}`}>Edit</button>}
                    <button className="remove-item" onClick={() => removeFromCart(item)} aria-label={`Remove ${item.fileName}`}>×</button>
                  </article>
                );
              })}
            </div>
            <div className="cart-summary">
              <div><span>{isPlagiarismOnly ? "Plagiarism subtotal" : "Printing subtotal"}</span><AnimatedPrice value={cartTotal} /></div>
              <button onClick={openCheckout}>Proceed to checkout →</button>
            </div>
          </>
        )}
      </section>

      <section className="how" id="how">
        <div><span>01</span><strong>Upload</strong><p>Add your PDF or image securely.</p></div>
        <div><span>02</span><strong>Choose</strong><p>Pick one of four simple A4 options.</p></div>
        <div><span>03</span><strong>We deliver</strong><p>Fresh prints arrive at your door.</p></div>
      </section>

      <section className="points-guide" id="points" aria-labelledby="points-guide-title">
        <div className="points-guide-heading">
          <div className="eyebrow"><span>●</span> PrintBee Points</div>
          <h2 id="points-guide-title">Print more. Invite friends. Earn points.</h2>
          <p>Points are added automatically only after an order is successfully delivered and the delivery OTP is verified.</p>
        </div>
        <div className="points-guide-grid">
          <article><span>01</span><strong>10 welcome points</strong><p>Every new customer starts with 10 bonus points in their PrintBee wallet.</p></article>
          <article><span>02</span><strong>Earn on your orders</strong><p>Get 1 point for every complete ₹10 spent on each of your own delivered orders.</p></article>
          <article><span>03</span><strong>Earn from referrals</strong><p>Invite friends with your referral code. You get 1 point for every complete ₹15 they spend on delivered orders.</p></article>
        </div>
        <div className="points-guide-note"><strong>Use your rewards</strong><span>15 points = ₹1 off at checkout. Amounts below the next ₹10 or ₹15 are rounded down and do not carry forward. Cancelled, unpaid and undelivered orders earn no points.</span></div>
      </section>

      <section className="pricing" id="pricing">
        <div className="section-intro">
          <div className="eyebrow"><span>●</span> Simple A4 pricing</div>
          <h2>No confusing paper choices.</h2>
          <p>Choose black-and-white or colour, with single- or double-sided printing.</p>
        </div>
        <div className="price-list">
          {options.map((item) => (
            <article key={item.id}>
              <span className={`mode-icon ${item.id.startsWith("colour") ? "colour" : ""}`}>{item.icon}</span>
              <div><h3>{item.title}</h3><p>{item.note}</p></div>
              <strong>{inr.format(prices[item.id])}<small>/page</small></strong>
            </article>
          ))}
        </div>
      </section>

      <section className="projects-home-cta" aria-label="PrintBee Projects">
        <div><span>PRINTBEE PROJECTS</span><h2>Have a project idea? 🚀</h2><p>Buy a project, sell something you built, or get your idea developed.</p></div>
        <a href="/projects">Explore Projects →</a>
      </section>
      <ProjectPortals />
      <footer>
        <div className="footer-brand"><img src="/printbee-logo.png" width={86} height={86} alt="" /><div><strong>Print<span>Bee</span></strong><p>Upload. Print. Delivered.</p></div></div>
        <nav className="footer-policy-links" aria-label="Policies"><a href="/terms">Terms</a><a href="/privacy-policy">Privacy</a><a href="/shipping-policy">Shipping</a><a href="/cancellation-refunds">Cancellation &amp; Refunds</a><a href="/contact">Contact</a></nav>
        <address className="footer-contact">
          <strong>Contact us</strong>
          <a href="mailto:printbee.co.in@gmail.com">printbee.co.in@gmail.com</a>
          <a href="https://www.instagram.com/print.bee_?igsh=MTkwM3lsZWFraHZrNQ%3D%3D" target="_blank" rel="noreferrer">Instagram: @print.bee_</a>
          <a href="https://wa.me/919347541419" target="_blank" rel="noreferrer">WhatsApp: 9347541419</a>
          <a href="https://whatsapp.com/channel/0029Vb8jYA0KmCPUXpRIYS10" target="_blank" rel="noreferrer">Join our WhatsApp channel for exclusive coupon codes →</a>
        </address>
        <p className="footer-copyright">© 2026 PrintBee · Local A4 printing made easy.</p>
      </footer>
      {!viewer?.isAdmin && <MobileNavigation orders={() => { if (viewer) void openMyOrders(); else setLoginOpen(true); }} profile={() => { if (viewer) setProfileOpen(true); else setLoginOpen(true); }} cartCount={cart.length} />}
      <GlassPresence>{profileOpen && <div className="modal-backdrop" onMouseDown={() => setProfileOpen(false)}><section className="login-modal account-panel" role="dialog" aria-modal="true" aria-labelledby="account-title" onMouseDown={event => event.stopPropagation()}><button className="close" aria-label="Close" onClick={() => setProfileOpen(false)}>×</button><BeeMascot /><h2 id="account-title">Your PrintBee</h2><p>{viewer?.email}</p><ActiveOrderLinks orders={myOrders} open={() => { setProfileOpen(false); void openMyOrders(); }} /><div className="account-actions"><button onClick={() => { setProfileOpen(false); void openMyOrders(); }}>Orders & tracking →</button><button onClick={() => { setProfileOpen(false); setWalletOpen(true); }}>Wallet · {pointsBalance} points →</button><a href="/contact">Help & contact →</a><a href="/privacy-policy">Privacy & your documents →</a><button onClick={signOut}>Sign out</button></div></section></div>}</GlassPresence>

      <GlassPresence>{adminOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => { void closeAdminDashboard(); }}>
          <section className="admin-modal admin-portal" role="dialog" aria-modal="true" aria-labelledby="admin-title" onMouseDown={(e) => e.stopPropagation()}>
            <aside className="admin-sidebar">
              <div className="admin-sidebar-brand"><img src="/printbee-logo.png" alt="" /><strong>PrintBee Admin</strong></div>
              {([["dashboard", "Dashboard", "⌂"], ["traffic", "Traffic", "↗"], ["revenue", "Revenue", "₹"], ["ledger", "Ledger", "▦"], ["orders", "Orders", "▤"], ["projects", "Projects", "◆"], ["riders", "Rider approvals", "♙"], ["services", "Print services", "＋"]] as const).map(([id, label, icon]) => <button key={id} className={adminSection === id ? "active" : ""} onClick={() => { void selectAdminSection(id); }}><span>{icon}</span>{label}{id === "orders" && <b>{dashboard?.pagination?.total ?? 0}</b>}</button>)}
              {notificationPermission !== "granted" && <button onClick={() => { if (ledger) void lockLedger(); void enableNotifications(); }}><span>♬</span>Enable order alerts</button>}
              {notificationPermission === "granted" && <button onClick={() => { if (ledger) void lockLedger(); void testNotifications(); }}><span>♬</span>Test sound + banner</button>}
              <button className={adminSection === "franchise" ? "active" : ""} onClick={() => { void selectAdminSection("franchise"); }}><span>⌂</span>Franchises</button>
              <button className="admin-sidebar-exit" onClick={() => { void closeAdminDashboard(); }}>← Back to website</button>
            </aside>
            <div className="admin-main">
            <button className="close" onClick={() => { void closeAdminDashboard(); }} aria-label="Close">×</button>
            <div className="admin-badge">ADMIN</div>
            {notificationMessage && <p className="panel-message">{notificationMessage}</p>}
            {adminSection === "services" && <>
            <h2 id="admin-services">Print service controls</h2>
            <p>Update the customer price per printed page. Changes appear everywhere immediately.</p>
            <div className={`order-toggle-panel ${acceptingOrders ? "on" : "off"}`}>
              <span><strong>Accept customer orders</strong><small>{acceptingOrders ? "ON — customers can place orders" : "OFF — customers see ‘Service will be live soon’"}</small></span>
              <button type="button" role="switch" aria-checked={acceptingOrders} onClick={toggleOrderAvailability}><i />{acceptingOrders ? "ON" : "OFF"}</button>
            </div>
            <div className="launch-schedule-panel">
              <h3>Customer launch countdown</h3>
              <p>Set the public launch time in Indian Standard Time and the note shown below the timer.</p>
              <label>Launch date and time (IST)<input type="datetime-local" value={launchInput} onChange={(e) => setLaunchInput(e.target.value)} /></label>
              <label>Launch note<input maxLength={160} value={launchMessage} onChange={(e) => setLaunchMessage(e.target.value)} /></label>
              <button type="button" onClick={saveLaunchSchedule}>Save launch timer</button>
            </div>
            <div className="service-admin fee-controls">
              <h3>Checkout fee controls</h3>
              <div className="order-toggle-panel"><span><strong>Store location</strong><small>{storeLocation?.latitude ? `${storeLocation.name ? `${storeLocation.name} · ` : ""}Store location configured` : "Set the store location before accepting delivery orders."}</small></span><button type="button" onClick={setCurrentStoreLocation}>{storeLocation?.latitude ? "Update" : "Set current"}</button>{storeLocation?.latitude != null && <button type="button" className="secondary-button" onClick={nameCurrentStore}>{storeLocation?.name ? "Rename store" : "Name this store"}</button>}</div>
              <div className="service-admin-form"><label>Platform fee for every delivery (₹)<input aria-label="Platform fee" type="number" min="0" step="0.01" value={platformFee} onChange={(e) => setPlatformFee(Math.max(0, Number(e.target.value)))} /></label><button onClick={() => saveFeeSettings()}>Save platform fee</button></div>
              <div className="service-admin-form"><label>Delivery fee for first 1.5 km (₹)<input aria-label="Base delivery fee" type="number" min="0" step="0.01" value={baseDeliveryFee} onChange={(e) => setBaseDeliveryFee(Math.max(0, Number(e.target.value)))} /></label><label>Extra delivery fee per 100 m (₹)<input aria-label="Delivery fee per 100 metres" type="number" min="0" step="0.01" value={deliveryFeePer100Meters} onChange={(e) => setDeliveryFeePer100Meters(Math.max(0, Number(e.target.value)))} /></label><button onClick={() => saveFeeSettings()}>Save delivery fees</button></div>
              <div className={`order-toggle-panel ${gatewayEnabled ? "on" : "off"}`}><span><strong>Payment handling charges</strong><small>Set the percentage charged on printing, delivery, and platform fees. It is shown separately at checkout.</small></span><button role="switch" aria-checked={gatewayEnabled} onClick={() => saveFeeSettings({ gatewayEnabled: !gatewayEnabled })}><i />{gatewayEnabled ? "ON" : "OFF"}</button></div>
              <div className="service-admin-form"><label>Payment handling charge (%)<input aria-label="Payment handling charge percentage" type="number" min="0" max="100" step="0.01" value={gatewayFeePercent} onChange={(e) => setGatewayFeePercent(Math.max(0, Number(e.target.value)))} /></label><button onClick={() => saveFeeSettings()}>Save payment handling charge</button></div>
              <div className={`order-toggle-panel ${packagingEnabled ? "on" : "off"}`}><span><strong>Optional packaging</strong><small>When enabled, customers can add packaging to their order for the price below.</small></span><button role="switch" aria-checked={packagingEnabled} onClick={() => saveFeeSettings({ packagingEnabled: !packagingEnabled })}><i />{packagingEnabled ? "ON" : "OFF"}</button></div>
              <div className="service-admin-form"><label>Packaging price (₹)<input aria-label="Packaging price" type="number" min="0" step="0.01" value={packagingFee} onChange={(e) => setPackagingFee(Math.max(0, Number(e.target.value)))} /></label><button onClick={() => saveFeeSettings()}>Save packaging price</button></div>
              <div className={`order-toggle-panel ${surgeEnabled ? "on" : "off"}`}><span><strong>Surge charge</strong><small>Shown to customers as a high-demand charge.</small></span><button role="switch" aria-checked={surgeEnabled} onClick={() => saveFeeSettings({ surgeEnabled: !surgeEnabled })}><i />{surgeEnabled ? "ON" : "OFF"}</button></div>
              <div className="service-admin-form"><select value={surgeType} onChange={(e) => setSurgeType(e.target.value as "PERCENT" | "FIXED")}><option value="PERCENT">Percentage (%)</option><option value="FIXED">Fixed amount (₹)</option></select><input type="number" min="0" step="0.01" value={surgeValue} onChange={(e) => setSurgeValue(Math.max(0, Number(e.target.value)))} /><button onClick={() => saveFeeSettings()}>Save surge charge</button></div>
              <div className={`order-toggle-panel ${lateNightEnabled ? "on" : "off"}`}><span><strong>Late-night delivery fee</strong><small>Shown separately in checkout and saved with each order.</small></span><button role="switch" aria-checked={lateNightEnabled} onClick={() => saveFeeSettings({ lateNightEnabled: !lateNightEnabled })}><i />{lateNightEnabled ? "ON" : "OFF"}</button></div>
              <div className="service-admin-form"><select value={lateNightType} onChange={(e) => setLateNightType(e.target.value as "PERCENT" | "FIXED")}><option value="PERCENT">Percentage (%)</option><option value="FIXED">Fixed amount (₹)</option></select><input aria-label="Late-night delivery fee value" type="number" min="0" max={lateNightType === "PERCENT" ? 100 : undefined} step="0.01" value={lateNightValue} onChange={(e) => setLateNightValue(Math.max(0, Number(e.target.value)))} /><button onClick={() => saveFeeSettings()}>Save late-night fee</button></div>
            </div>
            <div className="admin-prices">
              {options.map((item) => (
                <label key={item.id}>
                  <span><strong>{item.title}</strong><small>{item.note}</small></span>
                  <span className="rupee">₹<input type="number" min="0" step="0.01" value={draftPrices[item.id]} onChange={(e) => setDraftPrices({ ...draftPrices, [item.id]: Math.max(0, Number(e.target.value)) })} /></span>
                </label>
              ))}
            </div>
            <button className="save-button" onClick={savePrices}>{saved ? "Prices saved ✓" : "Save new prices"}</button>
            <div className="service-admin">
              <h3>{newService.id ? "Edit service option" : "Add a print, documentation, or finishing service"}</h3>
              <div className="service-admin-form"><input value={newService.name} onChange={(e) => setNewService({ ...newService, name: e.target.value })} placeholder="Example: Soft binding" /><input maxLength={125} value={newService.description} onChange={(e) => setNewService({ ...newService, description: e.target.value })} placeholder="Description (125 characters)" /><label className="service-price-field">Price (₹)<input type="number" min="0" step=".01" value={newService.price} onChange={(e) => setNewService({ ...newService, price: Math.max(0, Number(e.target.value)) })} /></label><label><input type="checkbox" checked={newService.isBinding} onChange={(e) => setNewService({ ...newService, isBinding: e.target.checked })} /> Request page instructions and WhatsApp</label><button onClick={addPrintService}>{newService.id ? "Save changes" : "Add service"}</button>{newService.id && <button className="secondary-button" onClick={() => setNewService({ id: "", name: "", description: "", isBinding: false, countsForPackaging: true, price: 0 })}>Cancel</button>}</div>
              <div className="service-chips">{printServices.map((service) => <span key={service.id}><b>{service.name} · {inr.format(service.price_paise / 100)}</b><small>{service.description}</small><button onClick={() => setNewService({ id: service.id, name: service.name, description: service.description, isBinding: Boolean(service.is_binding), countsForPackaging: Boolean(service.counts_for_packaging), price: service.price_paise / 100 })}>Edit</button>{!["document-printing", "document-binding"].includes(service.id) && <button onClick={() => removePrintService(service.id)}>Remove</button>}</span>)}</div>
            </div>
            <div className="service-admin" id="admin-addons">
              <h3>{newAddon.id ? "Edit add-on" : "Add an add-on product"}</h3>
              <p>Add-ons use a fixed price and are included in the cart and checkout whenever a customer selects them.</p>
              <div className="service-admin-form"><input value={newAddon.name} onChange={(e) => setNewAddon({ ...newAddon, name: e.target.value })} placeholder="Example: File folder" /><input maxLength={125} value={newAddon.description} onChange={(e) => setNewAddon({ ...newAddon, description: e.target.value })} placeholder="Description" /><label className="service-price-field">Fixed price (₹)<input type="number" min="0" step=".01" value={newAddon.price} onChange={(e) => setNewAddon({ ...newAddon, price: Math.max(0, Number(e.target.value)) })} /></label><button onClick={saveAddon}>{newAddon.id ? "Save add-on" : "Add product"}</button>{newAddon.id && <button className="secondary-button" onClick={() => setNewAddon({ id: "", name: "", description: "", price: 0 })}>Cancel</button>}</div>
              <div className="service-chips">{addons.map((addon) => <span key={addon.id}><b>{addon.name} · {inr.format(addon.price_paise / 100)}</b><small>{addon.description}</small><button onClick={() => setNewAddon({ id: addon.id, name: addon.name, description: addon.description, price: addon.price_paise / 100 })}>Edit</button><button onClick={() => removeAddon(addon.id)}>Remove</button></span>)}</div>
            </div>
            </>}
            {adminSection === "franchise" && <><h2>Franchise network</h2><p>Customers are routed to the closest registered store within its 5 km service radius.</p><div className="service-admin"><h3>Franchise applications · ₹60,000</h3>{franchiseApplications.length ? franchiseApplications.map((application) => <div className="franchise-application-admin" key={application.id}><span><strong>{application.full_name} · {application.location}</strong><small>{application.email} · {application.mobile_number} · WhatsApp {application.whatsapp_number}<br />{application.address}</small></span><select value={application.status} onChange={(e) => updateFranchiseApplication(application.id, e.target.value)}><option>SUBMITTED</option><option>REVIEWING</option><option>APPROVED</option><option>REJECTED</option></select></div>) : <p>No franchise applications yet.</p>}</div><div className="service-admin"><h3>Future franchise locations</h3><p>SRM University continues as the normal PrintBee admin store. When a new location is ready, register and name that separate location here as a 5 km franchise store.</p></div>{franchiseStores.length ? <div className="location-table">{franchiseStores.map((store) => <div key={store.id}><span><strong>{store.name}</strong><small>5 km service radius · Store managers can update only this store's paid orders.</small></span><strong>5 km</strong><div className="service-admin-form"><input aria-label={`Manager email for ${store.name}`} value={franchiseManagerEmails[store.id] ?? ""} onChange={(e) => setFranchiseManagerEmails((current) => ({ ...current, [store.id]: e.target.value }))} placeholder="Add store manager email" /><button type="button" onClick={() => addFranchiseManager(store.id)}>Add manager</button></div><span>{store.members ? store.members.split(",").map((email: string) => <button key={email} type="button" className="secondary-button" onClick={() => removeFranchiseManager(store.id, email)}>Manager: {email} ×</button>) : "No managers yet"}</span></div>)}</div> : <div className="service-admin"><p>No franchise locations are active yet.</p></div>}</>}
            {adminSection === "projects" && <section className="admin-projects-embed"><iframe title="Projects administration" src="/admin/projects" /></section>}
            {adminMessage && <p className="panel-message">{adminMessage}</p>}
            {dashboard && (
              <div className="dashboard-block">
                {adminSection === "dashboard" && <>
                <div className="admin-divider" />
                <h2 id="admin-dashboard">Operations dashboard</h2>
                <div className="payment-instruction"><strong>Store location</strong><span>{storeLocation?.latitude != null ? `${storeLocation.name ? `${storeLocation.name} · ` : ""}Store location configured` : "Action required: configure the store location before delivery orders can be accepted."}</span><button type="button" onClick={setCurrentStoreLocation}>{storeLocation?.latitude != null ? "Update Store Location" : "Set Current Store Location"}</button>{storeLocation?.latitude != null && <button type="button" className="secondary-button" onClick={nameCurrentStore}>{storeLocation?.name ? "Rename this store" : "Name this store"}</button>}</div>
                <div className="dashboard-range"><button className={dashboardRange === "today" ? "active" : ""} onClick={() => setDashboardRange("today")}>Today</button><button className={dashboardRange === "week" ? "active" : ""} onClick={() => setDashboardRange("week")}>This week</button><button className={dashboardRange === "month" ? "active" : ""} onClick={() => setDashboardRange("month")}>This month</button><button className={dashboardRange === "lifetime" ? "active" : ""} onClick={() => setDashboardRange("lifetime")}>Lifetime</button></div>
                <div className="metric-grid">
                  <div><small>Total orders</small><strong>{dashboardSummaryForRange.total}</strong></div>
                  <div><small>Paid</small><strong>{dashboardSummaryForRange.paid}</strong></div>
                  <div><small>Unpaid</small><strong>{dashboardSummaryForRange.unpaid}</strong></div>
                  <div><small>Delivered</small><strong>{dashboardSummaryForRange.delivered}</strong></div>
                  <div><small>Ready</small><strong>{dashboardSummaryForRange.ready}</strong></div>
                  <div><small>Paid revenue</small><strong>{inr.format(dashboardSummaryForRange.revenuePaise / 100)}</strong></div>
                  <div><small>B&amp;W pages</small><strong>{printTotalsForRange.bwSingle + printTotalsForRange.bwDouble}</strong></div><div><small>Colour pages</small><strong>{printTotalsForRange.colourSingle + printTotalsForRange.colourDouble}</strong></div>
                </div>
                {adminRole === "OWNER" && <section className="admin-team-panel"><div><h3>Admin team &amp; access</h3><p>Owners have full access. Operations manages orders and riders; accountants view revenue and exports; support handles customer order queries.</p></div><div className="admin-team-form"><input type="email" value={newAdminMember.email} onChange={(event) => setNewAdminMember({ ...newAdminMember, email: event.target.value })} placeholder="team@printbee.co.in" /><select value={newAdminMember.role} onChange={(event) => setNewAdminMember({ ...newAdminMember, role: event.target.value })}><option value="OPERATIONS">Operations manager</option><option value="ACCOUNTANT">Accountant</option><option value="SUPPORT">Support</option><option value="OWNER">Owner</option></select><button disabled={!newAdminMember.email.trim()} onClick={saveAdminMember}>Add or update</button></div><div className="admin-team-list">{dashboard.adminMembers?.map((member: any) => <span key={member.email}><span><strong>{member.email}</strong><small>{String(member.role).replaceAll("_", " ")}</small></span>{member.email !== viewer?.email && <button onClick={() => removeAdminMember(member.email)}>Remove</button>}</span>)}</div></section>}
                {dashboard.dailySales?.length ? <section className="sales-chart" aria-label="Paid sales during the last 30 days"><div className="sales-chart-heading"><span><strong>30-day sales trend</strong><small>Daily paid revenue and order volume</small></span><strong>{inr.format(dashboard.dailySales.reduce((sum: number, day: any) => sum + Number(day.revenue_paise || 0), 0) / 100)}</strong></div><div className="sales-bars">{dashboard.dailySales.map((day: any) => { const peak = Math.max(...dashboard.dailySales.map((entry: any) => Number(entry.revenue_paise) || 0), 1); return <div key={day.day} title={`${new Date(`${day.day}T00:00:00`).toLocaleDateString("en-IN")}: ${inr.format(day.revenue_paise / 100)}, ${day.orders} orders`}><i style={{ height: `${Math.max(5, Number(day.revenue_paise) / peak * 100)}%` }} /><small>{new Date(`${day.day}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</small></div>; })}</div></section> : null}
                </>}
                {adminSection === "traffic" && <><div className="admin-divider" /><h2>Traffic &amp; conversions</h2><p>Anonymous visitor tracking begins with this release. Paid orders and revenue include site history from 10 Aug 2026.</p><div className="metric-grid"><div><small>Unique visitors</small><strong>{dashboard.traffic?.visitors ?? 0}</strong></div><div><small>Page views</small><strong>{dashboard.traffic?.pageViews ?? 0}</strong></div><div><small>Checkout starts</small><strong>{dashboard.traffic?.checkoutStarts ?? 0}</strong></div><div><small>Visitor → checkout</small><strong>{dashboard.traffic?.visitors ? `${((dashboard.traffic.checkoutStarts / dashboard.traffic.visitors) * 100).toFixed(1)}%` : "—"}</strong></div><div><small>Paid orders since launch</small><strong>{dashboard.traffic?.paidOrders ?? 0}</strong></div><div><small>Checkout → paid</small><strong>{dashboard.traffic?.checkoutStarts ? `${((dashboard.traffic.paidOrders / dashboard.traffic.checkoutStarts) * 100).toFixed(1)}%` : "—"}</strong></div><div><small>Launch-to-date revenue</small><strong>{inr.format((dashboard.traffic?.revenuePaise ?? 0) / 100)}</strong></div></div><div className="location-table"><div className="table-head"><span>Date</span><span>Visitors</span><span>Views</span><span>Checkout starts</span></div>{dashboard.traffic?.daily?.length ? dashboard.traffic.daily.map((day: any) => <div key={day.day}><span>{day.day}</span><strong>{day.visitors}</strong><strong>{day.page_views}</strong><strong>{day.checkout_starts}</strong></div>) : <p>No visitor events recorded yet.</p>}</div></>}
                {adminSection === "revenue" && <>
                <div className="admin-divider" />
                <h2 id="admin-revenue">Revenue</h2>
                <p>Paid printing and fee revenue for the selected period.</p>
                <div className="metric-grid revenue-summary-grid">
                  <div><small>Colour prints</small><strong>{revenueTotals.colourPrints}</strong></div>
                  <div><small>Colour pages</small><strong>{revenueTotals.colourPages}</strong></div>
                  <div><small>Colour amount received</small><strong>{inr.format(revenueTotals.colourAmount)}</strong></div>
                  <div><small>B&amp;W prints</small><strong>{revenueTotals.bwPrints}</strong></div>
                  <div><small>B&amp;W pages</small><strong>{revenueTotals.bwPages}</strong></div>
                  <div><small>B&amp;W amount received</small><strong>{inr.format(revenueTotals.bwAmount)}</strong></div>
                  <div><small>Delivery charges revenue</small><strong>{inr.format(revenueTotals.delivery / 100)}</strong></div>
                  <div><small>Packaging fee revenue</small><strong>{inr.format(revenueTotals.packaging / 100)}</strong></div>
                  <div><small>Platform fee revenue</small><strong>{inr.format(revenueTotals.platform / 100)}</strong></div>
                </div>
                <h3>Location performance</h3>
                <p>Orders and paid revenue across every delivery location.</p>
                <div className="location-table">
                  <div className="table-head"><span>Location & fees</span><span>Orders</span><span>Delivered</span><span>Revenue</span></div>
                  {dashboard.locationStats?.length ? dashboard.locationStats.map((location: any) => (
                    <div key={location.id}>
                      <span><i className={location.active ? "active-dot" : ""} />{location.name}<small>{location.active ? "Active" : "Inactive"} · Delivery {inr.format((location.delivery_fee_paise ?? 1500) / 100)} · Platform {inr.format((location.platform_fee_paise ?? 350) / 100)}</small>{location.active && <span className="location-actions"><button className="text-action" onClick={() => renameLocation(location)}>Rename</button><button className="text-action" onClick={() => editLocationFees(location)}>Edit fees</button><button className="text-action delete" onClick={() => deleteLocation(location)}>Delete</button></span>}</span>
                      <strong>{location.orders ?? 0}</strong>
                      <strong>{location.delivered ?? 0}</strong>
                      <strong>{inr.format((location.revenue_paise ?? 0) / 100)}</strong>
                    </div>
                  )) : <p>No locations added yet.</p>}
                </div>
                </>}
                {adminSection === "riders" && <>
                <h2 id="admin-riders">Rider approvals</h2>
                <h3>Pending rider applications</h3>
                <div className="application-list">{dashboard.riderApplications?.length ? dashboard.riderApplications.map((application: any) => <article key={application.email}><span><strong>{application.name}</strong><small>{application.email} · {application.mobile_number}</small></span><div><button onClick={() => approveRider(application.email, true)}>Approve</button><button className="reject" onClick={() => approveRider(application.email, false)}>Reject</button></div></article>) : <p>No rider applications awaiting review.</p>}</div>
                </>}
                {adminSection === "revenue" && <>
                <h3>Active users</h3>
                <p>Customers who have placed orders, sorted by latest activity.</p>
                <div className="active-users">
                  {dashboard.activeUsers?.length ? dashboard.activeUsers.map((user: any) => <article key={user.email}><span className="user-avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.email} · {user.mobile_number}</small><small>Last order {new Date(user.last_order_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></span><span><strong>{user.order_count}</strong><small>Orders</small></span><span><strong>{inr.format((user.paid_spend_paise ?? 0) / 100)}</strong><small>Paid spend</small></span></article>) : <p>No active users yet.</p>}
                </div>
                <h3>Customer wallets</h3>
                <p>Every account's available balance, redeemed points, total credits, and points earned from delivered orders.</p>
                <div className="wallet-users-table"><div className="wallet-users-head"><span>User</span><span>Available</span><span>Spent</span><span>Credited</span><span>Delivered orders</span></div>{dashboard.walletUsers?.length ? dashboard.walletUsers.map((user: any) => <article key={user.email}><span><strong>{user.email}</strong><small>{user.referral_code}{user.latest_order_number ? ` · Latest ${user.latest_order_number}` : ""}</small></span><b>{user.available_points}</b><b>{user.spent_points}</b><b>{user.total_credited_points}</b><span><strong>{user.delivered_spend_points} points</strong><small>1 point per ₹10 after delivery</small></span></article>) : <p>No wallets yet.</p>}</div>
                <h3>Revenue by order</h3>
                <p>Paid order revenue, rider earnings, and PrintBee revenue per order.</p>
                <div className="revenue-table">
                    <div className="revenue-head"><span>Order</span><span>Revenue</span><span>Delivery partner</span><span>Rider fee</span><span>Admin revenue</span></div>
                  {dashboard.revenueOrders?.length ? dashboard.revenueOrders.map((entry: any) => <article key={entry.order_number}><span><strong>{entry.order_number}</strong><small>{new Date(entry.created_at).toLocaleDateString("en-IN")}</small></span><strong>{inr.format(entry.revenue_paise / 100)}</strong><span><strong>{entry.rider_name}</strong><small>{entry.rider_email || "Awaiting assignment"}</small></span><strong>{inr.format(entry.rider_fee_paise / 100)}</strong><span><strong>{inr.format(entry.admin_revenue_paise / 100)}</strong><small>Print {inr.format(entry.printing_subtotal_paise / 100)} + packaging {inr.format((entry.packaging_fee_paise ?? 0) / 100)} + platform {inr.format(entry.platform_fee_paise / 100)} + 25% delivery</small></span></article>) : <p>No paid-order revenue yet.</p>}
                </div>
                </>}
                {adminSection === "ledger" && <>
                <section className="ledger-section" id="admin-ledger">
                  <div className="ledger-heading"><div><span className="admin-badge">PASSWORD PROTECTED</span><h2>Business ledger</h2><p>Excel-style daily accounts calculated from all paid, visible orders.</p></div>{ledger && <div className="ledger-actions"><button className="download-ledger" onClick={() => downloadLedgerCsv(ledger)}>Download ledger</button><button onClick={() => { void lockLedger(); }}>Lock ledger</button></div>}</div>
                  {!ledger ? <form className="ledger-lock" onSubmit={(event) => { event.preventDefault(); unlockLedger(); }}><label>Ledger password<input type="password" autoComplete="current-password" value={ledgerPassword} onChange={(event) => setLedgerPassword(event.target.value)} placeholder="Enter password" /></label><button disabled={!ledgerPassword}>Unlock ledger</button>{ledgerMessage && <p>{ledgerMessage}</p>}</form> : <>
                    <div className="ledger-summary">
                      <div><small>Amount collected</small><strong>{inr.format(ledger.totals.amountCollectedPaise / 100)}</strong></div><div><small>Operational cost</small><strong>{inr.format(ledger.totals.operationalCostPaise / 100)}</strong></div><div><small>Total profit</small><strong>{inr.format(ledger.totals.netProfitPaise / 100)}</strong></div><div><small>Owner (Bharat) total</small><strong>{inr.format(ledger.totals.ownerTotalProfitPaise / 100)}</strong></div><div><small>Operator (Ramya) total</small><strong>{inr.format(ledger.totals.operatorTotalProfitPaise / 100)}</strong></div><div><small>Shares tally to</small><strong>{inr.format(ledger.totals.shareTallyPaise / 100)}</strong></div>
                    </div>
                    <p className="ledger-note">Printing revenue is calculated from each uploaded page and copy using the B&amp;W/colour single- or double-sided price saved with that order. Binding and other printing services are tracked separately. Payment handling charges are recorded as payment-gateway operating cost. The operator receives 65% of printing profit and profit from other printing services such as binding. The owner receives the remaining printing profit, platform fees, packing profit, surcharge, project platform revenue, and all other profit; late-night delivery is split 60% to the delivery partner and 40% to the owner.</p>
                    <h3>Plagiarism ledger</h3><div className="ledger-summary"><div><small>Plagiarism revenue</small><strong>{inr.format((ledger.totals.plagiarismRevenuePaise ?? 0) / 100)}</strong></div><div><small>Plagiarism operating cost</small><strong>{inr.format((ledger.totals.plagiarismOperationalCostPaise ?? 0) / 100)}</strong></div><div><small>Plagiarism profit</small><strong>{inr.format((ledger.totals.plagiarismProfitPaise ?? 0) / 100)}</strong></div></div>
                    <h3>Franchise ledger</h3><div className="ledger-summary"><div><small>PrintBee franchise revenue (12.5%)</small><strong>{inr.format((ledger.franchiseAdminRevenuePaise ?? 0) / 100)}</strong></div></div><div className="location-table"><div className="table-head"><span>Franchise</span><span>Orders</span><span>Paid revenue</span><span>Franchise share (87.5%)</span></div>{ledger.franchises?.map((store: any) => <div key={store.store_id}><span>{store.name}</span><strong>{store.orders}</strong><strong>{inr.format(store.revenue_paise / 100)}</strong><strong>{inr.format(store.franchise_revenue_paise / 100)}</strong></div>) || <p>No franchise-paid orders yet.</p>}</div>
                    <h3>Daily financial breakdown</h3>
                    <LedgerFinancialTable rows={ledger.daily} total={ledger.totals} />
                    <h3>Order-by-order financial breakdown</h3>
                    <LedgerFinancialTable rows={ledger.orders} orderView />
                    <h3>Order data</h3><div className="ledger-sheet ledger-orders"><table><thead><tr><th>Order number</th><th>Name</th><th>Mobile number</th><th>Order value</th><th>Date &amp; time</th><th>Email</th><th>Location</th><th>Status</th></tr></thead><tbody>{ledger.orders.map((order: any) => <tr key={order.order_number}><td>{order.order_number}</td><td>{order.customer_name}</td><td>{order.mobile_number}</td><td>{inr.format(order.total_paise / 100)}</td><td>{new Date(order.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td><td>{order.customer_email}</td><td>{order.location_name}</td><td>{String(order.status).replaceAll("_", " ")}</td></tr>)}</tbody></table></div>
                  </>}
                </section>
                </>}
                {adminSection === "orders" && <>
                <div className="order-export-panel">
                  <div><h3>Export orders</h3><p>Download a PDF containing visible orders only. Hidden orders are excluded.</p></div>
                  <div className="export-actions">
                    <button disabled={exporting} onClick={() => exportOrdersPdf("1d")}>Last 1 day PDF</button>
                    <button disabled={exporting} onClick={() => exportOrdersPdf("30d")}>Last 30 days PDF</button>
                    <label>From<input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} /></label>
                    <label>To<input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} /></label>
                    <button disabled={exporting || !exportFrom || !exportTo} onClick={() => exportOrdersPdf("custom")}>{exporting ? "Creating PDF..." : "Export custom PDF"}</button>
                  </div>
                </div>
                </>}
                {adminSection === "riders" && <>
                <h3>Rider performance</h3>
                <div className="rider-stats">{dashboard.riders?.length ? dashboard.riders.map((rider: any) => <div key={rider.email}><span><b>{rider.name || "Delivery partner"}</b><small>{rider.email} · {rider.mobile_number || "No mobile"}</small><small>{rider.delivered ?? 0} successful rides · {rider.assigned ?? 0} assigned</small></span><strong>{inr.format((rider.earned_paise ?? 0) / 100)}<small>Total earned</small></strong><button className="remove-rider" onClick={() => removeRider(rider.email)}>Remove partner</button></div>) : <p>No riders added yet.</p>}</div>
                <div className="payout-panel">
                  <div><h3>Record rider payment</h3><p>Save an amount paid to a rider for a specific day.</p></div>
                  <div className="payout-form">
                    <label>Rider<select value={riderPayment.riderEmail} onChange={(e) => setRiderPayment({ ...riderPayment, riderEmail: e.target.value })}><option value="">Select rider</option>{dashboard.riders?.map((rider: any) => <option key={rider.email} value={rider.email}>{rider.email}</option>)}</select></label>
                    <label>Amount (₹)<input type="number" min="1" step="0.01" value={riderPayment.amount} onChange={(e) => setRiderPayment({ ...riderPayment, amount: e.target.value })} placeholder="500" /></label>
                    <label>Date<input type="date" value={riderPayment.paymentDate} onChange={(e) => setRiderPayment({ ...riderPayment, paymentDate: e.target.value })} /></label>
                    <label>Note<input value={riderPayment.note} onChange={(e) => setRiderPayment({ ...riderPayment, note: e.target.value })} placeholder="Optional note" /></label>
                    <button onClick={recordRiderPayment} disabled={!riderPayment.riderEmail || !riderPayment.amount}>Record payment</button>
                  </div>
                </div>
                <h3>Recent rider payments</h3>
                <div className="payout-history">{dashboard.riderPayments?.length ? dashboard.riderPayments.slice(0, 12).map((payment: any) => <article key={payment.id}><span><strong>{payment.rider_email}</strong><small>{new Date(`${payment.payment_date}T00:00:00`).toLocaleDateString("en-IN")}{payment.note ? ` · ${payment.note}` : ""}</small></span><strong>{inr.format(payment.amount_paise / 100)}</strong></article>) : <p>No rider payments recorded yet.</p>}</div>
                <h3>Rider withdrawal requests</h3>
                <p>Review the UPI ID and move each request through the payout flow.</p>
                <div className="withdrawal-admin">{dashboard.riderWithdrawals?.length ? dashboard.riderWithdrawals.map((withdrawal: any) => <article className={withdrawal.status === "SENT" ? "payout-complete" : ""} key={withdrawal.id}><span><strong>{withdrawal.rider_email}</strong><small>UPI: {withdrawal.upi_id}</small><small>Requested {new Date(withdrawal.requested_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></span><strong>{inr.format(withdrawal.amount_paise / 100)}</strong>{withdrawal.status === "SENT" ? <span className="payout-done"><b>✓ Action done</b><small>Money sent to bank</small></span> : <select value={withdrawal.status} onChange={(e) => updateWithdrawalStatus(withdrawal.id, e.target.value)}><option value="REQUESTED">Withdraw requested</option><option value="IN_PROGRESS">In progress</option><option value="SENT">Amount sent to bank</option></select>}</article>) : <p>No withdrawal requests yet.</p>}</div>
                </>}
                {adminSection === "orders" && <>
                <h2 id="admin-orders">Live orders <small className="live-refresh">● Live · refreshes every 5 seconds</small></h2>
                <div className="admin-order-toolbar"><label>Search orders<input value={adminOrderSearch} onChange={(event) => setAdminOrderSearch(event.target.value)} placeholder="Order, customer, phone, email, location or rider" /></label><label>Status<select value={adminOrderStatus} onChange={(event) => setAdminOrderStatus(event.target.value)}><option value="ALL">All statuses</option><option value="CONFIRMED">Confirmed</option><option value="PRINTING">Printing</option><option value="READY_FOR_PICKUP">Ready for pickup</option><option value="RIDER_ASSIGNED">Rider assigned</option><option value="DELIVERED">Delivered</option><option value="CANCELLED">Cancelled</option></select></label><span><strong>{visibleAdminOrders.length}</strong><small>matching orders</small></span></div>
                <div className="orders-table-head"><span>Order &amp; documents</span><span>Payment QR</span><span>Status</span><span>Delivery partner</span><span>Earnings</span><span>Export</span></div>
                <div className="admin-orders">{visibleAdminOrders.length ? visibleAdminOrders.map((order: any) => (
                  <article className={expandedAdminOrders[order.id] ? "is-expanded" : "is-compact"} key={order.id}>
                    <div className="order-customer">
                      <strong>{order.order_number}</strong>
                      <small><b>Customer:</b> {order.customer_name} · {order.mobile_number}</small>
                      <small><b>Email:</b> {order.customer_email}</small>
                      <small><b>Delivery:</b> {order.location_name}</small>{Boolean(order.incampus_delivery) && <small><b>In-campus details:</b> {order.incampus_type === "CLASSROOM" ? "Classroom" : "Hostel"} · {order.campus_building}{order.classroom_number ? ` · Room ${order.classroom_number}` : ""}</small>}
                      <small><b>Ordered:</b> {new Date(order.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small>
                    </div>
                    <span className="status-chip">{order.payment_status} · {order.status}</span>
                    <strong>{inr.format(order.total_paise / 100)}</strong>
                    <div className="compact-order-actions">
                      <button className="view-order-action" onClick={() => setExpandedAdminOrders((current) => ({ ...current, [order.id]: !current[order.id] }))}>{expandedAdminOrders[order.id] ? "Close order" : "View order"}</button>
                      <label>Order flow<select disabled={order.status === "CANCELLED" || order.payment_status === "REJECTED"} value={order.status} onChange={(e) => updateOrderStatus(order.id, e.target.value)}>{order.status === "CANCELLED" && <option value="CANCELLED">Cancelled</option>}<option value="CONFIRMED">Confirmed</option><option value="PRINTING">Printing</option><option value="READY_FOR_PICKUP">Ready for pickup</option><option value="RIDER_ASSIGNED">Rider assigned</option><option value="DELIVERED">Delivered</option></select></label>
                      <label>Delivery partner<select disabled={order.status === "CANCELLED" || order.payment_status === "REJECTED"} value={order.rider_email ?? ""} onChange={(e) => assignRider(order.id, e.target.value)}><option value="">Assign available rider</option>{dashboard.riders.filter((rider: any) => rider.is_available).map((rider: any) => <option key={rider.email} value={rider.email}>{rider.name || rider.email} · Available</option>)}</select></label>
                    </div>
                    <div className="payment-review-details"><span><small>Payment</small><strong>{order.payment_status === "PAY_ON_DELIVERY" ? "Pay on delivery" : order.payment_reference || order.payment_status}</strong></span><span><small>Total</small><strong>{inr.format(order.total_paise / 100)}</strong></span></div>
                    {order.items?.every((item: any) => item.serviceId === PLAGIARISM_SERVICE_ID) && <div className="plagiarism-admin-flow"><strong>Plagiarism report flow</strong><PlagiarismTracker status={order.status} /><div><button className={order.status === "PLAGIARISM_SUBMITTED" ? "active" : ""} onClick={() => updateOrderStatus(order.id, "PLAGIARISM_SUBMITTED")}>Document submitted</button><button className={order.status === "PLAGIARISM_REPORT_RECEIVED" ? "active" : ""} onClick={() => updateOrderStatus(order.id, "PLAGIARISM_REPORT_RECEIVED")}>Report received</button><button className={order.status === "DELIVERED" ? "active" : ""} onClick={() => updateOrderStatus(order.id, "DELIVERED")}>Sent to WhatsApp · complete</button></div></div>}
                    {order.payment_status === "PAID" && order.payment_verified_at && <div className="payment-cleared-note"><strong>Payment received and verified</strong><small>Verified {new Date(order.payment_verified_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} by {order.payment_verified_by}. Scanner deleted from admin, customer and delivery-partner views.</small></div>}
                    {Boolean(order.has_payment_qr) && <div className="admin-payment-qr"><strong>Legacy payment scanner</strong><img src={`/api/orders/${order.id}/payment-qr`} alt={`Payment scanner for ${order.order_number}`} /></div>}
                    {order.payment_status === "PAY_ON_DELIVERY" && order.status !== "CANCELLED" && <div className="payment-review-actions"><button className="mini-action" onClick={() => reviewPayment(order.id, "APPROVE")}>Payment received & verified</button></div>}
                    {order.payment_status === "PENDING" && order.status !== "CANCELLED" && <div className="payment-review-actions"><button className="mini-action" disabled={!order.payment_reference} onClick={() => reviewPayment(order.id, "APPROVE")}>Payment verified</button><button onClick={() => reviewPayment(order.id, "REJECT", "REFERENCE")}>Wrong payment ID</button><button onClick={() => reviewPayment(order.id, "REJECT", "AMOUNT")}>Wrong amount</button><button onClick={() => reviewPayment(order.id, "REJECT", "BOTH")}>Both mismatch</button></div>}
                    {order.payment_rejection_reason && <div className="cancelled-note"><strong>Payment rejected</strong><small>{order.payment_rejection_reason}</small></div>}
                    {order.status === "CANCELLED" && <div className="cancelled-note"><strong>Cancelled</strong><small>{order.cancellation_reason}</small></div>}
                    <div className="document-details compact-order-details">
                      <strong>Order summary</strong>
                      {(() => { const total = printSummary(order.items); return <div className="print-summary"><span>B&amp;W: {total.bwSingle + total.bwDouble} pages</span><span>Colour: {total.colourSingle + total.colourDouble} pages</span></div>; })()}
                      {order.items?.length ? order.items.map((item: any, index: number) => (
                        <div key={`${item.uploadId ?? item.fileName}-${index}`}>
                          <span>{item.displayReference ?? `${order.order_number}-${index + 1}`}</span><small className="original-file-name">Original: {item.fileName ?? `Document ${index + 1}`}</small>
                          {item.kind === "ADDON" ? <small>Optional product · {item.addons?.[0]?.description || "Add-on only"} · {inr.format(item.total ?? item.addonsTotal ?? 0)}</small> : <small>{String(item.fileType ?? "PDF").toUpperCase()} · {printModeLabel(item.mode)} · {item.pages ?? 1} pages · {item.copies ?? 1} {item.copies === 1 ? "copy" : "copies"} · {item.serviceName || "Document printing"}</small>}
                          {item.colourPageNumbers !== undefined && <small><b>Colour pages:</b> {item.colourPageNumbers} · all remaining pages B&amp;W</small>}
                          {item.bwPageNumbers && <small><b>B&amp;W pages:</b> {item.bwPageNumbers}</small>}
                          {item.printInstructions && <small><b>Instructions:</b> {item.printInstructions} · WhatsApp {item.whatsappNumber}</small>}
                          {item.kind !== "ADDON" && item.addons?.length ? <div className="optional-products"><b>Optional products</b>{item.addons.map((addon: any) => <small key={addon.id}><span>{addon.name}{addon.description ? ` — ${addon.description}` : ""}</span><strong>{inr.format(addon.price)}</strong></small>)}</div> : null}
                        </div>
                      )) : <small>No document details saved for this legacy order.</small>}
                      <div className="order-bill-summary"><strong>Bill summary</strong><span><small>Printing &amp; products</small><b>{inr.format(order.printing_subtotal_paise / 100)}</b></span><span><small>Delivery</small><b>{inr.format(order.delivery_fee_paise / 100)}</b></span>{(order.incampus_fee_paise ?? 0) > 0 && <span><small>In-campus delivery</small><b>{inr.format(order.incampus_fee_paise / 100)}</b></span>}<span><small>Platform fee</small><b>{inr.format(order.platform_fee_paise / 100)}</b></span>{(order.packaging_fee_paise ?? 0) > 0 && <span><small>Packaging</small><b>{inr.format(order.packaging_fee_paise / 100)}</b></span>}{(order.payment_gateway_fee_paise ?? 0) > 0 && <span><small>Payment fee</small><b>{inr.format(order.payment_gateway_fee_paise / 100)}</b></span>}{(order.surge_fee_paise ?? 0) > 0 && <span><small>Surge charge</small><b>{inr.format(order.surge_fee_paise / 100)}</b></span>}{(order.late_night_fee_paise ?? 0) > 0 && <span><small>Late-night delivery</small><b>{inr.format(order.late_night_fee_paise / 100)}</b></span>}<span className="bill-total"><small>Total</small><b>{inr.format(order.total_paise / 100)}</b></span></div>
                    </div>
                    <div className="file-links">{order.files?.length ? order.files.map((file: any) => file.deleted_at ? <span className="deleted-file" key={file.id}>{file.original_name} · deleted {new Date(file.deleted_at).toLocaleDateString("en-IN")}</span> : <a key={file.id} href={`/api/admin/files/${file.id}/download`}>Download {file.original_name}</a>) : <span>{order.items?.every((item: any) => item.kind === "ADDON") ? "Add-on-only order — no document required" : "Legacy order — document was not stored"}</span>}</div>
                    {(["DELIVERED", "CANCELLED"].includes(String(order.status).toUpperCase()) || order.delivered_at || order.cancelled_at) && (order.files?.some((file: any) => !file.deleted_at) ? <button className="delete-files-action" onClick={() => deleteOrderFiles(order.id)}>Delete {order.files.filter((file: any) => !file.deleted_at).length} document{order.files.filter((file: any) => !file.deleted_at).length === 1 ? "" : "s"} from storage</button> : <div className="files-cleared-note">No stored documents remain for this order.</div>)}
                    <select disabled={order.status === "CANCELLED" || order.payment_status === "REJECTED"} value={order.status} onChange={(e) => updateOrderStatus(order.id, e.target.value)}>
                      {order.status === "CANCELLED" && <option value="CANCELLED">Cancelled</option>}
                      <option value="CONFIRMED">Confirmed</option><option value="PRINTING">Printing</option><option value="READY_FOR_PICKUP">Ready for pickup</option><option value="RIDER_ASSIGNED">Rider assigned</option>
                    </select>
                    <select disabled={order.status === "CANCELLED" || order.payment_status === "REJECTED"} value={order.rider_email ?? ""} onChange={(e) => assignRider(order.id, e.target.value)}>
                      <option value="">Assign available rider</option>{dashboard.riders.filter((rider: any) => rider.is_available).map((rider: any) => <option key={rider.email} value={rider.email}>{rider.name || rider.email} · Available</option>)}
                    </select>
                    <div className="give-points-control"><input type="number" min="1" max="10000" step="1" value={grantPointDrafts[order.id] ?? ""} onChange={(event) => setGrantPointDrafts((drafts) => ({ ...drafts, [order.id]: event.target.value }))} placeholder="Give points (optional)" aria-label={`Points to give customer for ${order.order_number}`} /><button disabled={!Number(grantPointDrafts[order.id])} onClick={() => grantOrderPoints(order.id)}>Give points</button></div>
                    <div className="order-earnings"><span>Rider <b>{inr.format((order.delivery_fee_paise * .75) / 100)}</b></span><span>Admin <b>{inr.format((order.printing_subtotal_paise + order.platform_fee_paise + order.delivery_fee_paise * .2) / 100)}</b></span></div>
                    <div className="order-record-actions"><button className="hide-order-action" onClick={() => setOrderHidden(order.id, true)}>Hide from dashboard &amp; exports</button><button className="delete-order-action" onClick={() => deleteOrder(order)}>Delete this order</button></div>
                  </article>
                )) : <p>No orders match the current filters.</p>}</div>
                {dashboard.pagination?.pages > 1 && <nav className="admin-pagination" aria-label="Order pages"><button disabled={adminPage <= 1} onClick={() => openAdminDashboard(adminPage - 1)}>Previous</button><span>Page <strong>{adminPage}</strong> of {dashboard.pagination.pages} · {dashboard.pagination.total} paid orders</span><button disabled={adminPage >= dashboard.pagination.pages} onClick={() => openAdminDashboard(adminPage + 1)}>Next</button></nav>}
                <h3>Hidden orders</h3>
                <p>Archived orders are excluded from the dashboard, revenue/profit, location and rider totals, active users, and exports.</p>
                <div className="hidden-orders">{dashboard.hiddenOrders?.length ? dashboard.hiddenOrders.map((order: any) => (
                  <article key={order.id}>
                    <span><strong>{order.order_number}</strong><small>{order.customer_name} · {order.location_name}</small><small>Ordered {new Date(order.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></span>
                    <span><strong>{inr.format(order.total_paise / 100)}</strong><small>{order.payment_status} · {order.status}</small></span>
                    <span><small>Hidden {new Date(order.hidden_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small><button onClick={() => setOrderHidden(order.id, false)}>Restore order</button><button className="delete-order-action" onClick={() => deleteOrder(order)}>Delete this order</button></span>
                  </article>
                )) : <p>No hidden orders.</p>}</div>
                </>}
              </div>
            )}
            <small className="admin-note">Print services and A4 prices are shared with all customers.</small>
            </div>
          </section>
        </div>
      )}</GlassPresence>

      <GlassPresence>{checkoutOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setCheckoutOpen(false)}>
          <section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title" onMouseDown={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setCheckoutOpen(false)} aria-label="Close">×</button>
            {orderResult ? (
              <div className="order-success"><CheckoutProgress step={orderResult.paid ? 3 : 2} />{orderResult.paid && <PaymentCelebration />}
                {orderResult.paid && <><BeeMascot celebrate /><p>Amount paid <strong>{inr.format(orderResult.totalPaise / 100)}</strong></p><button className="primary-cta" onClick={() => { setCheckoutOpen(false); void openMyOrders(); }}>Track Order →</button></>}
                <span>{orderResult.paid ? "✓" : "₹"}</span><h2>{orderResult.paid ? "Order placed" : "Complete payment"}</h2>
                <p>{orderResult.paid ? <>Order <strong>{orderResult.orderNumber}</strong> · {orderResult.locationName}</> : <>Your order number will be created after successful payment · {orderResult.locationName}</>}</p>
                <div className="payment-pending"><small>Payment status</small><strong>{orderResult.paid ? "PAID" : "PAYMENT REQUIRED"}</strong></div>
                {(orderResult.lateNightFeePaise ?? 0) > 0 && <div className="payment-pending"><small>Late-night delivery fee</small><strong>{inr.format((orderResult.lateNightFeePaise ?? 0) / 100)}</strong></div>}
                {orderResult.paid && <a className="invoice-link" href={`/api/orders/${orderResult.id}/invoice`}>Download GST-style invoice PDF</a>}
                <p>{orderResult.paid ? "Payment verified. Your delivery OTP will appear in tracking when a partner is assigned." : `Pay ${inr.format(orderResult.totalPaise / 100)} securely through Razorpay so printing can begin.`}</p>
                {!orderResult.paid && <button className="save-button" disabled={paymentProcessing} onClick={() => startRazorpayPayment(orderResult)}>{paymentProcessing ? "Starting payment..." : `Pay ${inr.format(orderResult.totalPaise / 100)} now`}</button>}
                {orderError && <p className="panel-message">{orderError}</p>}
                <button className="save-button" onClick={() => { setCheckoutOpen(false); setOrderResult(null); }}>Done</button>
              </div>
            ) : (
              <>
                <CheckoutProgress step={paymentProcessing ? 2 : customerName.trim() && mobileNumber.length === 10 ? 1 : 0} /><div className="admin-badge">CHECKOUT</div>
                <h2 id="checkout-title">Delivery details</h2>
                <p>{isPlagiarismOnly ? "Your plagiarism report will be sent to the WhatsApp number below within 24 hours." : "Share your current location, then confirm the delivery address below."}</p>
                <label className="checkout-field">Full name<input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Your full name" /></label>
                <label className="checkout-field">{isPlagiarismOnly ? "WhatsApp number" : "Mobile number"}<input value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit mobile number" inputMode="numeric" /></label>
                {!isPlagiarismOnly && <><button type="button" className="save-button" onClick={useCurrentLocation}>Use My Current Location</button>
                <button type="button" className={`packaging-choice ${incampusDelivery ? "selected" : ""}`} aria-pressed={incampusDelivery} onClick={() => setIncampusDelivery((current) => !current)}><span><strong>In-campus delivery</strong><small>Add ₹10 for classroom or hostel delivery.</small></span><b>{incampusDelivery ? "✓ Added" : "Add"}</b></button>
                {locationMessage && <p className="panel-message">{locationMessage}</p>}
                <label className="checkout-field">Building / house number and delivery address<textarea value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="House / flat number, building, street and area" rows={3} /></label>
                <label className="checkout-field">Landmark (optional)<input value={deliveryLandmark} onChange={(e) => setDeliveryLandmark(e.target.value)} placeholder="Near a shop, gate or landmark" /></label></>}
                {incampusDelivery && <div className="binding-fields"><strong>In-campus delivery details</strong><p><b>Please enter class room number and building name for university classrooms, enter only building name for hostels.</b></p><div className="service-option-grid" role="radiogroup" aria-label="In-campus destination type"><button type="button" role="radio" aria-checked={incampusType === "CLASSROOM"} className={incampusType === "CLASSROOM" ? "selected" : ""} onClick={() => setIncampusType("CLASSROOM")}><span><strong>University classroom</strong><small>Building name and classroom number required.</small></span></button><button type="button" role="radio" aria-checked={incampusType === "HOSTEL"} className={incampusType === "HOSTEL" ? "selected" : ""} onClick={() => setIncampusType("HOSTEL")}><span><strong>Hostel</strong><small>Building name required.</small></span></button></div><label>Building name<input value={campusBuilding} onChange={(e) => setCampusBuilding(e.target.value)} placeholder="Example: Academic Block A or Krishna Hostel" /></label>{incampusType === "CLASSROOM" && <label>Classroom number<input value={classroomNumber} onChange={(e) => setClassroomNumber(e.target.value)} placeholder="Example: A-204" /></label>}</div>}
                {packagingEnabled && <button type="button" className={`packaging-choice ${needsPackaging ? "selected" : ""}`} aria-pressed={needsPackaging} onClick={() => setNeedsPackaging((current) => !current)}><span><strong>Need packaging for this order?</strong><small>Add protective packaging for {inr.format(packagingFee)}.</small></span><b>{needsPackaging ? "✓ Added" : "Add"}</b></button>}
                <div className="fee-breakdown"><div><span>{isPlagiarismOnly ? "Plagiarism subtotal" : "Printing subtotal"}</span><strong>{inr.format(isPlagiarismOnly ? cartTotal : cartPrintingTotal)}</strong></div>{!isPlagiarismOnly && cartServiceCharges > 0 && <div className="binding-charge-row"><span>Service charges</span><strong>{inr.format(cartServiceCharges)}</strong></div>}{cartAddonCharges > 0 && <div className="binding-charge-row"><span>Add-ons</span><strong>{inr.format(cartAddonCharges)}</strong></div>}{!isPlagiarismOnly && <><div><span>Delivery fee</span><strong>{inr.format(checkoutDeliveryFee)}</strong></div>{incampusDelivery && <div className="binding-charge-row"><span>In-campus delivery</span><strong>{inr.format(checkoutIncampusFee)}</strong></div>}<div><span>Platform fee</span><strong>{inr.format(checkoutPlatformFee)}</strong></div>{needsPackaging && packagingEnabled && <div className="packaging-charge-row"><span>Packaging fee</span><strong>{inr.format(checkoutPackagingFee)}</strong></div>}{surgeEnabled && <div className="surge-charge-row"><span>High-demand surge charge</span><strong>{inr.format(checkoutSurgeFee)}</strong></div>}{lateNightEnabled && <div className="surge-charge-row"><span>Late-night delivery fee</span><strong>{inr.format(checkoutLateNightFee)}</strong></div>}</>}{checkoutGatewayFee > 0 && <div><span>{isPlagiarismOnly ? "Payment handling charges (2.36%)" : "Payment handling charges"}</span><strong>{inr.format(checkoutGatewayFee)}</strong></div>}{pointsDiscount > 0 && <div className="points-discount-row"><span>Points discount ({redeemablePoints} points)</span><strong>−{inr.format(pointsDiscount)}</strong></div>}</div>
                <button type="button" className={`wallet-balance-button ${usePoints ? "selected" : ""}`} disabled={redeemablePoints < 1} onClick={() => setUsePoints((current) => !current)}><span className="wallet-icon">₹</span><span><strong>{usePoints ? "Wallet applied" : "Use wallet balance"}</strong><small>{pointsBalance} points · worth {inr.format(pointsBalance / 15)} · every point is redeemable</small></span><b>{usePoints ? "✓" : "Use"}</b></button>
                <div className="checkout-total"><span>Estimated total</span><AnimatedPrice value={Math.max(0, checkoutBeforePoints - pointsDiscount)} /></div>
                <div className="points-earned-preview"><span>◉</span><div><strong>You’ll earn {Math.floor(Math.max(0, checkoutBeforePoints - pointsDiscount) / 10)} wallet points</strong><small>Credited after this order is successfully delivered.</small></div></div>
                <div className="pay-on-delivery-note"><strong>Secure online payment:</strong> After creating the order, complete payment through Razorpay. Printing begins only after verified payment.</div>
                {orderError && <p className="form-error">{orderError}</p>}
                <button className="save-button" aria-busy={paymentProcessing} disabled={(!isPlagiarismOnly && (!deliveryAddress.trim() || !customerCoordinates || calculatedDeliveryFee === null || (incampusDelivery && (!campusBuilding.trim() || (incampusType === "CLASSROOM" && !classroomNumber.trim()))))) || !customerName.trim() || mobileNumber.length !== 10 || paymentProcessing} onClick={() => void placeOrder()}>{paymentProcessing ? <LoadingAnimation label="Starting Razorpay…" /> : "Pay now"}</button>
              </>
            )}
          </section>
        </div>
      )}</GlassPresence>

      <GlassPresence>{safariUpiNoticeOpen && (
        <div className="modal-backdrop browser-payment-backdrop" role="presentation" onMouseDown={() => setSafariUpiNoticeOpen(false)}>
          <section className="checkout-modal browser-payment-notice" role="dialog" aria-modal="true" aria-labelledby="safari-upi-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="close" onClick={() => setSafariUpiNoticeOpen(false)} aria-label="Close payment browser notice">Ã—</button>
            <div className="admin-badge">UPI PAYMENT NOTICE</div>
            <h2 id="safari-upi-title">UPI options can be limited in Safari</h2>
            <p>Sometimes UPI options do not display in Safari. For the best UPI experience, open the PrintBee website in Chrome. Your signed-in cart is saved; after opening Chrome, sign in again, enter your name and required details, then pay.</p>
            <button className="save-button" onClick={() => {
              // Chrome for iOS opens HTTPS links through its googlechromes URI
              // scheme. The older /navigate query form is parsed as a host by
              // recent Chrome builds and results in ERR_NAME_NOT_RESOLVED.
              window.location.href = "googlechromes://www.printbee.co.in";
            }}>Open in Chrome</button>
            <button className="browser-payment-dismiss" onClick={() => { setSafariUpiNoticeOpen(false); void placeOrder(true); }}>Continue in Safari</button>
          </section>
        </div>
      )}</GlassPresence>

      <GlassPresence>{walletOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setWalletOpen(false)}>
          <section className="checkout-modal wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="close" onClick={() => setWalletOpen(false)} aria-label="Close wallet">×</button>
            <div className="wallet-heading"><span>◉</span><div><small>PRINTBEE WALLET</small><h2 id="wallet-title"><AnimatedCounter value={pointsBalance} onceInView /> points</h2><p>Worth {inr.format(pointsBalance / 15)} · every point can be redeemed at checkout.</p></div></div>
            <div className="earn-more-card"><div className="admin-badge">EARN MORE</div><h3>Invite friends to PrintBee</h3><p>Share your unique referral code or link. You earn 1 point for every ₹15 your referred friends spend on delivered orders.</p><label>Your referral code<input readOnly value={myReferralCode} /></label><label>Shareable referral link<input readOnly value={typeof window === "undefined" ? "" : `${window.location.origin}/?ref=${myReferralCode}`} /></label><button className="save-button" disabled={!myReferralCode} onClick={shareReferral}>Share referral link</button></div>
            {!hasReferrer ? <div className="existing-referral-card"><h3>Have a referral code?</h3><p>Existing users can link a valid code too. This is optional and can be done once.</p><label className="checkout-field">Referral code<input value={referralCode} onChange={(event) => setReferralCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="PBXXXXXXXX" /></label><button className="save-button" disabled={!referralCode.trim()} onClick={linkExistingReferral}>Verify referral code</button></div> : <div className="referral-linked">✓ A referral code is linked to your account.</div>}
            {walletMessage && <p className="panel-message">{walletMessage}</p>}
          </section>
        </div>
      )}</GlassPresence>

      <GlassPresence>{deliveryOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDeliveryOpen(false)}>
          <section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="delivery-title" onMouseDown={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setDeliveryOpen(false)} aria-label="Close">×</button>
            <div className="admin-badge">DELIVERY AGENT</div>
            <h2 id="delivery-title">Verify delivery</h2>
            <p>Ask the customer for their six-digit code only after handing over the prints.</p>
            {!viewer?.isAdmin && riderEarnings && <div className="rider-wallet">
              <div><small>Successful rides</small><strong>{riderEarnings.totalRides}</strong></div>
              <div><small>Total earned</small><strong>{inr.format(riderEarnings.earnedPaise / 100)}</strong></div>
              <div><small>Available to withdraw</small><strong>{inr.format(riderEarnings.availablePaise / 100)}</strong></div>
              <p>You earn 75% of the delivery fee for every successfully delivered order.</p>
              <label>UPI ID<input value={withdrawUpi} onChange={(e) => setWithdrawUpi(e.target.value)} placeholder="yourname@upi" /></label>
              <button disabled={riderEarnings.availablePaise <= 0 || !withdrawUpi.trim()} onClick={requestWithdrawal}>Withdraw available earnings</button>
              <div className="rider-withdrawals">{riderEarnings.withdrawals?.map((withdrawal: any) => <span key={withdrawal.id}><b>{inr.format(withdrawal.amount_paise / 100)}</b><small>{withdrawal.status === "REQUESTED" ? "Withdraw requested" : withdrawal.status === "IN_PROGRESS" ? "In progress" : "Amount sent to bank"} · {withdrawal.upi_id}</small></span>)}</div>
            </div>}
            <div className="rider-queue">
              <h3>My assigned orders</h3>
              {riderOrders.length ? riderOrders.map((order) => <button key={order.order_number} onClick={() => setDeliveryOrderNumber(order.order_number)}><strong>{order.order_number}</strong><span>{order.customer_name} · {order.location_name}</span><small>{order.mobile_number} · {order.status}</small></button>) : <p>No active assigned orders.</p>}
            </div>
            <label className="checkout-field">Order number<input value={deliveryOrderNumber} onChange={(e) => setDeliveryOrderNumber(e.target.value.toUpperCase())} placeholder="PB12345678" /></label>
            <label className="checkout-field">Customer delivery code<input className="code-input" value={deliveryCode} onChange={(e) => setDeliveryCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" inputMode="numeric" /></label>
            <button className="save-button" onClick={verifyDelivery}>Verify and mark delivered</button>
            {deliveryMessage && <p className="panel-message">{deliveryMessage}</p>}
          </section>
        </div>
      )}</GlassPresence>

      <GlassPresence>{myOrdersOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setMyOrdersOpen(false)}>
          <section className="orders-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setMyOrdersOpen(false)} aria-label="Close">×</button>
            <div className="admin-badge">CUSTOMER</div><h2>My orders</h2>
            {customerOrderError && <p role="status" className="active-order-error">{customerOrderError} <button onClick={() => void refreshCustomerOrders()}>Retry updates</button></p>}
            {myOrders.filter((order) => order.items?.every((item: any) => item.serviceId === PLAGIARISM_SERVICE_ID)).map((order) => <section className="customer-plagiarism-status" key={`plagiarism-${order.id}`}><strong>{order.order_number} · Plagiarism report</strong><small>Your report will be sent to your provided WhatsApp number within 24 hours.</small><PlagiarismTracker status={order.status} /></section>)}
            {myReferralCode && <div className="referral-wallet"><span><small>Your referral code</small><strong>{myReferralCode}</strong></span><span><small>Points balance</small><strong>{pointsBalance}</strong></span><p>Your own delivered orders earn 1 point per ₹10 spent. You also earn 1 point per ₹15 spent on delivered orders by each person you referred. Redeem 15 points for ₹1 at checkout.</p></div>}
            {myOrders.some((order) => (order.late_night_fee_paise ?? 0) > 0) && <div className="fee-breakdown">{myOrders.filter((order) => (order.late_night_fee_paise ?? 0) > 0).map((order) => <div key={`late-night-${order.id}`}><span>{order.order_number} · Late-night delivery fee</span><strong>{inr.format((order.late_night_fee_paise ?? 0) / 100)}</strong></div>)}</div>}
            {myOrders.some((order) => order.payment_status === "PENDING" && order.status !== "CANCELLED") && <div className="customer-error"><strong>Payment required</strong><p>Complete payment before PrintBee starts printing.</p>{myOrders.filter((order) => order.payment_status === "PENDING" && order.status !== "CANCELLED").map((order) => <button className="save-button" key={order.id} disabled={paymentProcessing} onClick={() => startRazorpayPayment(order)}>Pay {inr.format(order.total_paise / 100)} for {order.order_number}</button>)}</div>}
            {myOrders.length ? myOrders.map((order) => <article key={order.id}><div><strong>{order.order_number}</strong><small>{order.location_name} · {new Date(order.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small>{order.cancellation_reason && <small>Cancelled: {order.cancellation_reason}</small>}</div><span className="status-chip">{order.payment_status === "PAY_ON_DELIVERY" ? "PAY ON DELIVERY" : order.payment_status} · {order.status}</span><strong>{inr.format(order.total_paise / 100)}</strong><OrderDocuments order={order} /><OrderJourney order={order} />{order.payment_rejection_reason && <div className="customer-error">{order.payment_rejection_reason}</div>}{Boolean(order.has_payment_qr) && order.status !== "DELIVERED" && <div className="customer-payment-qr"><div><strong>Pay {inr.format(order.total_paise / 100)}</strong><small>Use this scanner now or pay when your delivery partner arrives. Tap the scanner to enlarge.</small></div><button className="scanner-expand-button" onClick={() => setExpandedScanner({ src: `/api/orders/${order.id}/payment-qr`, alt: `Payment scanner for ${order.order_number}` })}><img src={`/api/orders/${order.id}/payment-qr`} alt={`Payment scanner for ${order.order_number}`} /></button></div>}{order.rider_name && <div className="assigned-rider"><span><small>Delivery partner assigned</small><strong>{order.rider_name}</strong>{order.rider_mobile_number && <b>{order.rider_mobile_number}</b>}</span>{order.rider_mobile_number && <a href={`tel:${order.rider_mobile_number}`}>Call delivery partner</a>}</div>}<OTPCard order={order} /></article>) : <p>No orders yet.</p>}
            {myOrders.filter((order) => order.status === "DELIVERED" && !order.feedback_submitted).map((order) => <button key={`feedback-${order.id}`} className="feedback-invite" onClick={() => { setFeedbackOrder(order); setFeedback({ serviceRating: 0, riderRating: 0, printQualityRating: 0, overallRating: 0, description: "" }); }}>Rate your delivered order {order.order_number} (optional)</button>)}
          </section>
        </div>
      )}</GlassPresence>

      {expandedScanner && (
        <div className="scanner-fullscreen" role="dialog" aria-modal="true" aria-label="Full-screen payment scanner" onClick={() => setExpandedScanner(null)}>
          <button onClick={() => setExpandedScanner(null)} aria-label="Close full-screen scanner">×</button>
          <img src={expandedScanner.src} alt={expandedScanner.alt} onClick={(event) => event.stopPropagation()} />
          <strong>Tap outside the scanner to close</strong>
        </div>
      )}

      <GlassPresence>{feedbackOrder && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setFeedbackOrder(null)}>
          <section className="checkout-modal feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="close" onClick={() => setFeedbackOrder(null)} aria-label="Close feedback form">×</button>
            <div className="admin-badge">OPTIONAL FEEDBACK</div><h2 id="feedback-title">How was order {feedbackOrder.order_number}?</h2><p>Your ratings help us improve future deliveries.</p>
            {([['serviceRating', 'PrintBee service'], ['riderRating', 'Rider rating'], ['printQualityRating', 'Print quality'], ['overallRating', 'Overall experience']] as const).map(([field, label]) => <fieldset className="star-field" key={field}><legend>{label}</legend><div>{[1,2,3,4,5].map((star) => <button key={star} type="button" className={feedback[field] >= star ? "selected" : ""} onClick={() => setFeedback({ ...feedback, [field]: star })} aria-label={`${label}: ${star} star${star === 1 ? '' : 's'}`}>★</button>)}</div></fieldset>)}
            <label className="checkout-field">Small description <small>Optional</small><textarea rows={4} maxLength={1000} value={feedback.description} onChange={(event) => setFeedback({ ...feedback, description: event.target.value })} placeholder="Tell us what went well or what we can improve" /></label>
            {feedbackMessage && <p className="panel-message">{feedbackMessage}</p>}
            <button className="save-button" disabled={[feedback.serviceRating, feedback.riderRating, feedback.printQualityRating, feedback.overallRating].some((rating) => rating === 0)} onClick={submitFeedback}>Submit feedback</button>
            <button className="skip-feedback" onClick={() => setFeedbackOrder(null)}>Maybe later</button>
          </section>
        </div>
      )}</GlassPresence>

      <GlassPresence>{franchiseApplyOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setFranchiseApplyOpen(false)}><section className="login-modal franchise-application-modal" role="dialog" aria-modal="true" aria-labelledby="franchise-apply-title" onMouseDown={(e) => e.stopPropagation()}><button className="close" onClick={() => setFranchiseApplyOpen(false)} aria-label="Close">×</button><img src="/printbee-logo.png" width={72} height={72} alt="PrintBee" /><div className="admin-badge">PRINTBEE FRANCHISE</div><h2 id="franchise-apply-title">Apply for a franchise</h2><p>Start your PrintBee franchise journey for <strong>₹60,000</strong>. We will contact you after reviewing the application.</p><div className="franchise-application-form"><input value={franchiseApplication.fullName} onChange={(e) => setFranchiseApplication({ ...franchiseApplication, fullName: e.target.value })} placeholder="Full name" /><input value={franchiseApplication.location} onChange={(e) => setFranchiseApplication({ ...franchiseApplication, location: e.target.value })} placeholder="Preferred store location / city" /><input value={franchiseApplication.mobileNumber} onChange={(e) => setFranchiseApplication({ ...franchiseApplication, mobileNumber: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="Mobile number" inputMode="numeric" /><input value={viewer?.email ?? ""} disabled aria-label="Email address" /><input value={franchiseApplication.whatsappNumber} onChange={(e) => setFranchiseApplication({ ...franchiseApplication, whatsappNumber: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="WhatsApp number" inputMode="numeric" /><textarea value={franchiseApplication.address} onChange={(e) => setFranchiseApplication({ ...franchiseApplication, address: e.target.value })} placeholder="Full address" /></div>{franchiseApplyMessage && <p className="panel-message">{franchiseApplyMessage}</p>}<button className="save-button" onClick={submitFranchiseApplication}>Submit application</button></section></div>}</GlassPresence>
      <GlassPresence>{loginOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setLoginOpen(false)}>
          <section className="login-modal" role="dialog" aria-modal="true" aria-labelledby="login-title" onMouseDown={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setLoginOpen(false)} aria-label="Close">×</button>
            <img src="/printbee-logo.png" width={88} height={88} alt="PrintBee" />
            <h2 id="login-title">Welcome to PrintBee</h2>
            <p>Sign in securely with your Google account to continue.</p>
            <div className="login-mode-picker"><button type="button" className={loginMode === "CUSTOMER" ? "selected" : ""} onClick={() => { setLoginMode("CUSTOMER"); window.localStorage.setItem("printbee-login-mode", "CUSTOMER"); }}>Customer</button><button type="button" className={loginMode === "PARTNER" ? "selected" : ""} onClick={() => { setLoginMode("PARTNER"); window.localStorage.setItem("printbee-login-mode", "PARTNER"); }}>Delivery partner</button></div>
            <label className="checkout-field referral-input">Referral code <small>Optional · only for a new account</small><input value={referralCode} onChange={(event) => setReferralCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="PBXXXXXXXX" /></label>
            <div className="reviewer-login-divider"><span>Secure account access</span></div>
            <div className="google-sign-in-button" ref={googleButtonRef} aria-label="Continue with Google" />
            {loginMode === "PARTNER" && <small>After sign-in, submit your delivery-partner application for approval.</small>}
            {approvalStatus === "PENDING" && <p className="auth-message">Your delivery partner application is awaiting admin verification.</p>}
            {authMessage && <p className="auth-message">{authMessage}</p>}
            <small>By continuing, you agree to PrintBee's <a href="/terms">terms</a> and <a href="/privacy-policy">privacy policy</a>.</small>
          </section>
        </div>
      )}</GlassPresence>

      <GlassPresence>{editingCartItem && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditingCartItem(null)}>
          <section className="checkout-modal cart-edit-modal" role="dialog" aria-modal="true" aria-labelledby="cart-edit-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="close" onClick={() => setEditingCartItem(null)} aria-label="Close">×</button>
            <div className="admin-badge">EDIT DOCUMENT</div>
            <h2 id="cart-edit-title">Edit print options</h2>
            <p><strong>{editingCartItem.fileName}</strong> · {editingCartItem.pages} {editingCartItem.pages === 1 ? "page" : "pages"}</p>
            <label className="service-picker">Print service<select value={cartEditServiceId} onChange={(event) => setCartEditServiceId(event.target.value)}>{printServices.filter((service) => service.id !== PLAGIARISM_SERVICE_ID).map((service) => <option key={service.id} value={service.id}>{service.name}{service.price_paise ? ` (+${inr.format(service.price_paise / 100)})` : ""}</option>)}</select></label>
            <div className="field-label">Printing style</div>
            <div className="option-grid" role="radiogroup" aria-label="Printing style">{options.map((option) => <button type="button" role="radio" aria-checked={cartEditMode === option.id} className={`print-option ${cartEditMode === option.id ? "selected" : ""}`} key={option.id} onClick={() => setCartEditMode(option.id)}><span className={`mode-icon ${option.id.startsWith("colour") ? "colour" : ""}`}>{option.icon}</span><span><strong>{option.title}</strong><small>{option.note}</small></span></button>)}</div>
            <div className="cart-edit-details"><div className="copy-quantity"><small>Copies</small><div className="quantity-stepper"><button type="button" aria-label="Decrease copies" disabled={cartEditCopies <= 1} onClick={() => setCartEditCopies((value) => Math.max(1, value - 1))}>−</button><output>{cartEditCopies}</output><button type="button" aria-label="Increase copies" onClick={() => setCartEditCopies((value) => value + 1)}>+</button></div></div><div className="paper"><small>Paper size</small><strong>A4</strong><span>210 × 297 mm</span></div></div>
            <button className="save-button" onClick={saveCartEdit}>Save changes</button>
          </section>
        </div>
      )}</GlassPresence>

      <GlassPresence>{riderApplicationOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setRiderApplicationOpen(false)}>
          <section className="login-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setRiderApplicationOpen(false)} aria-label="Close">×</button>
            <div className="admin-badge">DELIVERY PARTNER</div>
            <h2>Register as a rider</h2>
            <p>Submit the details once verified by admin you can continue as delivery partner.</p>
            {!viewer && <p className="auth-message">Sign in with a PrintBee account before applying.</p>}
            <label className="checkout-field">Full name<input value={riderApplication.name} onChange={(e) => setRiderApplication({ ...riderApplication, name: e.target.value })} /></label>
            <label className="checkout-field">Mobile number<input inputMode="numeric" value={riderApplication.mobileNumber} onChange={(e) => setRiderApplication({ ...riderApplication, mobileNumber: e.target.value.replace(/\D/g, "").slice(0, 10) })} /></label>
            <button className="save-button" disabled={!viewer || !riderApplication.name.trim() || riderApplication.mobileNumber.length !== 10} onClick={submitRiderApplication}>Submit for admin verification</button>
            {authMessage && <p className="auth-message">{authMessage}</p>}
          </section>
        </div>
      )}</GlassPresence>
    </main>
  );
}
