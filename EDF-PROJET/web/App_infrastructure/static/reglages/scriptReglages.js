// Script de la page Réglages.
// Gère la validation des formulaires, l'ajout/suppression d'utilisateurs et l'envoi des modifications.

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

  for (const [label, val, max] of [['Valeur 1', valeur1, 16], ['Valeur 2', valeur2, 6], ['Valeur 3', valeur3, 6]]) {
    if (val === null) continue;
    if (isNaN(val)) {
      showError(`${label} doit être un nombre valide.`);
      return;
    }
    if (val <= 0) {
      showError(`${label} doit être strictement supérieur à 0.`);
      return;
    }
    if (val > max) {
      if (label === 'Valeur 1') {
        showError('erreur vous pouvez définir au maximum 16 contrôleurs mobiles');
      } else if (label === 'Valeur 2') {
        showError('erreur vous pouvez définir au maximum 6 CPO');
      } else if (label === 'Valeur 3') {
        showError('erreur vous pouvez définir au maximum 6 C2');
      }
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
      // Mettre à jour les placeholders avec les nouvelles valeurs et vider les champs
      const nomInput = document.getElementById('reglages-nom');
      const v1Input = document.getElementById('reglages-valeur1');
      const v2Input = document.getElementById('reglages-valeur2');
      const v3Input = document.getElementById('reglages-valeur3');
      if (nom) nomInput.placeholder = nom;
      if (valeur1 !== null) v1Input.placeholder = String(valeur1);
      if (valeur2 !== null) v2Input.placeholder = String(valeur2);
      if (valeur3 !== null) v3Input.placeholder = String(valeur3);
      nomInput.value = '';
      v1Input.value = '';
      v2Input.value = '';
      v3Input.value = '';

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

const userErrorBox = document.getElementById('user-error');
const userAddButton = document.getElementById('user-add-submit');
const userNameInput = document.getElementById('user-add-username');
const userPasswordInput = document.getElementById('user-add-password');
const userRoleInput = document.getElementById('user-add-role');
const userSelectDropdown = document.getElementById('user-select');
const userDeleteBtn = document.getElementById('user-delete-btn');
let selectedUserId = null;

if (userSelectDropdown && userDeleteBtn) {
  const trigger = userSelectDropdown.querySelector('.custom-select-trigger');
  const valueEl = userSelectDropdown.querySelector('.custom-select-value');
  const options = userSelectDropdown.querySelectorAll('.custom-select-option');

  trigger.addEventListener('click', () => {
    userSelectDropdown.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!userSelectDropdown.contains(e.target)) {
      userSelectDropdown.classList.remove('open');
    }
  });

  options.forEach((opt) => {
    if (opt.classList.contains('disabled')) return;
    opt.addEventListener('click', () => {
      options.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedUserId = opt.getAttribute('data-value');
      valueEl.textContent = opt.textContent.trim();
      valueEl.classList.add('selected');
      userDeleteBtn.disabled = false;
      userSelectDropdown.classList.remove('open');
    });
  });

  userDeleteBtn.addEventListener('click', () => {
    if (!selectedUserId) return;
    const selectedOption = userSelectDropdown.querySelector(`.custom-select-option[data-value="${selectedUserId}"]`);
    const username = selectedOption ? selectedOption.getAttribute('data-username') : '';
    openDeleteModal(selectedUserId, username || 'cet utilisateur');
  });
}

function showUserError(msg) {
  if (userErrorBox) {
    userErrorBox.textContent = msg;
  }
}

function clearUserError() {
  if (userErrorBox) {
    userErrorBox.textContent = '';
  }
}

if (userAddButton) {
  userAddButton.addEventListener('click', async () => {
    clearUserError();

    const username = userNameInput ? userNameInput.value.trim() : '';
    const password = userPasswordInput ? userPasswordInput.value : '';
    const role = userRoleInput ? userRoleInput.value : 'user';

    if (!username) {
      showUserError("Nom d'utilisateur requis.");
      return;
    }
    if (!password || password.length < 6) {
      showUserError('Mot de passe requis (6 caractères minimum).');
      return;
    }

    userAddButton.disabled = true;

    try {
      const resp = await fetch('/reglages/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role }),
      });

      if (resp.ok) {
        window.location.reload();
        return;
      }

      const data = await resp.json().catch(() => ({}));
      showUserError(data.error || `Erreur ${resp.status}`);
    } catch {
      showUserError('Erreur réseau. Vérifiez votre connexion.');
    } finally {
      userAddButton.disabled = false;
    }
  });
}

const userDeleteModal = document.getElementById('user-delete-modal');
const userDeleteModalClose = document.getElementById('user-delete-modal-close');
const userDeleteCancel = document.getElementById('user-delete-cancel');
const userDeleteConfirm = document.getElementById('user-delete-confirm');
const userDeleteError = document.getElementById('user-delete-error');
let userDeleteTargetId = null;

function openDeleteModal(userId, username) {
  userDeleteTargetId = userId;
  if (userDeleteError) {
    userDeleteError.textContent = '';
  }
  if (userDeleteModal) {
    userDeleteModal.classList.add('open');
    userDeleteModal.setAttribute('aria-hidden', 'false');
  }
}

function closeDeleteModal() {
  userDeleteTargetId = null;
  if (userDeleteModal) {
    userDeleteModal.classList.remove('open');
    userDeleteModal.setAttribute('aria-hidden', 'true');
  }
  if (userDeleteError) {
    userDeleteError.textContent = '';
  }
}

function showDeleteError(message) {
  if (userDeleteError) {
    userDeleteError.textContent = message;
  }
}

if (userDeleteModalClose) {
  userDeleteModalClose.addEventListener('click', closeDeleteModal);
}

if (userDeleteCancel) {
  userDeleteCancel.addEventListener('click', closeDeleteModal);
}

if (userDeleteModal) {
  userDeleteModal.addEventListener('click', (event) => {
    if (event.target === userDeleteModal) {
      closeDeleteModal();
    }
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && userDeleteModal && userDeleteModal.classList.contains('open')) {
    closeDeleteModal();
  }
});

if (userDeleteConfirm) {
  userDeleteConfirm.addEventListener('click', async () => {
    if (!userDeleteTargetId) {
      closeDeleteModal();
      return;
    }

    userDeleteConfirm.disabled = true;
    showDeleteError('');

    try {
      const resp = await fetch(`/reglages/users/${encodeURIComponent(userDeleteTargetId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      if (resp.ok) {
        window.location.reload();
        return;
      }

      const data = await resp.json().catch(() => ({}));
      showDeleteError(data.error || `Erreur ${resp.status}`);
    } catch {
      showDeleteError('Erreur réseau. Vérifiez votre connexion.');
    } finally {
      userDeleteConfirm.disabled = false;
    }
  });
}


