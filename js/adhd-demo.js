/* ADHD EEG demo — runs the 1D CNN in the browser via onnxruntime-web.
   The visitor picks a real 19-channel EEG window from an unseen subject; we
   draw the montage and classify it on-device. Mirrors src/adhd_train.py:
   input [1, 19, 256] float32, 2 logits -> softmax, classes [Control, ADHD]. */

(function () {
  "use strict";

  const MODEL_URL = "/models/adhd-model.onnx";
  const SAMPLES_URL = "/data/adhd-samples.json";
  const CHANNELS = ["Fp1","Fp2","F3","F4","C3","C4","P3","P4","O1","O2",
                    "F7","F8","T7","T8","P7","P8","Fz","Cz","Pz"];
  const CLASSES = ["Control", "ADHD"];

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
    const m = Math.max(...v);
    const e = v.map((x) => Math.exp(x - m));
    const s = e.reduce((a, b) => a + b, 0);
    return e.map((x) => x / s);
  }

  // Draw all 19 channels stacked, like an EEG montage.
  function drawMontage(signal) {
    const canvas = $("eeg-canvas");
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const cs = getComputedStyle(canvas);
    const gridColor = cs.getPropertyValue("--grid") || "#eee";
    const traceColor = cs.getPropertyValue("--trace") || "#7c3aed";
    const labelColor = cs.getPropertyValue("--label") || "#888";

    const n = signal.length;              // 19
    const rowH = H / n;
    const leftPad = 34;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textBaseline = "middle";

    for (let c = 0; c < n; c++) {
      const yMid = rowH * (c + 0.5);
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(leftPad, yMid); ctx.lineTo(W, yMid); ctx.stroke();
      ctx.fillStyle = labelColor;
      ctx.fillText(CHANNELS[c] || "", 2, yMid);

      const ch = signal[c];
      let min = ch[0], max = ch[0];
      for (const v of ch) { if (v < min) min = v; if (v > max) max = v; }
      const range = (max - min) || 1;
      const amp = rowH * 0.42;
      ctx.strokeStyle = traceColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < ch.length; i++) {
        const x = leftPad + (i / (ch.length - 1)) * (W - leftPad);
        const y = yMid - ((ch[i] - min) / range - 0.5) * 2 * amp;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }

  async function classify(signal) {
    const session = await getSession();
    // flatten [19][256] -> Float32Array, shape [1,19,256]
    const flat = new Float32Array(19 * 256);
    for (let c = 0; c < 19; c++) flat.set(signal[c], c * 256);
    const input = new ort.Tensor("float32", flat, [1, 19, 256]);
    const out = await session.run({ [session.inputNames[0]]: input });
    return softmax(Array.from(out[session.outputNames[0]].data));
  }

  function showResult(probs, trueClass) {
    const top = probs[1] >= probs[0] ? 1 : 0;
    const predClass = CLASSES[top];
    const correct = predClass === trueClass;
    const box = $("eeg-result");
    box.hidden = false;
    box.className = "demo-result " + (correct ? "reassuring" : "concerning");
    $("eeg-verdict").textContent =
      "Model says: " + predClass + " (" + (probs[top] * 100).toFixed(0) + "%)";
    $("eeg-truth").textContent =
      "This recording is from a subject in the " + trueClass + " group — " +
      (correct ? "model agrees ✓" : "model is wrong ✗");
    const bars = $("eeg-bars");
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
    document.querySelectorAll(".sample-chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.id === sample.id));
    drawMontage(sample.signal);
    $("eeg-status").textContent = "Analyzing on your device…";
    try {
      const probs = await classify(sample.signal);
      $("eeg-status").textContent = "";
      showResult(probs, sample.trueClass);
    } catch (e) {
      $("eeg-status").textContent = "Model error: " + e.message;
    }
  }

  function buildChips() {
    const wrap = $("eeg-samples");
    wrap.innerHTML = "";
    const counts = {};
    samples.samples.forEach((s) => {
      counts[s.trueClass] = (counts[s.trueClass] || 0) + 1;
      const btn = document.createElement("button");
      btn.className = "sample-chip";
      btn.dataset.id = s.id;
      btn.textContent = s.trueClass + " · rec " + counts[s.trueClass];
      btn.addEventListener("click", () => pick(s));
      wrap.appendChild(btn);
    });
  }

  async function init() {
    try {
      samples = await (await fetch(SAMPLES_URL)).json();
      buildChips();
      getSession();
    } catch (e) {
      $("eeg-status").textContent = "Could not load demo data.";
    }
  }

  document.addEventListener("DOMContentLoaded", init);
  window.__adhdClassify = classify;
})();
