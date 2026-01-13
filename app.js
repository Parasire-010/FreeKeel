const viewer = document.getElementById("viewer");
const fileInput = document.getElementById("fileInput");
const dropOverlay = document.getElementById("dropOverlay");

const textModeBtn = document.getElementById("textMode");
const drawModeBtn = document.getElementById("drawMode");
const undoBtn = document.getElementById("undoBtn");
const saveBtn = document.getElementById("saveBtn");

let mode = "text";
let pdfBytes = null;
let pages = [];
let annotations = [];
let history = [];

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.js";

textModeBtn.onclick = () => mode = "text";
drawModeBtn.onclick = () => mode = "draw";
undoBtn.onclick = undo;
saveBtn.onclick = savePdf;

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  await loadFile(file);
  fileInput.value = "";
});

window.addEventListener("dragover", e => {
  e.preventDefault();
  dropOverlay.style.display = "grid";
});

window.addEventListener("dragleave", e => {
  if (e.relatedTarget === null) dropOverlay.style.display = "none";
});

window.addEventListener("drop", async e => {
  e.preventDefault();
  dropOverlay.style.display = "none";
  const file = e.dataTransfer.files[0];
  if (file && file.type === "application/pdf") {
    await loadFile(file);
  }
});

async function loadFile(file) {
  pdfBytes = new Uint8Array(await file.arrayBuffer());
  annotations = [];
  history = [];
  await renderPdf(pdfBytes);
}

async function renderPdf(bytes) {
  viewer.innerHTML = "";
  pages = [];
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: 1.5 });

    const wrap = document.createElement("div");
    wrap.className = "page";

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");

    await page.render({ canvasContext: ctx, viewport }).promise;

    const anno = document.createElement("canvas");
    anno.width = canvas.width;
    anno.height = canvas.height;
    anno.style.position = "absolute";
    anno.style.left = 0;
    anno.style.top = 0;
    const annoCtx = anno.getContext("2d");

    wire(anno, annoCtx, i);

    wrap.appendChild(canvas);
    wrap.appendChild(anno);
    viewer.appendChild(wrap);

    pages.push({ anno, annoCtx });
  }
}

function wire(canvas, ctx, pageIndex) {
  let drawing = false;
  let stroke = null;

  canvas.addEventListener("click", e => {
    if (mode !== "text") return;
    pushHistory();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const text = prompt("Text:");
    if (!text) return;
    annotations.push({ type:"text", pageIndex, x, y, text });
    redraw();
  });

  canvas.addEventListener("mousedown", e => {
    if (mode !== "draw") return;
    pushHistory();
    drawing = true;
    stroke = { type:"stroke", pageIndex, points: [] };
    annotations.push(stroke);
  });

  canvas.addEventListener("mousemove", e => {
    if (!drawing || mode !== "draw") return;
    const rect = canvas.getBoundingClientRect();
    stroke.points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    redraw();
  });

  window.addEventListener("mouseup", () => drawing = false);
}

function redraw() {
  pages.forEach(p => p.annoCtx.clearRect(0,0,p.anno.width,p.anno.height));

  for (const a of annotations) {
    const p = pages[a.pageIndex];
    if (!p) continue;

    if (a.type === "text") {
      p.annoCtx.fillStyle = "yellow";
      p.annoCtx.font = "18px Arial";
      p.annoCtx.fillText(a.text, a.x, a.y);
    }

    if (a.type === "stroke") {
      p.annoCtx.strokeStyle = "lime";
      p.annoCtx.beginPath();
      a.points.forEach((pt,i) => {
        if (i === 0) p.annoCtx.moveTo(pt.x, pt.y);
        else p.annoCtx.lineTo(pt.x, pt.y);
      });
      p.annoCtx.stroke();
    }
  }
}

function pushHistory() {
  history.push(structuredClone(annotations));
  if (history.length > 50) history.shift();
}

function undo() {
  if (!history.length) return;
  annotations = history.pop();
  redraw();
}

async function savePdf() {
  if (!pdfBytes) return alert("Load a PDF first.");
  const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

  for (const a of annotations) {
    const page = pdfDoc.getPage(a.pageIndex);
    const { width, height } = page.getSize();
    const canvas = pages[a.pageIndex].anno;
    const sx = width / canvas.width;
    const sy = height / canvas.height;

    if (a.type === "text") {
      page.drawText(a.text, {
        x: a.x * sx,
        y: height - (a.y * sy) - 18,
        size: 18,
        font,
        color: PDFLib.rgb(1,1,0)
      });
    }

    if (a.type === "stroke") {
      for (let i = 1; i < a.points.length; i++) {
        const p1 = a.points[i-1];
        const p2 = a.points[i];
        page.drawLine({
          start:{ x:p1.x*sx, y:height-p1.y*sy },
          end:{ x:p2.x*sx, y:height-p2.y*sy },
          thickness:2,
          color: PDFLib.rgb(0,1,0)
        });
      }
    }
  }

  const out = await pdfDoc.save();
  const blob = new Blob([out], { type:"application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "edited.pdf";
  a.click();
  URL.revokeObjectURL(url);
}
