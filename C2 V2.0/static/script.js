document.addEventListener('DOMContentLoaded', () => {
    let C2_ID = document.body.dataset.c2Id || 'C2_1';


    function setC2Id(newId) {
        C2_ID = newId;
        const bannerText = document.querySelector('.c2-id-display');
        if (bannerText) {
            bannerText.textContent = `C2 ID : ${newId}`;
        }
        // On renvoie l'état actuel avec le nouveau C2_ID
        publishFullState();
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
        tete:  ['c1', 'c2', 'c3', 'c28'],
        buste: ['c4', 'c5', 'c6', 'c7', 'c8', 'c9'],
        jambes:['c10', 'c11', 'c12', 'c13', 'c14', 'c15', "c16", "c17", "c18"],
        bras: ['c19', 'c20', 'c21', 'c22', 'c23', 'c24', 'c25', 'c26', 'c27', 'c28'],    };

    // mapping zones du corps → liste d'ID de capteurs (DOS)
    const GROUPS_DOS = {
        tete:  ['dos1', 'dos2', 'dos3', 'dos28'],
        buste: ['dos4', 'dos5', 'dos6', 'dos7', 'dos8', 'dos9'],
        jambes:['dos10', 'dos11', 'dos12', 'dos13', 'dos14', 'dos15', 'dos16', 'dos17', 'dos18'],
        bras: ['dos19', 'dos20', 'dos21', 'dos22', 'dos23', 'dos24', 'dos25', 'dos26', 'dos27', 'dos28'],    };

    // sélectionner le bon mapping selon le mode
    function getGroupsForMode(mode) {
        return mode === 'FACE' ? GROUPS_FACE : GROUPS_DOS;
    }


	// tous les boutons capteurs
	const caps = document.querySelectorAll('.cap');

	// Toggle to show visible hitboxes for debugging collisions/positions.
	// Set to false to hide them in production. You can also remove the code below
	// once you've finished adjusting sizes/positions.
	const DEBUG_SHOW_HITBOX = false; // <-- toggle here to show/hide clickable zones

	// HITBOX_OVERRIDES: per-cap overrides for the injected debug rect.
	// Format: id: { x: '5%', y: '10%', width: '90%', height: '80%' }
	// Edit these values to shrink/expand the clickable area for specific caps.
	// Example: if `dos21` feels too large, reduce its width/height here.
	const HITBOX_OVERRIDES = {
		// 'dos21': { x: '10%', y: '10%', width: '80%', height: '80%' },
		// sensible defaults to reduce oversized collisions (tweak as needed):
		'dos21': { x: '12%', y: '12%', width: '20%', height: '70%' },
		'c21':   { x: '12%', y: '12%', width: '20%', height: '70%' },
	};

	// Force SVG caps to fill their CSS box and use a consistent preserveAspectRatio.
	// This helps complex-path SVGs (dos20/dos21) scale like the others.
	caps.forEach(el => {
		try {
			if (el.tagName && el.tagName.toLowerCase() === 'svg') {
				el.setAttribute('width', '100%');
				el.setAttribute('height', '100%');
				if (!el.hasAttribute('preserveAspectRatio')) el.setAttribute('preserveAspectRatio', 'xMidYMid meet');
				el.style.display = 'block';

				// If debug mode active, inject a visible hit rectangle and a small label
				// so you can visually tune position/size in the CSS (`static/C2.css`).
				if (DEBUG_SHOW_HITBOX) {
					try {
						const ns = 'http://www.w3.org/2000/svg';
						// don't add twice
						if (!el.querySelector('.cap-hit')) {
							const rect = document.createElementNS(ns, 'rect');
							rect.setAttribute('class', 'cap-hit');
							// default full-size hitbox
							rect.setAttribute('x', '0');
							rect.setAttribute('y', '0');
							rect.setAttribute('width', '100%');
							rect.setAttribute('height', '100%');
							rect.setAttribute('pointer-events', 'none');

							// apply per-cap overrides when present (percent values)
							const hid = el.dataset.capteur;
							if (HITBOX_OVERRIDES[hid]) {
								const o = HITBOX_OVERRIDES[hid];
								if (o.x) rect.setAttribute('x', o.x);
								if (o.y) rect.setAttribute('y', o.y);
								if (o.width) rect.setAttribute('width', o.width);
								if (o.height) rect.setAttribute('height', o.height);
							}

							// append so hitbox renders on top and is visible for debugging
							el.appendChild(rect);

							// add a small label with the cap id to identify overlaps
							const idLabel = document.createElementNS(ns, 'text');
							idLabel.setAttribute('class', 'cap-hit-label');
							idLabel.setAttribute('x', '50%');
							idLabel.setAttribute('y', '92%');
							idLabel.setAttribute('text-anchor', 'middle');
							idLabel.textContent = el.dataset.capteur || '';
							el.appendChild(idLabel);
						}
					} catch (e) { /* ignore */ }
				}
			}
		} catch (e) { /* ignore */ }
	});


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

            // make sure only caps for current mode are visible
            document.querySelectorAll('.cap').forEach(cap => {
                if (cap.dataset.mode === currentMode) cap.classList.remove('hidden-mode');
                else cap.classList.add('hidden-mode');
            });

            // control buttons state
            document.querySelectorAll('.control-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === currentMode));

            updateDrawer();
            return true;
        } catch (e) {
            console.error('loadStateForId error', e);
            return false;
        }
    }

    // envoi de l'état complet au backend (Flask -> MQTT)
    function publishFullState() {
		fetch('/publish_capteurs_full', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
			c2_id: C2_ID,
			mode: currentMode,
			capteurs: {
				FACE: stateCapteurs.FACE,
				DOS: stateCapteurs.DOS
			}
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


            // basculer la classe hidden-mode pour afficher/masquer les capteurs
            const allCaps = document.querySelectorAll('.cap');
            allCaps.forEach(cap => {
                const capMode = cap.dataset.mode;
                if (capMode === mode) {
                    // afficher les capteurs du nouveau mode
                    cap.classList.remove('hidden-mode');
                } else {
                    // masquer les capteurs de l'ancien mode
                    cap.classList.add('hidden-mode');
                }
            });


            // basculer l'image du corps
            const bodyImgFace = document.querySelector('.body-img-face');
            const bodyImgDos = document.querySelector('.body-img-dos');
            
            if (mode === 'FACE') {
                bodyImgFace.classList.remove('hide-mode');
                bodyImgDos.classList.remove('show-mode');
            } else {
                bodyImgFace.classList.add('hide-mode');
                bodyImgDos.classList.add('show-mode');
            }


            // basculer le mode (SANS réinitialiser l'état)
            currentMode = mode;


            // mettre à jour l'affichage des boutons de contrôle
            controlBtns.forEach(b => {
                b.classList.toggle('active', b.dataset.mode === currentMode);
            });


            // persist mode and send
            try { saveStateForId(C2_ID); } catch(e) {}
            publishFullState();
              
            // mettre à jour le drawer
            updateDrawer();
        });
    });


    // initialiser l'affichage du bouton FACE par défaut
    document.querySelector('.control-btn[data-mode="FACE"]')?.classList.add('active');


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
            // keep horizontal centering (translateX) and apply scale
            wrapper.style.transform = `translateX(-50%) scale(${scale})`;
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


    // lire l'état sauvegardé
    const savedState = localStorage.getItem('drawerOpen');
    const isOpen = savedState === 'true';


    // appliquer l'état au chargement
    if (isOpen) {
    drawer.classList.add('open');
    drawerToggle.classList.add('open');
    }


    // toggle + sauvegarde
    drawerToggle.addEventListener('click', () => {
    const nowOpen = !drawer.classList.contains('open');
    drawer.classList.toggle('open', nowOpen);
    drawerToggle.classList.toggle('open', nowOpen);
    localStorage.setItem('drawerOpen', String(nowOpen));
    });


    // ===== DRAWER DROIT : toggle + persistence =====
    const drawerRight = document.getElementById('drawerRight');
    const drawerToggleRight = document.getElementById('drawerToggleRight');


    const savedRight = localStorage.getItem('drawerRightOpen');
    const isRightOpen = savedRight === 'true';
    if (isRightOpen && drawerRight && drawerToggleRight) {
        drawerRight.classList.add('open');
        drawerToggleRight.classList.add('open');
    }


    if (drawerToggleRight) {
        drawerToggleRight.addEventListener('click', () => {
            const nowOpen = !drawerRight.classList.contains('open');
            drawerRight.classList.toggle('open', nowOpen);
            drawerToggleRight.classList.toggle('open', nowOpen);
            localStorage.setItem('drawerRightOpen', String(nowOpen));
        });
    }



    // Mettre à jour le drawer quand on change de mode
    function updateDrawer() {
        drawerMode.textContent = currentMode;
        
        const activeCapteurs = Object.keys(stateCapteurs[currentMode]).filter(
            id => stateCapteurs[currentMode][id]
        );
        
        if (activeCapteurs.length === 0) {
            drawerCapteurs.innerHTML = 'Aucun capteur activé';
        } else {
            drawerCapteurs.innerHTML = activeCapteurs.map(id => 
                `<div>• ${id}</div>`
            ).join('');
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

    // envoyer état restauré pour synchroniser backend
    publishFullState();


        function setC2Id(id) {
			C2_ID = id;
			const banner = document.querySelector('.c2-id-display');
			if (banner) banner.textContent = `C2 ID : ${id}`;
			try { loadStateForId(id); } catch(e) {}
			updateDrawer();
			// notifier backend pour que l'état soit pris en compte
			publishFullState();
			console.log('C2 changé:', id);
		}

    // Exemple: setC2Id('C2_2');


const c2Buttons = document.querySelectorAll('.cm-btn[href^="/C2/"]');


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
});
