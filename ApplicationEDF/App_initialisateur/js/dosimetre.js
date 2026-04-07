const BASE_URL = window.location.protocol === 'https:'
  ? 'https://192.168.190.8:3001'
  : 'http://192.168.190.8:3000';
let currentDosiExists = false;

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
fetch(`${BASE_URL}/api/dosi/all`, { method: 'GET' })
.then(r => r.json())
.then(data => {
const select = document.getElementById('dosiSelect');
data.dosis.forEach(dosi => {
let option = document.createElement('option');
option.value = dosi; option.text = dosi;
select.appendChild(option);
});
updateSaveButton(); updateDeleteButton(); updateSearchButton();
})
.catch(err => { document.getElementById('result').innerText = '❌ Erreur réseau : ' + err.message; });

const display = document.getElementById('display');
display.removeAttribute('readonly');
display.addEventListener('input', () => {
display.value = display.value.replace(/[^0-9]/g, '').slice(0, 6);
checkLength(); updateSaveButton(); updateDeleteButton(); updateSearchButton();
if (display.value.length === 6) searchDosi();
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
const sel = document.getElementById('dosiSelect').value;
document.getElementById('savebtn').disabled = (len !== 6 && sel === '');
}
function updateSearchButton() {
document.getElementById('searchbtn').disabled = document.getElementById('display').value.length !== 6;
}
function updateDeleteButton() {
const len = document.getElementById('display').value.length;
const sel = document.getElementById('dosiSelect').value;
document.getElementById('deletebtn').disabled = (sel === '' && len !== 6);
}
function enableSwitches() {
document.getElementById('batterieCheck').disabled = false;
document.getElementById('horsServiceCheck').disabled = false;
}
function disableSwitches() {
document.getElementById('batterieCheck').disabled = true;
document.getElementById('horsServiceCheck').disabled = true;
}

/* ======================================= CLAVIER ======================================= */
function addNumber(num) {
const display = document.getElementById('display');
if (display.value.length < 6) {
display.value += num;
checkLength(); updateSaveButton(); updateDeleteButton(); updateSearchButton();
if (display.value.length === 6) searchDosi();
}
}
function clearDisplay() {
document.getElementById('display').value = '';
document.getElementById('dosiSelect').value = '';
currentDosiExists = false;
disableSwitches(); updateSaveButton(); updateDeleteButton(); updateSearchButton();
}
function checkLength() {
document.getElementById('display').value.length === 6 ? enableSwitches() : disableSwitches();
}
function isValidDosi() { return document.getElementById('display').value.length === 6; }

/* ======================================= RECHERCHER ======================================= */
function searchDosi() {
if (!isValidDosi()) {
document.getElementById('result').innerText = 'Le dosimètre doit contenir exactement 6 chiffres';
disableSwitches(); return;
}
const numdosi = document.getElementById('display').value;
fetch(`${BASE_URL}/api/dosi/${numdosi}`)
.then(r => r.json())
.then(data => {
enableSwitches();
document.getElementById('batterieCheck').checked = data.batterie;
document.getElementById('horsServiceCheck').checked = data.hors_service;
document.getElementById('result').innerText = data.exists ? 'Dosimètre existant chargé' : 'Dosimètre inexistant';
currentDosiExists = data.exists;
})
.catch(err => { document.getElementById('result').innerText = '❌ Erreur : ' + err.message; });
}
function loadSelectedDosi() {
const select = document.getElementById('dosiSelect');
if (select.value !== '') {
document.getElementById('display').value = select.value;
currentDosiExists = true;
searchDosi(); updateSaveButton(); updateDeleteButton(); updateSearchButton();
}
}

/* ======================================= ENREGISTRER ======================================= */
function saveDosi() {
if (!isValidDosi()) { document.getElementById('result').innerText = "Impossible d'enregistrer : 6 chiffres requis"; return; }
const numdosi = document.getElementById('display').value;
const batterie = document.getElementById('batterieCheck').checked;
const hors_service = document.getElementById('horsServiceCheck').checked;
fetch(`${BASE_URL}/api/dosi`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ numdosi, batterie, hors_service })
})
.then(r => r.json())
.then(data => {
if (data.error) { document.getElementById('result').innerText = '❌ Erreur : ' + data.error; return; }
refreshDosiList('Dosimètre enregistré');
})
.catch(err => { document.getElementById('result').innerText = '❌ Erreur réseau : ' + err.message; });
}

/* ======================================= SUPPRIMER ======================================= */
function deleteDosi() {
const numdosi = document.getElementById('display').value || document.getElementById('dosiSelect').value;
if (numdosi.length !== 6) { document.getElementById('result').innerText = 'Numéro invalide pour suppression'; return; }
showConfirm(`Supprimer le dosimètre ${numdosi} ?`, (ok) => {
if (!ok) return;
fetch(`${BASE_URL}/api/dosi/${numdosi}`, { method: 'DELETE' })
.then(r => r.json())
.then(data => refreshDosiList(data.message || 'Supprimé'))
.catch(err => { document.getElementById('result').innerText = '❌ Erreur : ' + err.message; });
});
}

function deleteAllDosis() {
showConfirm('Êtes-vous sûr de vouloir supprimer TOUS les dosimètres ?', (ok) => {
if (!ok) return;
fetch(`${BASE_URL}/api/dosi/all`, { method: 'DELETE' })
.then(r => r.json())
.then(data => {
document.getElementById('dosiSelect').innerHTML = '-- Sélectionner un dosimètre --';
document.getElementById('result').innerText = data.message || 'Tous les dosimètres supprimés';
document.getElementById('display').value = '';
disableSwitches(); updateSaveButton(); updateDeleteButton(); updateSearchButton();
})
.catch(err => { document.getElementById('result').innerText = '❌ Erreur : ' + err.message; });
});
}

/* ======================================= HELPERS ======================================= */
function refreshDosiList(msg) {
fetch(`${BASE_URL}/api/dosi/all`)
.then(r => r.json())
.then(data => {
const select = document.getElementById('dosiSelect');
select.innerHTML = '-- Sélectionner un dosimètre --';
data.dosis.forEach(dosi => {
let o = document.createElement('option'); o.value = dosi; o.text = dosi; select.appendChild(o);
});
document.getElementById('result').innerText = msg;
document.getElementById('display').value = '';
disableSwitches(); updateSaveButton(); updateDeleteButton(); updateSearchButton();
})
.catch(err => { document.getElementById('result').innerText = '❌ Erreur : ' + err.message; });
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