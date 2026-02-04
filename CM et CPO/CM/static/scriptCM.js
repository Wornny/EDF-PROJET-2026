// ================== CONTAMINATION DOM ==================
const jauge     = document.getElementById("jauge");
const valeur    = document.getElementById("valeur");
const valueBox  = document.getElementById("valueBox");
const mask      = document.getElementById("gaugeMask");
const triangle  = document.getElementById("gaugeTriangle");
const overlay   = document.querySelector(".gauge-overlay");
const gaugeBg   = document.getElementById("gaugeBg");

// ================== BRUIT DE FOND DOM ==================
const jauge_bdf     = document.getElementById("jauge_bdf");
const valeur_bdf    = document.getElementById("valeur_bdf");
const valueBox_bdf  = document.getElementById("valueBox_bdf");
const mask_bdf      = document.getElementById("gaugeMask_bdf");
const triangle_bdf  = document.getElementById("gaugeTriangle_bdf");
const overlay_bdf   = document.getElementById("gaugeOverlay_bdf");
const gaugeBg_bdf   = document.getElementById("gaugeBg_bdf");

// CM ID courant
const cmId = Number(document.body.dataset.cmId || "1");

// ================== CONSTANTES JAUGE ==================
const P0     = 0;
const P1     = 200;
const P10    = 400;
const P100   = 600;
const P1000  = 800;
const P10000 = 1000;

const TH_GREEN  = 10;
const TH_ORANGE = 100;

// ================== SLIDER -> VALEUR (log) ==================
function sliderToValue(pos) {
  const p = Number(pos);

  if (p <= P1) {
    const t = (p - P0) / (P1 - P0);
    return t * 1;
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

function formatValue(v) {
  if (v === 0) return "0";
  if (v < 1)      return v.toFixed(2);
  if (v < 10)     return v.toFixed(2);
  if (v < 100)    return v.toFixed(1);
  if (v < 1000)   return v.toFixed(0);
  if (v <= 10000) return v.toFixed(0);
  return v.toExponential(1);
}

function snap(raw) {
  if (Math.abs(raw - P1)     < 3) raw = P1;
  if (Math.abs(raw - P10)    < 3) raw = P10;
  if (Math.abs(raw - P100)   < 3) raw = P100;
  if (Math.abs(raw - P1000)  < 3) raw = P1000;
  if (Math.abs(raw - P10000) < 3) raw = P10000;
  return raw;
}

// ================== COULEURS ==================
function setValueBoxColor(boxEl, valNum) {
  if (!boxEl) return;

  boxEl.classList.remove("value-green", "value-orange", "value-red");
  if (valNum < TH_GREEN) boxEl.classList.add("value-green");
  else if (valNum < TH_ORANGE) boxEl.classList.add("value-orange");
  else boxEl.classList.add("value-red");
}

// ================== UPDATE JAUGE ==================
function updateGauge(raw, valeurEl, boxEl, maskEl, triangleEl, overlayEl) {
  const valNum = sliderToValue(raw);
  const valTxt = formatValue(valNum);

  if (valeurEl) valeurEl.textContent = valTxt;
  setValueBoxColor(boxEl, valNum);

  const percent = (raw / 1000) * 100;
  if (maskEl) maskEl.style.width = (100 - percent) + "%";
  if (triangleEl) triangleEl.style.left = percent + "%";
  if (overlayEl) overlayEl.style.setProperty("--tri-left", percent + "%");

  return valTxt;
}

// ================== RESTORE ==================
function restoreSliderFromDisplayedValue(sliderEl, valeurEl) {
  if (!sliderEl || !valeurEl) return;

  const txt = (valeurEl.textContent || "").trim().replace(",", ".");
  const target = Number(txt);

  if (!isFinite(target) || target < 0) {
    sliderEl.value = 0;
    return;
  }

  let bestPos = 0;
  let bestDiff = Infinity;

  for (let p = 0; p <= 1000; p++) {
    const v = sliderToValue(p);
    const diff = Math.abs(v - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestPos = p;
    }
  }

  sliderEl.value = bestPos;
}

// ================== ENVOI SERVEUR ==================
function sendValue(type, vTxt) {
  const data = new FormData();
  data.append("value", vTxt);
  data.append("equip", "Controller Mobile N°" + cmId);
  data.append("type", type);

  fetch(`/slider/${cmId}`, {
    method: "POST",
    body: data
  });
}

// ================== CLIC SUR BARRE ==================
function enableGaugeClick(gaugeBgEl, sliderEl, updateFn) {
  if (!gaugeBgEl || !sliderEl) return;

  gaugeBgEl.addEventListener("click", (e) => {
    const rect = gaugeBgEl.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    sliderEl.value = Math.round(ratio * 1000);
    updateFn(false);
  });
}

// ================== DRAWER ==================
function initDrawer() {
  const drawer = document.getElementById("drawer");
  const drawerToggle = document.getElementById("drawerToggle");
  const cmListToggle = document.getElementById("cm-list-toggle");
  const cmListWrap = document.getElementById("cm-list-wrap");
  
  if (!drawer || !drawerToggle) return;

  // Restaurer l'état du drawer depuis localStorage (et assurer variables CSS initiales cohérentes)
  const drawerOpen = localStorage.getItem("drawerOpen") === "true";
  if (drawerOpen) {
    drawer.classList.add("open");
    document.documentElement.style.setProperty('--drawer-initial', 'translateX(0)');
    document.documentElement.style.setProperty('--toggle-initial', '220px');
    document.documentElement.style.setProperty('--arrow-initial', 'scaleX(-1)');
  } else {
    drawer.classList.remove("open");
    document.documentElement.style.removeProperty('--drawer-initial');
    document.documentElement.style.setProperty('--toggle-initial', '0');
    document.documentElement.style.setProperty('--arrow-initial', 'scaleX(1)');
  }

  drawerToggle.addEventListener("click", () => {
    const willOpen = !drawer.classList.contains("open");
    drawer.classList.toggle("open");
    // Synchroniser localStorage
    localStorage.setItem("drawerOpen", willOpen);

    // Mettre à jour les variables pour que le bouton reflète immédiatement l'état
    if (willOpen) {
      document.documentElement.style.setProperty('--drawer-initial', 'translateX(0)');
      document.documentElement.style.setProperty('--toggle-initial', '220px');
      document.documentElement.style.setProperty('--arrow-initial', 'scaleX(-1)');
    } else {
      document.documentElement.style.removeProperty('--drawer-initial');
      document.documentElement.style.setProperty('--toggle-initial', '0');
      document.documentElement.style.setProperty('--arrow-initial', 'scaleX(1)');
    }
  });

  // Gestion de la liste déroulante des CM
  if (cmListToggle && cmListWrap) {
    const stored = localStorage.getItem('cmListOpen');
    const open = (stored === null) ? true : (stored === 'true');
    if (!open) {
      cmListWrap.classList.add('collapsed');
      cmListToggle.setAttribute('aria-expanded', 'false');
    } else {
      cmListWrap.classList.remove('collapsed');
      cmListToggle.setAttribute('aria-expanded', 'true');
    }

    cmListToggle.addEventListener('click', () => {
      const collapsed = cmListWrap.classList.toggle('collapsed');
      const nowOpen = !collapsed;
      cmListToggle.setAttribute('aria-expanded', String(nowOpen));
      localStorage.setItem('cmListOpen', String(nowOpen));
    });
  }
}

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", () => {
  initDrawer();

  // --- Contamination
  if (jauge) {
    restoreSliderFromDisplayedValue(jauge, valeur);

    const updateCont = (doSend=false) => {
      let raw = snap(Number(jauge.value));
      jauge.value = raw;
      const vTxt = updateGauge(raw, valeur, valueBox, mask, triangle, overlay);
      if (doSend) sendValue("Contamination", vTxt);
    };

    updateCont(false);

    jauge.addEventListener("input", () => updateCont(false));
    jauge.addEventListener("change", () => updateCont(false));
    enableGaugeClick(gaugeBg, jauge, updateCont);
  }

  // --- Bruit de Fond
  if (jauge_bdf) {
    restoreSliderFromDisplayedValue(jauge_bdf, valeur_bdf);

    const updateBdf = (doSend=false) => {
      let raw = snap(Number(jauge_bdf.value));
      jauge_bdf.value = raw;
      const vTxt = updateGauge(raw, valeur_bdf, valueBox_bdf, mask_bdf, triangle_bdf, overlay_bdf);
      if (doSend) sendValue("Bruit de fond", vTxt);
    };

    updateBdf(false);

    jauge_bdf.addEventListener("input", () => updateBdf(false));
    jauge_bdf.addEventListener("change", () => updateBdf(false));
    enableGaugeClick(gaugeBg_bdf, jauge_bdf, updateBdf);
  }

  // --- Bouton Envoyer
  const sendBtn = document.getElementById("sendBtn");
  if (sendBtn) {
    sendBtn.addEventListener("click", () => {
      const rawCont = snap(Number(jauge?.value || 0));
      const vTxtCont = formatValue(sliderToValue(rawCont));
      sendValue("Contamination", vTxtCont);

      const rawBdf = snap(Number(jauge_bdf?.value || 0));
      const vTxtBdf = formatValue(sliderToValue(rawBdf));
      sendValue("Bruit de fond", vTxtBdf);
    });
  }
});
