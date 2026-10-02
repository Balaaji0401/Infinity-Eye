// Resume text extraction in the browser (the server's free tier has almost no CPU time).
import * as pdfjs from "pdfjs-dist";
import mammoth from "mammoth/mammoth.browser";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export const ACCEPTED = [".pdf", ".docx", ".txt"];
export const extOf = (name) => (name.match(/\.[^.]+$/) || [""])[0].toLowerCase();

export async function extractText(file) {
  const ext = extOf(file.name);
  if (ext === ".txt") return file.text();
  const buf = await file.arrayBuffer();
  if (ext === ".docx") return (await mammoth.extractRawText({ arrayBuffer: buf })).value || "";
  if (ext === ".pdf") {
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      let line = "", lastY = null, out = [];
      for (const it of content.items) {
        const y = Math.round(it.transform?.[5] ?? 0);
        if (lastY !== null && Math.abs(y - lastY) > 3) { out.push(line.trim()); line = ""; }
        line += it.str + (it.hasEOL ? "\n" : " ");
        lastY = y;
      }
      out.push(line.trim());
      pages.push(out.join("\n"));
    }
    return pages.join("\n");
  }
  throw new Error(`${file.name}: use PDF, DOCX or TXT.`);
}

/** Upload files one by one, extracting text first. onProgress(done, total, lastResult). */
export async function uploadResumes(api, mandateId, files, source, onProgress) {
  const list = [...files].filter((f) => ACCEPTED.includes(extOf(f.name)));
  const skipped = [...files].filter((f) => !ACCEPTED.includes(extOf(f.name))).map((f) => f.name);
  let done = 0, failed = [], duplicates = [];
  for (const f of list) {
    try {
      let text = "";
      try { text = await extractText(f); } catch (e) { console.warn("extract failed", f.name, e); }
      const fd = new FormData();
      fd.append("file", f, f.name);
      fd.append("text", text);
      fd.append("source", source);
      const r = await api.form(`/mandates/${mandateId}/candidates`, fd);
      if (r.duplicate) duplicates.push(`${r.duplicate.name || f.name} (${r.duplicate.via})`);
    } catch (e) { failed.push(`${f.name} (${e.message})`); }
    done++;
    onProgress?.(done, list.length);
  }
  return { uploaded: done - failed.length, failed, skipped, duplicates };
}
