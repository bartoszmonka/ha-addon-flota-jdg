/**
 * Tekst z PDF: najpierw warstwa tekstowa (pdf.js), a gdy strona jest skanem – OCR (tesseract.js, język polski).
 * Biblioteki ładują się dopiero przy pierwszym użyciu, więc nie spowalniają startu aplikacji.
 * OCR pobiera przy pierwszym uruchomieniu dane języka polskiego (~2–4 MB) z internetu.
 */

export interface PdfTextResult {
  text: string;
  pages: number;
  ocrPages: number;
}

type Progress = (msg: string, pct?: number) => void;

/** Tworzy silnik OCR. Moduł i dane języka polskiego pobierają się z CDN (jsdelivr / tessdata) przy pierwszym użyciu. */
async function createOcr() {
  const { createWorker } = await import('tesseract.js');
  // opcjonalnie własne ścieżki (np. pliki lokalne) – window.__FLOTA_OCR_PATHS = { workerPath, corePath, langPath }
  const paths = (globalThis as { __FLOTA_OCR_PATHS?: Record<string, string> }).__FLOTA_OCR_PATHS || {};
  try {
    return await createWorker('pol', 1, paths);
  } catch (err) {
    throw new Error('Nie udało się uruchomić rozpoznawania tekstu (OCR). Sprawdź połączenie z internetem – moduł OCR pobiera się przy pierwszym użyciu.');
  }
}

async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

export async function extractPdfText(file: Blob, onProgress?: Progress): Promise<PdfTextResult> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false, enableXfa: false }).promise;
  const pageTexts: string[] = [];
  const needOcr: number[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress?.(`Czytam stronę ${p} z ${pdf.numPages}…`, (p / pdf.numPages) * 40);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // składamy linie po współrzędnej Y, w linii – po X
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      rows.set(y, [...(rows.get(y) || []), { x: it.transform[4], s: it.str }]);
    }
    const text = Array.from(rows.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' '))
      .join('\n');
    pageTexts[p - 1] = text;
    if (text.replace(/\s/g, '').length < 40) needOcr.push(p);
  }

  if (needOcr.length) {
    onProgress?.('Strona jest skanem – uruchamiam rozpoznawanie tekstu (OCR)…', 45);
    const worker = await createOcr();
    try {
      for (let k = 0; k < needOcr.length; k++) {
        const p = needOcr[k];
        onProgress?.(`OCR strony ${p} (${k + 1} z ${needOcr.length})…`, 45 + ((k + 1) / needOcr.length) * 50);
        const page = await pdf.getPage(p);
        // ok. 300 dpi – przy niższej rozdzielczości OCR myli cyfry w tabelach składek
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(300 / 72, 4200 / Math.max(base.width, base.height)) });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        const { data: res } = await worker.recognize(canvas);
        pageTexts[p - 1] = res.text;
      }
    } finally {
      await worker.terminate();
    }
  }
  onProgress?.('Gotowe', 100);
  return { text: pageTexts.join('\n\n'), pages: pdf.numPages, ocrPages: needOcr.length };
}

/** Zdjęcie polisy (JPG/PNG) – od razu OCR */
export async function extractImageText(file: Blob, onProgress?: Progress): Promise<PdfTextResult> {
  onProgress?.('Rozpoznawanie tekstu ze zdjęcia (OCR)…', 30);
  const worker = await createOcr();
  try {
    const { data } = await worker.recognize(file);
    onProgress?.('Gotowe', 100);
    return { text: data.text, pages: 1, ocrPages: 1 };
  } finally {
    await worker.terminate();
  }
}
