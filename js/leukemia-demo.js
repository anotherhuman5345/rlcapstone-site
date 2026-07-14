/* Leukemia demo (v3) — runs the multi-source YOLO classifier in the browser via
   onnxruntime-web. The visitor picks a real single-cell image and we classify it
   on-device as leukemic (B-ALL blast) vs normal. Nothing is uploaded. The sample
   cells come from THREE different labs (Delhi, Tehran, Barcelona) to show the
   model works across sources. Preprocessing mirrors training: resize to 224,
   RGB/255, NCHW [1,3,224,224]; the model already applies softmax.
   Model output order = [all (leukemic), hem (normal)]. */

(function () {
  "use strict";

  const MODEL_URL = "/models/leukemia.onnx";
  const SAMPLES_URL = "/data/leukemia-samples.json";
  const IMG_BASE = "/demo-images/leukemia-v3/";
  const SIZE = 224;
  const CLASSES = ["all", "hem"]; // must match the model's output order
  const DISPLAY = {
    all: "Leukemic (B-ALL blast)",
    hem: "Normal cell",
  };

  let sessionPromise = null;
  let samples = null;
  const $ = (id) => document.getElementById(id);

  function setStatus(t) { const e = $("demo-status"); if (e) e.textContent = t; }

  async function fetchModelWithProgress() {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error("Model download failed (" + res.status + ")");
    const total = Number(res.headers.get("Content-Length")) || 0;
    if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
    const reader = res.body.getReader();
    const buf = new Uint8Array(total);
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf.set(value, got);
      got += value.length;
      setStatus("Downloading model… " + Math.round((got / total) * 100) +
        "% (" + (total / 1048576).toFixed(0) + " MB, one time)");
    }
    return buf;
  }

  function getSession() {
    if (!sessionPromise) {
      sessionPromise = (async () => {
        const bytes = await fetchModelWithProgress();
        setStatus("Initializing…");
        const s = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
        setStatus("");
        return s;
      })();
      sessionPromise.catch(() => { sessionPromise = null; });
    }
    return sessionPromise;
  }

  function imageToTensor(imgEl) {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE; canvas.height = SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(imgEl, 0, 0, SIZE, SIZE);
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
    const plane = SIZE * SIZE;
    const chw = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      chw[i] = data[i * 4] / 255;
      chw[plane + i] = data[i * 4 + 1] / 255;
      chw[2 * plane + i] = data[i * 4 + 2] / 255;
    }
    return new ort.Tensor("float32", chw, [1, 3, SIZE, SIZE]);
  }

  function softmaxIfNeeded(v) {
    const sum = v.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) < 0.05 && v.every((x) => x >= 0 && x <= 1)) return v;
    const m = Math.max(...v);
    const e = v.map((x) => Math.exp(x - m));
    const s = e.reduce((a, b) => a + b, 0);
    return e.map((x) => x / s);
  }

  async function classify(imgEl) {
    const session = await getSession();
    const out = await session.run({ [session.inputNames[0]]: imageToTensor(imgEl) });
    return softmaxIfNeeded(Array.from(out[session.outputNames[0]].data));
  }

  function showResult(probs, sample) {
    let top = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[top]) top = i;
    const predClass = CLASSES[top];
    const correct = predClass === sample.trueClass;

    const box = $("demo-result");
    box.hidden = false;
    box.className = "demo-result " + (correct ? "reassuring" : "concerning");
    $("result-verdict").textContent = "Model says: " + DISPLAY[predClass] +
      " (" + (probs[top] * 100).toFixed(0) + "%)";
    $("result-truth").textContent = "True label: " + DISPLAY[sample.trueClass] +
      "  ·  from " + sample.source + "  —  " + (correct ? "model agrees ✓" : "model is wrong ✗");
    const bars = $("result-bars");
    bars.innerHTML = "";
    CLASSES.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "prob-row";
      row.innerHTML =
        "<span class='prob-label' style='width:10rem'>" + DISPLAY[c] + "</span>" +
        "<div class='prob-track'><div class='prob-fill" + (i === top ? " top" : "") +
        "' style='width:" + Math.max(1, probs[i] * 100) + "%'></div></div>" +
        "<span class='prob-val'>" + (probs[i] * 100).toFixed(0) + "%</span>";
      bars.appendChild(row);
    });
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function pick(sample, thumbEl) {
    document.querySelectorAll(".cell-thumb").forEach((t) => t.classList.remove("active"));
    thumbEl.classList.add("active");
    $("selected-cell").src = IMG_BASE + sample.file;
    $("selected-cell").hidden = false;
    setStatus("Analyzing on your device…");
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = IMG_BASE + sample.file; });
      const probs = await classify(img);
      setStatus("");
      showResult(probs, sample);
    } catch (e) {
      setStatus("Model error: " + e.message);
    }
  }

  function buildGrid() {
    const grid = $("cell-grid");
    grid.innerHTML = "";
    samples.samples.forEach((s) => {
      const b = document.createElement("button");
      b.className = "cell-thumb";
      b.title = s.source;
      b.innerHTML = "<img src='" + IMG_BASE + s.file + "' alt='single blood cell' loading='lazy'>";
      b.addEventListener("click", () => pick(s, b));
      grid.appendChild(b);
    });
  }

  async function init() {
    const gate = $("demo-gate"), demo = $("demo-ui"), ack = $("gate-ack"), start = $("gate-start");
    ack.addEventListener("change", () => { start.disabled = !ack.checked; });
    start.addEventListener("click", async () => {
      gate.hidden = true; demo.hidden = false;
      try {
        samples = await (await fetch(SAMPLES_URL)).json();
        buildGrid();
        getSession().catch((e) => setStatus("Model failed to load: " + e.message));
      } catch (e) { setStatus("Could not load demo data."); }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
  window.__leukemiaClassify = classify;
})();
