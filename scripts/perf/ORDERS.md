# Order interaction benchmark

The fixture uses synthetic local data in a disposable browser context. It must
only run on localhost: it clears that origin's localStorage and never reads a
production bundle. The runner blocks API requests and external URLs.

Install the optional browser runner outside the repository dependencies:

```powershell
npm install --prefix ../../outputs/perf-runtime --no-save --package-lock=false playwright
$env:VITE_STORAGE_MODE='localStorage'
npm run dev -- --port 3011 --strictPort
```

In another terminal at the repository root:

```powershell
node scripts/perf/orders-interactions.mjs current
```

Requires Google Chrome. The runner tests admin, employee, and franchisee views
at 393 x 852, with 600 orders, 40 lines per order, and 4x CPU throttling. It
measures click-to-render time (including two animation frames), asserts repeated
quantity updates, saves the order and verifies quantities and totals, and switches
status tabs. JSON measurements and screenshots go to `../../outputs`.

These are repeatable local Chrome measurements, not physical iPhone or production
network measurements. The fixture exercises the real Orders component and storage
code, with local-only authentication data.
