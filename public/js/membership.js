// Center membership page (/membership): live Stripe price and checkout.
if (new URLSearchParams(location.search).get('subscribed') === '1') {
  document.getElementById('subscribed-banner').classList.add('show');
}

// ── Price (comes from Stripe) ──
// Priced per mentor: the Stripe price's tiers give the cost for any number
// of mentors (e.g. $249 for the first, $50 for each one after).
let pricing = null;
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: pricing.currency.toUpperCase() })
  .format(cents / 100).replace(/\.00$/, '');
function costFor(model, n) {
  if (model.mode === 'volume') {
    const t = model.tiers.find(t => t.upTo == null || n <= t.upTo) || model.tiers[model.tiers.length - 1];
    return n * t.unit + t.flat;
  }
  let total = 0, prev = 0;
  for (const t of model.tiers) {
    if (n <= prev) break;
    const top = t.upTo == null ? n : Math.min(n, t.upTo);
    total += (top - prev) * t.unit + t.flat;
    prev = t.upTo == null ? n : t.upTo;
  }
  return total;
}
function perText() {
  if (!pricing.interval) return '';
  return pricing.intervalCount > 1 ? ` every ${pricing.intervalCount} ${pricing.interval}s` : ` / ${pricing.interval}`;
}
// One row per tier after the first, e.g. "4–5 mentors · $125 each / month".
// Volume pricing charges every mentor that tier's rate; graduated pricing
// charges it only for the mentors within the tier.
function renderDiscounts(model) {
  const box = document.getElementById('discounts');
  const rows = model.tiers.slice(1);
  if (!rows.length) { box.hidden = true; return; }
  let from = (model.tiers[0].upTo || 1) + 1;
  const html = rows.map(t => {
    const range = t.upTo == null ? `${from} or more mentors` : (t.upTo === from ? `${from} mentors` : `${from}–${t.upTo} mentors`);
    const label = model.mode === 'volume' ? 'each' : 'per added mentor';
    const flat = t.flat ? ` + ${money(t.flat)}` : '';
    from = (t.upTo || from) + 1;
    return `<tr><td>${range}</td><td>${money(t.unit)} ${label}${flat}${perText()}</td></tr>`;
  }).join('');
  document.getElementById('discount-rows').innerHTML = html;
  document.querySelector('#discounts .discounts-title').textContent = 'Discounts for 2 or more mentors';
  box.hidden = false;
}

function updateTotal() {
  const box = document.getElementById('total-line');
  const n = parseInt(document.getElementById('s-mentors').value, 10);
  if (!pricing || !pricing.tiers || !(n >= 1)) { box.hidden = true; return; }
  box.innerHTML = `Total: <strong>${money(costFor(pricing.tiers, n))}</strong>${perText()} for ${n} mentor${n === 1 ? '' : 's'}`;
  box.hidden = false;
}
document.getElementById('s-mentors').addEventListener('input', updateTotal);

fetch('/api/public/pricing').then(r => r.json()).then(p => {
  if (!p.available) {
    document.getElementById('subscribe-cta').textContent = 'Contact us about a center membership';
    document.getElementById('subscribe-cta').href = 'mailto:info@mentorsuccessacademy.com?subject=MSA%20center%20membership';
    document.getElementById('subscribe').hidden = true;
    return;
  }
  pricing = p;
  if (!p.tiers) return;
  const first = costFor(p.tiers, 1);
  if (!first) return; // no fixed price to show; the button still works
  const el = document.getElementById('price-display');
  el.innerHTML = `${money(first)}<small>${perText()} for 1 mentor</small>`;
  el.hidden = false;
  renderDiscounts(p.tiers);
  updateTotal();
}).catch(() => {});

// ── Subscribe ──
document.getElementById('subscribe-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const msg = document.getElementById('subscribe-msg');
  const data = Object.fromEntries(new FormData(form));
  if (!data.programName || !data.contactName || !data.email) {
    return showMsg(msg, 'Please fill in all fields.', 'error');
  }
  const btn = document.getElementById('subscribe-btn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/public/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    const out = await r.json();
    if (!r.ok || !out.url) throw new Error(out.error || 'Something went wrong.');
    location.href = out.url;
  } catch (err) {
    showMsg(msg, err.message || 'Something went wrong. Please try again.', 'error');
    btn.disabled = false;
  }
});
