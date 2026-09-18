const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

let checkoutScriptPromise: Promise<void> | undefined;

/**
 * Load Standard Checkout before a customer begins payment.  iOS Safari is
 * stricter than Chromium browsers about loading/opening payment flows after a
 * click, so callers should warm this up when the checkout UI is shown.
 */
export function loadRazorpayCheckout() {
  if (typeof window === "undefined") return Promise.reject(new Error("Checkout is only available in a browser."));
  if ((window as Window & { Razorpay?: unknown }).Razorpay) return Promise.resolve();
  if (checkoutScriptPromise) return checkoutScriptPromise;

  checkoutScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${RAZORPAY_CHECKOUT_SRC}"]`);
    const finishLoading = () => resolve();
    const failLoading = () => {
      checkoutScriptPromise = undefined;
      reject(new Error("Checkout failed to load. Please check your connection and try again."));
    };

    if (existing) {
      existing.addEventListener("load", finishLoading, { once: true });
      existing.addEventListener("error", failLoading, { once: true });
      // A script already loaded by another checkout has no load event left to
      // emit, so resolve once the browser has completed the current task.
      window.setTimeout(() => {
        if ((window as Window & { Razorpay?: unknown }).Razorpay) resolve();
      }, 0);
      return;
    }

    const script = document.createElement("script");
    script.src = RAZORPAY_CHECKOUT_SRC;
    script.async = true;
    script.dataset.printbeeRazorpay = "true";
    script.addEventListener("load", finishLoading, { once: true });
    script.addEventListener("error", failLoading, { once: true });
    document.head.appendChild(script);
  });

  return checkoutScriptPromise;
}
