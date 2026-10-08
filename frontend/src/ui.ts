const HEX = "0123456789abcdef";
const LETTERS = "abcdef";
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const rand = () => HEX[(Math.random() * 16) | 0];
const letter = () => LETTERS[(Math.random() * 6) | 0];

/**
 * Churn that can never read as a plausible value. Pure hex occasionally lands on
 * all digits ("5138"), which looks like the decrypted number and undercuts the
 * whole point of the sealed state — so every other position is forced to a letter.
 */
const churn = (width: number) => {
  let out = "";
  for (let i = 0; i < width; i++) out += i % 2 === 0 ? letter() : rand();
  return out;
};

/**
 * Renders a sealed value as churning hex and settles it into the plaintext on
 * reveal. Cosmetic — the real handle is 32 bytes — but it keeps "you are looking
 * at something you cannot read" legible at a glance.
 */
export class Cipher {
  private raf = 0;

  constructor(private readonly el: HTMLElement) {}

  scramble(width = 4) {
    this.stop();
    this.el.dataset.revealed = "false";
    delete this.el.dataset.idle;
    if (reduced()) {
      this.el.textContent = "0x" + "··".repeat(width / 2);
      return;
    }
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 60) {
        this.el.textContent = churn(width);
        last = now;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  settle(target: string, ms = 800): Promise<void> {
    this.stop();
    return new Promise((resolve) => {
      const done = () => {
        this.el.textContent = target;
        this.el.dataset.revealed = "true";
        delete this.el.dataset.idle;
        resolve();
      };
      if (reduced()) return done();

      const width = Math.max(target.length, 4);
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / ms);
        const w = Math.round(width - (width - target.length) * p);
        const locked = Math.floor(p * p * target.length);
        let out = target.slice(0, locked);
        for (let i = locked; i < w; i++) out += rand();
        this.el.textContent = out;
        if (p < 1) this.raf = requestAnimationFrame(tick);
        else done();
      };
      this.raf = requestAnimationFrame(tick);
    });
  }

  /** Show a known plaintext with no animation (e.g. re-entering the holder view). */
  set(text: string) {
    this.stop();
    this.el.textContent = text;
    this.el.dataset.revealed = "true";
    delete this.el.dataset.idle;
  }

  idle(text = "••••") {
    this.stop();
    this.el.textContent = text;
    this.el.dataset.revealed = "false";
    this.el.dataset.idle = "true";
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

export type ToastKind = "info" | "error" | "success";

export function toast(message: string, kind: ToastKind = "info", ms = 4600) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.dataset.kind = kind;
  const bar = document.createElement("span");
  bar.className = "bar";
  const msg = document.createElement("span");
  msg.textContent = message;
  el.append(bar, msg);
  host.append(el);

  const close = () => {
    el.dataset.leaving = "true";
    setTimeout(() => el.remove(), 280);
  };
  const timer = setTimeout(close, ms);
  el.addEventListener("click", () => {
    clearTimeout(timer);
    close();
  });
}

export const short = (a: string, head = 6, tail = 4) => `${a.slice(0, head)}…${a.slice(-tail)}`;

/** Fires once per element when it scrolls into view. */
export function revealOnScroll(selector = ".reveal-on-scroll") {
  const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
  if (!("IntersectionObserver" in window)) {
    els.forEach((e) => e.classList.add("is-in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
  );
  els.forEach((e) => io.observe(e));
}

/**
 * Churns the hex inside the enc() boxes on the explainer, so the point —
 * the contract is operating on noise — is visible rather than asserted.
 */
export function animateEncBoxes(root: ParentNode = document) {
  const boxes = Array.from(root.querySelectorAll<HTMLElement>("[data-enc]"));
  if (!boxes.length) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    boxes.forEach((b) => (b.textContent = "0x" + "a3f1"));
    return;
  }
  let last = 0;
  const tick = (now: number) => {
    if (now - last > 90) {
      for (const b of boxes) b.textContent = churn(4);
      last = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
