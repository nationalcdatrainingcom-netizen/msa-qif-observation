// Free research trial page (/research-trial): the application form.
const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const stateSel = document.getElementById('r-state');
STATES.forEach(s => stateSel.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`));

// ── Research application ──
document.getElementById('research-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const msg = document.getElementById('research-msg');
  const data = Object.fromEntries(new FormData(form));
  data.agreements = {};
  form.querySelectorAll('[data-agree]').forEach(cb => { data.agreements[cb.dataset.agree] = cb.checked; });

  if (!data.programName || !data.directorName || !data.email || !data.licenseNumber || !data.state || !data.preschoolClassrooms) {
    return showMsg(msg, 'Please fill in all the required fields.', 'error');
  }
  if (parseInt(data.preschoolClassrooms, 10) < 2) {
    return showMsg(msg, 'The research trial needs at least 2 classrooms serving children 2½ and older. You can still join MSA with a center membership.', 'error');
  }
  if (Object.values(data.agreements).some(v => !v)) {
    return showMsg(msg, 'Please confirm every item in the list to apply.', 'error');
  }

  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const r = await fetch('/api/public/research-application', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    const out = await r.json();
    if (!r.ok) throw new Error(out.error || 'Something went wrong.');
    form.style.display = 'none';
    document.getElementById('research-success').style.display = 'block';
  } catch (err) {
    showMsg(msg, err.message || 'Something went wrong. Please try again.', 'error');
    btn.disabled = false;
  }
});
