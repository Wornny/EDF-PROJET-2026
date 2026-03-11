import { useEffect, useMemo, useRef, useState } from "react";
import "../styles/styleC2.css";

const DEFAULT_API_HOST = typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "localhost";
const DEFAULT_API_PROTOCOL = typeof window !== "undefined" && window.location.protocol === "https:" ? "https:" : "http:";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `${DEFAULT_API_PROTOCOL}//${DEFAULT_API_HOST}:3000`;

const SENSOR_LAYOUT = [
	{ num: 1, classes: "cap-c1 cap-c1r1" },
	{ num: 4, classes: "cap-c1 cap-c1r2" },
	{ num: 7, classes: "cap-c1 cap-c1r3" },
	{ num: 10, classes: "cap-c1 cap-c1r4" },
	{ num: 13, classes: "cap-c1 cap-c1r5" },
	{ num: 2, classes: "cap-c2 cap-c2r1" },
	{ num: 5, classes: "cap-c2 cap-c2r2" },
	{ num: 8, classes: "cap-c2 cap-c2r3" },
	{ num: 11, classes: "cap-c2 cap-c2r4" },
	{ num: 14, classes: "cap-c2 cap-c2r5" },
	{ num: 3, classes: "cap-c3 cap-c3r1" },
	{ num: 6, classes: "cap-c3 cap-c3r2" },
	{ num: 9, classes: "cap-c3 cap-c3r3" },
	{ num: 12, classes: "cap-c3 cap-c3r4" },
	{ num: 15, classes: "cap-c3 cap-c3r5" },
	{ num: 16, classes: "cap-colS-r1" },
	{ num: 17, classes: "cap-colS-r2" },
	{ num: 18, classes: "cap-colS-r3" },
	{ num: 19, classes: "cap-tri-top" },
	{ num: 20, classes: "cap-tri-left" },
	{ num: 21, classes: "cap-tri-right" },
	{ num: 25, classes: "cap-left-r1" },
	{ num: 26, classes: "cap-left-r2" },
	{ num: 27, classes: "cap-left-r3" },
	{ num: 28, classes: "cap-horizontal cap-top-center" },
	{ num: 22, classes: "cap-bottom-c1" },
	{ num: 23, classes: "cap-horizontal cap-bottom-c2" },
	{ num: 24, classes: "cap-bottom-c3" },
];

const GROUPS = {
	tete: [1, 2, 3, 25, 28],
	buste: [4, 5, 6, 7, 8, 9, 16, 26],
	jambes: [10, 11, 12, 13, 14, 15, 17, 18, 27],
	bras: [19, 20, 21],
	pieds: [22, 23, 24],
};

function parsePositiveInt(value, fallback = 1) {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeC2Id(value, fallback = 1) {
	const parsed = parsePositiveInt(value, fallback);
	if (parsed < 1 || parsed > 99) {
		return fallback;
	}
	return parsed;
}

function extractC2NumericId(value, fallback = 1) {
	const raw = String(value ?? "").trim();
	if (!raw) {
		return fallback;
	}

	const prefixed = raw.match(/^C2[\s_-]*(\d+)$/i);
	if (prefixed) {
		return normalizeC2Id(prefixed[1], fallback);
	}

	const groups = raw.match(/\d+/g);
	if (!groups || groups.length === 0) {
		return fallback;
	}

	return normalizeC2Id(groups[groups.length - 1], fallback);
}

function capId(mode, num) {
	return mode === "FACE" ? `c${num}` : `dos${num}`;
}

function createEmptyState() {
	const next = { FACE: {}, DOS: {} };
	for (let i = 1; i <= 28; i += 1) {
		next.FACE[capId("FACE", i)] = false;
		next.DOS[capId("DOS", i)] = false;
	}
	return next;
}

function createStateFromServer(fValues, dValues) {
	const next = createEmptyState();
	(fValues || []).forEach((value) => {
		const n = parsePositiveInt(value, NaN);
		if (Number.isFinite(n) && n >= 1 && n <= 28) {
			next.FACE[capId("FACE", n)] = true;
		}
	});
	(dValues || []).forEach((value) => {
		const n = parsePositiveInt(value, NaN);
		if (Number.isFinite(n) && n >= 1 && n <= 28) {
			next.DOS[capId("DOS", n)] = true;
		}
	});
	return next;
}

function getActiveNumbers(modeState, mode) {
	return Object.entries(modeState || {})
		.filter(([, active]) => Boolean(active))
		.map(([id]) => parsePositiveInt(id.replace(/\D/g, ""), NaN))
		.filter((n) => Number.isFinite(n))
		.sort((a, b) => a - b);
}

function C2({ c2Id = 1 }) {
	const [currentC2Id, setCurrentC2Id] = useState(() => normalizeC2Id(c2Id, 1));
	const [c2Ids, setC2Ids] = useState([1, 2]);
	const [c2Names, setC2Names] = useState({ 1: "C2 ID 1", 2: "C2 ID 2" });
	const [currentMode, setCurrentMode] = useState("FACE");
	const [capState, setCapState] = useState(createEmptyState);
	const [leftDrawerOpen, setLeftDrawerOpen] = useState(() => localStorage.getItem("drawerOpen") === "true");
	const [rightDrawerOpen, setRightDrawerOpen] = useState(() => localStorage.getItem("drawerRightOpen") === "true");
	const [modalOpen, setModalOpen] = useState(false);
	const [newDeviceName, setNewDeviceName] = useState("");
	const [modalError, setModalError] = useState("");

	const lastServerSignatureRef = useRef(null);
	const lastPublishedSignatureRef = useRef(null);

	const token = localStorage.getItem("authToken") || "";

	const authHeaders = useMemo(
		() => ({
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		}),
		[token],
	);

	useEffect(() => {
		document.body.classList.add("c2-page");
		return () => {
			document.body.classList.remove("c2-page");
		};
	}, []);

	useEffect(() => {
		setCurrentC2Id(normalizeC2Id(c2Id, 1));
	}, [c2Id]);

	useEffect(() => {
		localStorage.setItem("drawerOpen", String(leftDrawerOpen));
	}, [leftDrawerOpen]);

	useEffect(() => {
		localStorage.setItem("drawerRightOpen", String(rightDrawerOpen));
	}, [rightDrawerOpen]);

	useEffect(() => {
		window.history.replaceState({}, "", `/C2/${currentC2Id}`);
	}, [currentC2Id]);

	const publishFullState = (nextState, idToPublish) => {
		const F = getActiveNumbers(nextState.FACE, "FACE");
		const D = getActiveNumbers(nextState.DOS, "DOS");
		const signature = `C2_${idToPublish}|${F.join(",")}|${D.join(",")}`;
		if (signature === lastPublishedSignatureRef.current) {
			return;
		}
		lastPublishedSignatureRef.current = signature;

		fetch(`${API_BASE_URL}/api/c2/publish_capteurs_full`, {
			method: "POST",
			headers: authHeaders,
			body: JSON.stringify({
				c2_id: `C2_${idToPublish}`,
				F,
				D,
			}),
		}).catch(() => {
			lastPublishedSignatureRef.current = null;
		});
	};

	const updateCapState = (updater) => {
		setCapState((prevState) => {
			const nextState = {
				FACE: { ...prevState.FACE },
				DOS: { ...prevState.DOS },
			};
			updater(nextState);
			publishFullState(nextState, currentC2Id);
			return nextState;
		});
	};

	const fetchDeviceList = async () => {
		try {
			const response = await fetch(`${API_BASE_URL}/api/c2`, {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok || !payload?.ok) {
				return;
			}

			const ids = Array.isArray(payload.ids)
				? payload.ids
						.map((value) => parsePositiveInt(value, NaN))
						.filter((value) => Number.isFinite(value) && value >= 1 && value <= 99)
				: [];

			if (ids.length > 0) {
				setC2Ids(ids);
				setC2Names(payload.names || {});
				setCurrentC2Id((prev) => (ids.includes(prev) ? prev : ids[0]));
			}
		} catch {
			// Ignore temporary fetch errors.
		}
	};

	useEffect(() => {
		fetchDeviceList();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		let isCancelled = false;

		const pollServerState = async () => {
			try {
				const response = await fetch(`${API_BASE_URL}/api/c2/${currentC2Id}/state?_=${Date.now()}`, {
					cache: "no-store",
					headers: token ? { Authorization: `Bearer ${token}` } : {},
				});
				const payload = await response.json().catch(() => ({}));
				if (!response.ok || !payload?.ok || isCancelled) {
					return;
				}

				const serverId = extractC2NumericId(payload.c2_id ?? currentC2Id, currentC2Id);
				const F = Array.isArray(payload.F) ? payload.F : [];
				const D = Array.isArray(payload.D) ? payload.D : [];
				const signature = `C2_${serverId}|${F.join(",")}|${D.join(",")}`;
				if (signature === lastServerSignatureRef.current) {
					return;
				}

				lastServerSignatureRef.current = signature;
				setCurrentC2Id(serverId);
				setCapState(createStateFromServer(F, D));
			} catch {
				// Ignore temporary poll errors.
			}
		};

		pollServerState();
		const timer = setInterval(pollServerState, 1000);

		return () => {
			isCancelled = true;
			clearInterval(timer);
		};
	}, [currentC2Id, token]);

	const handleCapClick = (capteurId, mode) => {
		if (mode !== currentMode) {
			return;
		}
		updateCapState((nextState) => {
			nextState[mode][capteurId] = !nextState[mode][capteurId];
		});
	};

	const handleZoneToggle = (group) => {
		const numbers = GROUPS[group] || [];
		updateCapState((nextState) => {
			const ids = numbers.map((num) => capId(currentMode, num));
			const allActive = ids.every((id) => Boolean(nextState[currentMode][id]));
			const targetState = !allActive;
			ids.forEach((id) => {
				nextState[currentMode][id] = targetState;
			});
		});
	};

	const handleReset = () => {
		updateCapState((nextState) => {
			for (let i = 1; i <= 28; i += 1) {
				nextState.FACE[capId("FACE", i)] = false;
				nextState.DOS[capId("DOS", i)] = false;
			}
		});
	};

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
			const response = await fetch(`${API_BASE_URL}/api/c2/ajouter-appareil`, {
				method: "POST",
				headers: authHeaders,
				body: JSON.stringify({ name, type: "C2" }),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok || !payload?.ok) {
				setModalError(payload?.error || "Nom invalide.");
				return;
			}

			const extracted = name.match(/\d+/g);
			if (extracted && extracted.length > 0) {
				setCurrentC2Id(parsePositiveInt(extracted[extracted.length - 1], currentC2Id));
			}
			closeModal();
			fetchDeviceList();
		} catch {
			setModalError("Erreur serveur, reessaie.");
		}
	};

	const handleDeleteDevice = async (id) => {
		try {
			const response = await fetch(`${API_BASE_URL}/api/c2/supprimer-appareil`, {
				method: "POST",
				headers: authHeaders,
				body: JSON.stringify({ id }),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok || !payload?.ok) {
				window.alert(payload?.error || "Suppression impossible.");
				return;
			}

			const remainingIds = c2Ids.filter((item) => item !== id);
			if (remainingIds.length > 0) {
				setCurrentC2Id((prev) => (prev === id ? remainingIds[0] : prev));
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
							{c2Ids.map((id) => (
								<div className="id-item" key={id}>
									<button
										type="button"
										className={`id-btn ${currentC2Id === id ? "active" : ""}`}
										onClick={() => setCurrentC2Id(id)}
									>
										{c2Names[id] || `C2 ID ${id}`}
									</button>
									<button
										className="id-delete"
										type="button"
										data-id={id}
										title="Supprimer"
										onClick={() => handleDeleteDevice(id)}
									>
										<span className="id-delete-mark">-</span>
									</button>
								</div>
							))}
							<button className="id-btn id-add" id="id-add" type="button" title="Ajouter un appareil" onClick={openModal}>
								+
							</button>
						</div>
					</div>
					<div className="drawer-section" />
				</div>
			</div>

			<button
				className="drawer-toggle-btn"
				id="drawerToggle"
				type="button"
				onClick={() => setLeftDrawerOpen((prev) => !prev)}
			/>

			<div className={`drawer-right ${rightDrawerOpen ? "open" : ""}`} id="drawerRight">
				<div className="drawer-content" />
			</div>

			<button
				className="drawer-toggle-btn-right"
				id="drawerToggleRight"
				type="button"
				onClick={() => setRightDrawerOpen((prev) => !prev)}
			/>

			<div className="banner">
				<div className="banner-text" />
				<p className="c2-id-display">C2 Id : {currentC2Id}</p>
				<a className="home-link" href="/menu" title="Accueil" aria-label="Accueil">
					<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
						<path d="M3 10.5L12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5v-9Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
						<path d="M9 20v-6h6v6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
					</svg>
				</a>
				<button className="control-btn-reset" id="resetCapsBtn" type="button" title="Reinitialiser les capteurs" aria-label="Reinitialiser les capteurs" onClick={handleReset}>
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
						<path d="M6 7a7 7 0 1 1 2.05 9.9" />
						<polyline points="6 3 6 7 10 7" />
						<line x1="4" y1="20" x2="20" y2="4" />
					</svg>
				</button>
			</div>

			<div className="c2-wrapper">
				<div className="c2-container">
					<div id="page" />

					<div className="c2-container">
						{(["FACE", "DOS"]).map((mode) =>
							SENSOR_LAYOUT.map((sensor) => {
								const sensorId = capId(mode, sensor.num);
								const isHidden = mode !== currentMode;
								const isActive = Boolean(capState[mode][sensorId]);
								return (
									<button
										key={`${mode}-${sensor.num}`}
										className={`cap ${sensor.classes} ${isHidden ? "hidden-mode" : ""} ${isActive ? "active" : ""}`}
										data-capteur={sensorId}
										data-mode={mode}
										type="button"
										onClick={() => handleCapClick(sensorId, mode)}
									>
										<span>{sensor.num}</span>
									</button>
								);
							}),
						)}
					</div>

					<div className="body-container">
						<img src="/homme_face_blanc.png" className={`body-img body-img-face ${currentMode === "DOS" ? "hide-mode" : ""}`} alt="corps face" />
						<img src="/homme_dos_blanc.png" className={`body-img body-img-dos ${currentMode === "DOS" ? "show-mode" : "hidden-mode"}`} alt="corps dos" />

						<button className="body-zone zone-tete" type="button" data-group="tete" onClick={() => handleZoneToggle("tete")} />
						<button className="body-zone zone-bras" type="button" data-group="bras" onClick={() => handleZoneToggle("bras")} />
						<button className="body-zone zone-buste" type="button" data-group="buste" onClick={() => handleZoneToggle("buste")} />
						<button className="body-zone zone-jambes" type="button" data-group="jambes" onClick={() => handleZoneToggle("jambes")} />
						<button className="body-zone zone-pieds" type="button" data-group="pieds" onClick={() => handleZoneToggle("pieds")} />
					</div>
				</div>
			</div>

			<footer>
				<div className="banner-footer">
					<div className="control-group">
						<button className={`control-btn ${currentMode === "FACE" ? "active" : ""}`} data-mode="FACE" type="button" onClick={() => setCurrentMode("FACE")}>
							FACE
						</button>
						<button className={`control-btn ${currentMode === "DOS" ? "active" : ""}`} data-mode="DOS" type="button" onClick={() => setCurrentMode("DOS")}>
							DOS
						</button>
					</div>
				</div>
			</footer>

			<div className={`cm-modal ${modalOpen ? "open" : ""}`} id="cm-modal" aria-hidden={modalOpen ? "false" : "true"}>
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
							placeholder="Ex: C2 3"
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
						<input className="cm-modal-select" id="cm-modal-type" type="text" value="C2" readOnly />
					</div>
					<button className="cm-modal-submit" id="cm-modal-submit" type="button" onClick={handleAddDevice}>
						valider
					</button>
				</div>
			</div>
		</>
	);
}

export default C2;
