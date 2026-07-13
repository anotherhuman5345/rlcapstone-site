/* MoleCheck web demo — all inference happens in the browser via onnxruntime-web.
   The selected image is never uploaded anywhere. Mirrors app/lib/classifier.dart:
   plain resize to 224x224, RGB/255, softmax-if-needed. Ships the v2 model
   (smartphone-trained); threshold 0.368 for ~90% sensitivity on phone photos. */

(function () {
  "use strict";

  const MODEL_URL = "/models/molecheck.onnx";
  const INPUT_SIZE = 224;
  const THRESHOLD = 0.368; // v2: ~90% sensitivity on the PAD-UFES phone-photo test set
  const MALIGNANT_INDEX = 1; // labels: [benign, malignant]

  let sessionPromise = null;

  const $ = (id) => document.getElementById(id);

  function setStatus(text) {
    const el = $("demo-status");
    if (el) el.textContent = text;
  }

  /* ---- model loading (once, with download progress) ---- */

  async function fetchModelWithProgress() {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error("Model download failed (" + res.status + ")");
    const total = Number(res.headers.get("Content-Length")) || 0;
    if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());

    const reader = res.body.getReader();
    const buf = new Uint8Array(total);
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf.set(value, received);
      received += value.length;
      setStatus(
        "Downloading model… " + Math.round((received / total) * 100) + "% " +
        "(" + (total / 1048576).toFixed(1) + " MB, one time)"
      );
    }
    return buf;
  }

  function getSession() {
    if (!sessionPromise) {
      sessionPromise = (async () => {
        setStatus("Downloading model…");
        const bytes = await fetchModelWithProgress();
        setStatus("Initializing…");
        const session = await ort.InferenceSession.create(bytes, {
          executionProviders: ["wasm"],
        });
        setStatus("");
        return session;
      })();
      sessionPromise.catch(() => { sessionPromise = null; });
    }
    return sessionPromise;
  }

  /* ---- preprocessing: plain resize to 224x224, RGB/255, NCHW ---- */

  function imageToTensor(source) {
    const canvas = document.createElement("canvas");
    canvas.width = INPUT_SIZE;
    canvas.height = INPUT_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

    const plane = INPUT_SIZE * INPUT_SIZE;
    const chw = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      chw[i] = data[i * 4] / 255;             // R
      chw[plane + i] = data[i * 4 + 1] / 255; // G
      chw[2 * plane + i] = data[i * 4 + 2] / 255; // B
    }
    return new ort.Tensor("float32", chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  }

  function softmaxIfNeeded(v) {
    const sum = v.reduce((a, b) => a + b, 0);
    const normalised =
      Math.abs(sum - 1) < 0.05 && v.every((x) => x >= 0 && x <= 1);
    if (normalised) return v;
    const max = Math.max(...v);
    const exps = v.map((x) => Math.exp(x - max));
    const expSum = exps.reduce((a, b) => a + b, 0);
    return exps.map((x) => x / expSum);
  }

  async function classify(source) {
    const session = await getSession();
    const tensor = imageToTensor(source);
    const outputs = await session.run({ [session.inputNames[0]]: tensor });
    const raw = Array.from(outputs[session.outputNames[0]].data);
    const probs = softmaxIfNeeded(raw);
    return {
      benign: probs[1 - MALIGNANT_INDEX],
      malignant: probs[MALIGNANT_INDEX],
      concerning: probs[MALIGNANT_INDEX] >= THRESHOLD,
      threshold: THRESHOLD,
    };
  }

  /* ---- UI ---- */

  function showResult(r) {
    const box = $("demo-result");
    const pct = (r.malignant * 100).toFixed(1);
    box.hidden = false;
    box.className = "demo-result " + (r.concerning ? "concerning" : "reassuring");
    $("result-verdict").textContent = r.concerning
      ? "Worth showing to a dermatologist"
      : "Lower-risk pattern on this image";
    $("result-detail").textContent =
      "Model score: " + pct + "% resemblance to malignant lesions in the " +
      "training data (flagging threshold: " + (r.threshold * 100).toFixed(1) + "%).";
    const fill = $("result-fill");
    fill.style.width = Math.max(1.5, r.malignant * 100) + "%";
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      setStatus("Please choose an image file.");
      return;
    }
    $("demo-result").hidden = true;
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise((ok, err) => {
        img.onload = ok;
        img.onerror = () => err(new Error("Could not read that image."));
        img.src = url;
      });
      const preview = $("demo-preview");
      preview.src = url;
      preview.hidden = false;
      $("dropzone-hint").textContent = "Choose a different photo";

      setStatus("Analyzing on your device…");
      const result = await classify(img);
      setStatus("");
      showResult(result);
    } catch (e) {
      setStatus(e.message || "Something went wrong analyzing that image.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function init() {
    const gate = $("demo-gate");
    const demo = $("demo-ui");
    const ack = $("gate-ack");
    const start = $("gate-start");

    ack.addEventListener("change", () => { start.disabled = !ack.checked; });
    start.addEventListener("click", () => {
      gate.hidden = true;
      demo.hidden = false;
      getSession().catch((e) => setStatus("Model failed to load: " + e.message));
    });

    const drop = $("dropzone");
    const input = $("demo-file");
    drop.addEventListener("click", () => input.click());
    drop.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
    input.addEventListener("change", () => handleFile(input.files[0]));
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("dragging");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("dragging");
      handleFile(e.dataTransfer.files[0]);
    });
  }

  document.addEventListener("DOMContentLoaded", init);

  // Test hook: classify an image by same-origin URL, returns probabilities.
  window.__molecheckClassify = async function (url) {
    const img = new Image();
    await new Promise((ok, err) => {
      img.onload = ok;
      img.onerror = err;
      img.src = url;
    });
    return classify(img);
  };
})();
