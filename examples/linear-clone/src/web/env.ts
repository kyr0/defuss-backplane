/** VERIFIED: scripts/e2e.ts drives it in Chromium, Firefox and WebKit. The defuss-shadcn issue tracker bundle's
 * global `df$`, which `vendor/issue-tracker.min.js` defines before this bundle runs: its components, toasts and
 * persisted store. The app names it `ui` and imports its own defuss-query `df$` for DOM work, so the two never mix.
 * The bundle has no types, so this module names the parts the app uses. */
type Persisted<T> = { value: T; set(value: T): void };
type Df = ((selector: string | Element) => { get(index: number): HTMLElement; each(fn: (i: number, el: Element) => void): void }) & {
  shadcn: {
    toast: { show(options: { title: string; description?: string }): void };
    languageSwitcher: { bind(element: Element, locale: unknown): void };
    dataGrid?: {
      setSource(grid: Element, records: object[], options: { cells: Record<string, (el: HTMLElement, record: never) => void> }): void;
      rows(grid: Element): { id: string }[];
    };
  };
  store: { persisted<T>(key: string, fallback: T): Persisted<T> };
};

export const ui = (globalThis as unknown as { df$: Df }).df$;

export function toast(title: string, description?: string) {
  ui.shadcn.toast.show(description ? { title, description } : { title });
}
