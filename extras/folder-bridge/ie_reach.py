"""∞ Eye Reach bridge — runs on your PC, watches a folder, pushes new files to ∞ Eye.

  pip install requests pdfplumber python-docx openpyxl
  python ie_reach.py --url https://infinity-eye.xxx.workers.dev --token <token> --mandate 3 --watch "D:\\Downloads"

New .xlsx/.xls/.csv files are treated as Naukri Resdex exports and imported; new .pdf/.docx/.txt files are
treated as resumes (text is extracted here, the file is uploaded). Nothing logs in anywhere: it only watches
files you downloaded yourself.
"""
import argparse, csv, json, os, sys, time
from pathlib import Path
import requests

def read_rows(path: Path):
    if path.suffix.lower() == ".csv":
        with open(path, newline="", encoding="utf-8-sig", errors="ignore") as f:
            return list(csv.DictReader(f))
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = [[("" if v is None else str(v)) for v in r] for r in ws.iter_rows(values_only=True)]
    hi = next((i for i, r in enumerate(rows) if any("name" in c.lower() for c in r) and sum(1 for c in r if c) >= 3), 0)
    header = [h or f"col{i}" for i, h in enumerate(rows[hi])]
    return [dict(zip(header, r)) for r in rows[hi + 1:] if any(c.strip() for c in r)]

def extract_text(path: Path) -> str:
    ext = path.suffix.lower()
    if ext == ".txt": return path.read_text(errors="ignore")
    if ext == ".docx":
        import docx
        d = docx.Document(str(path)); return "\n".join(p.text for p in d.paragraphs)
    import pdfplumber
    with pdfplumber.open(str(path)) as pdf: return "\n".join((pg.extract_text() or "") for pg in pdf.pages)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True); ap.add_argument("--token", required=True); ap.add_argument("--mandate", required=True, type=int)
    ap.add_argument("--watch", default=str(Path.home() / "Downloads")); ap.add_argument("--source", default="naukri")
    a = ap.parse_args()
    H = {"Authorization": f"Bearer {a.token}"}; base = a.url.rstrip("/") + "/api"
    folder = Path(a.watch); seen = {p for p in folder.iterdir() if p.is_file()}
    print(f"Watching {folder} for mandate {a.mandate}. Download a Resdex export or resumes and they are sent automatically. Ctrl+C to stop.")
    while True:
        time.sleep(3)
        for p in sorted(folder.iterdir()):
            if not p.is_file() or p in seen or p.name.startswith(("~$", ".")) or p.suffix.lower() in (".crdownload", ".tmp", ".part"): continue
            seen.add(p); ext = p.suffix.lower()
            try:
                if ext in (".xlsx", ".xls", ".csv"):
                    r = requests.post(f"{base}/mandates/{a.mandate}/naukri-import", json={"rows": read_rows(p)}, headers=H, timeout=120).json()
                    print(f"[export] {p.name}: {r}")
                elif ext in (".pdf", ".docx", ".txt"):
                    text = extract_text(p)
                    with open(p, "rb") as fh:
                        r = requests.post(f"{base}/mandates/{a.mandate}/candidates", files={"file": (p.name, fh)}, data={"text": text, "source": a.source}, headers=H, timeout=120).json()
                    print(f"[resume] {p.name}: score {r.get('score')} {r.get('band')}")
            except Exception as e:
                print(f"[error] {p.name}: {e}")

if __name__ == "__main__":
    main()
