'use strict';

const form = document.getElementById('reglages-form');
const errorBox = document.getElementById('reglages-error');
const submitBtn = document.getElementById('reglages-submit');

function showError(msg) {
  errorBox.textContent = msg;
}

function clearError() {
  errorBox.textContent = '';
}

function getNumericValue(id) {
  const raw = document.getElementById(id).value.trim();
  if (raw === '') return null;
  const n = parseFloat(raw);
  return isNaN(n) ? NaN : n;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const nom = document.getElementById('reglages-nom').value.trim();
  const valeur1 = getNumericValue('reglages-valeur1');
  const valeur2 = getNumericValue('reglages-valeur2');
  const valeur3 = getNumericValue('reglages-valeur3');

  for (const [label, val] of [['Valeur 1', valeur1], ['Valeur 2', valeur2], ['Valeur 3', valeur3]]) {
    if (val === null) continue;
    if (isNaN(val)) {
      showError(`${label} doit être un nombre valide.`);
      return;
    }
    if (val <= 0) {
      showError(`${label} doit être strictement supérieur à 0.`);
      return;
    }
  }

  submitBtn.disabled = true;

  try {
    const resp = await fetch('/reglages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom, valeur1, valeur2, valeur3 }),
    });

    if (resp.ok) {
      submitBtn.textContent = 'Enregistré ✓';
      setTimeout(() => {
        submitBtn.textContent = 'Enregistrer';
        submitBtn.disabled = false;
      }, 2000);
    } else {
      const data = await resp.json().catch(() => ({}));
      showError(data.error || `Erreur ${resp.status}`);
      submitBtn.disabled = false;
    }
  } catch {
    showError('Erreur réseau. Vérifiez votre connexion.');
    submitBtn.disabled = false;
  }
});
