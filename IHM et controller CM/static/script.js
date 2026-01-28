// ================== RÉFÉRENCES DOM ==================
const jauge   = document.getElementById("jauge");
const valeur  = document.getElementById("valeur");
const mask    = document.getElementById("gaugeMask");
const cursor  = document.getElementById("gaugeCursor");
const cmId    = Number(document.body.dataset.cmId || "1");

// ================== CONSTANTES JAUGE ==================
const P0     = 0;
const P1     = 200;
const P10    = 400;
const P100   = 600;
const P1000  = 800;
const P10000 = 1000;

// ================== LOGIQUE SLIDER -> VALEUR ==================
function sliderToValue(pos) {
  const p = Number(pos);

  if (p <= P1) {
    return (p / P1);
  }

  if (p <= P10) {
    return Math.pow(10, Math.log10(1) + (p - P1) / (P10 - P1));
  }

  if (p <= P100) {
    return Math.pow(10, Math.log10(10) + (p - P10) / (P100 - P10));
  }

  if (p <= P1000) {
    return Math.pow(10, Math.log10(100) + (p - P100) / (P1000 - P100));
  }

  return Math.pow(10, Math.log10(1000) + (p - P1000) / (P10000 - P1000));
}

function formatValue(v) {
  if (v < 1) return v.toFixed(2);
  if (v < 10) return v.toFixed(2);
  if (v < 100) return v.toFixed(1);
  return v.toFixed(0);
}

// ================== MISE À JOUR VISUELLE ==================
function updateGaugeFromSlider() {
  let raw = Number(jauge.value);

  const val = sliderToValue(raw);
  valeur.textContent = formatValue(val);

  const percent = (raw / 1000) * 100;

  mask.style.width = (100 - percent) + "%";

  // ✅ déplacement du curseur
  cursor.style.left = percent + "%";
}

// ================== ENVOI FLASK ==================
function sendValue() {
  const data = new FormData();
  data.append("value", formatValue(sliderToValue(jauge.value)));
  data.append("equip", "Capteur Mobile N°" + cmId);
  data.append("type", "contamination");

  fetch(`/slider/${cmId}`, {
    method: "POST",
    body: data
  });
}

// ================== DRAWER ==================
function initDrawer() {
  const sidePanel = document.getElementById("sidePanel");
  const drawerToggle = document.getElementById("drawerToggle");

  let open = true;

  drawerToggle.addEventListener("click", () => {
    open = !open;
    sidePanel.classList.toggle("collapsed", !open);
    drawerToggle.textContent = open ? "◀" : "▶";
  });
}

// ================== INIT GLOBAL ==================
document.addEventListener("DOMContentLoaded", () => {
  jauge.addEventListener("input", updateGaugeFromSlider);
  jauge.addEventListener("change", sendValue);
  updateGaugeFromSlider();
  initDrawer();
});
