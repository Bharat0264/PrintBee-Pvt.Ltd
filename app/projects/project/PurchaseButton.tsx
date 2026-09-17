"use client";
import { useRef, useState } from "react";
import { ActionFeedback, GlassButton } from "../../components/LiquidGlass";
type PaymentResult = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayOptions = { key: string; amount: number; currency: string; name: string; description: string; order_id: string; config?: Record<string, unknown>; handler: (result: PaymentResult) => Promise<void>; modal: { ondismiss: () => void } };
declare global { interface Window { Razorpay?: new (options: RazorpayOptions) => { open: () => void } } }
export default function PurchaseButton({ projectId }: { projectId: string }) {
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const release = () => { lock.current = false; setBusy(false); };
  const buy = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/projects/purchase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) }), data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start payment");
      if (!window.Razorpay) {
        const script = document.createElement("script"); script.src = "https://checkout.razorpay.com/v1/checkout.js";
        await new Promise<void>((resolve, reject) => { script.onload = () => resolve(); script.onerror = () => reject(new Error("Checkout could not load. Please try again.")); document.head.appendChild(script); });
      }
      if (!window.Razorpay) throw new Error("Checkout is unavailable.");
      new window.Razorpay({ key: data.keyId, amount: data.amount, currency: "INR", name: "PrintBee Projects", description: `${data.title} · ${data.projectCode}`, order_id: data.razorpayOrderId, config: { display: { blocks: { upi: { name: "Pay via UPI", instruments: [{ method: "upi" }] } }, sequence: ["block.upi"], preferences: { show_default_blocks: true } } }, modal: { ondismiss: release }, handler: async result => {
        try {
          const verification = await fetch("/api/projects/purchase/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: data.orderId, ...result }) }), outcome = await verification.json();
          if (!verification.ok) throw new Error(outcome.error ?? "Verification failed");
          const text = encodeURIComponent(`Hello PrintBee, I bought project ${data.projectCode} (${data.title}). Payment ID: ${result.razorpay_payment_id}. Please share my documents.`);
          window.location.href = `https://wa.me/919347541419?text=${text}`;
        } catch (error) { setMessage(error instanceof Error ? error.message : "Please check your payment status before trying again."); }
        finally { release(); }
      } }).open();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not start payment"); release(); }
  };
  return <><p className="project-fee-note">Buyer pays 5% platform fee plus 2.36% payment handling on that amount. The seller receives 95% of the listed value.</p><GlassButton className="project-buy" busy={busy} onClick={buy}>{busy ? "Payment in progress…" : "Buy securely →"}</GlassButton>{message && <ActionFeedback tone="error">{message}</ActionFeedback>}</>;
}
