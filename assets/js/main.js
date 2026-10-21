/* ==========================================================================
   UniFlowWAM project page interactions (no dependencies).
   数据全部取自论文 tex：tab_grid / tab_aloha_objectives / fig_aloha_bars。
   ========================================================================== */
(() => {
  "use strict";

  // ============================ Data ============================

  const MOD_NAMES = { v: "visual", m: "flow", a: "action" };
  const MODS = ["v", "m", "a"];

  // tab_grid.tex：每个目标的 target / condition；其余模态为 absent
  const OBJECTIVES = [
    { id: 1, name: "Policy", short: "policy", target: "a", cond: [],
      text: "Predict the action chunk from the current observation, proprioceptive state and instruction alone. This is the objective that runs at deployment: the flow and visual slots hold learned placeholders, so no scene flow is extracted or encoded at test time." },
    { id: 2, name: "Visual prediction", short: "visual prediction", target: "v", cond: [],
      text: "Predict the DINOv3 feature of the frame at the end of the horizon from the context alone, with no action or flow given." },
    { id: 3, name: "Flow prediction", short: "flow prediction", target: "m", cond: [],
      text: "Predict the 3D flow latent from the context alone: where every point of the scene is and how it moves over the horizon. This is where flow receives its own supervision." },
    { id: 4, name: "Inverse dynamics", short: "inverse dynamics", target: "a", cond: ["v"],
      text: "Given the visual feature of the future frame, infer the action chunk that leads there." },
    { id: 5, name: "Flow-conditioned policy", short: "flow-cond. policy", target: "a", cond: ["m"],
      text: "Given how the scene will move in 3D, infer the action chunk that produces that motion." },
    { id: 6, name: "Forward dynamics", short: "forward dynamics", target: "v", cond: ["a"],
      text: "Given the action chunk, predict the visual feature of the frame it leads to." },
    { id: 7, name: "Dynamics from flow", short: "dynamics from flow", target: "v", cond: ["m"],
      text: "Given the 3D flow, predict the visual feature of the frame it leads to." },
    { id: 8, name: "Visual flow estimation", short: "visual flow estimation", target: "m", cond: ["v"],
      text: "Given the visual feature of the future frame, estimate the 3D flow that connects the current frame to it." },
    { id: 9, name: "Action-driven flow generation", short: "action-driven flow gen.", target: "m", cond: ["a"],
      text: "Given the action chunk, generate the 3D flow it induces in the scene." },
    { id: 10, name: "Dual-conditioned inverse dynamics", short: "dual-cond. inverse dyn.", target: "a", cond: ["m", "v"],
      text: "Given both the 3D flow and the future visual feature, infer the action chunk." },
  ];

  // tab_aloha_objectives.tex：真机消融（success rate, %）
  const OBJECTIVE_SETS = [
    { key: "policy", label: "Policy only", ids: [1], vals: { Chili: 76, Pen: 76, Towel: 72 },
      caption: "Policy only: the single action-prediction objective (1)." },
    { key: "noflow", label: "No flow", ids: [1, 2, 4, 6], vals: { Chili: 92, Pen: 80, Towel: 76 },
      caption: "No flow: the four future-image–action objectives of the base model (1, 2, 4, 6); flow is never a target or a condition." },
    { key: "flowcond", label: "Flow as condition", ids: [1, 2, 4, 5, 6, 7, 10], vals: { Chili: 92, Pen: 88, Towel: 76 },
      caption: "Flow as condition: seven objectives; flow is given as a condition (5, 7, 10) but never predicted." },
    { key: "full", label: "Full grid", ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], vals: { Chili: 94, Pen: 90, Towel: 84 },
      caption: "Full grid: all ten objectives, with 3D flow as both a target and a condition." },
  ];
  const ABLATION_TASKS = ["Chili", "Pen", "Towel"];

  // fig_aloha_bars：[success rate, process score]；顺序与任务图一致（Cabbage 在前）
  const POLICIES = ["π0.5", "DreamZero", "LDA-1B", "UniFlowWAM"];
  const REAL_ROBOT = [
    { task: "Cabbage", vals: [[64, 80], [10, 12], [8, 10.5], [80, 92.5]] },
    { task: "Chili", vals: [[70, 76], [40, 42.5], [20, 22.5], [94, 96.5]] },
    { task: "Pen", vals: [[68, 75.3], [40, 47.5], [18, 20], [90, 92.3]] },
    { task: "Towel", vals: [[72, 76.8], [30, 36], [16, 18], [84, 88]] },
    { task: "Average", vals: [[68.5, 77.0], [30.0, 34.5], [15.5, 17.8], [87.0, 92.3]] },
  ];

  // 网格缩略图：condition 显示干净输入；target 去噪后显示该模态的预测
  const THUMBS = {
    v: { cond: "assets/img/grid/visual-obs.jpg", target: "assets/img/grid/visual-dino.jpg" },
    m: { cond: "assets/img/grid/flow.jpg", target: "assets/img/grid/flow.jpg" },
    a: { cond: "assets/img/grid/action.jpg", target: "assets/img/grid/action.jpg" },
  };

  const CANVAS_W = 240;          // 单元格 canvas 内部分辨率（4:3）
  const CANVAS_H = 180;
  const NOISE_COLS = 16;         // 噪声马赛克块数（与 teaser 的像素噪声观感一致）
  const NOISE_ROWS = 12;
  const STATIC_NOISE = 0.86;     // 未选中目标的噪声强度（1 = 纯噪声）
  const DENOISE_MS = 950;        // 去噪动画时长

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ============================ Helpers ============================

  const el = (tag, cls, html) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html !== undefined) node.innerHTML = html;
    return node;
  };

  // p(a | v, c) 的着色 HTML；变量顺序与论文一致：m 在 v 前
  const formulaHTML = (obj) => {
    const order = ["m", "v", "a"].filter((k) => obj.cond.includes(k));
    const conds = order.map((k) => `<i class="f${k}">${k}</i>`).concat(["<i>c</i>"]).join(", ");
    return `p(<i class="f${obj.target}">${obj.target}</i> | ${conds})`;
  };

  const roleOf = (obj, mod) => (obj.target === mod ? "target" : obj.cond.includes(mod) ? "cond" : "absent");

  const loadImage = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  // ============================ Video slots ============================

  const initVideoSlots = () => {
    document.querySelectorAll(".video-slot").forEach((slot) => {
      const src = slot.dataset.video;
      if (!src) {
        slot.classList.add("is-empty");
        const box = el("div");
        box.appendChild(el("div", "slot-label", slot.dataset.label || "Video"));
        if (slot.dataset.note) box.appendChild(el("div", "slot-note", slot.dataset.note));
        slot.appendChild(box);
        return;
      }
      const video = el("video");
      video.src = src;
      if (slot.dataset.poster) video.poster = slot.dataset.poster;
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.setAttribute("aria-label", slot.dataset.label || "Video");
      // 带控制条：读者点播放，不循环；无控制条：静音循环，只在可见时播放（省流量）
      const userStarts = slot.dataset.controls === "true";
      video.controls = userStarts;
      video.loop = !userStarts;
      slot.appendChild(video);
      new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) video.pause();
          else if (!userStarts && !reduceMotion) video.play().catch(() => {});
        });
      }, { threshold: 0.3 }).observe(slot);
    });
  };

  // ============================ Navigation ============================

  const initNav = () => {
    const links = new Map();
    document.querySelectorAll(".nav-links a").forEach((a) => links.set(a.getAttribute("href").slice(1), a));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        links.forEach((a) => a.classList.remove("is-current"));
        const link = links.get(e.target.id);
        if (link) link.classList.add("is-current");
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    links.forEach((_, id) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });
  };

  // ============================ Role grid（签名交互） ============================

  const initRoleGrid = async () => {
    const grid = document.getElementById("role-grid");
    const detail = document.getElementById("objective-detail");
    if (!grid || !detail) return;

    // 每块噪声在 [0.25, 0.85] 灰度间随机，模拟 teaser 里的像素噪声
    const noiseCanvas = document.createElement("canvas");
    noiseCanvas.width = NOISE_COLS;
    noiseCanvas.height = NOISE_ROWS;
    const noiseCtx = noiseCanvas.getContext("2d");
    const reseedNoise = () => {
      const data = noiseCtx.createImageData(NOISE_COLS, NOISE_ROWS);
      for (let i = 0; i < data.data.length; i += 4) {
        const g = 64 + Math.random() * 153;
        data.data[i] = g; data.data[i + 1] = g; data.data[i + 2] = g; data.data[i + 3] = 255;
      }
      noiseCtx.putImageData(data, 0, 0);
    };
    reseedNoise();

    const small = document.createElement("canvas");
    const smallCtx = small.getContext("2d");

    // t ∈ [0, 1]：0 = 干净图像，1 = 纯噪声；块大小随 t 线性变化（去噪 = 由粗到细）
    const drawNoised = (ctx, img, t) => {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      if (!img) return;
      const block = Math.max(1, Math.round(1 + t * 14));
      small.width = Math.ceil(CANVAS_W / block);
      small.height = Math.ceil(CANVAS_H / block);
      smallCtx.imageSmoothingEnabled = true;
      smallCtx.drawImage(img, 0, 0, small.width, small.height);
      ctx.drawImage(small, 0, 0, CANVAS_W, CANVAS_H);
      if (t > 0) {
        ctx.globalAlpha = Math.min(1, t * 0.95);
        ctx.drawImage(noiseCanvas, 0, 0, CANVAS_W, CANVAS_H);
        ctx.globalAlpha = 1;
      }
    };

    const images = {};
    await Promise.all(MODS.flatMap((m) => ["cond", "target"].map(async (r) => {
      images[`${m}-${r}`] = await loadImage(THUMBS[m][r]);
    })));

    // 左侧行标签
    const labels = el("div", "row-labels");
    labels.appendChild(el("span"));
    MODS.forEach((m) => {
      const s = el("span", `mod-${m}`, m);
      s.title = MOD_NAMES[m];
      labels.appendChild(s);
    });
    grid.appendChild(labels);

    const columns = OBJECTIVES.map((obj) => {
      const btn = el("button", "obj");
      btn.type = "button";
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-label", `Objective ${obj.id}: ${obj.name}`);
      const head = el("span", "obj-head");
      head.appendChild(el("span", "obj-num", String(obj.id)));
      head.appendChild(el("span", "obj-name", obj.short));
      head.appendChild(el("span", "obj-formula formula-sm", formulaHTML(obj)));
      btn.appendChild(head);

      const cells = MODS.map((m) => {
        const role = roleOf(obj, m);
        const cell = el("span", `cell mod-${m} role-${role}`);
        const canvas = document.createElement("canvas");
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;
        cell.appendChild(canvas);
        btn.appendChild(cell);
        return { m, role, ctx: canvas.getContext("2d") };
      });
      grid.appendChild(btn);
      return { obj, btn, cells, anim: 0 };
    });

    // 静态状态：condition = 干净图，target = 噪声图，absent = 空占位
    const paintStatic = (col) => {
      col.cells.forEach((c) => {
        if (c.role === "cond") drawNoised(c.ctx, images[`${c.m}-cond`], 0);
        if (c.role === "target") drawNoised(c.ctx, images[`${c.m}-target`], STATIC_NOISE);
      });
    };

    // 选中列的 target 从噪声"去噪"到预测结果
    const denoise = (col) => {
      const targets = col.cells.filter((c) => c.role === "target");
      cancelAnimationFrame(col.anim);
      if (reduceMotion) {
        targets.forEach((c) => drawNoised(c.ctx, images[`${c.m}-target`], 0));
        return;
      }
      const start = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - start) / DENOISE_MS);
        const t = STATIC_NOISE * (1 - easeOutCubic(p));
        reseedNoise();
        targets.forEach((c) => drawNoised(c.ctx, images[`${c.m}-target`], t));
        if (p < 1) col.anim = requestAnimationFrame(step);
      };
      col.anim = requestAnimationFrame(step);
    };

    const ROLE_ORDER = { target: 0, cond: 1, absent: 2 };
    const ROLE_WORD = { target: "Target", cond: "Condition", absent: "Absent" };
    const renderDetail = (obj, deploy) => {
      // 按 target -> condition -> absent 排序展示
      const roles = MODS.map((m) => ({ m, r: roleOf(obj, m) }))
        .sort((p, q) => ROLE_ORDER[p.r] - ROLE_ORDER[q.r])
        .map(({ m, r }) => `<li>${ROLE_WORD[r]}: <b>${MOD_NAMES[m]}</b></li>`).join("");
      const lead = deploy ? "At test time UniFlowWAM runs this objective alone. " : "";
      detail.innerHTML = `
        <div>
          <div class="detail-num">${deploy ? "Deployment" : `Objective ${obj.id}`}</div>
          <div class="detail-name">${obj.name}</div>
          <div class="formula">${formulaHTML(obj)}</div>
        </div>
        <div>
          <ul class="detail-roles">${roles}</ul>
          <p class="detail-text">${lead}${obj.text}</p>
        </div>`;
    };

    let current = null;
    let deploy = false;
    const select = (col, animate = true) => {
      if (current && current !== col) {
        current.btn.classList.remove("is-active");
        current.btn.setAttribute("aria-pressed", "false");
        cancelAnimationFrame(current.anim);
        paintStatic(current);
      }
      current = col;
      col.btn.classList.add("is-active");
      col.btn.setAttribute("aria-pressed", "true");
      renderDetail(col.obj, deploy);
      if (animate) denoise(col);
    };

    columns.forEach((col) => {
      paintStatic(col);
      col.btn.addEventListener("click", () => {
        if (deploy) setMode("train");
        select(col);
      });
    });

    const modeButtons = document.querySelectorAll(".grid-modes .chip");
    const setMode = (mode) => {
      deploy = mode === "deploy";
      grid.classList.toggle("is-deploy", deploy);
      modeButtons.forEach((b) => {
        const on = b.dataset.mode === mode;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", String(on));
      });
      if (deploy) select(columns[0]);
      else if (current) renderDetail(current.obj, false);
    };
    modeButtons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

    // 默认选中 policy；首次滚动到网格时播放一次去噪。
    // 观察外层滚动容器而非网格本身：手机上网格(min-width 1000px)可见比例永远 < 40%
    select(columns[0], false);
    new IntersectionObserver((entries, obs) => {
      if (entries.some((e) => e.isIntersecting)) {
        denoise(columns[0]);
        obs.disconnect();
      }
    }, { threshold: 0.4 }).observe(grid.parentElement);
  };

  // ============================ Tooltip ============================

  const tooltip = el("div", "tooltip");
  tooltip.setAttribute("role", "tooltip");
  document.body.appendChild(tooltip);
  const showTip = (html, x, y) => {
    tooltip.innerHTML = html;
    tooltip.classList.add("is-on");
    const w = tooltip.offsetWidth;
    tooltip.style.left = `${Math.min(window.innerWidth - w - 12, Math.max(12, x - w / 2))}px`;
    tooltip.style.top = `${y - tooltip.offsetHeight - 12}px`;
  };
  const hideTip = () => tooltip.classList.remove("is-on");

  // ============================ Real-robot bars ============================

  const initRealBars = () => {
    // 每个任务的柱状图渲染到页面里对应的 [data-bars] 容器，与左侧该任务的里程碑图同一行
    REAL_ROBOT.forEach(({ task, vals }) => {
      const root = document.querySelector(`[data-bars="${task}"]`);
      if (!root) return;
      const panel = el("div", `bar-panel${task === "Average" ? " is-average" : ""}`);
      panel.appendChild(el("h4", "", task === "Average" ? "Average over four tasks" : task));
      vals.forEach(([sr, ps], i) => {
        const name = POLICIES[i];
        const ours = name === "UniFlowWAM";
        const row = el("div", `bar-row${ours ? " is-ours" : ""}`);
        row.tabIndex = 0;
        row.setAttribute("aria-label", `${name}, ${task}: success ${sr}%, process score ${ps}`);
        row.appendChild(el("span", "bar-name", name === "π0.5" ? "π<sub>0.5</sub>" : name));
        const track = el("span", "bar-track");
        const proc = el("span", "bar-process");
        proc.style.width = `${ps}%`;
        const succ = el("span", "bar-success");
        succ.style.width = `${sr}%`;
        track.append(proc, succ);
        row.appendChild(track);
        // 平均值保留一位小数（87.0 / 68.5），单任务为整数
        row.appendChild(el("span", "bar-val", task === "Average" ? sr.toFixed(1) : String(sr)));
        const tip = `<b>${name}</b> · ${task}<br>Success ${sr}% · Process ${ps}`;
        row.addEventListener("mousemove", (e) => showTip(tip, e.clientX, e.clientY));
        row.addEventListener("mouseleave", hideTip);
        row.addEventListener("focus", () => {
          const r = row.getBoundingClientRect();
          showTip(tip, r.left + r.width / 2, r.top);
        });
        row.addEventListener("blur", hideTip);
        panel.appendChild(row);
      });
      root.appendChild(panel);
    });

    // 等价表格视图（可访问性）
    const tableRoot = document.getElementById("real-table");
    if (tableRoot) {
      const head = `<tr><th scope="col">Task</th>${POLICIES.map((p) => `<th scope="col" class="n">${p}</th>`).join("")}</tr>`;
      const body = REAL_ROBOT.map(({ task, vals }) =>
        `<tr${task === "Average" ? ' class="ours"' : ""}><td>${task}</td>${vals.map(([sr, ps]) => `<td class="n">${sr} / ${ps}</td>`).join("")}</tr>`).join("");
      tableRoot.innerHTML = `<table class="data"><thead>${head}</thead><tbody>${body}</tbody></table>
        <p class="table-foot">Success rate (%) / process score. 50 trials per task and policy.</p>`;
    }
  };

  // ============================ Ablation ============================

  const initAblation = () => {
    const buttonsRoot = document.querySelector(".set-buttons");
    const mini = document.getElementById("mini-grid");
    const caption = document.getElementById("set-caption");
    const chart = document.getElementById("ablation-dots");
    if (!buttonsRoot || !mini || !chart) return;

    // 迷你网格：3 行模态 × 10 列目标
    const miniCells = [];
    MODS.forEach((m) => {
      mini.appendChild(el("span", `ml mod-${m}`, m));
      OBJECTIVES.forEach((obj) => {
        const c = el("span", `mc mod-${m} r-${roleOf(obj, m)}`);
        c.dataset.id = obj.id;
        miniCells.push(c);
        mini.appendChild(c);
      });
    });
    mini.appendChild(el("span"));
    OBJECTIVES.forEach((obj) => mini.appendChild(el("span", "mn", String(obj.id))));

    // 点图：x 轴 60–100（点图不需要从 0 起）
    const W = 640, ROW_H = 70, TOP = 34, LEFT = 86, RIGHT = 600;
    const H = TOP + ABLATION_TASKS.length * ROW_H;
    const x = (v) => LEFT + ((v - 60) / 40) * (RIGHT - LEFT);
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const mk = (tag, attrs, parent = svg) => {
      const n = document.createElementNS(NS, tag);
      Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
      parent.appendChild(n);
      return n;
    };
    const axis = mk("g", { class: "axis" });
    [60, 70, 80, 90, 100].forEach((v) => {
      mk("line", { x1: x(v), x2: x(v), y1: TOP - 10, y2: H - 8 }, axis);
      mk("text", { x: x(v), y: TOP - 18, "text-anchor": "middle" }, axis).textContent = v;
    });

    const base = OBJECTIVE_SETS[0];
    const rows = ABLATION_TASKS.map((task, i) => {
      const y = TOP + i * ROW_H + ROW_H / 2;
      mk("text", { class: "task-label", x: 0, y: y + 5 }).textContent = task;
      OBJECTIVE_SETS.slice(1).forEach((s) => mk("circle", { class: "dot-other", cx: x(s.vals[task]), cy: y, r: 4 }));
      const link = mk("line", { class: "link", x1: x(base.vals[task]), x2: x(base.vals[task]), y1: y, y2: y });
      mk("circle", { class: "dot-base", cx: x(base.vals[task]), cy: y, r: 6 });
      mk("text", { class: "base-val", x: x(base.vals[task]) - 12, y: y + 4, "text-anchor": "end" }).textContent = base.vals[task];
      const dot = mk("circle", { class: "dot-sel", cx: x(base.vals[task]), cy: y, r: 8 });
      const val = mk("text", { class: "val", x: x(base.vals[task]), y: y - 14, "text-anchor": "middle" });
      const delta = mk("text", { class: "delta", x: x(base.vals[task]) + 14, y: y + 4 });
      return { task, y, link, dot, val, delta };
    });
    chart.appendChild(svg);

    const buttons = OBJECTIVE_SETS.map((s) => {
      const b = el("button", "set-btn", `${s.label}<small>${s.ids.length} objective${s.ids.length > 1 ? "s" : ""}</small>`);
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      buttonsRoot.appendChild(b);
      return b;
    });

    const apply = (idx) => {
      const s = OBJECTIVE_SETS[idx];
      buttons.forEach((b, i) => {
        b.classList.toggle("is-on", i === idx);
        b.setAttribute("aria-pressed", String(i === idx));
      });
      miniCells.forEach((c) => c.classList.toggle("is-off", !s.ids.includes(Number(c.dataset.id))));
      rows.forEach((r) => {
        const v = s.vals[r.task];
        const d = v - base.vals[r.task];
        r.link.setAttribute("x2", x(v));
        r.dot.setAttribute("cx", x(v));
        r.val.setAttribute("x", x(v));
        r.val.textContent = idx === 0 ? "" : v;
        r.delta.setAttribute("x", x(v) + 14);
        r.delta.textContent = d > 0 ? `+${d}` : "";
      });
      const summary = ABLATION_TASKS.map((t) => `${t} ${s.vals[t]}%`).join(", ");
      caption.textContent = `${s.caption} Success: ${summary}.`;
    };
    buttons.forEach((b, i) => b.addEventListener("click", () => apply(i)));
    apply(OBJECTIVE_SETS.length - 1);
  };

  // ============================ BibTeX ============================

  const initCopy = () => {
    const btn = document.getElementById("copy-bibtex");
    const text = document.getElementById("bibtex-text");
    if (!btn || !text) return;
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text.innerText);
        btn.textContent = "Copied";
      } catch (err) {
        const range = document.createRange();
        range.selectNodeContents(text);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        btn.textContent = "Press Ctrl/⌘+C";
      }
      setTimeout(() => { btn.textContent = "Copy BibTeX"; }, 1800);
    });
  };

  // ============================ Main entry ============================

  initVideoSlots();
  initNav();
  initRoleGrid();
  initRealBars();
  initAblation();
  initCopy();
})();
