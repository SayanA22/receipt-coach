# Receipt Coach

A phone-friendly web app for a household: snap a receipt, check the items it read, and see
where the money goes plus a few plain-language suggestions.

- **No account, no API key, no server.** The photo is read in the browser with
  [Tesseract.js](https://github.com/naptha/tesseract.js) and receipts are saved in the
  browser's local storage on that device.
- **Screens:**
  - **Add** – photo or typed. Stores and items you have bought before are suggested, with the
    last price and category filled in, and the items are checked against the total.
  - **Dashboard** – one calendar month at a time, with a monthly budget: what is left and how
    much a day that allows, then spending by category, store and weekday.
  - **Insights** – plain-language suggestions from the last 30 days, including budget pace,
    price rises and items that are cheaper at another shop you use.
  - **Shopping** – a shopping list that suggests what is running low and what you often buy,
    estimates the cost from last prices, can be sent to someone, and ticks items off when a
    receipt containing them is saved.
  - **Receipts** – search, edit, delete, and a backup file (receipts, list and budget).

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

## Known limits

- Photo reading works best on flat, well-lit, printed receipts; always check the review screen.
- Data lives on one device. Use the backup file to move it.
- Prices are shown in dollars; slash dates are read as month/day.
