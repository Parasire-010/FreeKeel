// FreeKeel - app.js
// Upload or drag-drop PDFs, annotate (text/draw), undo, save flattened PDF,
// and create a brand new blank PDF.

const viewer = document.getElementById("viewer");
const fileInput = document.getElementById("fileInput");
const dropOverlay = document.getElementById("dropOverlay");

const newBtn = document.getElementById("newBtn");
const textModeBtn = document.getElementById("textMode");
const drawModeBtn = document.getElementById("drawMode");
const eraserModeBtn = document.getElementById("eraserMode");  // UPDATED: Added eraser button
const textColorInput = document.getElementById("textColor");  // UPDATED: Added text color picker
const textSizeInput = document.getElementById("textSize");  // UPDATED: Added text size control
const drawColorInput = document.getElementById("drawColor");  // UPDATED: Added draw color picker
const lineWidthInput = document.getElementById("lineWidth");  // UPDATED: Added line width control
const undoBtn = document.getElementById("undoBtn");
const saveBtn = document.getElementById("saveBtn");

let mode = "text";
let pdfBytes = null;        // Uint8Array OR ArrayBuffer-ish bytes for loaded/created PDF
let pages = [];             // [{ anno, annoCtx }]
let annotations = [];       // stored edits
let history = [];           // undo stack

// PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
// Mode buttons
textModeBtn.onclick = () => (mode = "text");
drawModeBtn.onclick = () => (mode = "draw");
eraserModeBtn.onclick = () => (mode = "eraser");  // UPDATED: Added eraser mode

// Actions
undoBtn.onclick = undo;
saveBtn.onclick = savePdf;
newBtn.onclick = createNewPdf;

// File picker upload
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  await loadFile(file);
  fileInput.value = "";
});

// Drag/drop upload
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (dropOverlay) dropOverlay.style.display = "grid";
});

window.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null && dropOverlay) dropOverlay.style.display = "none";
});

window.addEventListener("drop", async (e) => {
  e.preventDefault();
  if (dropOverlay) dropOverlay.style.display = "none";

  const file = e.dataTransfer.files[0];
  if (!file) return;

  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return alert("Please drop a PDF file.");

  await loadFile(file);
});

// Create a new blank PDF
async function createNewPdf() {
  // Optional prompts (safe defaults)
  const pagesCount = Math.max(1, parseInt(prompt("How many pages?", "1") || "1", 10));
  const size = (prompt("Page size: LETTER or A4?", "LETTER") || "LETTER").toUpperCase();

  // Dimensions in PDF points
  const dims = size === "A4" ? [595, 842] : [612, 792]; // A4 or US Letter

  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < pagesCount; i++) doc.addPage(dims);

  pdfBytes = await doc.save();

  annotations = [];
  history = [];
  await renderPdf(pdfBytes);
}

// Load a PDF from an uploaded/dropped file
async function loadFile(file) {
  pdfBytes = new Uint8Array(await file.arrayBuffer());
  annotations = [];
  history = [];
  await renderPdf(pdfBytes);
}

// Render PDF with PDF.js, build an annotation layer per page
async function renderPdf(bytes) {
    try {
          viewer.innerHTML = "";
    pages = [];

    const loadingTask = pdfjsLib.getDocument({ data: bytes });

    // Handle password-protected PDFs
    loadingTask.onPassword = (updatePassword, reason) => {
      const msg = (reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD)
        ? "Incorrect password. Try again:"
        : "This PDF is password protected. Enter password:";

      const pw = prompt(msg, "");
      if (pw === null) {
        // user cancelled
        throw new Error("Password entry cancelled.");
      }
      updatePassword(pw);
    };

    const pdf = await loadingTask.promise;


      for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: 1.5 });

    const wrap = document.createElement("div");
    wrap.className = "page";
    wrap.style.position = "relative";

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");

    await page.render({ canvasContext: ctx, viewport }).promise;

    // Annotation overlay canvas
    const anno = document.createElement("canvas");
    anno.width = canvas.width;
    anno.height = canvas.height;
    anno.style.position = "absolute";
    anno.style.left = "0";
    anno.style.top = "0";

    const annoCtx = anno.getContext("2d");
    wire(anno, annoCtx, i);

    wrap.appendChild(canvas);
    wrap.appendChild(anno);
    viewer.appendChild(wrap);

    pages.push({ anno, annoCtx });
  }

  // After re-rendering, redraw current annotations (if any)
  redraw();
        } catch (err) {
    console.error("PDF load/render failed:", err);
    alert("Could not open that PDF. Check Console (F12) for details.\n\n" + (err?.message || err));
  }
}

// Wire interaction handlers for a page's annotation layer
function wire(canvas, ctx, pageIndex) {
  let drawing = false;
  let stroke = null;

  canvas.addEventListener("click", (e) => {
    if (mode !== "text") return;

    const text = prompt("Text:");
    if (!text) return;

    pushHistory();

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    annotations.push({ type: "text", pageIndex, x, y, text, size: parseInt(textSizeInput.value) || 18, color: textColorInput.value });  // UPDATED: Custom size and color    redraw();
  })
    
      canvas.addEventListener("mousedown", (e) => {
            if (mode !== "draw" && mode !== "eraser") return;  // UPDATED: Allow eraser mode
            pushHistory();
            drawing = true;
            stroke = { type: "stroke", pageIndex, points: [], width: parseInt(lineWidthInput.value) || 2, color: mode === "eraser" ? "#FFFFFF" : drawColorInput.value };  // UPDATED: Custom width, color, eraser uses white
            annotations.push(stroke);
            const rect = canvas.getBoundingClientRect();
            stroke.points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          });
  
    canvas.addEventListener("mousemove", (e) => {
          if (!drawing || (mode !== "draw" && mode !== "eraser")) return;  // UPDATED: Allow eraser mode
          const rect = canvas.getBoundingClientRect();
          stroke.points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          redraw();
        });
  
    window.addEventListener("mouseup", () => {
          drawing = false;
          stroke = null;
        });
  }

// Redraw all annotations onto all pages' annotation canvases
function redraw() {
    pages.forEach((p) => p.annoCtx.clearRect(0, 0, p.anno.width, p.anno.height));
    for (const a of annotations) {
          const p = pages[a.pageIndex];
          if (!p) continue;
      
          if (a.type === "text") {
                  p.annoCtx.fillStyle = a.color || "yellow";  // UPDATED: Use annotation color
                  p.annoCtx.font = `${a.size || 18}px Arial`;
                  p.annoCtx.fillText(a.text, a.x, a.y);
                }
      
          if (a.type === "stroke") {
                  p.annoCtx.strokeStyle = a.color || "lime";  // UPDATED: Use annotation color
                  p.annoCtx.lineWidth = a.width || 2;
                  p.annoCtx.beginPath();
                  a.points.forEach((pt, i) => {
                            if (i === 0) p.annoCtx.moveTo(pt.x, pt.y);
                            else p.annoCtx.lineTo(pt.x, pt.y);
                          });
                  p.annoCtx.stroke();
                }
        }
  }

// Undo stack helpers
function pushHistory() {
    history.push(structuredClone(annotations));
    if (history.length > 50) history.shift();
  }

function undo() {
    if (!history.length) return;
    annotations = history.pop();
    redraw();
  }

// Save flattened PDF with pdf-lib
async function savePdf() {
    if (!pdfBytes) return alert("Load a PDF first.");
  
    const bytesForLib = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const pdfDoc = await PDFLib.PDFDocument.load(bytesForLib);
    const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  
    for (const a of annotations) {
          const page = pdfDoc.getPage(a.pageIndex);
          if (!page) continue;
          const { width, height } = page.getSize();
          const canvas = pages[a.pageIndex]?.anno;
          if (!canvas) continue;
          const sx = width / canvas.width;
          const sy = height / canvas.height;
      
          if (a.type === "text") {
                  const size = a.size || 18;
                  page.drawText(a.text, {
                            x: a.x * sx,
                            y: height - (a.y * sy) - size,
                            size,
                            font,
                            color: PDFLib.rgb(1, 1, 0)
                                    });
                }
      
          if (a.type === "stroke") {
                  const thickness = a.width || 2;
                  for (let i = 1; i < a.points.length; i++) {
                            const p1 = a.points[i - 1];
                            const p2 = a.points[i];
                            page.drawLine({
                                        start: { x: p1.x * sx, y: height - p1.y * sy },
                                        end: { x: p2.x * sx, y: height - p2.y * sy },
                                        thickness,
                                        color: PDFLib.rgb(0, 1, 0)
                                                  });
                          }
                }
        }
  
    const out = await pdfDoc.save();
    const blob = new Blob([out], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
  
    const link = document.createElement("a");
    link.href = url;
    link.download = "edited.pdf";
    link.click();
  
    URL.revokeObjectURL(url);
  };


