﻿document.addEventListener('DOMContentLoaded', () => {
    let C2_ID = document.body.dataset.c2Id || 'C2_1';
	const apiBase = '/C2';

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

	function applyServerCapteursState(fValues, dValues) {
		const setF = new Set((fValues || []).map(v => Number(v)).filter(Number.isFinite));
		const setD = new Set((dValues || []).map(v => Number(v)).filter(Number.isFinite));

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
				const signature = `${nextC2Id}|${fList.join(',')}|${dList.join(',')}`;

				if (signature === lastServerSignature) return;
				lastServerSignature = signature;

				C2_ID = nextC2Id;
				const banner = document.querySelector('.c2-id-display');
				if (banner) banner.textContent = `C2 Id : ${normalizedDisplay}`;
				applyServerCapteursState(fList, dList);
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


    // mapping zones du corps → liste d'ID de capteurs (FACE)
    const GROUPS_FACE = {
        tete:  ['c1', 'c2', 'c3','c25','c28'],
        buste: ['c4', 'c5', 'c6', 'c7', 'c8', 'c9','c16','c26'],
        jambes:['c10', 'c11', 'c12', 'c13', 'c14', 'c15','c17', 'c18','c27'],
        bras: ['c19', 'c20', 'c21'],
		pieds: ['c22', 'c23', 'c24']
    };


    // mapping zones du corps → liste d'ID de capteurs (DOS)
    const GROUPS_DOS = {
        tete:  ['dos1', 'dos2', 'dos3','dos25','dos28'],
        buste: ['dos4', 'dos5', 'dos6', 'dos7', 'dos8', 'dos9','dos16','dos26'],
        jambes:['dos10', 'dos11', 'dos12', 'dos13', 'dos14', 'dos15', 'dos17', 'dos18','dos27'],
        bras: ['dos19', 'dos20', 'dos21'],
		pieds: ['dos22', 'dos23', 'dos24']
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

		// image corps
		const bodyImgFace = document.querySelector('.body-img-face');
		const bodyImgDos = document.querySelector('.body-img-dos');
		if (bodyImgFace && bodyImgDos) {
			if (mode === 'FACE') {
				bodyImgFace.classList.remove('hide-mode');
				bodyImgDos.classList.remove('show-mode');
			} else {
				bodyImgFace.classList.add('hide-mode');
				bodyImgDos.classList.add('show-mode');
			}
		}

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

            // apply to DOM
            caps.forEach(btn => {
                const id = btn.dataset.capteur;
                const mode = btn.dataset.mode;
                const active = !!(stateCapteurs[mode] && stateCapteurs[mode][id]);
                btn.classList.toggle('active', active);
            });

			applyModeUI(currentMode);

            updateDrawer();
            return true;
        } catch (e) {
            console.error('loadStateForId error', e);
            return false;
        }
    }

	// envoi de l'état compact au backend (Flask -> MQTT)
	// Format souhaité dans MQTT : { "F": [..], "D": [..] }
	// avec uniquement les numéros des capteurs actifs, sans le "c" ou "dos".
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

		fetch('/C2/publish_capteurs_full', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			// on envoie { c2_id, F, D } au backend,
			// mais côté MQTT seul {F,D} sera publié.
			body: JSON.stringify({
				c2_id: C2_ID,
				F: payloadCapteurs.F,
				D: payloadCapteurs.D
			})
		}).catch(err => console.error('Erreur fetch MQTT:', err));
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
            // persist for this station
            try { saveStateForId(C2_ID); } catch(e) {}
            publishFullState();
        });
    });


    // clic sur une zone du corps
    const zones = document.querySelectorAll('.body-zone');


    zones.forEach(zone => {
        zone.addEventListener('click', () => {
            const groupName = zone.dataset.group;   // ex "tete"
            const GROUPS = getGroupsForMode(currentMode);
            const capteursGroup = GROUPS[groupName] || [];


            // 1) on regarde si le groupe est actuellement "tout actif"
            let allActive = true;
            capteursGroup.forEach(id => {
                const btn = document.querySelector(`.cap[data-capteur="${id}"]`);
                if (!btn || !btn.classList.contains('active')) {
                    allActive = false;
                }
            });


            // 2) si tout est actif → on désactive tout
            //    sinon → on active tout
            const targetState = !allActive;


            capteursGroup.forEach(id => {
            const btn = document.querySelector(`.cap[data-capteur="${id}"]`);
            if (!btn) return;


            btn.classList.toggle('active', targetState);


            // ✅ on met à jour l'état dans le bon sous-objet (FACE ou DOS)
            stateCapteurs[currentMode][id] = targetState;
            });


			// persist group change for this station
			try { saveStateForId(C2_ID); } catch(e) {}			// envoyer changement au backend (MQTT)
			publishFullState();
			// mettre à jour le drawer
			updateDrawer();            // removed per-click resize to avoid shifting the layout
        });
    });


    // gestion des boutons de contrôle FACE/DOS
    const controlBtns = document.querySelectorAll('.control-btn');
    controlBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            if (mode === currentMode) return; // déjà en ce mode


            // basculer le mode (SANS réinitialiser l'état)
            currentMode = mode;
			applyModeUI(currentMode);


            // persist mode and send
            try { saveStateForId(C2_ID); } catch(e) {}
            publishFullState();
              
            // mettre à jour le drawer
            updateDrawer();
        });
    });


	// appliquer l'UI du mode courant (FACE par défaut au premier chargement)
	applyModeUI(currentMode);


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
	const modal = document.getElementById('cm-modal');
	const modalClose = document.getElementById('cm-modal-close');
	const modalSubmit = document.getElementById('cm-modal-submit');
	const modalInput = document.getElementById('cm-modal-input');
	const modalType = document.getElementById('cm-modal-type');
	const modalError = document.getElementById('cm-modal-error');

	const updatePlaceholder = () => {
		if (!modalInput || !modalType) return;
		const type = modalType.value || 'C2';
		modalInput.placeholder = 'Ex: ' + type + ' 3';
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
		setError('');
		updatePlaceholder();
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
			const type = (modalType?.value || 'C2').trim();
			if (!name) {
				setError('Le nom est obligatoire.');
				modalInput?.focus();
				return;
			}
			setError('');

			const data = new FormData();
			data.append('name', name);
			data.append('type', type);

			fetch(`${apiBase}/ajouter-appareil`, {
				method: 'POST',
				body: data
			})
				.then((res) => res.json().then((json) => ({ ok: res.ok, json })))
				.then(({ ok, json }) => {
					if (!ok || !json?.ok) {
						setError(json?.error || 'Nom invalide.');
						modalInput?.focus();
						return;
					}
					closeModal();
					window.location.reload();
				})
				.catch(() => {
					setError('Erreur serveur, reessaie.');
					modalInput?.focus();
				});
		});
	}

	if (modalType) {
		modalType.addEventListener('change', updatePlaceholder);
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

	const deleteButtons = document.querySelectorAll('.id-delete, .cm-delete');
	deleteButtons.forEach((btn) => {
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const id = btn.getAttribute('data-id');
			if (!id) return;

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
