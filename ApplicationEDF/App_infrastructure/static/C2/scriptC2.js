document.addEventListener('DOMContentLoaded', () => {
	if (window.__c2PageInitialized) {
		return;
	}
	window.__c2PageInitialized = true;

    let C2_ID = document.body.dataset.c2Id || 'C2_1';
	const apiBase = '/C2';

	function normalizeGenderValue(value) {
		const raw = String(value || '').trim().toLowerCase();
		if (raw === 'f' || raw === 'femme') return 'femme';
		return 'homme';
	}

	function normalizeGenderCode(value) {
		return normalizeGenderValue(value) === 'femme' ? 'F' : 'M';
	}

	function formatC2DisplayId(value) {
		const n = extractC2NumericId(value);
		if (!Number.isFinite(n) || n < 1) return '1';
		return String(n);
	}

	function extractC2NumericId(value) {
		const raw = String(value || '').trim();
		if (!raw) return 1;

		const prefixed = raw.match(/^C2[\s_-]*(\d+)$/i);
		if (prefixed) {
			const n = Number(prefixed[1]);
			return Number.isFinite(n) ? n : 1;
		}

		const groups = raw.match(/\d+/g);
		if (!groups || groups.length === 0) return 1;
		const n = Number(groups[groups.length - 1]);
		return Number.isFinite(n) ? n : 1;
	}

	function applyServerCapteursState(fValues, dValues, genderCode) {
		const setF = new Set((fValues || []).map(v => Number(v)).filter(Number.isFinite));
		const setD = new Set((dValues || []).map(v => Number(v)).filter(Number.isFinite));
		currentGender = normalizeGenderValue(genderCode || currentGender);

		caps.forEach(btn => {
			const id = btn.dataset.capteur;
			const mode = btn.dataset.mode;
			if (!id || !mode) return;

			const n = parseInt(id.replace(/\D/g, ''), 10);
			if (Number.isNaN(n)) return;

			const active = mode === 'FACE' ? setF.has(n) : setD.has(n);
			btn.classList.toggle('active', active);
			stateCapteurs[mode][id] = active;
		});

		applyGenderUI(currentGender);
		updateAllZoneVisuals();
		updateDrawer();
	}

	let lastServerSignature = null;
	function pollServerState() {
		const currentId = extractC2NumericId(C2_ID);
		if (!Number.isFinite(currentId) || currentId < 1) return;

		fetch(`${apiBase}/state/${currentId}?_=${Date.now()}`, {
			cache: 'no-store',
			headers: { 'Cache-Control': 'no-cache' }
		})
			.then((res) => res.json().then((json) => ({ ok: res.ok, json })))
			.then(({ ok, json }) => {
				if (!ok || !json?.ok) return;

				const rawServerId = json.c2_id || `C2_${currentId}`;
				const normalizedDisplay = formatC2DisplayId(rawServerId);
				const nextC2Id = `C2_${normalizedDisplay}`;
				const fList = Array.isArray(json.F) ? json.F : [];
				const dList = Array.isArray(json.D) ? json.D : [];
				const genderCode = normalizeGenderCode(json.genre || document.body.dataset.c2Gender);
				const signature = `${nextC2Id}|${fList.join(',')}|${dList.join(',')}|${genderCode}`;

				if (signature === lastServerSignature) return;
				lastServerSignature = signature;

				C2_ID = nextC2Id;
				document.body.dataset.c2Gender = normalizeGenderValue(genderCode);
				const banner = document.querySelector('.c2-id-display');
				if (banner) banner.textContent = `C2 Id : ${normalizedDisplay}`;
				applyServerCapteursState(fList, dList, genderCode);
			})
			.catch(() => {});
	}


    function setC2Id(newId) {
        C2_ID = newId;
        const bannerText = document.querySelector('.c2-id-display');
        if (bannerText) {
	           bannerText.textContent = `C2 Id : ${formatC2DisplayId(newId)}`;
        }
	       pollServerState();
    }


    // état global: garder l'état de chaque mode séparément
    const stateCapteurs = {
        FACE: {},
        DOS: {}
    };


    // mode actuel (FACE ou DOS)
    let currentMode = 'FACE';

    // genre actuel (homme ou femme)
	let currentGender = normalizeGenderValue(document.body.dataset.c2Gender || 'homme');


    // mapping zones du corps → liste d'ID de capteurs (FACE)
    const GROUPS_FACE = {
        tete:  ['c15', 'c16', 'c17','c24','c27'],
        buste: ['c9', 'c10', 'c11', 'c12', 'c13', 'c14','c18','c28'],
        jambes:['c3', 'c4', 'c5', 'c6', 'c7', 'c8','c19', 'c20','c29'],
        bras: ['c21', 'c22', 'c23'],
		pieds: ['c1', 'c2', 'c25']
    };


    // mapping zones du corps → liste d'ID de capteurs (DOS)
    const GROUPS_DOS = {
        tete:  ['dos15', 'dos16', 'dos17','dos24','dos27'],
        buste: ['dos9', 'dos10', 'dos11', 'dos12', 'dos13', 'dos14','dos18','dos28'],
        jambes:['dos3', 'dos4', 'dos5', 'dos6', 'dos7', 'dos8','dos19', 'dos20','dos29'],
        bras: ['dos21', 'dos22', 'dos23'],
		pieds: ['dos1', 'dos2', 'dos25']
    };


    // sélectionner le bon mapping selon le mode
    function getGroupsForMode(mode) {
        return mode === 'FACE' ? GROUPS_FACE : GROUPS_DOS;
    }


    // tous les boutons capteurs
    const caps = document.querySelectorAll('.cap');

	function applyModeUI(mode) {
		// capteurs visibles selon le mode
		document.querySelectorAll('.cap').forEach(cap => {
			if (cap.dataset.mode === mode) cap.classList.remove('hidden-mode');
			else cap.classList.add('hidden-mode');
		});

		// couches de zones visibles selon le mode (FACE/DOS)
		document.querySelectorAll('.zones-face, .zones-dos').forEach(layer => {
			const isFaceLayer = layer.classList.contains('zones-face');
			const shouldShow = (mode === 'FACE' && isFaceLayer) || (mode === 'DOS' && !isFaceLayer);
			layer.classList.toggle('hidden-zone-mode', !shouldShow);
		});

		// securite: cache aussi les boutons de zone hors mode
		document.querySelectorAll('.body-zone[data-mode]').forEach(zone => {
			zone.classList.toggle('hidden-zone-mode', zone.dataset.mode !== mode);
		});

		// image corps
		document.querySelectorAll('.body-img-face').forEach(function(img) {
			img.classList.toggle('hide-mode', mode !== 'FACE');
		});
		document.querySelectorAll('.body-img-dos').forEach(function(img) {
			img.classList.toggle('show-mode', mode === 'DOS');
		})

		// boutons FACE/DOS
		document.querySelectorAll('.control-btn').forEach(b => {
			b.classList.toggle('active', b.dataset.mode === mode);
		});
	}


    // init de l'état à partir du DOM
    caps.forEach(btn => {
        const id = btn.dataset.capteur;
        const mode = btn.dataset.mode;
        if (!id || !mode) return;
        stateCapteurs[mode][id] = btn.classList.contains('active');
    });


    // ===== PERSISTENCE PAR STATION (localStorage) =====
    function storageKey(c2Id) {
        return `c2_state:${c2Id}`;
    }

    function saveStateForId(c2Id) {
        try {
            const toSave = {
                mode: currentMode,
                gender: currentGender,
                capteurs: stateCapteurs
            };
            localStorage.setItem(storageKey(c2Id), JSON.stringify(toSave));
        } catch (e) {
            console.error('saveStateForId error', e);
        }
    }

    function loadStateForId(c2Id) {
        try {
            const raw = localStorage.getItem(storageKey(c2Id));
            if (!raw) return false;
            const data = JSON.parse(raw);
            if (data.capteurs) {
                stateCapteurs.FACE = data.capteurs.FACE || stateCapteurs.FACE;
                stateCapteurs.DOS = data.capteurs.DOS || stateCapteurs.DOS;
            }
            if (data.mode) currentMode = data.mode || currentMode;
            if (data.gender) currentGender = data.gender || currentGender;

            // apply to DOM
            caps.forEach(btn => {
                const id = btn.dataset.capteur;
                const mode = btn.dataset.mode;
                const active = !!(stateCapteurs[mode] && stateCapteurs[mode][id]);
                btn.classList.toggle('active', active);
            });

			applyModeUI(currentMode);
			updateAllZoneVisuals();
			applyGenderUI(currentGender);

            updateDrawer();
            return true;
        } catch (e) {
            console.error('loadStateForId error', e);
            return false;
        }
    }

	let lastPublishedStateSignature = null;

	// envoi de l'état compact au backend (Flask -> MQTT)
	// Format MQTT cible (non JSON):
	// - FormaReaEDF/C2/C2_X/CapteursFace -> "[1; 2; 3]"
	// - FormaReaEDF/C2/C2_X/CapteursDos  -> "[4; 5]"
	function publishFullState() {
		// transforme un objet { id: bool } en tableau de numéros actifs
		const toNums = (capsById) => {
			return Object.entries(capsById || {})
				.filter(([, active]) => active)
				.map(([id]) => {
					const n = parseInt(id.replace(/\D/g, ''), 10);
					return Number.isNaN(n) ? null : n;
				})
				.filter(n => n !== null);
		};

		const payloadCapteurs = {
			F: toNums(stateCapteurs.FACE),
			D: toNums(stateCapteurs.DOS)
		};
		const genderCode = normalizeGenderCode(currentGender);

		const signature = `${C2_ID}|${payloadCapteurs.F.join(',')}|${payloadCapteurs.D.join(',')}|${genderCode}`;
		if (signature === lastPublishedStateSignature) {
			return;
		}
		lastPublishedStateSignature = signature;

		const form = new FormData();
		form.append('c2_id', C2_ID);
		form.append('F', payloadCapteurs.F.join(';'));
		form.append('D', payloadCapteurs.D.join(';'));
		form.append('genre', genderCode);

		fetch('/C2/publish_capteurs_full', {
			method: 'POST',
			body: form
		}).catch(err => {
			lastPublishedStateSignature = null;
			console.error('Erreur fetch MQTT:', err);
		});
	}

    // clic individuel sur un capteur
    caps.forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.capteur;
            const capMode = btn.dataset.mode;
            
            // vérifier que le capteur est du mode actuel
            if (capMode !== currentMode) return;
            if (!id) return;


            btn.classList.toggle('active');
            stateCapteurs[currentMode][id] = btn.classList.contains('active');
            updateAllZoneVisuals();
            // persist for this station
            try { saveStateForId(C2_ID); } catch(e) {}
            publishFullState();
        });
    });


	function toggleCapteurGroup(groupName) {
		const GROUPS = getGroupsForMode(currentMode);
		const capteursGroup = GROUPS[groupName] || [];
		if (capteursGroup.length === 0) return;

		let allActive = true;
		capteursGroup.forEach(id => {
			const btn = document.querySelector(`.cap[data-capteur="${id}"]`);
			if (!btn || !btn.classList.contains('active')) {
				allActive = false;
			}
		});

		const targetState = !allActive;

		capteursGroup.forEach(id => {
			const btn = document.querySelector(`.cap[data-capteur="${id}"]`);
			if (!btn) return;
			btn.classList.toggle('active', targetState);
			stateCapteurs[currentMode][id] = targetState;
		});

		try { saveStateForId(C2_ID); } catch (e) {}
		publishFullState();
		updateDrawer();
	}

	// Met à jour le visuel rouge de toutes les zones SVG
	// en se basant sur l'état réel des capteurs du mode courant
	function updateAllZoneVisuals() {
		const GROUPS = getGroupsForMode(currentMode);
		const state = stateCapteurs[currentMode] || {};
		const allHits = document.querySelectorAll('.zone-hit[data-group]');
		allHits.forEach(hit => {
			const zoneButton = hit.closest('.body-zone[data-mode]');
			if (zoneButton && zoneButton.dataset.mode !== currentMode) {
				hit.classList.remove('zone-active');
				return;
			}
			const groupName = hit.dataset.group;
			const capteursGroup = GROUPS[groupName] || [];
			if (capteursGroup.length === 0) {
				hit.classList.remove('zone-active');
				return;
			}
			const allActive = capteursGroup.every(id => !!state[id]);
			hit.classList.toggle('zone-active', allActive);
		});
	}

	function isZoneHitInteractive(hit) {
		const zoneButton = hit.closest('.body-zone');
		if (!zoneButton) return false;
		if (zoneButton.classList.contains('hidden-zone-mode')) return false;
		if (zoneButton.closest('.hidden-gender')) return false;
		return true;
	}

	// clic sur les formes SVG uniquement (pas sur les rectangles)
	const zoneHits = document.querySelectorAll('.zone-hit[data-group]');
	zoneHits.forEach(hit => {
		hit.addEventListener('click', (event) => {
			if (!isZoneHitInteractive(hit)) return;
			event.preventDefault();
			event.stopPropagation();
			toggleCapteurGroup(hit.dataset.group);
			updateAllZoneVisuals();
		});
	});

	// Hit-test géométrique au niveau du container : corrige les zones (buste, jambes)
	// dont le SVG déborde visuellement du bouton mais où les clics overflow
	// ne sont pas captés par le handler direct ci-dessus.
	const bodyContainer = document.querySelector('.body-container');
	if (bodyContainer) {
		bodyContainer.addEventListener('click', function(e) {
			const allHits = document.querySelectorAll('.zone-hit[data-group]');
			for (const hit of allHits) {
				if (!isZoneHitInteractive(hit)) continue;
				const ctm = hit.getScreenCTM();
				if (!ctm) continue;
				const svgPt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
				if (hit.isPointInFill(svgPt)) {
					e.preventDefault();
					e.stopPropagation();
					toggleCapteurGroup(hit.dataset.group);
					updateAllZoneVisuals();
					return;
				}
			}
		});
	}


	    // gestion des boutons de contrôle FACE/DOS
	    const controlBtns = document.querySelectorAll('.control-btn[data-mode]');
    controlBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            if (mode === currentMode) return; // déjà en ce mode


            // basculer le mode (SANS réinitialiser l'état)
            currentMode = mode;
			applyModeUI(currentMode);
			updateAllZoneVisuals();


            // persist mode and send
            try { saveStateForId(C2_ID); } catch(e) {}
            publishFullState();
              
            // mettre à jour le drawer
            updateDrawer();
        });
    });

	const resetCapsBtn = document.getElementById('resetCapsBtn');
	if (resetCapsBtn) {
		resetCapsBtn.addEventListener('click', () => {
			caps.forEach(btn => {
				const id = btn.dataset.capteur;
				const mode = btn.dataset.mode;
				if (!id || !mode || !stateCapteurs[mode]) return;
				stateCapteurs[mode][id] = false;
				btn.classList.remove('active');
			});

			updateAllZoneVisuals();
			try { saveStateForId(C2_ID); } catch (e) {}
			publishFullState();
			updateDrawer();
		});
	}



	// ===== GESTION DU GENRE (HOMME/FEMME) =====
	function applyGenderUI(gender) {
		document.body.dataset.c2Gender = normalizeGenderValue(gender);
		// toggle body images per gender
		document.querySelectorAll('.body-img-homme').forEach(function(img) {
			img.classList.toggle('hidden-gender', gender !== 'homme');
		});
		document.querySelectorAll('.body-img-femme').forEach(function(img) {
			img.classList.toggle('hidden-gender', gender !== 'femme');
		});

		// toggle zone containers
		document.querySelectorAll('.zones-homme').forEach(function(zonesH) {
			zonesH.classList.toggle('hidden-gender', gender !== 'homme');
		});
		document.querySelectorAll('.zones-femme').forEach(function(zonesF) {
			zonesF.classList.toggle('hidden-gender', gender !== 'femme');
		});

		// re-apply mode UI for the new gender images
		applyModeUI(currentMode);
		updateAllZoneVisuals();
	}
	// appliquer l'UI du mode courant (FACE par défaut au premier chargement)
	applyModeUI(currentMode);
	updateAllZoneVisuals();
	applyGenderUI(currentGender);


    // ===== GLOBAL SCALING (one-time) =====
    (function setupScaling(){
        const wrapper = document.querySelector('.c2-wrapper');
        if (!wrapper) return;


        const BASE_WIDTH = 1280;
        const BASE_HEIGHT = 720;


        function applyScale() {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const scale = Math.min(vw / BASE_WIDTH, vh / BASE_HEIGHT);
			// keep full centering and apply uniform scale
			wrapper.style.transform = `translate(-50%, -50%) scale(${scale})`;
            wrapper.style.transformOrigin = 'center center';
        }


        window.addEventListener('resize', applyScale);
        applyScale();
    })();


    // ===== GESTION DU DRAWER =====
    const drawer = document.getElementById('drawer');
    const drawerToggle = document.getElementById('drawerToggle');
    const drawerMode = document.getElementById('drawerMode');
    const drawerCapteurs = document.getElementById('drawerCapteurs');

	    function applyLeftDrawerVisualState(isOpen) {
	    	if (isOpen) {
	    		document.documentElement.style.setProperty('--drawer-initial', 'translateX(0)');
	    		document.documentElement.style.setProperty('--toggle-initial', '220px');
	    		document.documentElement.style.setProperty('--arrow-initial', 'scaleX(-1)');
	    	} else {
	    		document.documentElement.style.removeProperty('--drawer-initial');
	    		document.documentElement.style.setProperty('--toggle-initial', '0');
	    		document.documentElement.style.setProperty('--arrow-initial', 'scaleX(1)');
	    	}
	    }

	    if (drawer && drawerToggle) {
	    	const isOpen = localStorage.getItem('drawerOpen') === 'true';
	    	drawer.classList.toggle('open', isOpen);
	    	applyLeftDrawerVisualState(isOpen);

	    	drawerToggle.addEventListener('click', () => {
	    		const nowOpen = !drawer.classList.contains('open');
	    		drawer.classList.toggle('open', nowOpen);
	    		localStorage.setItem('drawerOpen', String(nowOpen));
	    		applyLeftDrawerVisualState(nowOpen);
	    	});
	    }


    // ===== DRAWER DROIT : toggle + persistence =====
    const drawerRight = document.getElementById('drawerRight');
    const drawerToggleRight = document.getElementById('drawerToggleRight');

	    function applyRightDrawerVisualState(isOpen) {
	    	if (isOpen) {
	    		document.documentElement.style.setProperty('--drawer-right-initial', 'translateX(0)');
	    		document.documentElement.style.setProperty('--toggle-right-initial', '220px');
	    		document.documentElement.style.setProperty('--arrow-right-initial', 'scaleX(-1)');
	    	} else {
	    		document.documentElement.style.removeProperty('--drawer-right-initial');
	    		document.documentElement.style.setProperty('--toggle-right-initial', '0');
	    		document.documentElement.style.setProperty('--arrow-right-initial', 'scaleX(1)');
	    	}
	    }

	    if (drawerRight && drawerToggleRight) {
	        const isRightOpen = localStorage.getItem('drawerRightOpen') === 'true';
	        drawerRight.classList.toggle('open', isRightOpen);
	        applyRightDrawerVisualState(isRightOpen);

	        drawerToggleRight.addEventListener('click', () => {
	            const nowOpen = !drawerRight.classList.contains('open');
	            drawerRight.classList.toggle('open', nowOpen);
	            localStorage.setItem('drawerRightOpen', String(nowOpen));
	            applyRightDrawerVisualState(nowOpen);
	        });
	    }



    // Mettre à jour le drawer quand on change de mode
    function updateDrawer() {
		if (drawerMode) drawerMode.textContent = currentMode;
        
        const activeCapteurs = Object.keys(stateCapteurs[currentMode]).filter(
            id => stateCapteurs[currentMode][id]
        );
        
		if (drawerCapteurs) {
			if (activeCapteurs.length === 0) {
				drawerCapteurs.innerHTML = 'Aucun capteur activé';
			} else {
				drawerCapteurs.innerHTML = activeCapteurs.map(id => 
					`<div>• ${id}</div>`
				).join('');
			}
		}
    }


    // Mettre à jour le drawer à chaque changement d'état capteur
    caps.forEach(btn => {
        btn.addEventListener('click', () => {
            updateDrawer();
        });
    });


// Restaurer l'état pour cette station (si présent)
    try { loadStateForId(C2_ID); } catch(e) {}

    // Mettre à jour au chargement
    updateDrawer();

	// synchroniser depuis MQTT/backend (source de vérité)
	pollServerState();
	setInterval(pollServerState, 1000);


        function setC2Id(id) {
			C2_ID = id;
			const banner = document.querySelector('.c2-id-display');
			if (banner) banner.textContent = `C2 Id : ${formatC2DisplayId(id)}`;
			try { loadStateForId(id); } catch(e) {}
			updateDrawer();
			pollServerState();
			console.log('C2 changé:', id);
		}

    // Exemple: setC2Id('C2_2');


const c2Buttons = document.querySelectorAll('.id-btn[href^="/C2/"]');


    c2Buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Avant navigation : sauvegarder l'état courant pour cette station
			try { saveStateForId(C2_ID); } catch(e) {}
			// laisser la navigation se produire normalement (pas de preventDefault)





            // optionnel: classe active sur le bouton sélectionné
            // server handles active state
            // active handled by server template
        });
    });

    // save on page unload (best-effort)
    window.addEventListener('beforeunload', () => {
        try { saveStateForId(C2_ID); } catch(e) {}
    });

	// --- BOUTON + POUR AJOUTER UN APPAREIL
	const addBtn = document.getElementById('id-add');
	const pick = (...selectors) => {
		for (const selector of selectors) {
			const el = document.querySelector(selector);
			if (el) return el;
		}
		return null;
	};

	const modal = pick('#c2-modal', '#modal', '.c2-modal');
	const modalClose = pick('#c2-modal-close', '#modal-close', '.c2-modal-close');
	const modalSubmit = pick('#c2-modal-submit', '#modal-submit', '.c2-modal-submit');
	const modalInput = pick('#c2-modal-input', '#modal-input', '.c2-modal-input');
	const modalId = pick('#c2-modal-id', '#modal-id', '.c2-modal-id');
	const modalGender = pick('#c2-modal-gender', '#modal-gender', '.c2-modal-select');
	const modalError = pick('#c2-modal-error', '#modal-error', '.c2-modal-error');

	const buildAssignedC2Ids = () => {
		const ids = new Set();
		const links = document.querySelectorAll('.id-list .id-item .id-btn[href^="/C2/"]');
		links.forEach((link) => {
			const href = String(link.getAttribute('href') || '');
			const match = href.match(/\/C2\/(\d+)$/);
			if (!match) return;
			const id = Number(match[1]);
			if (Number.isInteger(id) && id >= 1 && id <= 4) {
				ids.add(id);
			}
		});
		return ids;
	};

	const refreshAddButtonVisibility = () => {
		if (!addBtn) return;
		const assigned = buildAssignedC2Ids();
		const hasFreeSlot = assigned.size < 4;
		addBtn.style.display = hasFreeSlot ? '' : 'none';
	};

	const updateIdChoices = () => {
		if (!modalId) return;

		const assigned = buildAssignedC2Ids();
		modalId.innerHTML = '';

		for (let id = 1; id <= 4; id += 1) {
			if (assigned.has(id)) continue;
			const option = document.createElement('option');
			option.value = String(id);
			option.textContent = String(id);
			modalId.appendChild(option);
		}
	};

	const setError = (message) => {
		if (!modalError) return;
		modalError.textContent = message || '';
	};

	const openModal = () => {
		if (!modal || !modalInput) return;
		modal.classList.add('open');
		modal.setAttribute('aria-hidden', 'false');
		modalInput.value = '';
		updateIdChoices();
		if (modalGender) modalGender.value = currentGender;
		setError('');
		if (modalId && modalId.options.length === 0) {
			setError('Tous les IDs 1 a 4 sont deja utilises.');
			return;
		}
		modalInput.focus();
	};

	const closeModal = () => {
		if (!modal) return;
		modal.classList.remove('open');
		modal.setAttribute('aria-hidden', 'true');
	};

	if (addBtn) {
		addBtn.addEventListener('click', (e) => {
			e.preventDefault();
			openModal();
		});
	}

	if (addBtn && (!modal || !modalInput || !modalSubmit || !modalGender)) {
		console.warn('Modal C2 introuvable ou incomplet: verifie les ids/classes c2-modal*');
	}

	refreshAddButtonVisibility();

	if (modalClose) {
		modalClose.addEventListener('click', closeModal);
	}

	if (modal) {
		modal.addEventListener('click', (e) => {
			if (e.target === modal) closeModal();
		});
	}

	if (modalSubmit) {
		modalSubmit.addEventListener('click', () => {
			const name = (modalInput?.value || '').trim();
			const selectedId = Number(modalId?.value || '');
			const gender = normalizeGenderValue(modalGender?.value || 'homme');
			if (!name) {
				setError('Le nom est obligatoire.');
				modalInput?.focus();
				return;
			}
			if (!Number.isInteger(selectedId) || selectedId < 1 || selectedId > 4) {
				setError('Selectionne un ID valide (1 a 4).');
				modalId?.focus();
				return;
			}
			setError('');

			const data = new FormData();
			data.append('name', name);
			data.append('id', String(selectedId));
			data.append('gender', normalizeGenderCode(gender));

			fetch(`${apiBase}/ajouter-appareil`, {
				method: 'POST',
				body: data
			})
				.then(async (res) => {
					let json = null;
					try {
						json = await res.json();
					} catch (_) {
						json = null;
					}
					return { ok: res.ok, status: res.status, json };
				})
				.then(({ ok, status, json }) => {
					if (!ok || !json?.ok) {
						if (status === 401 || status === 403) {
							setError('Droits admin requis ou session expiree.');
						} else {
							setError(json?.error || 'Requete refusee, verifie le nom.');
						}
						modalInput?.focus();
						return;
					}
					closeModal();
					const createdId = Number(json?.c2_id);
					if (Number.isInteger(createdId) && createdId >= 1) {
						window.location.href = `${apiBase}/${createdId}`;
					} else {
						window.location.reload();
					}
				})
				.catch(() => {
					setError('Erreur serveur, reessaie.');
					modalInput?.focus();
				});
		});
	}

	if (modalInput) {
		modalInput.addEventListener('input', () => setError(''));
	}

	if (modal) {
		modal.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				modalSubmit?.click();
			}
		});
	}

	const ensureDeleteModal = () => {
		let deleteModal = document.getElementById('c2-delete-modal');
		if (!deleteModal) {
			deleteModal = document.createElement('div');
			deleteModal.id = 'c2-delete-modal';
			deleteModal.className = 'c2-modal';
			deleteModal.setAttribute('aria-hidden', 'true');
			deleteModal.innerHTML = `
				<div class="c2-modal-card" role="dialog" aria-modal="true" aria-labelledby="c2-delete-title">
					<button class="c2-modal-close" id="c2-delete-close" aria-label="Fermer" type="button">X</button>
					<h3 class="c2-modal-title" id="c2-delete-title">Confirmer la suppression</h3>
					<div class="c2-modal-row">
						<p class="c2-modal-label" id="c2-delete-message" style="margin: 0;"></p>
					</div>
					<div class="c2-modal-row" style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px;">
						<button class="c2-modal-submit" id="c2-delete-cancel" type="button">Annuler</button>
						<button class="c2-modal-submit" id="c2-delete-confirm" type="button">Supprimer</button>
					</div>
				</div>
			`;
			document.body.appendChild(deleteModal);
		}

		return {
			modal: deleteModal,
			close: deleteModal.querySelector('#c2-delete-close'),
			cancel: deleteModal.querySelector('#c2-delete-cancel'),
			confirm: deleteModal.querySelector('#c2-delete-confirm'),
			message: deleteModal.querySelector('#c2-delete-message')
		};
	};

	const askDeleteConfirmation = (id) => new Promise((resolve) => {
		const refs = ensureDeleteModal();
		if (!refs.modal || !refs.close || !refs.cancel || !refs.confirm || !refs.message) {
			resolve(false);
			return;
		}

		refs.message.textContent = `Supprimer l'equipement C2 ID ${id} ?`;

		const closeWith = (result) => {
			refs.modal.classList.remove('open');
			refs.modal.setAttribute('aria-hidden', 'true');
			refs.close.removeEventListener('click', onCancel);
			refs.cancel.removeEventListener('click', onCancel);
			refs.confirm.removeEventListener('click', onConfirm);
			refs.modal.removeEventListener('click', onBackdrop);
			document.removeEventListener('keydown', onEsc);
			resolve(result);
		};

		const onCancel = () => closeWith(false);
		const onConfirm = () => closeWith(true);
		const onBackdrop = (event) => {
			if (event.target === refs.modal) closeWith(false);
		};
		const onEsc = (event) => {
			if (event.key === 'Escape') closeWith(false);
		};

		refs.close.addEventListener('click', onCancel);
		refs.cancel.addEventListener('click', onCancel);
		refs.confirm.addEventListener('click', onConfirm);
		refs.modal.addEventListener('click', onBackdrop);
		document.addEventListener('keydown', onEsc);

		refs.modal.classList.add('open');
		refs.modal.setAttribute('aria-hidden', 'false');
		refs.confirm.focus();
	});

	const deleteButtons = document.querySelectorAll('.id-delete');
	deleteButtons.forEach((btn) => {
		btn.addEventListener('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			const id = btn.getAttribute('data-id');
			if (!id) return;
			const confirmed = await askDeleteConfirmation(id);
			if (!confirmed) return;

			const data = new FormData();
			data.append('id', id);

			fetch(`${apiBase}/supprimer-appareil`, {
				method: 'POST',
				body: data
			})
				.then((res) => res.json().then((json) => ({ ok: res.ok, json })))
				.then(({ ok, json }) => {
					if (!ok || !json?.ok) {
						alert(json?.error || 'Suppression impossible.');
						return;
					}
					const deletedId = Number(id);
					const currentId = Number((C2_ID || '').replace(/\D/g, ''));
					if (deletedId === currentId) {
						window.location.href = `${apiBase}/1`;
					} else {
						window.location.reload();
					}
				})
				.catch(() => {
					alert('Erreur serveur, reessaie.');
				});
		});
	});

	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') closeModal();
	});
});
