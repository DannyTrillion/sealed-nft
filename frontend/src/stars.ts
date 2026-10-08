type Star = {
  x: number; y: number; r: number;
  base: number;        // resting alpha
  amp: number;         // twinkle amplitude (0 for steady stars)
  phase: number;
  speed: number;
  warm: boolean;       // a minority carry the brand yellow
};

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A quiet star field behind the whole app. Density scales with viewport area so
 * a laptop and a phone look equally sparse, and only a third of the stars
 * twinkle — a sky where everything pulses reads as noise, not depth.
 */
export function startStars(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let stars: Star[] = [];
  let w = 0, h = 0, dpr = 1;
  let raf = 0;

  function seed() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.round(Math.min(260, Math.max(70, (w * h) / 7800)));
    stars = Array.from({ length: count }, () => {
      const twinkles = Math.random() < 0.34;
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() < 0.88 ? 0.5 + Math.random() * 0.6 : 1.1 + Math.random() * 0.7,
        base: 0.1 + Math.random() * 0.4,
        amp: twinkles ? 0.12 + Math.random() * 0.22 : 0,
        phase: Math.random() * Math.PI * 2,
        speed: 0.0005 + Math.random() * 0.0011,
        warm: Math.random() < 0.12,
      };
    });
  }

  function draw(t: number) {
    ctx!.clearRect(0, 0, w, h);
    for (const s of stars) {
      const a = s.amp ? s.base + Math.sin(t * s.speed + s.phase) * s.amp : s.base;
      if (a <= 0.02) continue;
      ctx!.beginPath();
      ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx!.fillStyle = s.warm
        ? `rgba(255, 210, 7, ${Math.min(1, a * 0.85)})`
        : `rgba(226, 232, 244, ${Math.min(1, a)})`;
      ctx!.fill();

      // The brightest few get a soft bloom so the field has some depth.
      if (s.r > 1.1) {
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r * 3.4, 0, Math.PI * 2);
        ctx!.fillStyle = s.warm
          ? `rgba(255, 210, 7, ${a * 0.07})`
          : `rgba(200, 214, 240, ${a * 0.06})`;
        ctx!.fill();
      }
    }
  }

  function loop(t: number) {
    draw(t);
    raf = requestAnimationFrame(loop);
  }

  function start() {
    cancelAnimationFrame(raf);
    seed();
    if (reduced()) draw(0);
    else raf = requestAnimationFrame(loop);
  }

  let resizeTimer = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(start, 180);
  });

  // No point animating a sky nobody is looking at.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else if (!reduced()) raf = requestAnimationFrame(loop);
  });

  start();
}
