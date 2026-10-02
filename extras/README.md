# ∞ Eye Reach

Local helpers that give ∞ Eye reach into sources it can't fetch from the cloud, using your own logged-in browser and your own downloads. Same idea as Agent Reach: nothing headless, no stored passwords, your session stays yours.

## Browser extension (Chrome / Edge)

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, choose the `extras/reach-extension` folder.
2. Click the ∞ Eye Reach icon → **Settings** → enter your ∞ Eye URL and the API token shown under **Sourcing → Reach** in the app. Save.
3. Sign in to Resdex (or LinkedIn) as usual, run a search, then click the icon → pick the mandate → **Send whole page** (or select the result cards first and use **Send selected text**).

The page's visible text goes to ∞ Eye, the AI extracts the candidates (name, company, title, experience, CTC, notice, activity, contacts, profile link), and they're scored into Scout within seconds. Works on any results page, not just Resdex.

## Folder bridge (Python)

Auto-imports what you download, so Resdex exports and resumes go to ∞ Eye without touching the app:

```powershell
pip install requests pdfplumber python-docx openpyxl
python extras\folder-bridge\ie_reach.py --url https://infinity-eye.xxx.workers.dev --token <token> --mandate 3 --watch "D:\Downloads"
```

Excel/CSV files are imported as Resdex exports; PDF/DOCX/TXT files as resumes. The mandate id is the number in the mandate's URL.

## Terms

Both helpers operate on pages and files you access yourself with your own account. That is still unofficial access for sites like Resdex and LinkedIn, whose terms restrict automated extraction. Use them for your own recruiting on your own subscription, keep volumes human, and read the terms of any account you connect.
