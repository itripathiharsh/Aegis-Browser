/* Nivrok landing page — interactions & 3D hero */
(() => {
  'use strict';
  document.documentElement.classList.remove('no-js');

  // ---- Config: change these in one place --------------------------------
  const CONFIG = {
    repo: 'itripathiharsh/Aegis-Browser',      // GitHub "owner/repo" for releases, issues & stars
    email: 'harsh.tripathi.cs@gmail.com',      // where feedback & issue reports are sent
  };
  const REPO_URL = `https://github.com/${CONFIG.repo}`;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---- Wire config into links ------------------------------------------
  $$('[data-repo-link]').forEach((a) => (a.href = REPO_URL));
  $$('[data-download-direct]').forEach((a) => (a.href = `${REPO_URL}/releases/latest`));
  $$('[data-mail]').forEach((a) => { a.href = `mailto:${CONFIG.email}`; if (a.textContent.includes('@')) a.textContent = CONFIG.email; });
  const yearEl = $('#year'); if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ---- Toast ------------------------------------------------------------
  const toastEl = $('#toast');
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove(); return ok;
    }
  }

  // ---- Nav --------------------------------------------------------------
  const nav = $('#nav');
  const onScrollNav = () => nav.classList.toggle('scrolled', window.scrollY > 12);
  onScrollNav();
  window.addEventListener('scroll', onScrollNav, { passive: true });

  const navToggle = $('#navToggle');
  const navLinks = $('#navLinks');
  const setMenu = (open) => {
    navLinks.classList.toggle('open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  navToggle.addEventListener('click', () => setMenu(!navLinks.classList.contains('open')));
  navLinks.addEventListener('click', (e) => { if (e.target.closest('a,button')) setMenu(false); });

  // ---- Reveal on scroll -------------------------------------------------
  const reveals = $$('.reveal');
  reveals.forEach((el) => {
    const sibs = Array.from(el.parentElement.children).filter((c) => c.classList.contains('reveal'));
    el.style.setProperty('--d', `${Math.min(sibs.indexOf(el), 6) * 0.08}s`);
  });
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      revealIO.unobserve(en.target);
      $$('[data-count]', en.target).forEach(countUp);
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  reveals.forEach((el) => revealIO.observe(el));

  function countUp(el) {
    const target = Number(el.dataset.count);
    const start = performance.now(), dur = 1600;
    const tick = (now) => {
      const t = clamp((now - start) / dur, 0, 1);
      el.textContent = fmt(target * (1 - Math.pow(1 - t, 4)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Run a callback only while an element is on screen.
  function whileVisible(el, onChange) {
    const io = new IntersectionObserver(([en]) => onChange(en.isIntersecting), { threshold: 0.05 });
    io.observe(el);
  }

  // ---- 3D hero (three.js) ----------------------------------------------
  const hudCount = $('#hudCount');
  let blocked = 0;
  const bumpBlocked = () => { blocked += 1; hudCount.textContent = fmt(blocked); };

  function initHero() {
    const canvas = $('#hero3d');
    const stage = canvas.parentElement;
    const THREE = window.THREE;
    let renderer;
    try {
      if (!THREE) throw new Error('three.js unavailable');
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      document.documentElement.classList.add('no-webgl');
      canvas.style.display = 'none';
      // Keep the HUD alive even without WebGL.
      setInterval(bumpBlocked, 900);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 11);

    // Logo geometry from the brand SVG (1320 × 1320 viewBox → 4 units wide)
    const S = 1 / 330;
    const toV = (x, y) => [(x - 660) * S, (660 - y) * S];
    const shapeFrom = (pts) => {
      const s = new THREE.Shape();
      pts.forEach(([x, y], i) => { const [vx, vy] = toV(x, y); i ? s.lineTo(vx, vy) : s.moveTo(vx, vy); });
      s.closePath();
      return s;
    };
    const octShape = shapeFrom([[330, 82], [990, 82], [1238, 330], [1238, 990], [990, 1238], [330, 1238], [82, 990], [82, 330]]);
    const nShape = shapeFrom([[371, 371], [526, 371], [794, 711], [794, 371], [949, 371], [949, 948], [794, 948], [526, 608], [526, 948], [371, 948]]);

    const D = 0.5, BT = 0.08;
    const octGeo = new THREE.ExtrudeGeometry(octShape, { depth: D, bevelEnabled: true, bevelThickness: BT, bevelSize: 0.06, bevelSegments: 4, curveSegments: 1 });
    octGeo.translate(0, 0, -D / 2);
    const nGeo = new THREE.ExtrudeGeometry(nShape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2, curveSegments: 1 });

    const orangeMat = new THREE.MeshStandardMaterial({ color: 0xff4f00, roughness: 0.36, metalness: 0.22 });
    const inkMat = new THREE.MeshStandardMaterial({ color: 0x0b0d0e, roughness: 0.5, metalness: 0.3 });

    const logo = new THREE.Group();
    logo.add(new THREE.Mesh(octGeo, orangeMat));
    const nFront = new THREE.Mesh(nGeo, inkMat);
    nFront.position.z = D / 2 + BT - 0.06;
    logo.add(nFront);
    const nBack = new THREE.Mesh(nGeo, inkMat);
    nBack.rotation.y = Math.PI;
    nBack.position.z = -(D / 2 + BT - 0.06);
    logo.add(nBack);

    const world = new THREE.Group();
    world.add(logo);
    scene.add(world);

    // Shield: rings + faint geodesic dome
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff6a2a, transparent: true, opacity: 0.55 });
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.012, 8, 200), ringMat);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.006, 8, 200), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 }));
    ring1.rotation.x = 1.2; ring2.rotation.x = -1.0; ring2.rotation.y = 0.5;
    world.add(ring1, ring2);

    const dotPos = [];
    for (let i = 0; i < 90; i++) { const a = (i / 90) * Math.PI * 2; dotPos.push(Math.cos(a) * 3.6, Math.sin(a) * 3.6, 0); }
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(dotPos, 3));
    const dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({ color: 0xff7a3d, size: 0.05, transparent: true, opacity: 0.7 }));
    world.add(dots);

    const domeMat = new THREE.LineBasicMaterial({ color: 0xff7a3d, transparent: true, opacity: 0.06 });
    const dome = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(3.0, 1)), domeMat);
    world.add(dome);

    // Background star dust
    const starPos = [];
    for (let i = 0; i < 700; i++) starPos.push((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 20, -Math.random() * 20 - 2);
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9aa6b5, size: 0.035, transparent: true, opacity: 0.55 }));
    scene.add(stars);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(4, 5, 8); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffa070, 0.9); rim.position.set(-6, 3, -4); scene.add(rim);
    const glow = new THREE.PointLight(0xff6a2a, 2.2, 20); glow.position.set(-4, -2, 3); scene.add(glow);

    // "Ads" flying in — stopped by the shield
    const adColors = [0xef4444, 0xf59e0b, 0xef4444, 0x64748b, 0xa855f7];
    const adGeos = [new THREE.BoxGeometry(0.26, 0.18, 0.03), new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.OctahedronGeometry(0.1)];
    const ads = [];
    const AD_COUNT = window.innerWidth < 700 ? 14 : 24;
    const spawn = (ad, initial) => {
      const theta = Math.random() * Math.PI * 2;
      const r = initial ? 3.4 + Math.random() * 6 : 9 + Math.random() * 3;
      ad.mesh.position.set(Math.cos(theta) * r, (Math.random() - 0.5) * 6, Math.sin(theta) * r * 0.6 - 1);
      ad.speed = 0.9 + Math.random() * 1.3;
      ad.spin.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    };
    for (let i = 0; i < AD_COUNT; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: adColors[i % adColors.length], roughness: 0.5, emissive: adColors[i % adColors.length], emissiveIntensity: 0.25 });
      const mesh = new THREE.Mesh(adGeos[i % adGeos.length], mat);
      const ad = { mesh, speed: 1, spin: new THREE.Vector3() };
      spawn(ad, true);
      scene.add(mesh);
      ads.push(ad);
    }

    // Burst pool
    const bursts = [];
    const burstGeo = new THREE.RingGeometry(0.12, 0.16, 32);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(burstGeo, new THREE.MeshBasicMaterial({ color: 0xff7a3d, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      m.visible = false; scene.add(m);
      bursts.push({ m, t: 1 });
    }
    let burstIdx = 0, hitFlash = 0;
    const pop = (pos) => {
      const b = bursts[burstIdx++ % bursts.length];
      b.m.position.copy(pos); b.m.lookAt(camera.position); b.t = 0; b.m.visible = true;
      hitFlash = 1;
      bumpBlocked();
    };

    // Sizing
    const resize = () => {
      const w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.position.z = Math.max(11, 11.6 / camera.aspect);
      camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(stage);
    resize();

    // Input
    const mouse = { x: 0, y: 0 }, smooth = { x: 0, y: 0 };
    window.addEventListener('pointermove', (e) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    // Reduced-motion users get the same scene, just slower and without the spin-in or scroll coupling.
    const calm = reduceMotion ? 0.35 : 1;

    // Loop
    const clock = new THREE.Clock();
    const intro = { t: 0 };
    const tmp = new THREE.Vector3();
    let running = false, raf = 0, elapsed = 0;

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(clock.getDelta(), 0.05);
      elapsed += dt;
      intro.t = reduceMotion ? 1 : Math.min(intro.t + dt / 1.6, 1);
      const e = 1 - Math.pow(1 - intro.t, 3);

      smooth.x = lerp(smooth.x, mouse.x, 0.05);
      smooth.y = lerp(smooth.y, mouse.y, 0.05);
      const scrollP = reduceMotion ? 0 : clamp(window.scrollY / window.innerHeight, 0, 1);

      logo.scale.setScalar(lerp(0.55, 1, e));
      logo.rotation.y = lerp(-Math.PI * 1.1, 0, e) + (smooth.x * 0.5 + Math.sin(elapsed * 0.6) * 0.2) * calm + scrollP * 0.9;
      logo.rotation.x = (smooth.y * 0.3 + Math.sin(elapsed * 0.8) * 0.06) * calm;
      logo.position.y = Math.sin(elapsed * 1.1) * 0.12 * calm;

      world.rotation.z = scrollP * 0.3;
      world.position.y = scrollP * 1.5;
      ring1.rotation.z += dt * 0.35 * calm;
      ring2.rotation.z -= dt * 0.22 * calm;
      dots.rotation.z += dt * 0.08;
      dome.rotation.y += dt * 0.06;
      dome.rotation.x = smooth.y * 0.2;
      stars.rotation.y = smooth.x * 0.05 + elapsed * 0.004;

      hitFlash = Math.max(0, hitFlash - dt * 2.5);
      domeMat.opacity = 0.06 + hitFlash * 0.16;
      ringMat.opacity = 0.55 + hitFlash * 0.4;

      for (const ad of ads) {
        const p = ad.mesh.position;
        tmp.copy(p).negate().normalize().multiplyScalar(ad.speed * dt * e * (reduceMotion ? 0.5 : 1));
        p.add(tmp);
        ad.mesh.rotation.x += ad.spin.x * dt;
        ad.mesh.rotation.y += ad.spin.y * dt;
        if (p.length() < 3.05) { pop(p); spawn(ad, false); }
      }
      for (const b of bursts) {
        if (b.t >= 1) { b.m.visible = false; continue; }
        b.t = Math.min(b.t + dt * 1.8, 1);
        b.m.scale.setScalar(1 + b.t * 5);
        b.m.material.opacity = (1 - b.t) * 0.9;
      }

      renderer.render(scene, camera);
    };
    const setRunning = (on) => {
      if (on === running) return;
      running = on;
      if (on) { clock.getDelta(); frame(); } else cancelAnimationFrame(raf);
    };
    let onScreen = true;
    whileVisible(stage, (v) => { onScreen = v; setRunning(v && !document.hidden); });
    document.addEventListener('visibilitychange', () => setRunning(onScreen && !document.hidden));
    setRunning(true);
  }

  // three.js loads with `defer` before this file, but guard anyway.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHero); else initHero();

  // ---- Live request log -------------------------------------------------
  (function initConsole() {
    const body = $('#consoleBody');
    if (!body) return;
    const blockList = [
      ['securepubads.g.doubleclick.net/gampad/ads', 'easylist'],
      ['pagead2.googlesyndication.com/pagead/js', 'easylist'],
      ['connect.facebook.net/en_US/fbevents.js', 'easyprivacy'],
      ['cdn.taboola.com/libtrc/loader.js', 'easylist'],
      ['widgets.outbrain.com/outbrain.js', 'easylist'],
      ['static.hotjar.com/c/hotjar.js', 'easyprivacy'],
      ['sb.scorecardresearch.com/beacon.js', 'easyprivacy'],
      ['c.amazon-adsystem.com/aax2/apstag.js', 'easylist'],
      ['static.criteo.net/js/ld/publishertag.js', 'easylist'],
      ['onclickads.net/redirect?zone=4412', 'popup'],
      ['ads.pubmatic.com/AdServer/js/pwt', 'ublock'],
      ['pixel.quantserve.com/pixel/p-31', 'easyprivacy'],
      ['popads.net/pop.js', 'popup'],
      ['tags.crwdcntrl.net/c/12345/cc.js', 'ublock'],
    ];
    const allowList = [
      'news-site.com/2026/11/story', 'cdn.news-site.com/css/main.css', 'fonts.gstatic.com/s/inter.woff2',
      'img.news-site.com/hero-1200.webp', 'news-site.com/api/comments', 'upload.wikimedia.org/thumb/map.png',
      'cdn.jsdelivr.net/npm/player.min.js', 'video.news-site.com/hls/720p.m3u8',
    ];
    const elBlocked = $('#logBlocked'), elAllowed = $('#logAllowed');
    let nb = 0, na = 0, timer = 0, active = false;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const add = () => {
      const isBlock = Math.random() < 0.58;
      const row = document.createElement('div');
      row.className = `log-line ${isBlock ? 'block' : 'allow'}`;
      const [host, src] = isBlock ? pick(blockList) : [pick(allowList), 'ok'];
      row.innerHTML = `<span class="tag">${isBlock ? 'BLOCK' : 'ALLOW'}</span><span class="host"></span><span class="src">${isBlock ? src : '—'}</span>`;
      row.querySelector('.host').textContent = host;
      body.appendChild(row);
      while (body.children.length > 20) body.firstChild.remove();
      if (isBlock) elBlocked.textContent = fmt(++nb); else elAllowed.textContent = fmt(++na);
    };
    for (let i = 0; i < 12; i++) add();
    const pace = reduceMotion ? 2 : 1;
    const loop = () => { add(); timer = setTimeout(loop, (380 + Math.random() * 620) * pace); };
    whileVisible(body, (v) => {
      if (v && !active) { active = true; loop(); }
      else if (!v && active) { active = false; clearTimeout(timer); }
    });
  })();

  // ---- 3D tilt cards ----------------------------------------------------
  if (canHover) {
    $$('.tilt').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        card.style.setProperty('--mx', `${px * 100}%`);
        card.style.setProperty('--my', `${py * 100}%`);
        card.style.transform = `rotateX(${(0.5 - py) * 8}deg) rotateY(${(px - 0.5) * 10}deg) translateZ(0)`;
      });
      card.addEventListener('pointerleave', () => { card.style.transform = ''; });
    });
  }

  // ---- Phone: rotate with scroll & pointer -----------------------------
  (function initPhone() {
    const stage = $('#phoneStage'), phone = $('#phone');
    if (!stage || !phone) return;
    const amp = reduceMotion ? 0.4 : 1;
    let px = 0, py = 0, ticking = false;
    const update = () => {
      ticking = false;
      const r = stage.getBoundingClientRect();
      const p = clamp(1 - (r.top + r.height / 2) / (window.innerHeight / 2 + r.height / 2), -1, 1); // -1 → 1 through viewport
      phone.style.setProperty('--ry', `${-22 + (lerp(-8, 48, (p + 1) / 2)) * amp + px * 8}deg`);
      phone.style.setProperty('--rx', `${10 - (p * 6 + py * 6) * amp}deg`);
      phone.style.setProperty('--rz', `${2 - p * 4 * amp}deg`);
    };
    const req = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    window.addEventListener('scroll', req, { passive: true });
    window.addEventListener('resize', req);
    if (canHover) stage.addEventListener('pointermove', (e) => {
      const r = stage.getBoundingClientRect();
      px = (e.clientX - r.left) / r.width - 0.5; py = (e.clientY - r.top) / r.height - 0.5; req();
    });
    stage.addEventListener('pointerleave', () => { px = py = 0; req(); });
    update();

    const phCount = $('#phCount');
    let n = 1284, t = 0;
    const tick = () => { n += 1 + Math.floor(Math.random() * 3); phCount.textContent = fmt(n); t = setTimeout(tick, 900 + Math.random() * 1400); };
    whileVisible(stage, (v) => { clearTimeout(t); if (v) tick(); });
  })();

  // ---- Latest release info ---------------------------------------------
  (function loadRelease() {
    const meta = $('#releaseMeta');
    if (!meta || !window.fetch) return;
    fetch(`https://api.github.com/repos/${CONFIG.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((rel) => {
        if (!rel || !rel.tag_name) return;
        const apk = (rel.assets || []).find((a) => /\.apk$/i.test(a.name));
        const parts = [rel.tag_name];
        if (apk) {
          const mb = apk.size >= 1048576;
          const num = mb ? (apk.size / 1048576).toFixed(1) : String(Math.round(apk.size / 1024));
          parts.push(`${num} ${mb ? 'MB' : 'KB'}`);
          const sizeEl = $('#apkSize');
          if (sizeEl) sizeEl.innerHTML = `${num}<small>${mb ? 'MB' : 'KB'}</small>`;
        }
        if (rel.published_at) parts.push(`released ${new Date(rel.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
        parts.push('Android 7.0+');
        meta.textContent = parts.join(' · ');
      })
      .catch(() => { /* keep the static text */ });
  })();

  // ---- Share & copy -----------------------------------------------------
  $('#shareBtn')?.addEventListener('click', async () => {
    const data = { title: 'Nivrok', text: 'Nivrok — a free, open-source Android browser that blocks ads, trackers and pop-ups before they load.', url: location.href.startsWith('http') ? location.href : REPO_URL };
    if (navigator.share) { try { await navigator.share(data); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    if (await copyText(`${data.text} ${data.url}`)) toast('Link copied — paste it anywhere to share');
  });
  $$('[data-copy-mail]').forEach((b) => b.addEventListener('click', async () => {
    if (await copyText(CONFIG.email)) toast('Email address copied');
  }));

  // ---- Contact panel ----------------------------------------------------
  const panel = $('#contactPanel'), scrim = $('#contactScrim'), form = $('#contactForm');
  const errEl = $('#cpError'), urlField = $('#urlField'), deviceFields = $('#deviceFields');
  const msgLabel = $('#msgLabel'), msg = $('#cpMessage'), subj = $('#cpSubject');
  const TOPICS = {
    feedback: { label: 'Feedback', msgLabel: 'Your message', ph: 'What do you like? What annoys you? Anything goes.', subjPh: 'e.g. Love the tab groups' },
    bug: { label: 'Bug report', msgLabel: 'What happened?', ph: 'What did you do, what did you expect, and what happened instead?', subjPh: 'e.g. App closes when I open a download' },
    site: { label: 'Site issue', msgLabel: 'What went wrong on the site?', ph: 'Did an ad get through, or does something on the page not work?', subjPh: 'e.g. Video ad still plays on example.com' },
    idea: { label: 'Feature idea', msgLabel: 'Describe your idea', ph: 'What would you like Nivrok to do, and why would it help you?', subjPh: 'e.g. Add a QR code scanner' },
  };
  let lastFocus = null;

  const currentTopic = () => (form.elements.topic.value || 'feedback');
  function applyTopic() {
    const t = currentTopic(), cfg = TOPICS[t];
    deviceFields.hidden = !(t === 'bug' || t === 'site');
    urlField.hidden = t !== 'site';
    msgLabel.textContent = cfg.msgLabel;
    msg.placeholder = cfg.ph;
    subj.placeholder = cfg.subjPh;
  }
  form.addEventListener('change', (e) => { if (e.target.name === 'topic') applyTopic(); });

  function openContact(topic) {
    lastFocus = document.activeElement;
    if (topic && TOPICS[topic]) form.elements.topic.value = topic;
    applyTopic();
    errEl.hidden = true;
    scrim.hidden = false;
    requestAnimationFrame(() => { scrim.classList.add('open'); panel.classList.add('open'); });
    panel.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => form.querySelector('input[name="topic"]:checked')?.focus(), 80);
  }
  function closeContact() {
    scrim.classList.remove('open');
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    setTimeout(() => { if (!panel.classList.contains('open')) scrim.hidden = true; }, 320);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $$('[data-open-contact]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); openContact(b.dataset.topic); }));
  $('#contactClose').addEventListener('click', closeContact);
  scrim.addEventListener('click', closeContact);
  document.addEventListener('keydown', (e) => {
    if (!panel.classList.contains('open')) return;
    if (e.key === 'Escape') { closeContact(); return; }
    if (e.key === 'Tab') {
      const f = $$('button, [href], input, textarea, select', panel).filter((el) => !el.closest('[hidden]') && !el.disabled && el.offsetParent !== null);
      const radios = f.filter((el) => el.type === 'radio');
      const focusables = f.filter((el) => el.type !== 'radio' || el.checked || !radios.length);
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  function collect() {
    const fd = new FormData(form);
    const t = currentTopic();
    const get = (k) => String(fd.get(k) || '').trim();
    const data = { topic: t, name: get('name'), subject: get('subject'), url: get('url'), version: get('version'), device: get('device'), message: get('message') };
    [msg, subj].forEach((el) => el.classList.remove('invalid'));
    const problems = [];
    if (!data.subject) { problems.push('add a short subject'); subj.classList.add('invalid'); }
    if (data.message.length < 10) { problems.push('write a few words in the message'); msg.classList.add('invalid'); }
    if (problems.length) {
      errEl.textContent = `Please ${problems.join(' and ')}.`;
      errEl.hidden = false;
      (data.subject ? msg : subj).focus();
      return null;
    }
    errEl.hidden = true;
    return data;
  }
  function composeBody(d, markdown) {
    const h = (s) => (markdown ? `### ${s}` : `${s}:`);
    const lines = [];
    lines.push(d.message, '');
    if (d.url) lines.push(h('Website'), d.url, '');
    if (d.version || d.device) {
      lines.push(h('Device'));
      if (d.version) lines.push(`Nivrok version: ${d.version}`);
      if (d.device) lines.push(`Phone / Android: ${d.device}`);
      lines.push('');
    }
    if (!markdown && d.name) lines.push(`— ${d.name}`);
    lines.push(markdown ? '_Sent from the Nivrok website_' : '(Sent from the Nivrok website contact panel)');
    return lines.join('\n');
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = collect(); if (!d) return;
    const subject = `[Nivrok · ${TOPICS[d.topic].label}] ${d.subject}`;
    window.location.href = `mailto:${CONFIG.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(composeBody(d, false))}`;
    toast('Opening your mail app…');
  });
  $('#ghIssueBtn').addEventListener('click', () => {
    const d = collect(); if (!d) return;
    const title = `[${TOPICS[d.topic].label}] ${d.subject}`;
    window.open(`${REPO_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(composeBody(d, true))}`, '_blank', 'noopener');
  });
})();
