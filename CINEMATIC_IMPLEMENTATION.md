# Cinematic PrintBee implementation

Baseline: c0783bc8c5b0e819344e9ba93e5c39a5fe9d0521 (live version 217).

The customer interface lives in PrintBeeApp; uploads, PDF counting, pricing,
authentication, rewards, cart persistence and Razorpay callbacks stay there.
Order states remain sourced from ActiveOrderWidget/useCustomerOrders. Projects
keep their existing URLs and API contracts. New visuals are isolated in
components/cinematic and cinematic.css; the existing upload form is retained.

CSS perspective geometry supplies the printer, floating documents and package.
Scroll progress changes scene composition without trapping scroll. Pointer
enhancement is decorative and disabled for touch/reduced motion. Animations
pause outside the visible scene. The normal DOM remains the fallback and all
buttons are immediately usable. No shader/graphics dependency is required.

The Sites source and Vercel source have distinct runtime adapters. Shared UI
files are synchronized while Vercel database/storage/auth adapters and its
existing local changes are preserved. Rollback uses the baseline source commit
or the previous saved Sites deployment; no database migration is needed.
