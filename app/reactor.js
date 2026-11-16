/* Reactor: the animated core. One canvas, one animation loop, no libraries.
 *
 *   Reactor.mount(canvas, read)
 *   read() is called every frame and returns { state, analyser?, muted? }
 *     state    - offline | standby | listening | thinking | speaking | muted
 *     analyser - optional Web Audio AnalyserNode; when present the bars follow the microphone
 */
const Reactor = (() => {
  const TAU = Math.PI * 2;
  const COLORS = { offline: [255, 107, 107], muted: [255, 107, 107], standby: [79, 216, 255],
    listening: [125, 243, 255], thinking: [255, 184, 77], speaking: [185, 244, 255] };
  // r = radius (fraction), w = line width, n = segments, fill = how much of each segment is drawn, s = spin speed, a = alpha
  const RINGS = [
    { r: .98, w: 1.2, n: 1, fill: 1, s: 0, a: .22 },
    { r: .92, w: 5, n: 3, fill: .72, s: .25, a: .55 },
    { r: .84, w: 2, n: 72, fill: .3, s: -.1, a: .5 },
    { r: .49, w: 3, n: 4, fill: .55, s: -.6, a: .7 },
    { r: .41, w: 1.5, n: 2, fill: .8, s: .9, a: .45 },
    { r: .29, w: 7, n: 10, fill: .62, s: .35, a: .32 },
  ];
  const BARS = 96;

  function mount(canvas, read) {
    const g = canvas.getContext('2d');
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.15 : 1;
    const freq = new Uint8Array(128), col = [79, 216, 255];
    let size = 0, level = 0, spin = 0, lastMs = 0;

    new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = canvas.width = canvas.height = Math.round(canvas.clientWidth * dpr);
    }).observe(canvas);

    function frame(ms) {
      requestAnimationFrame(frame);
      if (!size) return;
      const { state, analyser, muted } = read();
      const t = ms / 1000, dt = Math.min(0.05, (ms - lastMs) / 1000); lastMs = ms;
      const c = size / 2, R = c * 0.96, px = size / 600;
      const micLive = analyser && !muted && (state === 'standby' || state === 'listening');

      // loudness: real mic when idle, synthetic pulse when speaking / thinking
      let target = 0.06;
      if (state === 'speaking') target = 0.3 + 0.4 * Math.abs(Math.sin(t * 9) * Math.sin(t * 2.3));
      else if (state === 'thinking') target = 0.22 + 0.1 * Math.sin(t * 7);
      else if (state === 'listening' && !micLive) target = 0.16 + 0.08 * Math.sin(t * 4);
      else if (micLive) { analyser.getByteFrequencyData(freq); let sum = 0; for (let i = 2; i < 42; i++) sum += freq[i]; target = Math.min(1, sum / 40 / 130); }
      level += (target - level) * 0.18;
      const want = COLORS[state] || COLORS.standby;
      for (let i = 0; i < 3; i++) col[i] += (want[i] - col[i]) * 0.1;
      const rgb = `${col[0] | 0},${col[1] | 0},${col[2] | 0}`;
      spin += dt * calm * (state === 'thinking' ? 3.2 : state === 'listening' ? 1.7 : state === 'speaking' ? 1.3 : 1);

      g.clearRect(0, 0, size, size);

      const glow = g.createRadialGradient(c, c, 0, c, c, R * (0.5 + level * 0.3));
      glow.addColorStop(0, `rgba(${rgb},${0.5 + level * 0.45})`);
      glow.addColorStop(0.3, `rgba(${rgb},.18)`);
      glow.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = glow; g.beginPath(); g.arc(c, c, R * 0.8, 0, TAU); g.fill();

      g.lineCap = 'butt';
      for (const ring of RINGS) {
        const seg = TAU / ring.n, rot = spin * ring.s, rad = R * ring.r;
        g.lineWidth = ring.w * px; g.strokeStyle = `rgba(${rgb},${ring.a})`;
        g.beginPath();   // one path per ring = one draw call, however many segments
        for (let i = 0; i < ring.n; i++) {
          const a0 = rot + i * seg;
          g.moveTo(c + Math.cos(a0) * rad, c + Math.sin(a0) * rad);
          g.arc(c, c, rad, a0, a0 + seg * ring.fill);
        }
        g.stroke();
      }

      g.lineCap = 'round'; g.lineWidth = 2.4 * px;
      for (let i = 0; i < BARS; i++) {
        const a = i / BARS * TAU - Math.PI / 2;
        const mirrored = i < BARS / 2 ? i : BARS - i;   // symmetric left/right
        const v = micLive ? freq[2 + mirrored] / 255 : level * (0.55 + 0.45 * Math.sin(i * 0.7 + t * 5) * Math.sin(i * 0.23 - t * 3));
        const r0 = R * 0.57, r1 = r0 + R * 0.2 * Math.max(0.03, v);
        g.strokeStyle = `rgba(${rgb},${0.3 + v * 0.7})`;
        g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
      }

      const coreR = R * (0.13 + level * 0.06);
      const core = g.createRadialGradient(c, c, 0, c, c, coreR);
      core.addColorStop(0, 'rgba(255,255,255,.95)'); core.addColorStop(0.6, `rgba(${rgb},.85)`); core.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = core; g.beginPath(); g.arc(c, c, coreR, 0, TAU); g.fill();
    }
    requestAnimationFrame(frame);
  }

  return { mount };
})();
