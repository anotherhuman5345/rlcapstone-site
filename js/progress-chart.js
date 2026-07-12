/* Reusable model-progress section. Usage:
     <div class="progress" data-src="/data/<project>-progress.json"></div>
   Renders: version-recap table, an SVG line chart of per-epoch validation
   accuracy (with crosshair + tooltip), and a collapsible data table. */

(function () {
  "use strict";

  const W = 720, H = 300;
  const PAD = { top: 18, right: 88, bottom: 42, left: 56 };

  const fmtPct = (v) => (v * 100).toFixed(1) + "%";

  function el(tag, attrs, parent) {
    const ns = "http://www.w3.org/2000/svg";
    const node = document.createElementNS(ns, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function renderVersions(container, versions, inProgress) {
    const table = document.createElement("table");
    table.className = "facts";
    table.innerHTML =
      "<thead><tr><th>Iteration</th><th>Trained on</th><th>ROC-AUC</th>" +
      "<th>Sensitivity</th><th>Specificity</th><th>Val. accuracy</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const v of versions) {
      const tr = document.createElement("tr");
      for (const cell of [
        v.version + " (" + v.date + ")", v.data,
        v.rocAuc, v.sensitivity, v.specificity, v.valTop1,
      ]) {
        const td = document.createElement("td");
        td.textContent = cell;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
    if (inProgress) {
      const p = document.createElement("p");
      p.className = "progress-note";
      p.textContent = "In training now: " + inProgress;
      container.appendChild(p);
    }
  }

  function renderChart(container, series) {
    const pts = series.points;
    const xMin = pts[0][0], xMax = pts[pts.length - 1][0];
    let yMin = Math.min(...pts.map((p) => p[1]), series.baseline ? series.baseline.value : 1);
    let yMax = Math.max(...pts.map((p) => p[1]));
    const span = yMax - yMin;
    yMin = Math.floor((yMin - span * 0.1) * 50) / 50; // snap to 2% steps
    yMax = Math.ceil((yMax + span * 0.1) * 50) / 50;

    const px = (x) => PAD.left + ((x - xMin) / (xMax - xMin)) * (W - PAD.left - PAD.right);
    const py = (y) => PAD.top + (1 - (y - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

    const fig = document.createElement("figure");
    fig.className = "chart";
    const title = document.createElement("figcaption");
    title.textContent = series.label;
    fig.appendChild(title);

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": series.label });

    // recessive horizontal grid + y tick labels, every 2%
    for (let y = yMin; y <= yMax + 1e-9; y += 0.02) {
      el("line", { x1: PAD.left, x2: W - PAD.right, y1: py(y), y2: py(y),
        class: "grid" }, svg);
      el("text", { x: PAD.left - 8, y: py(y) + 4, "text-anchor": "end",
        class: "tick" }, svg).textContent = Math.round(y * 100) + "%";
    }
    // x ticks every 10 epochs
    for (let x = 10; x <= xMax; x += 10) {
      el("text", { x: px(x), y: H - PAD.bottom + 20, "text-anchor": "middle",
        class: "tick" }, svg).textContent = x;
    }
    el("text", { x: (PAD.left + W - PAD.right) / 2, y: H - 6,
      "text-anchor": "middle", class: "axis-label" }, svg).textContent = series.xLabel;

    // baseline reference
    if (series.baseline) {
      const by = py(series.baseline.value);
      el("line", { x1: PAD.left, x2: W - PAD.right, y1: by, y2: by,
        class: "baseline" }, svg);
      el("text", { x: W - PAD.right - 6, y: by + 15, "text-anchor": "end",
        class: "baseline-label" }, svg).textContent = series.baseline.label;
    }

    // the series line
    const d = pts.map((p, i) => (i ? "L" : "M") + px(p[0]) + " " + py(p[1])).join(" ");
    el("path", { d, class: "series-line" }, svg);

    // selective direct labels: last point only (the title names the series)
    const last = pts[pts.length - 1];
    const best = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
    el("circle", { cx: px(last[0]), cy: py(last[1]), r: 4, class: "series-dot" }, svg);
    el("text", { x: px(last[0]) + 8, y: py(last[1]) + 4, class: "point-label" },
      svg).textContent = fmtPct(last[1]);
    if (best[0] !== last[0]) {
      el("text", { x: px(best[0]), y: py(best[1]) - 8, "text-anchor": "middle",
        class: "point-label" }, svg).textContent = "best " + fmtPct(best[1]);
    }

    // hover layer: crosshair + dot + tooltip
    const cross = el("line", { y1: PAD.top, y2: H - PAD.bottom, class: "crosshair",
      visibility: "hidden" }, svg);
    const hoverDot = el("circle", { r: 5, class: "series-dot",
      visibility: "hidden" }, svg);
    const tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.hidden = true;

    const hit = el("rect", { x: PAD.left, y: PAD.top,
      width: W - PAD.left - PAD.right, height: H - PAD.top - PAD.bottom,
      fill: "transparent" }, svg);
    hit.addEventListener("mousemove", (e) => {
      const rect = svg.getBoundingClientRect();
      const xData = xMin + ((e.clientX - rect.left) * (W / rect.width) - PAD.left) /
        (W - PAD.left - PAD.right) * (xMax - xMin);
      const p = pts.reduce((a, b) =>
        Math.abs(b[0] - xData) < Math.abs(a[0] - xData) ? b : a);
      cross.setAttribute("x1", px(p[0]));
      cross.setAttribute("x2", px(p[0]));
      cross.setAttribute("visibility", "visible");
      hoverDot.setAttribute("cx", px(p[0]));
      hoverDot.setAttribute("cy", py(p[1]));
      hoverDot.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.textContent = "Epoch " + p[0] + ": " + fmtPct(p[1]);
      tip.style.left = (px(p[0]) / W) * 100 + "%";
      tip.style.top = (py(p[1]) / H) * 100 + "%";
    });
    hit.addEventListener("mouseleave", () => {
      cross.setAttribute("visibility", "hidden");
      hoverDot.setAttribute("visibility", "hidden");
      tip.hidden = true;
    });

    const wrap = document.createElement("div");
    wrap.className = "chart-stage";
    wrap.appendChild(svg);
    wrap.appendChild(tip);
    fig.appendChild(wrap);
    container.appendChild(fig);

    // accessible data table
    const det = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = "Show this chart as a table";
    det.appendChild(sum);
    const t = document.createElement("table");
    t.className = "facts";
    t.innerHTML = "<thead><tr><th>" + series.xLabel + "</th><th>" +
      series.yLabel + "</th></tr></thead>";
    const tb = document.createElement("tbody");
    for (const p of pts) {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td>" + p[0] + "</td><td>" + fmtPct(p[1]) + "</td>";
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    det.appendChild(t);
    container.appendChild(det);
  }

  async function init(container) {
    try {
      const res = await fetch(container.dataset.src);
      const data = await res.json();
      if (data.versions && data.versions.length) {
        renderVersions(container, data.versions, data.inProgress);
      }
      if (data.epochSeries) renderChart(container, data.epochSeries);
    } catch (e) {
      container.textContent = "Could not load progress data.";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".progress[data-src]").forEach(init);
  });
})();
