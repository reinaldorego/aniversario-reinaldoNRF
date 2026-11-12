/* Prévia de paralaxe: limitada e desativada quando o usuário reduz movimento. */
(() => {
  const hero = document.querySelector('.hero-visual');
  if (!hero || !window.matchMedia || !window.requestAnimationFrame) return;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  document.documentElement.classList.add('motion-preview');
  let pending = false;
  function update() {
    pending = false;
    if (preference.matches || document.hidden) {
      hero.style.removeProperty('--hero-motion');
      return;
    }
    const rect = hero.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    const distance = Math.max(0, Math.min(-rect.top, rect.height));
    hero.style.setProperty('--hero-motion', `${Math.min(distance * 0.12, 30).toFixed(2)}px`);
  }
  function schedule() {
    if (!pending) { pending = true; window.requestAnimationFrame(update); }
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  if (preference.addEventListener) preference.addEventListener('change', schedule);
  schedule();

  // Partículas são decorativas, limitadas e pausadas fora da tela.
  const canvas = document.createElement('canvas');
  canvas.className = 'cinema-particles';
  canvas.setAttribute('aria-hidden', 'true');
  hero.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }
  let width = 0, height = 0, visible = true, running = false, last = 0;
  const dots = Array.from({ length: 22 }, (_, i) => ({
    x: (i * 0.61803398875) % 1,
    y: (i * 0.41421356237) % 1,
    radius: 1 + (i % 3) * .65,
    speed: .000007 + (i % 4) * .000002,
    phase: i * 1.37
  }));
  function resizeCanvas() {
    const rect = hero.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  function frame(t) {
    if (document.hidden || preference.matches || !visible) { running = false; ctx.clearRect(0, 0, width, height); return; }
    if (t - last > 33) {
      last = t;
      ctx.clearRect(0, 0, width, height);
      for (const d of dots) {
        const x = d.x * width + Math.sin(t * .0005 + d.phase) * 8;
        const y = ((d.y - t * d.speed) % 1 + 1) % 1 * height;
        const alpha = .18 + .35 * (.5 + .5 * Math.sin(t * .0015 + d.phase));
        ctx.beginPath(); ctx.fillStyle = `rgba(255,213,113,${alpha})`;
        ctx.shadowColor = 'rgba(239,185,68,.65)'; ctx.shadowBlur = 8;
        ctx.arc(x, y, d.radius, 0, Math.PI * 2); ctx.fill();
      }
    }
    window.requestAnimationFrame(frame);
  }
  function start() {
    if (!running && visible && !document.hidden && !preference.matches) {
      running = true; window.requestAnimationFrame(frame);
    }
  }
  resizeCanvas();
  window.addEventListener('resize', () => { resizeCanvas(); start(); }, { passive: true });
  document.addEventListener('visibilitychange', start);
  if (preference.addEventListener) preference.addEventListener('change', start);
  const enterButton = document.querySelector('#enterBtn');
  if (enterButton) enterButton.addEventListener('click', () => window.requestAnimationFrame(() => { resizeCanvas(); start(); }));
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      if (visible) resizeCanvas();
      start();
    }).observe(hero);
  }
  start();
})();
