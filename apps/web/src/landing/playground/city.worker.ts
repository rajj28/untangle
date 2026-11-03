import { untangleCity } from "./city.ts";
import type { CityRequest } from "./city.ts";

// Runs off the main thread so the page keeps animating while a city of invoices clears.
self.addEventListener("message", (event: MessageEvent<CityRequest>) => {
  self.postMessage(untangleCity(event.data));
});
