import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../app/PrintBeeApp.tsx", import.meta.url), "utf8");

test("checkout asks for the current location and a confirmed delivery address", () => {
  assert.match(appSource, /Share your current location, then confirm the delivery address below/);
  assert.match(appSource, /Use My Current Location/);
  assert.match(appSource, /Building \/ house number and delivery address/);
});
