# Receipt Coach

A phone-friendly web app for a household: snap a receipt, check the items it read, and see
where the money goes plus a few plain-language suggestions.

- **No account, no API key, no server.** The photo is read in the browser with
  [Tesseract.js](https://github.com/naptha/tesseract.js) and receipts are saved in the
  browser's local storage on that device.
- **Screens:**
  - **Add** – a photo, a screenshot, a PDF, pasted text from an order email, typed, or just a
    store and an amount. On Android, an installed copy also appears in the share sheet, so a
    PDF, screenshot or selected text can be shared straight into it. Stores and items you have bought
    before are suggested, with the last price and category filled in, and the items are
    checked against the total. Names and categories you correct are remembered and applied
    to later receipts. A "This week" card sums up the last 7 days.
  - **Dashboard** – one calendar month at a time, with a monthly budget: what is left and how
    much a day that allows, then spending by category (with optional limits per category),
    store and weekday, and a month-by-month trend.
  - **Insights** – plain-language suggestions from the last 30 days, including budget pace,
    price rises and items that are cheaper at another shop you use.
  - **Shopping** – a shopping list that suggests what is running low and what you often buy,
    estimates the cost from last prices, can be sent to someone, and ticks items off when a
    receipt containing them is saved.
  - **Receipts** – search (an item search also shows its price history), edit, delete with
    undo, a backup file that carries everything, a spreadsheet (CSV) export, and settings for
    the currency symbol and day/month date order.
- **Works offline.** A service worker (`sw.js`) keeps the app and the photo reader on the
  phone after the first visit.

## Family sharing (optional)

Off by default. When switched on, every phone that enters the same family code shows the
same receipts, shopping list, budget and settings, and each receipt records who added it.

- One document per family is kept in a Cloud Firestore database. It is compressed and
  encrypted on the phone with a key derived from the family code, so the database only
  holds unreadable text. The code itself never leaves the phones.
- Phones check for changes when the app opens, every 20 seconds while it is on screen, and
  right after a change. The latest change to a receipt or list entry wins; deletions carry
  across.

To switch it on: create a Firebase project, create a Firestore database in production mode,
put the project ID in `config.js`, and publish these security rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /families/{family} {
      allow get: if true;
      allow create, update: if family.matches('^[0-9a-f]{64}$')
        && request.resource.data.keys().hasOnly(['data'])
        && request.resource.data.data is string
        && request.resource.data.data.size() < 1000000;
    }
  }
}
```

## Run it

Any static file server works:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. To use it on a phone, publish the folder with GitHub Pages
(Settings → Pages → deploy from the `main` branch) and open the Pages address.

## Tests

```bash
npm test
```

## Files

| File | What it does |
| --- | --- |
| `parser.js` | Turns receipt text into store, date, items, total and categories |
| `insights.js` | Totals, budget, item memory and the suggestion rules |
| `app.js` | Screens, photo reading, shopping list, storage, backup |
| `sample.js` | Made-up receipts for trying the app |
| `sw.js` | Saves the app and the photo reader for offline use |
| `sync.js` | Family sharing: family codes, encryption, merging, the Firestore calls |
| `config.js` | The Firebase project ID that switches family sharing on |

## Known limits

- Photo reading works best on flat, well-lit, printed receipts; always check the review screen.
  It has been tested on drawn receipts, not yet on a set of real photos.
- Without family sharing, data lives on one device. Use the backup file (or "Send to another
  phone") to move or merge it.
- Family sharing keeps a household's data in one document of at most 1 MB, which is several
  thousand receipts. Anyone with the family code can read and change everything.
- One currency symbol at a time; no conversion.
