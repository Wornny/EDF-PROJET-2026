// ================== RÉFÉRENCES DOM ==================
const jauge     = document.getElementById("jauge");
const valeur    = document.getElementById("valeur");
const valueBox  = document.getElementById("valueBox");
const mask      = document.getElementById("gaugeMask");
const triangle  = document.getElementById("gaugeTriangle");
const overlay   = document.querySelector(".gauge-overlay");

// CM ID courant
const cmId = Number(document.body.dataset.cmId || "1");

// ================== CONSTANTES JAUGE ==================
const P0     = 0;
const P1     = 200;
const P10    = 400;
const P100   = 600;
const P1000  = 800;
const P10000 = 1000;

// ✅ seuils couleur (sur la valeur réelle)
// Vert < 10, Orange >= 10, Rouge >= 100
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

// ================== COULEUR VALUE-BOX ==================
function setValueBoxColor(valNum) {
  if (!valueBox) return;

  valueBox.classList.remove("value-green", "value-orange", "value-red");

  if (valNum < TH_GREEN) valueBox.classList.add("value-green");
  else if (valNum < TH_ORANGE) valueBox.classList.add("value-orange");
  else valueBox.classList.add("value-red");
}

// ================== UPDATE VISUEL ==================
function updateGaugeFromSlider() {
  if (!jauge || !valeur || !mask) return;

  let raw = Number(jauge.value);

  // snap positions clés
  if (Math.abs(raw - P1)     < 3) raw = P1;
  if (Math.abs(raw - P10)    < 3) raw = P10;
  if (Math.abs(raw - P100)   < 3) raw = P100;
  if (Math.abs(raw - P1000)  < 3) raw = P1000;
  if (Math.abs(raw - P10000) < 3) raw = P10000;

  jauge.value = raw;

  const valNum = sliderToValue(raw);
  const valTxt = formatValue(valNum);

  valeur.textContent = valTxt;
  setValueBoxColor(valNum);

  // masque 0..1000
  const percent = (raw / 1000) * 100;
  mask.style.width = (100 - percent) + "%";

  // triangle position
  if (triangle) triangle.style.left = percent + "%";

  // tige position (via variable css)
  if (overlay) overlay.style.setProperty("--tri-left", percent + "%");
}

// ================== ENVOI SERVEUR ==================
function sendValue() {
  if (!jauge) return;

  const v = formatValue(sliderToValue(jauge.value));

  const data = new FormData();
  data.append("value", v);
  data.append("equip", "Capteur Mobile N°" + cmId);
  data.append("type", "contamination");

  fetch(`/slider/${cmId}`, {
    method: "POST",
    body: data
  });
}

// ================== RESTAURATION VALEUR AU CHARGEMENT ==================
function restoreSliderFromDisplayedValue() {
  if (!jauge || !valeur) return;

  const txt = (valeur.textContent || "").trim().replace(",", ".");
  const target = Number(txt);

  if (!isFinite(target) || target < 0) {
    jauge.value = 0;
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

  jauge.value = bestPos;
}

// ================== DRAWER ==================
function initDrawer() {
  const sidePanel = document.getElementById("sidePanel");
  const drawerToggle = document.getElementById("drawerToggle");
  if (!sidePanel || !drawerToggle) return;

  let open = true;

  drawerToggle.addEventListener("click", () => {
    open = !open;
    sidePanel.classList.toggle("collapsed", !open);
    drawerToggle.textContent = open ? "◀" : "▶";
  });
}

// ================== ✅ CLIC SUR LA JAUGE (même zone blanche) ==================
function enableGaugeClick() {
  const gaugeBg = document.querySelector(".gauge-bg");
  if (!gaugeBg || !jauge) return;

  gaugeBg.addEventListener("click", (e) => {
    const rect = gaugeBg.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.min(Math.max(clickX / rect.width, 0), 1);

    // 0 → 1000 (même échelle que le slider)
    const newValue = Math.round(ratio * 1000);

    jauge.value = newValue;

    // met à jour visuellement
    updateGaugeFromSlider();

    // envoie au serveur (comme un vrai changement)
    sendValue();
  });
}

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", () => {
  if (!jauge) return;

  restoreSliderFromDisplayedValue();
  updateGaugeFromSlider();

  jauge.addEventListener("input", updateGaugeFromSlider);
  jauge.addEventListener("change", sendValue);

  initDrawer();

  // ✅ active le clic sur la barre
  enableGaugeClick();
});
