(function () {
  'use strict';

  const CELL = 54;
  const STORAGE_KEY = 'shipEditorDesign';

  // ── Category colors ────────────────────────────────────────────
  const CAT_COLORS = [
    { prefix: 'core',        color: '#f84' },
    { prefix: 'armor',       color: '#7a9' },
    { prefix: 'thruster',    color: '#48f' },
    { prefix: 'shield',      color: '#4cf' },
    { prefix: 'storage',     color: '#4b8' },
    { prefix: 'weapon',      color: '#f55' },
    { prefix: 'drill',       color: '#ca4' },
    { prefix: 'tether',      color: '#a6f' },
    { prefix: 'fabricator',  color: '#f6a' },
    { prefix: 'drone',       color: '#4db' },
  ];

  function typeColor(typeKey) {
    for (const { prefix, color } of CAT_COLORS) {
      if (typeKey.startsWith(prefix)) return color;
    }
    return '#556';
  }

  // ── Grid dimensions (mutable) ─────────────────────────────────
  let cols = 10;
  let rows = 10;

  // ── Polar shape for core_basic ────────────────────────────────
  // Loaded once; rendered inside the core_basic cell in draw().
  const coreShape = new PolarObject('/assets/core.json');
  coreShape.show();
  coreShape.onload = () => draw();
  // Max distance in core.json is ~7.11; scale is set per-draw to fit the cell.

  // ── State ──────────────────────────────────────────────────────
  let grid        = new ShipGrid(cols, rows);
  let selectedKey = null;
  let hoverX = -1, hoverY = -1;
  let painting = false;

  // ── Canvas ─────────────────────────────────────────────────────
  const canvas = document.getElementById('grid-canvas');
  const ctx    = canvas.getContext('2d');

  function resizeCanvas() {
    canvas.width  = cols * CELL;
    canvas.height = rows * CELL;
  }
  resizeCanvas();

  // ── Palette ────────────────────────────────────────────────────
  function buildPalette() {
    const list = document.getElementById('palette-list');
    list.innerHTML = '';

    const categories = [
      { label: 'Cores',       prefix: 'core' },
      { label: 'Armor',       prefix: 'armor' },
      { label: 'Thrusters',   prefix: 'thruster' },
      { label: 'Shields',     prefix: 'shield' },
      { label: 'Storage',     prefix: 'storage' },
      { label: 'Weapons',     prefix: 'weapon' },
      { label: 'Drills',      prefix: 'drill' },
      { label: 'Tethers',     prefix: 'tether' },
      { label: 'Fabricators', prefix: 'fabricator' },
      { label: 'Drones',      prefix: 'drone' },
    ];

    for (const cat of categories) {
      const keys = Object.keys(COMPONENT_REGISTRY).filter(k => k.startsWith(cat.prefix));
      if (!keys.length) continue;

      const header = document.createElement('div');
      header.className = 'cat-header';
      header.textContent = cat.label;
      list.appendChild(header);

      for (const key of keys) {
        const def = COMPONENT_REGISTRY[key].defaults;
        const col = typeColor(key);

        const card = document.createElement('div');
        card.className = 'comp-card';
        card.dataset.typeKey = key;
        card.style.setProperty('--c', col);

        const name = document.createElement('div');
        name.className = 'comp-name';
        name.textContent = def.name;

        const meta = document.createElement('div');
        meta.className = 'comp-meta';
        meta.textContent = `${def.gridW}×${def.gridH}  HP: ${def.hp}`;

        card.appendChild(name);
        card.appendChild(meta);

        if (def.powerOutput > 0) {
          const pw = document.createElement('div');
          pw.className = 'comp-power';
          pw.style.color = '#fa3';
          pw.textContent = `⚡ +${def.powerOutput} W`;
          card.appendChild(pw);
        } else if (def.powerDraw > 0) {
          const pw = document.createElement('div');
          pw.className = 'comp-power';
          pw.style.color = '#68a';
          pw.textContent = `⚡ −${def.powerDraw} W`;
          card.appendChild(pw);
        }

        const extraText = extraStat(def);
        if (extraText) {
          const ex = document.createElement('div');
          ex.className = 'comp-extra';
          ex.textContent = extraText;
          card.appendChild(ex);
        }

        card.addEventListener('click', () => selectKey(key));
        list.appendChild(card);
      }
    }
  }

  function extraStat(def) {
    if (def.thrust)           return `Thrust: ${def.thrust}`;
    if (def.armorRating > 1)  return `Armor: ×${def.armorRating}`;
    if (def.shieldStrength)   return `Shield: ${def.shieldStrength} HP`;
    if (def.capacity)         return `Cap: ${def.capacity} u`;
    if (def.mineRate)         return `Mine: ${def.mineRate}/s`;
    if (def.maxDrones)        return `Drones: ${def.maxDrones}`;
    return '';
  }

  function selectKey(key) {
    selectedKey = selectedKey === key ? null : key;
    document.querySelectorAll('.comp-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.typeKey === selectedKey);
    });
    updateSelectedInfo();
    draw();
  }

  // ── Drawing ────────────────────────────────────────────────────
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = '#070d1c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid lines
    ctx.strokeStyle = '#111d2e';
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL + 0.5, 0); ctx.lineTo(x * CELL + 0.5, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL + 0.5); ctx.lineTo(canvas.width, y * CELL + 0.5); ctx.stroke();
    }

    // Components
    const drawn = new Set();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cell = grid.getAt(x, y);
        if (!cell || drawn.has(cell.component)) continue;
        drawn.add(cell.component);

        const comp = cell.component;
        const ox   = cell.originX * CELL + 2;
        const oy   = cell.originY * CELL + 2;
        const cw   = comp.gridW * CELL - 4;
        const ch   = comp.gridH * CELL - 4;
        const col  = typeColor(comp.typeKey);

        // Background fill
        ctx.fillStyle = col + '28';
        ctx.fillRect(ox, oy, cw, ch);

        // Border
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(ox + 0.75, oy + 0.75, cw - 1.5, ch - 1.5);

        // core_basic: render the polar shape from core.json
        if (comp.typeKey === 'core_basic' && coreShape.loaded) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(ox, oy, cw, ch);
          ctx.clip();

          coreShape.x     = ox + cw / 2;
          coreShape.y     = oy + ch / 2;
          // core.json max d ≈ 7.11; scale so diameter fills ~80% of the shorter side
          coreShape.scale = (Math.min(cw, ch) * 0.4) / 7.11;
          coreShape.lineWidth = 1;
          coreShape.render(ctx);

          ctx.restore();
        } else {
          // Fallback: component name text
          ctx.fillStyle = '#dde';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const fontSize = Math.min(11, (cw / (comp.name.length * 0.6)));
          ctx.font = `${Math.max(8, fontSize)}px monospace`;
          ctx.fillText(comp.name, ox + cw / 2, oy + ch / 2);
        }
      }
    }

    // Hover preview
    if (selectedKey && hoverX >= 0 && hoverY >= 0) {
      const def = COMPONENT_REGISTRY[selectedKey].defaults;
      const tmp = createComponent(selectedKey);
      const canPlace = grid._fits(tmp, hoverX, hoverY);
      const px = hoverX * CELL + 2;
      const py = hoverY * CELL + 2;
      const pw = def.gridW * CELL - 4;
      const ph = def.gridH * CELL - 4;

      ctx.fillStyle = canPlace ? 'rgba(0,200,100,0.22)' : 'rgba(255,60,60,0.22)';
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = canPlace ? '#0c7' : '#f33';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
    }
  }

  // ── Stats ──────────────────────────────────────────────────────
  function updateStats() {
    const all   = grid.getAllComponents();
    const stats = grid.computeStats();

    el('stat-power-out').textContent  = `${stats.powerOutput} W`;
    el('stat-power-draw').textContent = `${stats.powerDraw} W`;
    el('stat-speed').textContent      = stats.maxSpeed.toFixed(1);
    el('stat-hp').textContent         = stats.maxHp;
    el('stat-shield').textContent     = `${stats.shieldMax} HP`;
    el('stat-mass').textContent       = all.reduce((s, c) => s + c.massContrib, 0);
    el('stat-parts').textContent      = all.length;

    const core = grid.getCore();
    if (core) {
      const secs = core.maxFuel / core.fuelRate;
      el('stat-fuel').textContent = `${Math.round(secs / 60)} min`;
    } else {
      el('stat-fuel').textContent = '--';
    }

    const ratio  = stats.powerDraw > 0 ? Math.min(1, stats.powerOutput / stats.powerDraw) : 1;
    const bar    = el('power-bar-fill');
    bar.style.width      = (ratio * 100) + '%';
    bar.style.background = ratio >= 1 ? '#4a8' : ratio > 0.5 ? '#ca4' : '#f44';

    const statusEl = el('power-status');
    if (all.length === 0) {
      statusEl.textContent = 'No components';
      statusEl.style.color = '#334';
    } else if (ratio >= 1) {
      statusEl.textContent = `Surplus ${stats.powerOutput - stats.powerDraw} W`;
      statusEl.style.color = '#4a8';
    } else {
      statusEl.textContent = `Deficit ${stats.powerDraw - stats.powerOutput} W`;
      statusEl.style.color = '#f55';
    }

    autosave();
  }

  function updateSelectedInfo() {
    const panel = el('selected-info');
    if (!selectedKey) {
      panel.innerHTML = '<div class="no-sel">Click a component to select it.</div>';
      return;
    }
    const def = COMPONENT_REGISTRY[selectedKey].defaults;
    const col = typeColor(selectedKey);

    const statRows = [
      ['Size', `${def.gridW}×${def.gridH}`],
      ['HP',   `${def.hp}`],
    ];
    if (def.powerOutput)     statRows.push(['Power Out',  `+${def.powerOutput} W`]);
    if (def.powerDraw)       statRows.push(['Power Draw', `−${def.powerDraw} W`]);
    if (def.thrust)          statRows.push(['Thrust', `${def.thrust}`]);
    if (def.armorRating > 1) statRows.push(['Armor', `×${def.armorRating}`]);
    if (def.shieldStrength)  statRows.push(['Shield', `${def.shieldStrength} HP`]);
    if (def.rechargeRate)    statRows.push(['Recharge', `${def.rechargeRate}/s`]);
    if (def.capacity)        statRows.push(['Capacity', `${def.capacity} u`]);
    if (def.mineRate)        statRows.push(['Mine Rate', `${def.mineRate}/s`]);
    if (def.maxDrones)       statRows.push(['Max Drones', `${def.maxDrones}`]);
    if (def.fuelRate)        statRows.push(['Fuel Rate', `${def.fuelRate}/s`]);

    const tableRows = statRows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');

    panel.innerHTML = `
      <div class="sel-name" style="color:${col}">${def.name}</div>
      <div class="sel-key">${selectedKey}</div>
      <table class="sel-table">${tableRows}</table>
      <div class="sel-hint">Left-click — place<br>Right-click — remove</div>
    `;
  }

  // ── Mouse ──────────────────────────────────────────────────────
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    hoverX = Math.floor((e.clientX - r.left)  / CELL);
    hoverY = Math.floor((e.clientY - r.top)   / CELL);
    if (painting && selectedKey) tryPlace(hoverX, hoverY);
    draw();
  });

  canvas.addEventListener('mousedown', e => {
    e.preventDefault();
    const r  = canvas.getBoundingClientRect();
    const gx = Math.floor((e.clientX - r.left) / CELL);
    const gy = Math.floor((e.clientY - r.top)  / CELL);
    if (e.button === 2) {
      grid.remove(gx, gy);
      updateStats();
      draw();
    } else {
      painting = true;
      tryPlace(gx, gy);
    }
  });

  canvas.addEventListener('mouseup',    () => { painting = false; });
  canvas.addEventListener('mouseleave', () => { hoverX = -1; hoverY = -1; painting = false; draw(); });

  function tryPlace(gx, gy) {
    if (!selectedKey) return;
    const comp = createComponent(selectedKey);
    if (grid.place(comp, gx, gy)) {
      updateStats();
      draw();
    }
  }

  // ── Grid resize ────────────────────────────────────────────────
  window.applyGridSize = function () {
    const newCols = parseInt(el('grid-cols').value, 10);
    const newRows = parseInt(el('grid-rows').value, 10);
    if (isNaN(newCols) || isNaN(newRows)) return;
    if (newCols < 2 || newCols > 40 || newRows < 2 || newRows > 40) {
      alert('Grid size must be between 2 and 40.');
      return;
    }

    // Preserve components that still fit in the new dimensions
    const saved   = grid.serialize();
    const newGrid = new ShipGrid(newCols, newRows);
    for (const entry of saved.layout) {
      const comp = createComponent(entry.typeKey, entry.state);
      newGrid.place(comp, entry.x, entry.y); // silently skips if out of bounds
    }

    cols = newCols;
    rows = newRows;
    grid = newGrid;
    hoverX = -1; hoverY = -1;

    resizeCanvas();
    draw();
    updateStats();
  };

  // ── File ops ───────────────────────────────────────────────────
  window.exportDesign = function () {
    const data = { ...grid.serialize(), editorCols: cols, editorRows: rows };
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'ship_design.json';
    a.click();
  };

  window.importDesign = function () {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = '.json';
    input.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.editorCols) {
            cols = data.editorCols;
            rows = data.editorRows;
            el('grid-cols').value = cols;
            el('grid-rows').value = rows;
            resizeCanvas();
          }
          grid = ShipGrid.deserialize(data);
          hoverX = -1; hoverY = -1;
          draw();
          updateStats();
        } catch (err) {
          alert('Invalid design file: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  window.clearGrid = function () {
    if (!confirm('Clear the entire grid?')) return;
    grid = new ShipGrid(cols, rows);
    draw();
    updateStats();
  };

  // ── Persistence ────────────────────────────────────────────────
  function autosave() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...grid.serialize(),
        editorCols: cols,
        editorRows: rows,
      }));
    } catch (_) {}
  }

  function tryLoadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.editorCols) {
        cols = data.editorCols;
        rows = data.editorRows;
        el('grid-cols').value = cols;
        el('grid-rows').value = rows;
      }
      grid = ShipGrid.deserialize(data);
    } catch (_) {}
  }

  // ── Utilities ──────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  // ── Init ───────────────────────────────────────────────────────
  tryLoadSaved();
  resizeCanvas();
  buildPalette();
  draw();
  updateStats();
  updateSelectedInfo();
})();
