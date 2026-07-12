/* ECG arrhythmia demo — runs the 1D CNN in the browser via onnxruntime-web.
   The visitor picks a real (unseen-patient) heartbeat from MIT-BIH; we draw the
   waveform and classify it live. Everything runs client-side. Mirrors
   src/ecg_train.py: input [1,1,260] float32, 4 logits -> softmax, classes NSVF. */

(function () {
  "use strict";

  const MODEL_URL = "/models/ecg-model.onnx";
  const SAMPLES_URL = "/data/ecg-samples.json";
  const CLASSES = ["N", "S", "V", "F"];
  const CLASS_NAME = {
    N: "Normal beat",
    S: "Supraventricular (early) beat",
    V: "Ventricular ectopic beat",
    F: "Fusion beat",
  };

  let sessionPromise = null;
  let samples = null;

  const $ = (id) => document.getElementById(id);

  function getSession() {
    if (!sessionPromise) {
      sessionPromise = ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ["wasm"],
      });
      sessionPromise.catch(() => { sessionPromise = null; });
    }
    return sessionPromise;
  }

  function softmax(v) {
    const max = Math.max(...v);
    const exps = v.map((x) => Math.exp(x - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((x) => x / sum);
  }

  function drawWave(signal) {
    const canvas = $("ecg-canvas");
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // faint ECG-paper grid
    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue("--grid") || "#eee";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += W / 26) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += H / 8) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    const min = Math.min(...signal), max = Math.max(...signal);
    const range = max - min || 1;
    const pad = 12;
    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue("--trace") || "#2563eb";
    ctx.lineWidth = 2;
    ctx.beginPath();
    signal.forEach((v, i) => {
      const x = (i / (signal.length - 1)) * W;
      const y = pad + (1 - (v - min) / range) * (H - 2 * pad);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  async function classify(signal) {
    const session = await getSession();
    const input = new ort.Tensor("float32", Float32Array.from(signal), [1, 1, signal.length]);
    const out = await session.run({ [session.inputNames[0]]: input });
    const logits = Array.from(out[session.outputNames[0]].data);
    return softmax(logits);
  }

  function showResult(probs, trueClass) {
    const top = probs.indexOf(Math.max(...probs));
    const predClass = CLASSES[top];
    const correct = predClass === trueClass;

    const box = $("ecg-result");
    box.hidden = false;
    box.className = "demo-result " + (correct ? "reassuring" : "concerning");
    $("ecg-verdict").textContent =
      "Model says: " + CLASS_NAME[predClass] +
      " (" + (probs[top] * 100).toFixed(0) + "%)";
    $("ecg-truth").textContent =
      "Cardiologist's label: " + CLASS_NAME[trueClass] +
      "  —  " + (correct ? "model agrees ✓" : "model is wrong ✗");

    // per-class probability bars
    const bars = $("ecg-bars");
    bars.innerHTML = "";
    CLASSES.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "prob-row";
      const label = document.createElement("span");
      label.className = "prob-label";
      label.textContent = c;
      const track = document.createElement("div");
      track.className = "prob-track";
      const fill = document.createElement("div");
      fill.className = "prob-fill" + (i === top ? " top" : "");
      fill.style.width = Math.max(1, probs[i] * 100) + "%";
      track.appendChild(fill);
      const val = document.createElement("span");
      val.className = "prob-val";
      val.textContent = (probs[i] * 100).toFixed(0) + "%";
      row.append(label, track, val);
      bars.appendChild(row);
    });
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function pick(sample) {
    document.querySelectorAll(".sample-chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.id === sample.id));
    drawWave(sample.signal);
    $("ecg-status").textContent = "Analyzing on your device…";
    try {
      const probs = await classify(sample.signal);
      $("ecg-status").textContent = "";
      showResult(probs, sample.trueClass);
    } catch (e) {
      $("ecg-status").textContent = "Model error: " + e.message;
    }
  }

  function buildChips() {
    const wrap = $("ecg-samples");
    wrap.innerHTML = "";
    const labelFor = {};
    samples.samples.forEach((s) => {
      labelFor[s.trueClass] = (labelFor[s.trueClass] || 0) + 1;
      const btn = document.createElement("button");
      btn.className = "sample-chip";
      btn.dataset.id = s.id;
      btn.textContent = s.trueClass + " · beat " + labelFor[s.trueClass];
      btn.title = CLASS_NAME[s.trueClass];
      btn.addEventListener("click", () => pick(s));
      wrap.appendChild(btn);
    });
  }

  async function init() {
    try {
      samples = await (await fetch(SAMPLES_URL)).json();
      buildChips();
      getSession(); // warm up (28 KB, near-instant)
    } catch (e) {
      $("ecg-status").textContent = "Could not load demo data.";
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  // Test hook
  window.__ecgClassify = classify;
})();
