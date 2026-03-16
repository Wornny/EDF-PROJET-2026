import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../styles/styleCPO.css";

const DEFAULT_API_HOST = typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "localhost";
const DEFAULT_API_PROTOCOL = typeof window !== "undefined" && window.location.protocol === "https:" ? "https:" : "http:";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `${DEFAULT_API_PROTOCOL}//${DEFAULT_API_HOST}:3000`;

const P0 = 0;
const P1 = 200;
const P10 = 400;
const P100 = 600;
const P1000 = 800;
const P10000 = 1000;

const TH_GREEN = 10;
const TH_ORANGE = 100;

function parsePositiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeCpoId(value, fallback = 1) {
  const parsed = parsePositiveInt(value, fallback);
  if (parsed < 1 || parsed > 99) {
    return fallback;
  }
  return parsed;
}

function clampRaw(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(1000, Math.max(0, Math.round(numeric)));
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
  let raw = clampRaw(rawValue);
  if (Math.abs(raw - P1) < 3) raw = P1;
  if (Math.abs(raw - P10) < 3) raw = P10;
  if (Math.abs(raw - P100) < 3) raw = P100;
  if (Math.abs(raw - P1000) < 3) raw = P1000;
  if (Math.abs(raw - P10000) < 3) raw = P10000;
  return raw;
}

function displayValueToRaw(displayValue) {
  const text = String(displayValue ?? "").trim().replace(",", ".");
  const target = Number(text);

  if (!Number.isFinite(target) || target < 0) {
    return 0;
  }

  let bestRaw = 0;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (let raw = 0; raw <= 1000; raw += 1) {
    const candidate = sliderToValue(raw);
    const diff = Math.abs(candidate - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestRaw = raw;
    }
  }

  return bestRaw;
}

function valueClass(value) {
  if (value < TH_GREEN) {
    return "value-green";
  }
  if (value < TH_ORANGE) {
    return "value-orange";
  }
  return "value-red";
}

function useGaugePointer(gaugeBgRef, sliderRef, onRawChange) {
  useEffect(() => {
    const gaugeBgEl = gaugeBgRef.current;
    const sliderEl = sliderRef.current;
    if (!gaugeBgEl || !sliderEl) {
      return undefined;
    }

    let activePointerId = null;

    const setFromClientX = (clientX) => {
      const rect = gaugeBgEl.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }

      const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      onRawChange(Math.round(ratio * 1000));
    };

    const onPointerDown = (event) => {
      activePointerId = event.pointerId;
      setFromClientX(event.clientX);
      event.preventDefault();
    };

    const onPointerMove = (event) => {
      if (activePointerId !== event.pointerId) {
        return;
      }
      setFromClientX(event.clientX);
      event.preventDefault();
    };

    const onPointerUpOrCancel = (event) => {
      if (activePointerId !== event.pointerId) {
        return;
      }

      setFromClientX(event.clientX);
      activePointerId = null;
    };

    sliderEl.style.touchAction = "none";
    gaugeBgEl.style.touchAction = "none";

    gaugeBgEl.addEventListener("pointerdown", onPointerDown);
    sliderEl.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUpOrCancel);
    window.addEventListener("pointercancel", onPointerUpOrCancel);

    return () => {
      gaugeBgEl.removeEventListener("pointerdown", onPointerDown);
      sliderEl.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUpOrCancel);
      window.removeEventListener("pointercancel", onPointerUpOrCancel);
    };
  }, [gaugeBgRef, sliderRef, onRawChange]);
}

function CPO({ cpoId = 1 }) {
  const [currentCpoId, setCurrentCpoId] = useState(() => normalizeCpoId(cpoId, 1));
  const [cpoIds, setCpoIds] = useState([1, 2]);
  const [cpoNames, setCpoNames] = useState({ 1: "CPO ID 1", 2: "CPO ID 2" });
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(() => localStorage.getItem("drawerOpen") === "true");

  const [contaminationRaw, setContaminationRaw] = useState(P0);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalError, setModalError] = useState("");
  const [newDeviceName, setNewDeviceName] = useState("");

  const contaminationGaugeBgRef = useRef(null);
  const contaminationSliderRef = useRef(null);
  const lastServerStateRef = useRef(null);

  const token = localStorage.getItem("authToken") || "";

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [token],
  );

  const sendValue = useCallback(
    async (type, valueText) => {
      try {
        await fetch(`${API_BASE_URL}/api/cpo/${currentCpoId}/slider`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            value: valueText,
            equip: `CPO N°${currentCpoId}`,
            type,
          }),
        });
      } catch {
        // Ignore temporary network failures.
      }
    },
    [currentCpoId, authHeaders],
  );

  const updateContaminationRaw = useCallback((raw) => {
    setContaminationRaw(snap(raw));
  }, []);

  useGaugePointer(contaminationGaugeBgRef, contaminationSliderRef, updateContaminationRaw);

  useEffect(() => {
    document.body.classList.add("cpo-page");
    return () => {
      document.body.classList.remove("cpo-page");
    };
  }, []);

  useEffect(() => {
    setCurrentCpoId(normalizeCpoId(cpoId, 1));
  }, [cpoId]);

  useEffect(() => {
    localStorage.setItem("drawerOpen", String(leftDrawerOpen));
  }, [leftDrawerOpen]);

  useEffect(() => {
    window.history.replaceState({}, "", `/CPO/${currentCpoId}`);
  }, [currentCpoId]);

  const fetchDeviceList = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/cpo`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        return;
      }

      const ids = Array.isArray(payload.ids)
        ? payload.ids
            .map((value) => parsePositiveInt(value, Number.NaN))
            .filter((value) => Number.isFinite(value) && value >= 1 && value <= 99)
        : [];

      if (ids.length > 0) {
        setCpoIds(ids);
        setCpoNames(payload.names || {});
        setCurrentCpoId((prev) => (ids.includes(prev) ? prev : ids[0]));
      }
    } catch {
      // Ignore temporary fetch failures.
    }
  }, [token]);

  useEffect(() => {
    fetchDeviceList();
  }, [fetchDeviceList]);

  useEffect(() => {
    let cancelled = false;

    const pollServerState = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/cpo/${currentCpoId}/state?_=${Date.now()}`, {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok || cancelled) {
          return;
        }

        const serverId = normalizeCpoId(payload.cpoId ?? payload.cpo_id ?? currentCpoId, currentCpoId);
        const contamination = String(payload.NivContamination ?? "");
        const nextKey = `${serverId}|${contamination}`;
        if (nextKey === lastServerStateRef.current) {
          return;
        }

        lastServerStateRef.current = nextKey;
        setCurrentCpoId(serverId);
        setContaminationRaw(snap(displayValueToRaw(contamination)));
      } catch {
        // Ignore temporary poll failures.
      }
    };

    pollServerState();
    const timer = setInterval(pollServerState, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [currentCpoId, token]);

  useEffect(() => {
    if (!modalOpen) {
      return undefined;
    }

    const onEscape = (event) => {
      if (event.key === "Escape") {
        setModalOpen(false);
        setModalError("");
      }
    };

    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("keydown", onEscape);
    };
  }, [modalOpen]);

  const contaminationValue = sliderToValue(contaminationRaw);
  const contaminationPercent = (contaminationRaw / 1000) * 100;

  const openModal = () => {
    setModalError("");
    setNewDeviceName("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalError("");
  };

  const handleAddDevice = async () => {
    const name = newDeviceName.trim();
    if (!name) {
      setModalError("Le nom est obligatoire.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/cpo/ajouter-appareil`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name, type: "CPO" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        setModalError(payload?.error || "Nom invalide.");
        return;
      }

      const extracted = name.match(/\d+/g);
      if (extracted && extracted.length > 0) {
        setCurrentCpoId(parsePositiveInt(extracted[extracted.length - 1], currentCpoId));
      }

      closeModal();
      fetchDeviceList();
    } catch {
      setModalError("Erreur serveur, reessaie.");
    }
  };

  const handleDeleteDevice = async (id) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/cpo/supprimer-appareil`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        window.alert(payload?.error || "Suppression impossible.");
        return;
      }

      const remainingIds = cpoIds.filter((item) => item !== id);
      if (remainingIds.length > 0) {
        setCurrentCpoId((prev) => (prev === id ? remainingIds[0] : prev));
      }

      fetchDeviceList();
    } catch {
      window.alert("Erreur serveur, reessaie.");
    }
  };

  return (
    <>
      <div className={`drawer ${leftDrawerOpen ? "open" : ""}`} id="drawer">
        <div className="drawer-content">
          <h2>Panneau de Controle</h2>
          <div className="drawer-section">
            <div className="id-list">
              {cpoIds.map((id) => (
                <div className="id-item" key={id}>
                  <button
                    type="button"
                    className={`id-btn ${currentCpoId === id ? "active" : ""}`}
                    onClick={() => {
                      setCurrentCpoId(id);
                      lastServerStateRef.current = null;
                    }}
                  >
                    {cpoNames[id] || `CPO ID ${id}`}
                  </button>
                  <button type="button" className="id-delete" title="Supprimer" onClick={() => handleDeleteDevice(id)}>
                    <span className="id-delete-mark">-</span>
                  </button>
                </div>
              ))}
              <button type="button" className="id-btn id-add" id="id-add" title="Ajouter un appareil" onClick={openModal}>
                +
              </button>
            </div>
          </div>
        </div>
      </div>

      <button className="drawer-toggle-btn" id="drawerToggle" type="button" onClick={() => setLeftDrawerOpen((prev) => !prev)} />

      <div className="banner">
        <p className="cm-id-display">CPO ID : {currentCpoId}</p>
        <a className="home-link" href="/menu" title="Accueil" aria-label="Accueil">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M3 10.5L12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5v-9Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M9 20v-6h6v6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </a>
      </div>

      <div className="tablet">
        <div className="right-area">
          <div className="detector-panel">
            <div className="detector-title">
              <span>Niveau Contamination</span>
              <span className={`value-box ${valueClass(contaminationValue)}`} id="valueBox">
                <span id="valeur">{formatValue(contaminationValue)}</span>
              </span>
            </div>

            <div className="detector-content">
              <div className="beta-icon">β</div>
              <div className="gauge-zone">
                <div className="gauge-overlay" style={{ "--tri-left": `${contaminationPercent}%` }}>
                  <div className="gauge-triangle" id="gaugeTriangle" style={{ left: `${contaminationPercent}%` }} />
                </div>

                <div className="gauge-bg" id="gaugeBg" ref={contaminationGaugeBgRef}>
                  <div className="gauge-mask" id="gaugeMask" style={{ width: `${100 - contaminationPercent}%` }} />
                  <div className="gauge-separators">
                    <span style={{ left: "0%" }} />
                    <span style={{ left: "20%" }} />
                    <span style={{ left: "40%" }} />
                    <span style={{ left: "60%" }} />
                    <span style={{ left: "80%" }} />
                    <span style={{ left: "100%" }} />
                  </div>
                </div>

                <div className="scale">
                  <span style={{ left: "0%" }}>0</span>
                  <span style={{ left: "20%" }}>1</span>
                  <span style={{ left: "40%" }}>10</span>
                  <span style={{ left: "60%" }}>100</span>
                  <span style={{ left: "80%" }}>1000</span>
                  <span style={{ left: "100%" }}>C/S</span>
                </div>

                <input
                  type="range"
                  id="jauge"
                  min="0"
                  max="1000"
                  step="1"
                  value={contaminationRaw}
                  ref={contaminationSliderRef}
                  onInput={(event) => updateContaminationRaw(event.currentTarget.value)}
                  onChange={(event) => updateContaminationRaw(event.currentTarget.value)}
                />
              </div>

              <button
                type="button"
                className="send-btn"
                id="sendBtn"
                title="Envoyer les valeurs au MQTT"
                onClick={() => sendValue("Contamination", formatValue(sliderToValue(contaminationRaw)))}
              />
            </div>
          </div>
        </div>
      </div>

      <div
        className={`cm-modal ${modalOpen ? "open" : ""}`}
        id="cm-modal"
        aria-hidden={modalOpen ? "false" : "true"}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeModal();
          }
        }}
      >
        <div className="cm-modal-card" role="dialog" aria-modal="true" aria-labelledby="cm-modal-title">
          <button className="cm-modal-close" id="cm-modal-close" aria-label="Fermer" type="button" onClick={closeModal}>
            X
          </button>
          <h3 className="cm-modal-title" id="cm-modal-title">
            Ajouter un appareil
          </h3>
          <div className="cm-modal-row">
            <label className="cm-modal-label" htmlFor="cm-modal-input">
              Nom du nouvel appareil :
            </label>
            <input
              className="cm-modal-input"
              id="cm-modal-input"
              type="text"
              placeholder="Ex: CPO 3"
              value={newDeviceName}
              onChange={(event) => {
                setNewDeviceName(event.target.value);
                setModalError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAddDevice();
                }
                if (event.key === "Escape") {
                  closeModal();
                }
              }}
            />
            <div className="cm-modal-error" id="cm-modal-error" aria-live="polite">
              {modalError}
            </div>
          </div>
          <div className="cm-modal-row">
            <label className="cm-modal-label" htmlFor="cm-modal-type">
              Type :
            </label>
            <input className="cm-modal-select" id="cm-modal-type" type="text" value="CPO" readOnly />
          </div>
          <button className="cm-modal-submit" id="cm-modal-submit" type="button" onClick={handleAddDevice}>
            valider
          </button>
        </div>
      </div>
    </>
  );
}

export default CPO;