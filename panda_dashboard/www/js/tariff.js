/*
 * Tariff maths: which rate applies at a given time, and pricing hourly import/export rows.
 * Payback and monthly costs live in the Energy Tracker add-on.
 */
window.HD = window.HD || {};

(function () {
  const cfg = () => HD.config;

  function tariffAt(ts) {
    const d = new Date(ts);
    let t = cfg().tariffs[0];
    cfg().tariffs.forEach((row) => { if (d >= new Date(row.from + 'T00:00:00')) t = row; });
    return t;
  }

  function isOffPeak(ts) {
    const t = tariffAt(ts);
    const h = new Date(ts).getHours();
    return t.offPeakStart <= t.offPeakEnd ? h >= t.offPeakStart && h < t.offPeakEnd : h >= t.offPeakStart || h < t.offPeakEnd;
  }

  function importRate(ts) { const t = tariffAt(ts); return isOffPeak(ts) ? t.offPeak : t.peak; }

  // Price hourly statistics rows ({start, change}) → { kwh, cost, offPeakKwh }
  function priceImport(rows) {
    let kwh = 0; let cost = 0; let off = 0;
    (rows || []).forEach((r) => {
      const v = Math.max(0, r.change || 0);
      kwh += v; cost += v * importRate(r.start);
      if (isOffPeak(r.start)) off += v;
    });
    return { kwh, cost, offPeakKwh: off };
  }
  function priceExport(rows) {
    let kwh = 0; let credit = 0;
    (rows || []).forEach((r) => { const v = Math.max(0, r.change || 0); kwh += v; credit += v * tariffAt(r.start).export; });
    return { kwh, credit };
  }

  HD.tariff = { tariffAt, isOffPeak, importRate, priceImport, priceExport };
})();
