const jauge = document.getElementById("jauge");
const valeur = document.getElementById("valeur");
const valueBox = document.getElementById("valueBox");
const mask = document.getElementById("gaugeMask");
const triangle = document.getElementById("gaugeTriangle");
const overlay = document.querySelector(".gauge-overlay");
const gaugeBg = document.getElementById("gaugeBg");

const cpoId = Number(document.body.dataset.cpoId || "1");
const apiBase = document.body.dataset.apiBase || "";
const hasEquipment = document.body.dataset.hasEquipment === "1";
const rawMaxCpo = Number(document.body.dataset.maxCpo || "4");
const maxCpo = Number.isInteger(rawMaxCpo) && rawMaxCpo > 0 ? rawMaxCpo : 4;

const RAW_MAX = 10000;
const P0 = 0;
const P1 = 2000;
const P10 = 4000;
const P100 = 6000;
const P1000 = 8000;
const P10000 = RAW_MAX;

const TH_GREEN = 10;
const TH_ORANGE = 100;

let lastServerStateKey = null;

function clampRaw(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(RAW_MAX, Math.max(0, Math.round(numeric)));
}

function sliderToValue(position) {
  const p = clampRaw(position);

  if (p <= P1) {
    const t = (p - P0) / (P1 - P0);
    return t;
  }

  if (p <= P10) {
    const t = (p - P1) / (P10 - P1);
    const logVal = Math.log10(1) + t * (Math.log10(10) - Math.log10(1));
    return Math.pow(10, logVal);
  }

  if (p <= P100) {
    const t = (p - P10) / (P100 - P10);
    const logVal = Math.log10(10) + t * (Math.log10(100) - Math.log10(10));
    return Math.pow(10, logVal);
  }

  if (p <= P1000) {
    const t = (p - P100) / (P1000 - P100);
    const logVal = Math.log10(100) + t * (Math.log10(1000) - Math.log10(100));
    return Math.pow(10, logVal);
  }

  const t = (p - P1000) / (P10000 - P1000);
  const logVal = Math.log10(1000) + t * (Math.log10(10000) - Math.log10(1000));
  return Math.pow(10, logVal);
}

function formatValue(value) {
  if (value === 0) return "0";
  if (value < 1) return value.toFixed(2);
  if (value < 10) return value.toFixed(2);
  if (value < 100) return value.toFixed(1);
  if (value < 1000) return value.toFixed(0);
  if (value <= 10000) return value.toFixed(0);
  return value.toExponential(1);
}

function snap(rawValue) {
  return clampRaw(rawValue);
}

function normalizeDisplayValue(text) {
  return String(text || "")
    .replace(/Bq\/m²/gi, "")
    .replace(/Bq\/cm²/gi, "")
    .replace(/Bq/gi, "")
    .trim()
    .replace(",", ".");
}

function displayValueToRaw(displayValue) {
  const text = String(displayValue || "").trim().replace(",", ".");
  const target = Number(text);

  if (!Number.isFinite(target) || target < 0) {
    return 0;
  }

  let bestRaw = 0;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (let raw = 0; raw <= RAW_MAX; raw += 1) {
    const candidate = sliderToValue(raw);
    const diff = Math.abs(candidate - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestRaw = raw;
    }
  }

  return bestRaw;
}

function setValueBoxColor(boxEl, valueNum) {
  if (!boxEl) return;

  boxEl.classList.remove("value-green", "value-yellow", "value-orange", "value-red");
  if (valueNum < TH_GREEN) {
    boxEl.classList.add("value-green");
  } else if (valueNum < TH_ORANGE) {
    boxEl.classList.add("value-yellow");
  } else {
    boxEl.classList.add("value-red");
  }
}

function setGaugeTone(valueNum) {
  const toneClass = valueNum < TH_GREEN
    ? "gauge-tone-green"
    : valueNum < TH_ORANGE
      ? "gauge-tone-yellow"
      : "gauge-tone-red";

  if (gaugeBg) {
    gaugeBg.classList.remove("gauge-tone-green", "gauge-tone-yellow", "gauge-tone-red");
    gaugeBg.classList.add(toneClass);
  }

  if (triangle) {
    triangle.classList.remove("gauge-tone-green", "gauge-tone-yellow", "gauge-tone-red");
    triangle.classList.add(toneClass);
  }
}

function updateGauge(rawValue) {
  const raw = snap(rawValue);
  if (jauge) {
    jauge.value = raw;
  }

  const valueNum = sliderToValue(raw);
  const valueText = formatValue(valueNum);

  if (valeur) {
    valeur.textContent = `${valueText} Bq`;
  }
  setValueBoxColor(valueBox, valueNum);
  setGaugeTone(valueNum);

  const percent = (raw / RAW_MAX) * 100;
  if (mask) mask.style.width = `${100 - percent}%`;
  if (triangle) triangle.style.left = `${percent}%`;
  if (overlay) overlay.style.setProperty("--tri-left", `${percent}%`);

  return valueText;
}

function applyServerState(contamination) {
  if (typeof contamination !== "string") {
    return;
  }

  const normalized = normalizeDisplayValue(contamination);
  if (valeur) {
    valeur.textContent = `${normalized} Bq`;
  }

  if (jauge) {
    const raw = snap(displayValueToRaw(normalized));
    updateGauge(raw);
  }
}

function pollServerState() {
  fetch(`${apiBase}/state/${cpoId}?_=${Date.now()}`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  })
    .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
    .then(({ ok, json }) => {
      if (!ok || !json || json.ok !== true) return;

      const contamination = String(json.NivContamination ?? "");
      const nextKey = `${contamination}`;

      if (nextKey === lastServerStateKey) return;
      lastServerStateKey = nextKey;

      applyServerState(contamination);
    })
    .catch(() => {
      // Ignore temporary poll failures.
    });
}

function sendValue(type, valueText) {
  const data = new FormData();
  data.append("value", valueText);
  data.append("equip", `CPO ID ${cpoId}`);
  data.append("type", type);

  return fetch(`${apiBase}/slider/${cpoId}`, {
    method: "POST",
    body: data,
  }).catch(() => {
    // Ignore temporary network failures.
  });
}

function enableGaugePointer(gaugeBgEl, sliderEl, onRawChange) {
  if (!gaugeBgEl || !sliderEl || typeof onRawChange !== "function") return;

  let activePointerId = null;
  sliderEl.style.touchAction = "none";
  gaugeBgEl.style.touchAction = "none";

  const setFromClientX = (clientX) => {
    const rect = gaugeBgEl.getBoundingClientRect();
    if (rect.width <= 0) return;

    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    onRawChange(Math.round(ratio * RAW_MAX));
  };

  const onPointerDown = (event) => {
    activePointerId = event.pointerId;
    setFromClientX(event.clientX);
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (activePointerId !== event.pointerId) return;
    setFromClientX(event.clientX);
    event.preventDefault();
  };

  const onPointerUpOrCancel = (event) => {
    if (activePointerId !== event.pointerId) return;
    setFromClientX(event.clientX);
    activePointerId = null;
  };

  gaugeBgEl.addEventListener("pointerdown", onPointerDown);
  sliderEl.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUpOrCancel);
  window.addEventListener("pointercancel", onPointerUpOrCancel);
}

function enableFineTune(sliderEl, gaugeBgEl, onRawChange) {
  if (!sliderEl || !gaugeBgEl || typeof onRawChange !== "function") return;

  const applyDelta = (deltaRaw) => {
    const current = clampRaw(Number(sliderEl.value));
    onRawChange(current + deltaRaw);
  };

  const onWheel = (event) => {
    event.preventDefault();

    const direction = event.deltaY < 0 ? 1 : -1;
    const step = event.shiftKey ? 10 : 1;
    applyDelta(direction * step);
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      applyDelta(event.shiftKey ? 10 : 1);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      applyDelta(event.shiftKey ? -10 : -1);
      return;
    }
  };

  gaugeBgEl.addEventListener("wheel", onWheel, { passive: false });
  sliderEl.addEventListener("wheel", onWheel, { passive: false });
  sliderEl.addEventListener("keydown", onKeyDown);
}

function initDrawer() {
  const drawer = document.getElementById("drawer");
  const drawerToggle = document.getElementById("drawerToggle");
  if (!drawer || !drawerToggle) return;

  const drawerOpen = localStorage.getItem("drawerOpen") === "true";
  if (drawerOpen) {
    drawer.classList.add("open");
    document.documentElement.style.setProperty("--drawer-initial", "translateX(0)");
    document.documentElement.style.setProperty("--toggle-initial", "220px");
    document.documentElement.style.setProperty("--arrow-initial", "scaleX(-1)");
  } else {
    drawer.classList.remove("open");
    document.documentElement.style.removeProperty("--drawer-initial");
    document.documentElement.style.setProperty("--toggle-initial", "0");
    document.documentElement.style.setProperty("--arrow-initial", "scaleX(1)");
  }

  drawerToggle.addEventListener("click", () => {
    const willOpen = !drawer.classList.contains("open");
    drawer.classList.toggle("open", willOpen);
    localStorage.setItem("drawerOpen", String(willOpen));

    if (willOpen) {
      document.documentElement.style.setProperty("--drawer-initial", "translateX(0)");
      document.documentElement.style.setProperty("--toggle-initial", "220px");
      document.documentElement.style.setProperty("--arrow-initial", "scaleX(-1)");
    } else {
      document.documentElement.style.removeProperty("--drawer-initial");
      document.documentElement.style.setProperty("--toggle-initial", "0");
      document.documentElement.style.setProperty("--arrow-initial", "scaleX(1)");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initDrawer();

  if (hasEquipment) {
    pollServerState();
    setInterval(pollServerState, 1000);
  }

  if (hasEquipment && jauge) {
    const initialText = normalizeDisplayValue(valeur ? valeur.textContent : "0");
    const initialRaw = snap(displayValueToRaw(initialText));
    updateGauge(initialRaw);

    jauge.addEventListener("input", (event) => {
      updateGauge(Number(event.currentTarget.value));
    });

    jauge.addEventListener("change", (event) => {
      updateGauge(Number(event.currentTarget.value));
    });

    enableGaugePointer(gaugeBg, jauge, (raw) => {
      updateGauge(raw);
    });

    enableFineTune(jauge, gaugeBg, (raw) => {
      updateGauge(raw);
    });
  }

  const sendBtn = document.getElementById("sendBtn");
  if (hasEquipment && sendBtn) {
    sendBtn.addEventListener("click", () => {
      const contaminationRaw = snap(Number(jauge ? jauge.value : 0));
      const contaminationText = formatValue(sliderToValue(contaminationRaw));
      sendValue("Contamination", contaminationText);
    });
  }

  const addBtn = document.getElementById("id-add");
  const modal = document.getElementById("cm-modal");
  const modalClose = document.getElementById("cm-modal-close");
  const modalSubmit = document.getElementById("cm-modal-submit");
  const modalInput = document.getElementById("cm-modal-input");
  const modalId = document.getElementById("cm-modal-id");
  const modalError = document.getElementById("cm-modal-error");

  const buildAssignedCpoIds = () => {
    const ids = new Set();
    const links = document.querySelectorAll('.id-list .id-item .id-btn[href^="/CPO/"]');
    links.forEach((link) => {
      const href = String(link.getAttribute("href") || "");
      const match = href.match(/\/CPO\/(\d+)$/);
      if (!match) return;
      const id = Number(match[1]);
      if (Number.isInteger(id) && id >= 1 && id <= maxCpo) {
        ids.add(id);
      }
    });
    return ids;
  };

  const refreshAddButtonVisibility = () => {
    if (!addBtn) return;
    const assigned = buildAssignedCpoIds();
    const hasFreeSlot = assigned.size < maxCpo;
    addBtn.style.display = hasFreeSlot ? "" : "none";
  };

  const updateIdChoices = () => {
    if (!modalId) return;

    const assigned = buildAssignedCpoIds();
    modalId.innerHTML = "";

    for (let id = 1; id <= maxCpo; id += 1) {
      if (assigned.has(id)) continue;
      const option = document.createElement("option");
      option.value = String(id);
      option.textContent = String(id);
      modalId.appendChild(option);
    }
  };

  const setError = (message) => {
    if (!modalError) return;
    modalError.textContent = message || "";
  };

  const openModal = () => {
    if (!modal || !modalInput) return;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    modalInput.value = "";
    setError("");
    updateIdChoices();

    if (modalId && modalId.options.length === 0) {
      setError(`Tous les IDs 1 a ${maxCpo} sont deja utilises.`);
      return;
    }

    modalInput.focus();
  };

  const closeModal = () => {
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  };

  if (addBtn) {
    addBtn.addEventListener("click", (event) => {
      event.preventDefault();
      openModal();
    });
  }

  refreshAddButtonVisibility();

  if (modalClose) {
    modalClose.addEventListener("click", closeModal);
  }

  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });
  }

  if (modalSubmit) {
    modalSubmit.addEventListener("click", () => {
      const name = (modalInput && modalInput.value ? modalInput.value : "").trim();
      const selectedId = Number(modalId && modalId.value ? modalId.value : "");

      if (!name) {
        setError("Le nom est obligatoire.");
        if (modalInput) modalInput.focus();
        return;
      }

      if (!Number.isInteger(selectedId) || selectedId < 1 || selectedId > maxCpo) {
        setError(`Selectionne un ID valide (1 a ${maxCpo}).`);
        if (modalId) modalId.focus();
        return;
      }

      setError("");

      const data = new FormData();
      data.append("name", name);
      data.append("id", String(selectedId));

      fetch(`${apiBase}/ajouter-appareil`, {
        method: "POST",
        body: data,
      })
        .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
        .then(({ ok, json }) => {
          if (!ok || !json || !json.ok) {
            setError((json && json.error) || "Nom invalide.");
            if (modalInput) modalInput.focus();
            return;
          }

          closeModal();
          const createdId = Number(json.cpo_id);
          if (Number.isInteger(createdId) && createdId >= 1) {
            window.location.href = `${apiBase}/${createdId}`;
          } else {
            window.location.reload();
          }
        })
        .catch(() => {
          setError("Erreur serveur, reessaie.");
          if (modalInput) modalInput.focus();
        });
    });
  }

  if (modalInput) {
    modalInput.addEventListener("input", () => setError(""));
    modalInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (modalSubmit) modalSubmit.click();
      }
      if (event.key === "Escape") {
        closeModal();
      }
    });
  }

  const ensureDeleteModal = () => {
    let deleteModal = document.getElementById("cpo-delete-modal");
    if (!deleteModal) {
      deleteModal = document.createElement("div");
      deleteModal.id = "cpo-delete-modal";
      deleteModal.className = "cm-modal";
      deleteModal.setAttribute("aria-hidden", "true");
      deleteModal.innerHTML = `
        <div class="cm-modal-card" role="dialog" aria-modal="true" aria-labelledby="cpo-delete-title">
          <button class="cpo-modal-close" id="cpo-delete-close" aria-label="Fermer" type="button">X</button>
          <h3 class="cm-modal-title" id="cpo-delete-title">Confirmer la suppression</h3>
          <div class="cm-modal-row">
            <p class="cm-modal-label" id="cpo-delete-message" style="margin: 0;"></p>
          </div>
          <div class="cm-modal-row" style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px;">
            <button class="cm-modal-submit" id="cpo-delete-cancel" type="button">Annuler</button>
            <button class="cm-modal-submit" id="cpo-delete-confirm" type="button">Supprimer</button>
          </div>
        </div>
      `;
      document.body.appendChild(deleteModal);
    }

    return {
      modal: deleteModal,
      close: deleteModal.querySelector("#cpo-delete-close"),
      cancel: deleteModal.querySelector("#cpo-delete-cancel"),
      confirm: deleteModal.querySelector("#cpo-delete-confirm"),
      message: deleteModal.querySelector("#cpo-delete-message"),
    };
  };

  const askDeleteConfirmation = (id) => new Promise((resolve) => {
    const refs = ensureDeleteModal();
    if (!refs.modal || !refs.close || !refs.cancel || !refs.confirm || !refs.message) {
      resolve(false);
      return;
    }

    refs.message.textContent = `Supprimer l'equipement CPO ID ${id} ?`;

    const closeWith = (result) => {
      refs.modal.classList.remove("open");
      refs.modal.setAttribute("aria-hidden", "true");
      refs.close.removeEventListener("click", onCancel);
      refs.cancel.removeEventListener("click", onCancel);
      refs.confirm.removeEventListener("click", onConfirm);
      refs.modal.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onEsc);
      resolve(result);
    };

    const onCancel = () => closeWith(false);
    const onConfirm = () => closeWith(true);
    const onBackdrop = (event) => {
      if (event.target === refs.modal) closeWith(false);
    };
    const onEsc = (event) => {
      if (event.key === "Escape") closeWith(false);
    };

    refs.close.addEventListener("click", onCancel);
    refs.cancel.addEventListener("click", onCancel);
    refs.confirm.addEventListener("click", onConfirm);
    refs.modal.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onEsc);

    refs.modal.classList.add("open");
    refs.modal.setAttribute("aria-hidden", "false");
    refs.confirm.focus();
  });

  const deleteButtons = document.querySelectorAll(".id-delete");
  deleteButtons.forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const id = btn.getAttribute("data-id");
      if (!id) return;
      const confirmed = await askDeleteConfirmation(id);
      if (!confirmed) return;

      const data = new FormData();
      data.append("id", id);

      fetch(`${apiBase}/supprimer-appareil`, {
        method: "POST",
        body: data,
      })
        .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
        .then(({ ok, json }) => {
          if (!ok || !json || !json.ok) {
            alert((json && json.error) || "Suppression impossible.");
            return;
          }

          const deletedId = Number(id);
          if (deletedId === cpoId) {
            window.location.href = `${apiBase}/1`;
          } else {
            window.location.reload();
          }
        })
        .catch(() => {
          alert("Erreur serveur, reessaie.");
        });
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (modal && modal.classList.contains("open")) {
        closeModal();
      }
    }
  });

  const initHelpPanel = () => {
    const helpButton = document.getElementById("helpButton");
    const helpPanel = document.getElementById("helpPanel");
    const helpClose = document.getElementById("helpClose");
    if (!helpButton || !helpPanel || !helpClose) return;

    const openHelp = () => {
      helpPanel.classList.add("open");
      helpPanel.setAttribute("aria-hidden", "false");
      helpButton.setAttribute("aria-expanded", "true");
      helpClose.focus();
    };

    const closeHelp = () => {
      helpPanel.classList.remove("open");
      helpPanel.setAttribute("aria-hidden", "true");
      helpButton.setAttribute("aria-expanded", "false");
      helpButton.focus();
    };

    helpButton.addEventListener("click", () => {
      if (helpPanel.classList.contains("open")) {
        closeHelp();
      } else {
        openHelp();
      }
    });

    helpClose.addEventListener("click", closeHelp);

    helpPanel.addEventListener("click", (event) => {
      if (event.target === helpPanel) {
        closeHelp();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && helpPanel.classList.contains("open")) {
        closeHelp();
      }
    });
  };

  initHelpPanel();
});
