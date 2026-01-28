document.addEventListener('DOMContentLoaded', () => {
    const C2_ID = 'C2_1';

    // état global de tous les capteurs
    const stateCapteurs = {};

    // mapping zones du corps → liste d'ID de capteurs
    // adapte cette table à ton câblage réel
    const GROUPS = {
        tete:  ['c1', 'c2', 'c3'],
        buste: ['c4', 'c5', 'c6', 'c7', 'c8', 'c9'],
        jambes:['c10', 'c11', 'c12', 'c13', 'c14', 'c15', "c16", "c17", "c18"],
        bras: ['c19', 'c20', 'c21'],
    };

    // tous les boutons capteurs
    const caps = document.querySelectorAll('.cap');

    // init de l'état à partir du DOM
    caps.forEach(btn => {
        const id = btn.dataset.capteur;
        if (!id) return;
        stateCapteurs[id] = btn.classList.contains('active');
    });

    // envoi de l'état complet au backend (Flask -> MQTT)
    function publishFullState() {
        fetch('/publish_capteurs_full', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                c2_id: C2_ID,
                capteurs: stateCapteurs
            })
        }).catch(err => console.error('Erreur fetch MQTT:', err));
    }

    // clic individuel sur un capteur
    caps.forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.capteur;
            if (!id) return;

            btn.classList.toggle('active');
            stateCapteurs[id] = btn.classList.contains('active');
            publishFullState();
        });
    });

    // clic sur une zone du corps
    // clic sur une zone du corps
    const zones = document.querySelectorAll('.body-zone');

    zones.forEach(zone => {
        zone.addEventListener('click', () => {
            const groupName = zone.dataset.group;   // ex "tete"
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
        });
    });
});

