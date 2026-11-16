/* Scroll motion for the landing page. No libraries; one passive, rAF-throttled scroll listener for everything.
 *
 *   [data-reveal]        fades and rises once as it enters the viewport (stagger with style="--d: 120ms")
 *   .manifesto .w        words light up as the paragraph scrolls past (opacity only, so it stays under reduced motion)
 *   .reactor (hero)      drifts down and shrinks slightly as you scroll away from the hero
 *   .progress            the page's scroll progress, drawn as a line in the nav
 *   glideTo('#id')       an eased scroll to a section, with a scan line sweeping the screen and the section "arriving"
 */
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeInOutQuart = t => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2);
const NAV_OFFSET = 88;

export function startScrollMotion() {
  const reveal = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('is-in'); reveal.unobserve(e.target); }
  }), { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('[data-reveal]').forEach(el => reveal.observe(el));

  const words = [...document.querySelectorAll('.manifesto .w')];
  const manifesto = document.querySelector('.manifesto');
  const core = document.querySelector('.hero .reactor');
  const hero = document.querySelector('.hero');
  const bar = document.querySelector('.progress');
  let ticking = false, lastP = -1;

  const update = () => {
    ticking = false;
    const vh = innerHeight, y = scrollY;
    if (bar) bar.style.transform = `scaleX(${clamp(y / Math.max(1, document.documentElement.scrollHeight - vh))})`;
    if (core && hero && y < hero.offsetHeight && !reduced()) {   // parallax is movement: skipped under reduced motion
      const p = clamp(y / hero.offsetHeight);
      core.style.transform = `translate3d(0, ${p * 90}px, 0) scale(${1 - p * 0.12})`;
      core.style.opacity = String(1 - p * 0.7);
    }
    if (manifesto && words.length) {
      // 0 when the paragraph's top reaches 85% of the viewport, 1 when its bottom reaches 35%.
      const r = manifesto.getBoundingClientRect();
      const p = clamp((0.85 * vh - r.top) / (0.5 * vh + r.height));
      if (Math.abs(p - lastP) > 0.001) {
        lastP = p;
        const n = words.length;
        words.forEach((w, i) => { w.style.opacity = (0.14 + 0.86 * clamp((p - i / n + 0.08) / 0.12)).toFixed(3); });
      }
    }
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  update();
}

let gliding = 0;
export function glideTo(hash) {
  const target = document.querySelector(hash);
  if (!target) return;
  history.pushState(null, '', hash);
  const from = scrollY;
  const to = clamp(target.getBoundingClientRect().top + from - NAV_OFFSET, 0, document.documentElement.scrollHeight - innerHeight);
  if (reduced()) { scrollTo({ top: to, behavior: 'instant' }); arrive(target); return; }

  const id = ++gliding, dist = to - from;
  const duration = clamp(Math.abs(dist) * 0.5, 650, 1300);
  const warp = document.querySelector('.warp');
  if (warp) {
    warp.dataset.dir = dist >= 0 ? 'down' : 'up';
    warp.style.setProperty('--dur', `${duration}ms`);
    warp.classList.remove('run'); void warp.offsetWidth; warp.classList.add('run');   // restart the sweep
  }
  // The reader can take over at any moment: a wheel, touch or key press cancels the glide.
  const cancel = () => { gliding++; };
  const opts = { once: true, passive: true };
  addEventListener('wheel', cancel, opts); addEventListener('touchstart', cancel, opts); addEventListener('keydown', cancel, opts);

  const t0 = performance.now();
  const step = now => {
    if (id !== gliding) { warp?.classList.remove('run'); return; }
    const t = clamp((now - t0) / duration);
    scrollTo({ top: from + dist * easeInOutQuart(t), behavior: 'instant' });
    if (t < 1) requestAnimationFrame(step);
    else { removeEventListener('wheel', cancel); removeEventListener('touchstart', cancel); removeEventListener('keydown', cancel); arrive(target); }
  };
  requestAnimationFrame(step);
}

function arrive(section) {
  section.querySelectorAll('[data-reveal]').forEach(el => el.classList.add('is-in'));
  section.classList.remove('arrived'); void section.offsetWidth; section.classList.add('arrived');
  setTimeout(() => section.classList.remove('arrived'), 1600);
}

// Click handler for in-page links: <a href="#demo" onClick={glide}>
export const glide = e => {
  const href = e.currentTarget.getAttribute('href');
  if (!href || !href.startsWith('#') || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  glideTo(href);
};
