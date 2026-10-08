export const ROUTES = ["public", "you", "how"] as const;
export type Route = (typeof ROUTES)[number];

const isRoute = (v: string): v is Route => (ROUTES as readonly string[]).includes(v);

export const currentRoute = (): Route => {
  const hash = location.hash.replace(/^#\/?/, "");
  return isRoute(hash) ? hash : "public";
};

/**
 * Hash routing: no history shim, no dependency, and a pasted link to #/how
 * lands where it says it will.
 */
export function startRouter(onChange: (route: Route) => void) {
  const apply = () => {
    const route = currentRoute();

    for (const page of document.querySelectorAll<HTMLElement>(".page")) {
      const active = page.dataset.route === route;
      page.hidden = !active;
      if (active) {
        // Restart the entrance animation on every entry, not just the first.
        page.classList.remove("is-entering");
        void page.offsetWidth;
        page.classList.add("is-entering");
      }
    }

    for (const link of document.querySelectorAll<HTMLElement>(".tab")) {
      link.classList.toggle("is-active", link.dataset.route === route);
      link.setAttribute("aria-current", link.dataset.route === route ? "page" : "false");
    }

    onChange(route);
  };

  addEventListener("hashchange", apply);
  apply();
}

export const go = (route: Route) => {
  location.hash = `#/${route}`;
};
