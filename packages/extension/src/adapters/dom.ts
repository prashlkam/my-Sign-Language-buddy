/**
 * DOM helpers shared by the platform adapters.
 *
 * Everything in this file exists because we are guests in someone else's page.
 * Meet and Zoom ship obfuscated, frequently-changing markup; any selector we
 * write is a guess with an expiry date. The strategy is therefore:
 *
 *   - describe each target as an ordered list of candidate strategies,
 *   - record which one worked (or that none did),
 *   - surface "none did" as a health problem so the UI can degrade loudly
 *     rather than silently doing nothing (PLAN.md §4.5).
 */

export interface Strategy<T> {
  name: string;
  find: () => T | null;
}

export interface ResolveResult<T> {
  value: T | null;
  /** Which strategy produced it, for diagnostics and for the health check. */
  via: string | null;
}

export function resolve<T>(strategies: Strategy<T>[]): ResolveResult<T> {
  for (const s of strategies) {
    try {
      const value = s.find();
      if (value) return { value, via: s.name };
    } catch {
      // A selector that throws is just a selector that failed.
    }
  }
  return { value: null, via: null };
}

/** Wait for an element, giving up rather than hanging forever. */
export function waitFor<T>(
  strategies: Strategy<T>[],
  timeoutMs = 15_000,
): Promise<ResolveResult<T>> {
  return new Promise((res) => {
    const immediate = resolve(strategies);
    if (immediate.value) return res(immediate);

    const started = Date.now();
    const obs = new MutationObserver(() => {
      const r = resolve(strategies);
      if (r.value) {
        obs.disconnect();
        clearInterval(timer);
        res(r);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    const timer = setInterval(() => {
      if (Date.now() - started > timeoutMs) {
        obs.disconnect();
        clearInterval(timer);
        res({ value: null, via: null });
      }
    }, 500);
  });
}

/**
 * Set the value of a React-controlled input.
 *
 * React installs its own value setter on the element and ignores plain
 * assignment, so we have to go through the prototype's native setter and then
 * fire the events React is listening for. This is fragile by nature; it is used
 * only on the chat fallback path, never on anything load-bearing.
 */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function pressEnter(el: HTMLElement): void {
  for (const type of ['keydown', 'keypress', 'keyup'] as const) {
    el.dispatchEvent(
      new KeyboardEvent(type, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
}

/** Case-insensitive attribute-contains selector, built safely. */
export function attrContains(attr: string, needle: string): string {
  return `[${attr}*="${CSS.escape(needle)}" i]`;
}

export function visible(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
