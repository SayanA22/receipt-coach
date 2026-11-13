# Receipt Coach

A phone-friendly web app for a household: snap a receipt, check the items it read, and see
where the money goes plus a few plain-language suggestions.

- **No account, no API key, no server.** The photo is read in the browser with
  [Tesseract.js](https://github.com/naptha/tesseract.js) and receipts are saved in the
  browser's local storage on that device.
- **Screens:** Add (photo or typed), Dashboard (category, store, weekday), Insights, Receipts (with backup file).

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
| `insights.js` | Totals and the suggestion rules |
| `app.js` | Screens, photo reading, storage, backup |
| `sample.js` | Made-up receipts for trying the app |

## Known limits

- Photo reading works best on flat, well-lit, printed receipts; always check the review screen.
- Data lives on one device. Use the backup file to move it.
- Prices are shown in dollars; slash dates are read as month/day.
