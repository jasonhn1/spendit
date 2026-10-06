# Spend It

A private spending dashboard. People drop in their bank and credit card statements (PDF, CSV or Excel, including Venmo CSV statements) and see where their money goes. Statements are read on their own device and never uploaded anywhere.

## Put it online for free

### Option A: Netlify Drop (easiest, about 2 minutes, no coding)
1. Unzip this folder.
2. Go to https://app.netlify.com/drop and create a free account.
3. Drag the whole `spend-it` folder onto the page.
4. Netlify gives you a link like `https://something-random.netlify.app`. Rename it under **Site configuration → Change site name**, for example `jason-spend-it`.
5. Send that link to your friends.

The `_headers` file in this folder turns on the security settings automatically on Netlify.

### Option B: GitHub + Vercel (best if you'll keep changing it)
1. Create a free GitHub account and a new repository called `spend-it`.
2. Upload everything in this folder to the repository (**Add file → Upload files**).
3. Go to https://vercel.com, sign in with GitHub, click **Add New → Project**, pick the repository, and click **Deploy**. There's nothing to configure.
4. Every time you change a file on GitHub, Vercel updates the site on its own.

The `vercel.json` file turns on the security settings automatically on Vercel.

### Updating the app later
Replace the files and redeploy. Open `sw.js` and bump the version in `spend-it-v5` (to `spend-it-v5` and so on) each time, so people's installed copies pick up the new version.

## Keep it safe
- **Turn on two-factor login** for your Netlify, Vercel and GitHub accounts. Whoever controls those accounts controls the site.
- **Only share your exact link.** Tell friends not to trust copies at other addresses.
- **Don't add outside scripts,** analytics or ads. The page is locked so it can't send data anywhere; adding outside code would mean loosening that lock.

## How people's data is protected
- **Nothing is uploaded.** Statements are read in the browser, on the person's own device.
- **The page can't send data out.** A Content Security Policy tells the browser to block every network request from the page (`connect-src 'none'`). Even if bad code got in, the browser would refuse to send anything.
- **It's encrypted.** Each person's data is encrypted with their passcode (AES-256-GCM, with the key made from the passcode using PBKDF2 at 600,000 rounds) and saved only in their browser. Nobody can read it without the passcode, including you.
- **It locks itself** after 10 minutes of no use, and there's a Lock button.
- **Backups are encrypted too.** "Save backup" downloads an encrypted file that only opens with the passcode.
- **Anyone can check it.** Load the site, turn off Wi-Fi, and drop in a statement: it still works. Or open the browser's developer tools, go to the Network tab, and watch: no requests leave the page.

## What it can't protect against
- A virus or a sketchy browser extension on someone's own computer, which can read any website.
- Someone who knows the passcode, or uses the device while it's unlocked.
- A forgotten passcode. It can't be recovered; the only option is to erase and start over, or restore a backup.

## Installing it like an app
- **Computer (Chrome or Edge):** click the install icon in the address bar.
- **iPhone (Safari):** tap Share → Add to Home Screen.
- **Android (Chrome):** tap ⋮ → Install app.

Once installed, it works offline.

## Files
| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and installing |
| `lib/` | PDF reader (pdf.js) and Excel reader (SheetJS), bundled so nothing loads from outside. See `lib/LICENSES.txt` |
| `fonts/` | Figtree and Bricolage Grotesque (open font license) |
| `_headers`, `vercel.json` | Security settings for Netlify and Vercel |
