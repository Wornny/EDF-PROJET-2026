document.addEventListener('DOMContentLoaded', () => {
    const C2_ID = 'C2_1';

    // état global: garder l'état de chaque mode séparément
    const stateCapteurs = {
        FACE: {},
        DOS: {}
    };

    // mode actuel (FACE ou DOS)
    let currentMode = 'FACE';

    // mapping zones du corps → liste d'ID de capteurs (FACE)
    const GROUPS_FACE = {
        tete:  ['c1', 'c2', 'c3'],
        buste: ['c4', 'c5', 'c6', 'c7', 'c8', 'c9'],
        jambes:['c10', 'c11', 'c12', 'c13', 'c14', 'c15', "c16", "c17", "c18"],
        bras: ['c19', 'c20', 'c21'],
    };

    // mapping zones du corps → liste d'ID de capteurs (DOS)
    const GROUPS_DOS = {
        tete:  ['dos1', 'dos2', 'dos3'],
        buste: ['dos4', 'dos5', 'dos6', 'dos7', 'dos8', 'dos9'],
        jambes:['dos10', 'dos11', 'dos12', 'dos13', 'dos14', 'dos15', 'dos16', 'dos17', 'dos18'],
        bras: ['dos19', 'dos20', 'dos21'],
    };

    // sélectionner le bon mapping selon le mode
    function getGroupsForMode(mode) {
        return mode === 'FACE' ? GROUPS_FACE : GROUPS_DOS;
    }

    // tous les boutons capteurs
    const caps = document.querySelectorAll('.cap');

    // init de l'état à partir du DOM
    caps.forEach(btn => {
        const id = btn.dataset.capteur;
        const mode = btn.dataset.mode;
        if (!id || !mode) return;
        stateCapteurs[mode][id] = btn.classList.contains('active');
    });

    // envoi de l'état complet au backend (Flask -> MQTT)
    function publishFullState() {
        fetch('/publish_capteurs_full', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                c2_id: C2_ID,
                mode: currentMode,
                capteurs: stateCapteurs[currentMode]
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
            publishFullState();
        });
    });

    // clic sur une zone du corps
    // clic sur une zone du corps
    const zones = document.querySelectorAll('.body-zone');

    zones.forEach(zone => {
        zone.addEventListener('click', () => {
            const groupName = zone.dataset.group;   // ex "tete"
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
            //    sinon → on active tout
            const targetState = !allActive;

            capteursGroup.forEach(id => {
                const btn = document.querySelector(`.cap[data-capteur="${id}"]`);
                if (!btn) return;

                btn.classList.toggle('active', targetState);
                stateCapteurs[id] = targetState;
            });

            publishFullState();

            const container = document.querySelector('.c2-container');

            if (container) {
                const BASE_WIDTH = 1280;
                const BASE_HEIGHT = 720;

                function resize() {
                    const vw = window.innerWidth;
                    const vh = window.innerHeight;

                    const scale = Math.min(vw / BASE_WIDTH, vh / BASE_HEIGHT);

                    container.style.transform = `scale(${scale})`;
                    container.style.transformOrigin = 'center center';
                }

                window.addEventListener('resize', resize);
                resize();  // appel initial
            }

            
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

            // envoyer l'état du mode actif
            publishFullState();
            
            // mettre à jour le drawer
            updateDrawer();
        });
    });

    // initialiser l'affichage du bouton FACE par défaut
    document.querySelector('.control-btn[data-mode="FACE"]')?.classList.add('active');

    // ===== GESTION DU DRAWER =====
    const drawer = document.getElementById('drawer');
    const drawerToggle = document.getElementById('drawerToggle');
    const drawerMode = document.getElementById('drawerMode');
    const drawerCapteurs = document.getElementById('drawerCapteurs');

    // Ouvrir/Fermer le drawer
    drawerToggle.addEventListener('click', () => {
        drawer.classList.toggle('open');
    });

    // Fermer en cliquant en dehors du drawer
    document.addEventListener('click', (e) => {
        if (!drawer.contains(e.target) && !drawerToggle.contains(e.target)) {
            if (drawer.classList.contains('open')) {
                drawer.classList.remove('open');
            }
        }
    });

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

    // Mettre à jour au chargement
    updateDrawer();

        function setC2Id(id) {
        C2_ID = id;
        document.querySelector('.c2-id-display').textContent = `Station: ${id}`;
        console.log('C2 changé:', id);
    }

    // Exemple: setC2Id('C2_2');

});

