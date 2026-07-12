/* Stock risk demo — runs the MLP in the browser via onnxruntime-web. The
   visitor picks a real (ticker, date) example; we draw its recent price line
   and sentiment, then classify next-week risk on-device. Input [1,12], 3
   logits -> softmax, classes [Low, Medium, High]. Educational, not advice. */

(function () {
  "use strict";

  const MODEL_URL = "/models/stock-model.onnx";
  const SAMPLES_URL = "/data/stock-samples.json";
  const CLASSES = ["Low", "Medium", "High"];
  const RISK_COLOR = { Low: "#0a7d3c", Medium: "#b8860b", High: "#c0392b" };

  let sessionPromise = null;
  let samples = null;
  const $ = (id) => document.getElementById(id);

  function getSession() {
    if (!sessionPromise) {
      sessionPromise = ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
      sessionPromise.catch(() => { sessionPromise = null; });
    }
    return sessionPromise;
  }

  function softmax(v) {
    const m = Math.max(...v);
    const e = v.map((x) => Math.exp(x - m));
    const s = e.reduce((a, b) => a + b, 0);
    return e.map((x) => x / s);
  }

  function drawSparkline(closes) {
    const canvas = $("price-canvas");
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const cs = getComputedStyle(canvas);
    let min = Math.min(...closes), max = Math.max(...closes);
    const range = (max - min) || 1;
    const pad = 8;
    ctx.strokeStyle = cs.getPropertyValue("--trace") || "#2563eb";
    ctx.lineWidth = 2;
    ctx.beginPath();
    closes.forEach((c, i) => {
      const x = pad + (i / (closes.length - 1)) * (W - 2 * pad);
      const y = pad + (1 - (c - min) / range) * (H - 2 * pad);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  async function classify(features) {
    const session = await getSession();
    const input = new ort.Tensor("float32", Float32Array.from(features), [1, features.length]);
    const out = await session.run({ [session.inputNames[0]]: input });
    return softmax(Array.from(out[session.outputNames[0]].data));
  }

  function showResult(probs, sample) {
    let top = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[top]) top = i;
    const predClass = CLASSES[top];
    const correct = predClass === sample.trueClass;
    const box = $("demo-result");
    box.hidden = false;
    box.className = "demo-result " + (correct ? "reassuring" : "concerning");
    $("result-verdict").innerHTML = "Predicted next-week risk: <span style='color:" +
      RISK_COLOR[predClass] + "'>" + predClass + "</span> (" + (probs[top] * 100).toFixed(0) + "%)";
    $("result-truth").textContent = "What actually happened: " + sample.trueClass +
      " volatility  —  " + (correct ? "model agrees ✓" : "model was off ✗");
    const senti = sample.sentiment > 0.05 ? "positive" : sample.sentiment < -0.05 ? "negative" : "neutral";
    $("result-context").textContent =
      "News sentiment that week: " + senti + " (" + sample.sentiment.toFixed(2) +
      ", " + sample.sentCount + (sample.sentCount === 1 ? " article" : " articles") +
      "). Note: the model does slightly better without the sentiment feature.";
    const bars = $("result-bars");
    bars.innerHTML = "";
    CLASSES.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "prob-row";
      row.innerHTML =
        "<span class='prob-label'>" + c + "</span>" +
        "<div class='prob-track'><div class='prob-fill" + (i === top ? " top" : "") +
        "' style='width:" + Math.max(1, probs[i] * 100) + "%'></div></div>" +
        "<span class='prob-val'>" + (probs[i] * 100).toFixed(0) + "%</span>";
      bars.appendChild(row);
    });
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function pick(sample) {
    document.querySelectorAll(".stock-chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.id === sample.ticker + sample.date));
    drawSparkline(sample.closes);
    $("price-caption").textContent = sample.ticker + " · 21 trading days up to " + sample.date;
    $("price-canvas").hidden = false;
    $("demo-status").textContent = "Analyzing on your device…";
    try {
      const probs = await classify(sample.features);
      $("demo-status").textContent = "";
      showResult(probs, sample);
    } catch (e) {
      $("demo-status").textContent = "Model error: " + e.message;
    }
  }

  function buildChips() {
    const wrap = $("stock-samples");
    wrap.innerHTML = "";
    samples.samples.forEach((s) => {
      const b = document.createElement("button");
      b.className = "stock-chip";
      b.dataset.id = s.ticker + s.date;
      b.innerHTML = "<strong>" + s.ticker + "</strong><span>" + s.date + "</span>";
      b.addEventListener("click", () => pick(s));
      wrap.appendChild(b);
    });
  }

  async function init() {
    const gate = $("demo-gate"), demo = $("demo-ui"), ack = $("gate-ack"), start = $("gate-start");
    ack.addEventListener("change", () => { start.disabled = !ack.checked; });
    start.addEventListener("click", async () => {
      gate.hidden = true; demo.hidden = false;
      try {
        samples = await (await fetch(SAMPLES_URL)).json();
        buildChips();
        getSession().catch((e) => $("demo-status").textContent = "Model failed to load: " + e.message);
      } catch (e) { $("demo-status").textContent = "Could not load demo data."; }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
  window.__stockClassify = classify;
})();
