/**
 * The only script the manifest injects.
 *
 * MV3 content scripts cannot be ES modules, but the real overlay pulls in React
 * and — once the camera is switched on — MediaPipe and ONNX Runtime. Bundling
 * all of that into a classic script would mean every Meet page load parses tens
 * of megabytes it will probably never use.
 *
 * So this stub does one thing: dynamic-import the real ESM entry point from
 * web_accessible_resources. Code splitting then keeps the heavy chunks out of
 * the initial load, and they arrive only when the user turns signing on.
 */
const url = chrome.runtime.getURL('content/main.js');

import(/* @vite-ignore */ url).catch((err: unknown) => {
  console.error('[sign-language-buddy] failed to load the overlay:', err);
});

export {};
