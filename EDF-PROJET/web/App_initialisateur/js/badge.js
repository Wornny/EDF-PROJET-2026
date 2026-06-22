/* =======================================
   URL DE BASE DE L'API
   ======================================= */
// Permet de définir un préfixe d'URL si l'API est hébergée ailleurs.
// Ici vide => même serveur que l'application.
const BASE_URL = '';

/* =======================================
   BOUTON RETOUR
   ======================================= */
// Retourne à la page précédente de l'historique du navigateur.
document.getElementById('backBadge').addEventListener('click', () => {
    history.back();
});

/* =======================================
   POPUP DE CONFIRMATION PERSONNALISÉE
   ======================================= */
// Affiche une popup Oui / Non.
// callback(true) si Oui
// callback(false) si Non
function showConfirm(msg, callback) {

    const overlay = document.getElementById('customConfirm');

    document.getElementById('confirmMsg').textContent = msg;

    overlay.classList.add('show');

    document.getElementById('confirmOui').onclick = () => {
        overlay.classList.remove('show');
        callback(true);
    };

    document.getElementById('confirmNon').onclick = () => {
        overlay.classList.remove('show');
        callback(false);
    };
}

/* =======================================
   INITIALISATION DE LA PAGE
   ======================================= */
window.onload = function () {

    // Chargement de la liste complète des badges
    fetch(`${BASE_URL}/api/badge/all`, {
        method: 'GET'
    })
    .then(r => r.json())
    .then(data => {

        const select = document.getElementById('badgeSelect');

        // Remplit la liste déroulante
        data.badges.forEach(badge => {

            let option = document.createElement('option');

            option.value = badge;
            option.text = badge;

            select.appendChild(option);
        });

        updateSaveButton();
        updateDeleteButton();
        updateSearchButton();
    })
    .catch(err => {

        document.getElementById('result').innerText =
            '❌ Erreur réseau : ' + err.message;
    });

    const display = document.getElementById('display');

    // Autorise la saisie clavier
    display.removeAttribute('readonly');

    /* ---------------------------------------
       Contrôle de la saisie
       --------------------------------------- */
    display.addEventListener('input', () => {

        // Garde uniquement les chiffres
        // et limite à 6 caractères
        display.value = display.value
            .replace(/[^0-9]/g, '')
            .slice(0, 6);

        checkLength();

        updateSaveButton();
        updateDeleteButton();
        updateSearchButton();

        // Recherche automatique à 6 chiffres
        if (display.value.length === 6) {
            searchbadge();
        }
    });

    /* ---------------------------------------
       Bloque les caractères non numériques
       --------------------------------------- */
    display.addEventListener('keydown', (e) => {

        const allowed = [
            'Backspace',
            'ArrowLeft',
            'ArrowRight',
            'Delete',
            'Tab'
        ];

        if (allowed.includes(e.key)) return;

        if (!/[0-9]/.test(e.key) || display.value.length >= 6) {
            e.preventDefault();
        }
    });

    // Mise à jour des textes des interrupteurs
    document.getElementById('formationCheck')
        .addEventListener('change', updateLabels);

    document.getElementById('visiteCheck')
        .addEventListener('change', updateLabels);

    updateLabels();

    /* ---------------------------------------
       Gestion du mode plein écran
       --------------------------------------- */
    updateFullscreenButton();

    document.addEventListener('fullscreenchange', () => {

        updateFullscreenButton();

        document.body.classList.toggle(
            'fullscreen',
            !!document.fullscreenElement
        );
    });

    // Restaure le plein écran si activé précédemment
    if (localStorage.getItem('fullscreen') === 'true') {
        toggleFullscreen();
    }
};

/* =======================================
   GESTION DE L'ÉTAT DES BOUTONS
   ======================================= */

// Active ou désactive le bouton Enregistrer
function updateSaveButton() {

    const len = document.getElementById('display').value.length;
    const sel = document.getElementById('badgeSelect').value;

    document.getElementById('savebtn').disabled =
        (len !== 6 && sel === '');
}

// Active ou désactive le bouton Rechercher
function updateSearchButton() {

    document.getElementById('searchbtn').disabled =
        document.getElementById('display').value.length !== 6;
}

// Active ou désactive le bouton Supprimer
function updateDeleteButton() {

    const len = document.getElementById('display').value.length;
    const sel = document.getElementById('badgeSelect').value;

    document.getElementById('deletebtn').disabled =
        (sel === '' && len !== 6);
}

// Active les interrupteurs
function enableSwitches() {

    document.getElementById('formationCheck').disabled = false;
    document.getElementById('visiteCheck').disabled = false;
}

// Désactive les interrupteurs
function disableSwitches() {

    document.getElementById('formationCheck').disabled = true;
    document.getElementById('visiteCheck').disabled = true;
}

/* =======================================
   CLAVIER NUMÉRIQUE
   ======================================= */

// Ajoute un chiffre à l'affichage
function addNumber(num) {

    const display = document.getElementById('display');

    if (display.value.length < 6) {

        display.value += num;

        checkLength();

        updateSaveButton();
        updateDeleteButton();
        updateSearchButton();

        // Recherche automatique
        if (display.value.length === 6) {
            searchbadge();
        }
    }
}

// Efface la saisie
function clearDisplay() {

    document.getElementById('display').value = '';
    document.getElementById('badgeSelect').value = '';

    currentBadgeExists = false;

    disableSwitches();

    updateSaveButton();
    updateDeleteButton();
    updateSearchButton();
}

// Vérifie si la longueur est correcte
function checkLength() {

    document.getElementById('display').value.length === 6
        ? enableSwitches()
        : disableSwitches();
}

// Vérifie qu'un badge contient exactement 6 chiffres
function isValidBadge() {

    return document.getElementById('display').value.length === 6;
}

/* =======================================
   RECHERCHE D'UN BADGE
   ======================================= */

function searchbadge() {

    if (!isValidBadge()) {

        document.getElementById('result').innerText =
            'Le badge doit contenir exactement 6 chiffres';

        disableSwitches();
        return;
    }

    const numbadge =
        document.getElementById('display').value;

    fetch(`${BASE_URL}/api/badge/${numbadge}`)

        .then(r => r.json())

        .then(data => {

            enableSwitches();

            // Chargement des états du badge
            document.getElementById('formationCheck').checked =
                data.formation;

            document.getElementById('visiteCheck').checked =
                data.visite_medical ?? data.visite;

            updateLabels();

            document.getElementById('result').innerText =
                data.exists
                    ? 'Badge existant chargé'
                    : 'Badge inexistant';

            currentBadgeExists = data.exists;
        })

        .catch(err => {

            document.getElementById('result').innerText =
                '❌ Erreur : ' + err.message;
        });
}

/* =======================================
   CHARGEMENT DEPUIS LA LISTE DÉROULANTE
   ======================================= */

function loadSelectedbadge() {

    const select =
        document.getElementById('badgeSelect');

    // Retour à l'état initial
    if (select.value === '') {

        document.getElementById('display').value = '';

        document.getElementById('formationCheck').checked = false;
        document.getElementById('visiteCheck').checked = false;

        disableSwitches();
        updateLabels();

        document.getElementById('result').innerText = '';

        updateSaveButton();
        updateDeleteButton();
        updateSearchButton();

        return;
    }

    // Charge le badge sélectionné
    document.getElementById('display').value =
        select.value;

    currentBadgeExists = true;

    searchbadge();

    updateSaveButton();
    updateDeleteButton();
    updateSearchButton();
}

/* =======================================
   ENREGISTREMENT D'UN BADGE
   ======================================= */

function savebadge() {

    if (!isValidBadge()) {

        document.getElementById('result').innerText =
            "Impossible d'enregistrer : 6 chiffres requis";

        return;
    }

    const numbadge =
        document.getElementById('display').value;

    const formation =
        document.getElementById('formationCheck').checked;

    const visite =
        document.getElementById('visiteCheck').checked;

    fetch(`${BASE_URL}/api/badge`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            numbadge,
            formation,
            visite_medical: visite
        })
    })

    .then(r => r.json())

    .then(data => {

        if (data.error) {

            document.getElementById('result').innerText =
                '❌ Erreur : ' + data.error;

            return;
        }

        refreshBadgeList('✅ Badge enregistré');
    })

    .catch(err => {

        document.getElementById('result').innerText =
            '❌ Erreur réseau : ' + err.message;
    });
}

/* =======================================
   SUPPRESSION D'UN BADGE
   ======================================= */

// Demande confirmation puis supprime un badge
function deletebadge() {

    const numbadge =
        document.getElementById('display').value ||
        document.getElementById('badgeSelect').value;

    if (numbadge.length !== 6) {

        document.getElementById('result').innerText =
            'Numéro invalide pour suppression';

        return;
    }

    showConfirm(
        `Supprimer le badge ${numbadge} ?`,
        (ok) => {

            if (!ok) return;

            fetch(`${BASE_URL}/api/badge/${numbadge}`, {
                method: 'DELETE'
            })

            .then(r => r.json())
            .then(data =>
                refreshBadgeList(
                    data.message || 'Supprimé'
                )
            )

            .catch(err => {

                document.getElementById('result').innerText =
                    '❌ Erreur : ' + err.message;
            });
        }
    );
}

/* =======================================
   SUPPRESSION DE TOUS LES BADGES
   ======================================= */

// Supprime la totalité des badges enregistrés
function deleteallbadges() {
    ...
}

/* =======================================
   ACTUALISATION DE LA LISTE
   ======================================= */

// Recharge la liste après ajout ou suppression
function refreshBadgeList(msg) {
    ...
}

/* =======================================
   MODE PLEIN ÉCRAN
   ======================================= */

// Active ou désactive le plein écran
function toggleFullscreen() {
    ...
}

// Met à jour le texte du bouton plein écran
function updateFullscreenButton() {
    ...
}

/* =======================================
   MISE À JOUR DES LIBELLÉS
   ======================================= */

// Change les textes selon l'état des interrupteurs
function updateLabels() {

    const formation =
        document.getElementById('formationCheck').checked;

    const visite =
        document.getElementById('visiteCheck').checked;

    document.getElementById('formationLabel').textContent =
        formation
            ? 'Formation valide'
            : 'Formation non valide';

    document.getElementById('visiteLabel').textContent =
        visite
            ? 'Visite médicale valide'
            : 'Visite médicale non valide';
}