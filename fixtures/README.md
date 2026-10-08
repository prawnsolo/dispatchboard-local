# Fixtures

**Everything in this folder is synthetic.** No real customer, address, work order, or account number belongs in this repo. Real Pegasus/ADD exports stay on the PC that runs the app and never get committed.

- `add-export-sample.csv`: 61 data rows, 18 PDR headers (47 jobs, 14 capacity blocks). Names are `SAMPLE CUSTOMER NN` / `SAMPLE BUSINESS NN`, streets are invented (`SAMPLE HOLLOW LN`), and customer, account, and WO numbers are made up. Import tests run against it.
- `lockouts-sample.csv`: demo credit list for the lockout replace (`npm run import:lockouts`). Includes `DEMO-LOCK` so the Phase 2 overlay seed stays open.
- `meter-sites.example.csv`: header plus one example row. Not the real 36-site workbook.

```bash
npm run import:add -- fixtures/add-export-sample.csv
```

To use a real export, keep it outside the repo and pass its path. CI runs `scripts/check-fixtures-synthetic.mjs` and fails if a fixture holds anything that is not obviously synthetic.
