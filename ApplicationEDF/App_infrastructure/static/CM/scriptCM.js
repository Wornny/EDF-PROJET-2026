const jauge = document.getElementById("jauge");
const valeur = document.getElementById("valeur");
const valueBox = document.getElementById("valueBox");
const mask = document.getElementById("gaugeMask");
const triangle = document.getElementById("gaugeTriangle");
const overlay = document.querySelector(".gauge-overlay");
const gaugeBg = document.getElementById("gaugeBg");

const cmId = Number(document.body.dataset.cmId || "1");
const apiBase = document.body.dataset.apiBase || "";

let hasPendingContamination = false;
let hasPendingStatus = false;
let currentStatus = "0";
let isSendPressed = false;
let sendPointerId = null;

const RAW_MAX = 10000;
const P0 = 0;
const P1 = 2000;
const P10 = 4000;
const P100 = 6000;
const P1000 = 8000;
const P3000 = RAW_MAX;
const MAX_CONTAMINATION_VALUE = 3000;

const TH_GREEN = 10;
const TH_ORANGE = 100;

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

  const t = (p - P1000) / (P3000 - P1000);
  const logVal = Math.log10(1000) + t * (Math.log10(MAX_CONTAMINATION_VALUE) - Math.log10(1000));
  return Math.min(MAX_CONTAMINATION_VALUE, Math.pow(10, logVal));
}

function formatValue(value) {
  const epsilon = Number.EPSILON * MAX_CONTAMINATION_VALUE * 10;
  const normalized = value > MAX_CONTAMINATION_VALUE && value <= MAX_CONTAMINATION_VALUE + epsilon
    ? MAX_CONTAMINATION_VALUE
    : value;

  if (normalized === 0) return "0";
  if (normalized < 1) return normalized.toFixed(2);
  if (normalized < 10) return normalized.toFixed(2);
  if (normalized < 100) return normalized.toFixed(1);
  if (normalized < 1000) return normalized.toFixed(0);
  if (normalized <= MAX_CONTAMINATION_VALUE) return normalized.toFixed(0);
  return normalized.toExponential(1);
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

function restoreSliderFromDisplayedValue(sliderEl, valueEl) {
  if (!sliderEl || !valueEl) return;

  const target = Number(normalizeDisplayValue(valueEl.textContent));
  if (!Number.isFinite(target) || target < 0) {
    sliderEl.value = 0;
    return;
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

  sliderEl.value = bestRaw;
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
    valeur.textContent = `${valueText} Bq/cm²`;
  }
  setValueBoxColor(valueBox, valueNum);
  setGaugeTone(valueNum);

  const percent = (raw / RAW_MAX) * 100;
  if (mask) mask.style.width = `${100 - percent}%`;
  if (triangle) triangle.style.left = `${percent}%`;
  if (overlay) overlay.style.setProperty("--tri-left", `${percent}%`);

  return valueText;
}

function updateSendButtonState() {
  const sendBtn = document.getElementById("sendBtn");
  if (!sendBtn) return;

  const isActive = currentStatus === "1";
  sendBtn.classList.toggle("is-active", isActive);
  sendBtn.setAttribute("aria-pressed", isActive ? "true" : "false");
}

function setStatus(nextStatus) {
  currentStatus = String(nextStatus).trim() === "1" ? "1" : "0";
  updateSendButtonState();
}

function sendValue(type, valueText) {
  const data = new FormData();
  data.append("value", valueText);
  data.append("equip", `Controller Mobile N°${cmId}`);
  data.append("type", type);

  return fetch(`${apiBase}/slider/${cmId}`, {
    method: "POST",
    body: data,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("Request failed");
      }

      if (type === "Contamination") {
        hasPendingContamination = false;
      }
      if (type === "Status") {
        hasPendingStatus = false;
      }
    })
    .catch(() => {
      // Ignore temporary network failures.
    });
}

function applyServerState(contamination, status) {
  if (!hasPendingContamination && typeof contamination === "string" && valeur) {
    valeur.textContent = `${normalizeDisplayValue(contamination)} Bq/cm²`;
    if (jauge) {
      restoreSliderFromDisplayedValue(jauge, valeur);
      updateGauge(Number(jauge.value));
    }
  }

  if (!hasPendingStatus && typeof status !== "undefined") {
    setStatus(status);
  }
}

let lastServerStateKey = null;
function pollServerState() {
  fetch(`${apiBase}/state/${cmId}?_=${Date.now()}`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  })
    .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
    .then(({ ok, json }) => {
      if (!ok || !json || json.ok !== true) return;

      const contamination = String(json.NivContamination ?? "");
      const status = String(json.Status ?? "0");
      const nextKey = `${contamination}|${status}`;

      if (nextKey === lastServerStateKey) return;
      lastServerStateKey = nextKey;

      applyServerState(contamination, status);
    })
    .catch(() => {
      // Ignore temporary poll failures.
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

  pollServerState();
  setInterval(pollServerState, 1000);

  if (jauge) {
    restoreSliderFromDisplayedValue(jauge, valeur);
    updateGauge(Number(jauge.value));

    jauge.addEventListener("input", (event) => {
      hasPendingContamination = true;
      updateGauge(Number(event.currentTarget.value));
    });

    jauge.addEventListener("change", (event) => {
      hasPendingContamination = true;
      updateGauge(Number(event.currentTarget.value));
    });

    enableGaugePointer(gaugeBg, jauge, (raw) => {
      hasPendingContamination = true;
      updateGauge(raw);
    });

    enableFineTune(jauge, gaugeBg, (raw) => {
      hasPendingContamination = true;
      updateGauge(raw);
    });
  }

  const sendBtn = document.getElementById("sendBtn");
  if (sendBtn) {
    const sendPressStart = () => {
      if (isSendPressed) return;
      isSendPressed = true;

      const contaminationRaw = snap(Number(jauge ? jauge.value : 0));
      const contaminationText = formatValue(sliderToValue(contaminationRaw));

      hasPendingContamination = true;
      hasPendingStatus = true;
      setStatus("1");

      Promise.all([
        sendValue("Contamination", contaminationText),
        sendValue("Status", "1"),
      ]).catch(() => {
        // Keep optimistic local state until next server poll.
      });
    };

    const sendPressEnd = () => {
      if (!isSendPressed) return;
      isSendPressed = false;

      hasPendingStatus = true;
      setStatus("0");
      sendValue("Status", "0").catch(() => {
        // Keep optimistic local state until next server poll.
      });
    };

    sendBtn.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;

      sendPointerId = event.pointerId;
      sendPressStart();
      if (typeof sendBtn.setPointerCapture === "function") {
        sendBtn.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
    });

    sendBtn.addEventListener("pointerup", (event) => {
      if (sendPointerId !== event.pointerId) return;
      sendPointerId = null;
      sendPressEnd();
    });

    sendBtn.addEventListener("pointercancel", (event) => {
      if (sendPointerId !== event.pointerId) return;
      sendPointerId = null;
      sendPressEnd();
    });

    sendBtn.addEventListener("lostpointercapture", () => {
      sendPointerId = null;
      sendPressEnd();
    });

    sendBtn.addEventListener("keydown", (event) => {
      if (event.repeat) return;
      if (event.key !== " " && event.key !== "Enter") return;
      sendPressStart();
      event.preventDefault();
    });

    sendBtn.addEventListener("keyup", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      sendPressEnd();
      event.preventDefault();
    });

    sendBtn.addEventListener("blur", () => {
      sendPressEnd();
    });

    window.addEventListener("blur", () => {
      sendPointerId = null;
      sendPressEnd();
    });
  }

  const addBtn = document.getElementById("id-add");
  const modal = document.getElementById("cm-modal");
  const modalClose = document.getElementById("cm-modal-close");
  const modalSubmit = document.getElementById("cm-modal-submit");
  const modalInput = document.getElementById("cm-modal-input");
  const modalType = document.getElementById("cm-modal-type");
  const modalError = document.getElementById("cm-modal-error");

  const updatePlaceholder = () => {
    if (!modalInput || !modalType) return;
    const type = modalType.value || "CM";
    modalInput.placeholder = `Ex: ${type} 3`;
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
    updatePlaceholder();
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
      const type = (modalType && modalType.value ? modalType.value : "CM").trim();

      if (!name) {
        setError("Le nom est obligatoire.");
        if (modalInput) modalInput.focus();
        return;
      }

      setError("");

      const data = new FormData();
      data.append("name", name);
      data.append("type", type);

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
          window.location.reload();
        })
        .catch(() => {
          setError("Erreur serveur, reessaie.");
          if (modalInput) modalInput.focus();
        });
    });
  }

  if (modalType) {
    modalType.addEventListener("change", updatePlaceholder);
  }

  if (modalInput) {
    modalInput.addEventListener("input", () => setError(""));
  }

  if (modal) {
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (modalSubmit) modalSubmit.click();
      }
    });
  }

  const deleteButtons = document.querySelectorAll(".id-delete");
  deleteButtons.forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const id = btn.getAttribute("data-id");
      if (!id) return;

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
          if (deletedId === cmId) {
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
        modal.classList.remove("open");
        modal.setAttribute("aria-hidden", "true");
      }
    }
  });
});
