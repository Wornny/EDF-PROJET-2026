const BASE_URL = 'https://192.168.190.8:3001';
let currentBadgeExists = false;

/* ======================================= RETOUR ======================================= */
document.getElementById('backBadge').addEventListener('click', () => { history.back(); });

/* ======================================= POPUP CONFIRM ======================================= */
function showConfirm(msg, callback) {
  const overlay = document.getElementById('customConfirm');
  document.getElementById('confirmMsg').textContent = msg;
  overlay.classList.add('show');
  document.getElementById('confirmOui').onclick = () => { overlay.classList.remove('show'); callback(true); };
  document.getElementById('confirmNon').onclick = () => { overlay.classList.remove('show'); callback(false); };
}

/* ======================================= INIT ======================================= */
window.onload = function () {
  fetch(`${BASE_URL}/api/badge/all`, { method: 'GET' })
    .then(r => r.json())
    .then(data => {
      const select = document.getElementById('badgeSelect');
      data.badges.forEach(badge => {
        let option = document.createElement('option');
        option.value = badge; option.text = badge;
        select.appendChild(option);
      });
      updateSaveButton(); updateDeleteButton(); updateSearchButton();
    });

  const display = document.getElementById('display');
  display.removeAttribute('readonly');
  display.addEventListener('input', () => {
    display.value = display.value.replace(/[^0-9]/g, '').slice(0, 6);
    checkLength(); updateSaveButton(); updateDeleteButton(); updateSearchButton();
    if (display.value.length === 6) searchbadge();
  });
  display.addEventListener('keydown', (e) => {
    const allowed = ['Backspace','ArrowLeft','ArrowRight','Delete','Tab'];
    if (allowed.includes(e.key)) return;
    if (!/[0-9]/.test(e.key) || display.value.length >= 6) e.preventDefault();
  });

  updateFullscreenButton();
  document.addEventListener('fullscreenchange', () => {
    updateFullscreenButton();
    document.body.classList.toggle('fullscreen', !!document.fullscreenElement);
  });
  if (localStorage.getItem('fullscreen') === 'true') toggleFullscreen();
};

/* ======================================= BOUTONS ÉTAT ======================================= */
function updateSaveButton() {
  const len = document.getElementById('display').value.length;
  const sel = document.getElementById('badgeSelect').value;
  document.getElementById('savebtn').disabled = (len !== 6 && sel === '');
}
function updateSearchButton() {
  document.getElementById('searchbtn').disabled = document.getElementById('display').value.length !== 6;
}
function updateDeleteButton() {
  const len = document.getElementById('display').value.length;
  const sel = document.getElementById('badgeSelect').value;
  document.getElementById('deletebtn').disabled = (sel === '' && len !== 6);
}
function enableSwitches()  { document.getElementById('formationCheck').disabled = false; document.getElementById('visiteCheck').disabled = false; }
function disableSwitches() { document.getElementById('formationCheck').disabled = true;  document.getElementById('visiteCheck').disabled = true; }

/* ======================================= CLAVIER ======================================= */
function addNumber(num) {
  const display = document.getElementById('display');
  if (display.value.length < 6) {
    display.value += num;
    checkLength(); updateSaveButton(); updateDeleteButton(); updateSearchButton();
    if (display.value.length === 6) searchbadge();
  }
}
function clearDisplay() {
  document.getElementById('display').value = '';
  document.getElementById('badgeSelect').value = '';
  currentBadgeExists = false;
  disableSwitches(); updateSaveButton(); updateDeleteButton(); updateSearchButton();
}
function checkLength() {
  document.getElementById('display').value.length === 6 ? enableSwitches() : disableSwitches();
}
function isValidBadge() { return document.getElementById('display').value.length === 6; }

/* ======================================= RECHERCHER ======================================= */
function searchbadge() {
  if (!isValidBadge()) {
    document.getElementById('result').innerText = 'Le badge doit contenir exactement 6 chiffres';
    disableSwitches(); return;
  }
  const numbadge = document.getElementById('display').value;
  fetch(`${BASE_URL}/api/badge/${numbadge}`)
    .then(r => r.json())
    .then(data => {
      enableSwitches();
      document.getElementById('formationCheck').checked = data.formation;
      document.getElementById('visiteCheck').checked    = data.visite_medical ?? data.visite;
      document.getElementById('result').innerText = data.exists ? 'Badge existant chargé' : 'Badge inexistant';
      currentBadgeExists = data.exists;
    });
}
function loadSelectedbadge() {
  const select = document.getElementById('badgeSelect');
  if (select.value !== '') {
    document.getElementById('display').value = select.value;
    currentBadgeExists = true;
    searchbadge(); updateSaveButton(); updateDeleteButton(); updateSearchButton();
  }
}

/* ======================================= ENREGISTRER ======================================= */
function savebadge() {
  if (!isValidBadge()) { document.getElementById('result').innerText = "Impossible d'enregistrer : 6 chiffres requis"; return; }
  const numbadge  = document.getElementById('display').value;
  const formation = document.getElementById('formationCheck').checked;
  const visite    = document.getElementById('visiteCheck').checked;
  fetch(`${BASE_URL}/api/badge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numbadge, formation, visite_medical: visite })
  })
  .then(r => r.json())
  .then(() => refreshBadgeList('Badge enregistré'));
}

/* ======================================= SUPPRIMER ======================================= */
function deletebadge() {
  const numbadge = document.getElementById('display').value || document.getElementById('badgeSelect').value;
  if (numbadge.length !== 6) { document.getElementById('result').innerText = 'Numéro invalide pour suppression'; return; }
  showConfirm(`Supprimer le badge ${numbadge} ?`, (ok) => {
    if (!ok) return;
    fetch(`${BASE_URL}/api/badge/${numbadge}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(data => refreshBadgeList(data.message || 'Supprimé'));
  });
}

function deleteallbadges() {
  showConfirm('Êtes-vous sûr de vouloir supprimer TOUS les badges ?', (ok) => {
    if (!ok) return;
    fetch(`${BASE_URL}/api/badge/all`, { method: 'DELETE' })
      .then(r => r.json())
      .then(data => {
        document.getElementById('badgeSelect').innerHTML = '<option value="">-- Sélectionner un badge --</option>';
        document.getElementById('result').innerText = data.message || 'Tous les badges supprimés';
        document.getElementById('display').value = '';
        disableSwitches(); updateSaveButton(); updateDeleteButton(); updateSearchButton();
      });
  });
}

/* ======================================= HELPERS ======================================= */
function refreshBadgeList(msg) {
  fetch(`${BASE_URL}/api/badge/all`)
    .then(r => r.json())
    .then(data => {
      const select = document.getElementById('badgeSelect');
      select.innerHTML = '<option value="">-- Sélectionner un badge --</option>';
      data.badges.forEach(badge => {
        let o = document.createElement('option'); o.value = badge; o.text = badge; select.appendChild(o);
      });
      document.getElementById('result').innerText = msg;
      document.getElementById('display').value = '';
      disableSwitches(); updateSaveButton(); updateDeleteButton(); updateSearchButton();
    });
}

/* ======================================= PLEIN ÉCRAN ======================================= */
function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.() || document.webkitExitFullscreen?.();
    localStorage.setItem('fullscreen', 'false');
  } else {
    (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)
      .call(document.documentElement);
    localStorage.setItem('fullscreen', 'true');
  }
}
function updateFullscreenButton() {
  document.getElementById('fullscreenBtn').innerText =
    document.fullscreenElement ? 'Quitter plein écran' : 'Plein écran';
}