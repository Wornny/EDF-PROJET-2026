
    /* ======================================= SERVICE WORKER ======================================= */
    if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(() => {}); }

    /* ======================================= NAVIGATION SPA ======================================= */
    function showPage(id) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-' + id).classList.add('active');
    }

    /* ======================================= INITIALISATEUR PREFIX ======================================= */
    function getInitPrefix() {
      const val = document.getElementById('initSelect').value;
      return val || 'initialisateur';
    }

    /* ======================================= POPUP ALERT ======================================= */
    function showAlert(msg, callback) {
      const overlay = document.getElementById('customAlert');
      document.getElementById('alertMsg').textContent = msg;
      overlay.classList.add('show');
      document.getElementById('alertOk').onclick = () => {
        overlay.classList.remove('show');
        if (callback) callback();
      };
    }

    /* ======================================= POPUP PROMPT ======================================= */
    function showPrompt(msg, callback) {
      const overlay    = document.getElementById('customPrompt');
      const input      = document.getElementById('promptInput');
      const btnOk      = document.getElementById('promptOk');
      const confirmRow = document.getElementById('confirmRow');
      document.getElementById('promptMsg').textContent = msg;
      input.value = '';
      input.style.display = '';
      btnOk.style.display = '';
      confirmRow.style.display = 'none';
      overlay.classList.add('show');
      setTimeout(() => input.focus(), 100);
      btnOk.onclick = () => {
        overlay.classList.remove('show');
        if (callback) callback(input.value.trim());
      };
      input.onkeydown = (e) => { if (e.key === 'Enter') btnOk.click(); };
    }

    /* ======================================= POPUP CONFIRM ======================================= */
    function showConfirm(msg, callback) {
      const overlay    = document.getElementById('customPrompt');
      const input      = document.getElementById('promptInput');
      const btnOk      = document.getElementById('promptOk');
      const confirmRow = document.getElementById('confirmRow');
      const btnOui     = document.getElementById('confirmOui');
      const btnNon     = document.getElementById('confirmNon');
      document.getElementById('promptMsg').textContent = msg;
      input.style.display = 'none';
      btnOk.style.display = 'none';
      confirmRow.style.display = 'flex';
      overlay.classList.add('show');
      const close = (val) => { overlay.classList.remove('show'); callback(val); };
      btnOui.onclick = () => close(true);
      btnNon.onclick = () => close(false);
    }

    /* ======================================= PLEIN ECRAN ======================================= */
    function goFullscreen() {
      const el = document.documentElement;
      const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
      if (rfs) {
        rfs.call(el, { navigationUI: 'hide' })
          .then(() => { localStorage.setItem('fs_actif', '1'); updateBtnFS(true); })
          .catch(() => {});
      }
    }
    function exitFullscreen() {
      const efs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
      if (efs) efs.call(document).catch(() => {});
      localStorage.setItem('fs_actif', '0'); updateBtnFS(false);
    }
    function updateBtnFS(isFS) { document.getElementById('btnFS').textContent = isFS ? '✕ Quitter' : '⛶ Plein écran'; }
    if (localStorage.getItem('fs_actif') === '1') {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:transparent;cursor:pointer;';
      document.body.appendChild(overlay);
      overlay.addEventListener('pointerdown', (e) => {
        overlay.remove(); goFullscreen();
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && el !== overlay) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: e.clientX, clientY: e.clientY }));
      }, { once: true });
    }
    document.getElementById('btnFS').addEventListener('click', () => {
      const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
      isFS ? exitFullscreen() : goFullscreen();
    });
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(evt => {
      document.addEventListener(evt, () => {
        const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
        updateBtnFS(isFS);
        if (!isFS) localStorage.setItem('fs_actif', '0');
      });
    });

    /* ======================================= BANNIERE PWA ======================================= */
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); deferredPrompt = e;
      const banner = document.createElement('div');
      banner.id = 'installBanner';
      banner.innerHTML = `<span>📲 Installer pour un vrai plein écran</span>
        <button id="btnInstall">Installer</button>
        <button class="dismiss" id="btnDismiss">✕</button>`;
      document.body.appendChild(banner);
      document.getElementById('btnInstall').addEventListener('click', async () => {
        deferredPrompt.prompt(); await deferredPrompt.userChoice;
        deferredPrompt = null; banner.remove();
      });
      document.getElementById('btnDismiss').addEventListener('click', () => banner.remove());
    });

    /* ======================================= ACCUEIL - BOUTONS ======================================= */
    const barrierLabel = document.getElementById('barrierLabel');
    const barrierImg   = document.getElementById('barrierImg');
    let barrierEtat    = localStorage.getItem('barriere_etat') || 'fermee';
    let resetEtat = 0; // 0 = inactif, 1 = actif
    function updateBarrierBtn() {
      const texte = barrierEtat === 'fermee' ? 'Ouvrir la barrière' : 'Fermer la barrière';
      barrierLabel.textContent = texte; barrierImg.alt = texte;
    }


    document.getElementById('btnBarrier').addEventListener('click', () => {
      barrierEtat = barrierEtat === 'fermee' ? 'ouverte' : 'fermee';
      localStorage.setItem('barriere_etat', barrierEtat);
      afficherBarriere();
      publishBarriere(barrierEtat);
    });
    document.getElementById('btnScenario').addEventListener('click', () => showPage('scenario'));
    document.getElementById('btnReset').addEventListener('click', () => {
      resetEtat = resetEtat === 0 ? 1 : 0;
      publishReset(resetEtat);
      afficherReset(resetEtat);
    });

    document.querySelector('#page-index .plus').addEventListener('click', () => console.log('Ajouter'));

    /* ======================================= BARRIERE - AFFICHAGE ======================================= */
    let barrierTimer = null;
    function afficherBarriere() {
      showPage('barriere');
      const estOuverte   = localStorage.getItem('barriere_etat') === 'ouverte';
      const emoji        = document.getElementById('barEmoji');
      const message      = document.getElementById('barMessage');
      const progressFill = document.getElementById('barProgressFill');
      emoji.textContent      = estOuverte ? '🔓' : '🔒';
      message.textContent    = estOuverte ? 'Ouverture Barrière' : 'Fermeture Barrière';
      message.className      = 'message ' + (estOuverte ? 'ouverte' : 'fermee');
      progressFill.className = 'progress-fill ' + (estOuverte ? 'ouverte' : 'fermee');
      progressFill.style.transform = 'scaleX(1)';
      requestAnimationFrame(() => { requestAnimationFrame(() => { progressFill.style.transform = 'scaleX(0)'; }); });
      if (barrierTimer) clearTimeout(barrierTimer);
      barrierTimer = setTimeout(() => { showPage('index'); updateBarrierBtn(); }, 2000);
    }

    /* ======================================= SCENARIO - NAVIGATION ======================================= */
    document.getElementById('backScenario').addEventListener('click', () => showPage('index'));
    document.getElementById('btnAttestation').addEventListener('click', () => { resetAttestation(); showPage('attestation'); });

    /* ======================================= CONFIG ======================================= */
    const MQTT_HOST     = "192.168.190.8";
    const MQTT_WS_PORT  = 9002;
    const MQTT_USERNAME = "initialisateur";
    const MQTT_PASSWORD = "projet";
    const BASE_URL = window.location.protocol === 'https:'
      ? 'https://192.168.190.8:3001'
      : 'http://192.168.190.8:3000';
    let scannedCode   = null;
    let mqttClient    = null;
    let currentNom    = null;
    let currentPrenom = null;

    /* ======================================= ATTESTATION - ENVOI BDD ======================================= */
    function saveToDatabase(code, dateValid, zoneValid, nom, prenom, callback) {
      fetch(`${BASE_URL}/api/attestation/by-code/${encodeURIComponent(code)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_attestation: code,
          date_valide: dateValid ? 1 : 0,
          zone_valide: zoneValid ? 1 : 0,
          nom: nom || null,
          prenom: prenom || null
        })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          console.log(`✅ Badge ${data.action} en BDD:`, code);
          if (callback) callback();
        } else {
          showAlert("❌ Erreur BDD : " + data.error);
          document.getElementById('btnSave').disabled = false;
          document.getElementById('btnSave').textContent = 'Enregistrer';
        }
      })
      .catch(err => {
        showAlert("❌ Erreur réseau : " + err.message);
        document.getElementById('btnSave').disabled = false;
        document.getElementById('btnSave').textContent = 'Enregistrer';
      });
    }

    function fetchBadgeFromDB(code) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      return fetch(`${BASE_URL}/api/attestation/by-code/${encodeURIComponent(code)}`, { signal: controller.signal })
        .then(r => { clearTimeout(timer); return r.json(); })
        .catch(err => { clearTimeout(timer); throw err; });
    }

    /* ======================================= MQTT ======================================= */
    function connectMqtt() {
      if (mqttClient && mqttClient.connected) return;
      mqttClient = mqtt.connect(`wss://${MQTT_HOST}:${MQTT_WS_PORT}`, {
        username: MQTT_USERNAME, password: MQTT_PASSWORD,
        keepalive: 30, reconnectPeriod: 2000, clean: true
      });
      mqttClient.on("connect",   () => console.log("✅ MQTT connecté"));
      mqttClient.on("reconnect", () => console.log("🔄 MQTT reconnexion…"));
      mqttClient.on("close",     () => console.log("❌ MQTT déconnecté"));
      mqttClient.on("error", e   => console.warn("MQTT erreur:", e?.message || e));
    }

    function publishAttestation(code, dateValid, zoneValid) {
      if (!mqttClient || !mqttClient.connected) { console.warn("⚠️ MQTT non connecté"); return; }
      const safe = String(code).trim().replace(/\s+/g,"_").replace(/\//g,"_");
      mqttClient.publish(`${getInitPrefix()}/lecteur_code_barre/${safe}`,
        JSON.stringify({ code: String(code).trim(), date_valide: dateValid ? "oui" : "non", zone_valide: zoneValid ? "oui" : "non" }),
        { qos: 0, retain: false },
        (err) => { if (err) console.warn("❌ MQTT publish erreur:", err); else console.log("✅ MQTT publié sur:", `${getInitPrefix()}/lecteur_code_barre/${safe}`); }
      );
    }

    function publishBarriere(etat) {
      if (!mqttClient || !mqttClient.connected) { console.warn("⚠️ MQTT non connecté"); return; }
      mqttClient.publish(`${getInitPrefix()}/barriere/etat`,
        JSON.stringify({ etat: etat === 'ouverte' ? 1 : 0 }),
        { qos: 0, retain: false },
        (err) => { if (err) console.warn("❌ MQTT barrière erreur:", err); else console.log("✅ MQTT barrière publié sur:", `${getInitPrefix()}/barriere/etat`); }
      );
    }

    function publishReset(valeur) {
      if (!mqttClient || !mqttClient.connected) { console.warn("⚠️ MQTT non connecté"); return; }
      mqttClient.publish(`${getInitPrefix()}/reset/etat`,
        JSON.stringify({ reset: valeur }),
        { qos: 0, retain: false },
        (err) => { if (err) console.warn("❌ MQTT reset erreur:", err); else console.log("✅ MQTT reset publié:", valeur); }
      );
    }

    connectMqtt();

    /* ======================================= RESET - AFFICHAGE ======================================= */
    let resetTimer = null;
    function afficherReset(valeur) {
      showPage('barriere');
      const emoji        = document.getElementById('barEmoji');
      const message      = document.getElementById('barMessage');
      const progressFill = document.getElementById('barProgressFill');
      emoji.textContent      = valeur === 1 ? '🔄' : '🔄';
      message.textContent    = valeur === 1 ? 'Étapes remises à zéro' : 'Étapes remises à zéro';
      message.className      = 'message fermee';
      progressFill.className = 'progress-fill fermee';
      progressFill.style.transform = 'scaleX(1)';
      requestAnimationFrame(() => { requestAnimationFrame(() => { progressFill.style.transform = 'scaleX(0)'; }); });
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { showPage('index'); }, 2000);
    }

    /* ======================================= ATTESTATION - SWITCHES ======================================= */
    const swDate  = document.getElementById('swDate');
    const swZone  = document.getElementById('swZone');
    const lblDate = document.getElementById('lblDate');
    const lblZone = document.getElementById('lblZone');
    const isEnabled  = el => !el.classList.contains('disabled');
    const setEnabled = (el, v) => { el.classList.toggle('disabled', !v); el.setAttribute('tabindex', v ? '0' : '-1'); };
    const setOn      = (el, v) => { el.classList.toggle('on', !!v); el.setAttribute('aria-checked', v ? 'true' : 'false'); };
    const getOn      = el => el.classList.contains('on');
    function refreshLabels() {
      lblDate.textContent = getOn(swDate) ? 'Date valide' : 'Date non valide';
      lblZone.textContent = getOn(swZone) ? 'Zone de travail valide' : 'Zone non valide';
    }
    function toggleSwitch(el) { if (!isEnabled(el)) return; setOn(el, !getOn(el)); refreshLabels(); }
    swDate.addEventListener('click',   () => toggleSwitch(swDate));
    swZone.addEventListener('click',   () => toggleSwitch(swZone));
    swDate.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); toggleSwitch(swDate); }});
    swZone.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); toggleSwitch(swZone); }});
    function resetAttestation() {
      scannedCode   = null;
      currentNom    = null;
      currentPrenom = null;
      setEnabled(swDate, false); setEnabled(swZone, false);
      setOn(swDate, false);      setOn(swZone, false);
      refreshLabels();
      document.getElementById('codePill').classList.remove('show');
      document.getElementById('codeTxt').textContent = '';
      document.getElementById('scanHint').textContent = 'Appuyez pour scanner';
      document.getElementById('btnSave').disabled = true;
      document.getElementById('btnSave').textContent = 'Enregistrer';
    }

    /* ======================================= ATTESTATION - SCANNER ======================================= */
    const scannerModal = document.getElementById('scannerModal');
    const btnCloseScan = document.getElementById('btnCloseScan');
    const scanStatus   = document.getElementById('scanStatus');
    const quaggaConfig = {
      inputStream: {
        type: "LiveStream",
        target: document.querySelector('#interactive'),
        constraints: { facingMode:{ideal:"environment"}, width:{min:640,ideal:1280}, height:{min:480,ideal:720} }
      },
      locator: { patchSize:"medium", halfSample:true },
      numOfWorkers: navigator.hardwareConcurrency || 4,
      decoder: {
        readers: ["ean_reader","ean_8_reader","upc_reader","upc_e_reader",
                  "code_128_reader","code_39_reader","codabar_reader",
                  "i2of5_reader","2of5_reader","code_93_reader"],
        multiple: false
      },
      locate: true, frequency: 10
    };
    let scanning = false;
    function normalizeCode(raw) {
      const c = String(raw).trim();
      return (c.length === 13 && c.startsWith('0')) ? c.slice(1) : c;
    }
    function openScanner() {
      connectMqtt();
      scannerModal.classList.add('show');
      scannerModal.setAttribute("aria-hidden","false");
      scanStatus.textContent = window.isSecureContext ? "Cadrez le code-barres…" : "⚠️ Caméra peut être bloquée en HTTP.";
      if (!scanning) {
        scanning = true;
        Quagga.init(quaggaConfig, err => {
          if (err) { scanStatus.textContent = "❌ Caméra refusée"; scanning = false; return; }
          Quagga.start();
        });
      }
    }
    function closeScanner() {
      if (scanning) { scanning = false; try { Quagga.stop(); } catch {} }
      scannerModal.classList.remove('show');
      scannerModal.setAttribute("aria-hidden","true");
      if (localStorage.getItem('fs_actif') === '1') { setTimeout(() => goFullscreen(), 300); }
    }
    Quagga.onDetected(result => {
      if (!scanning) return;
      const code = result?.codeResult?.code;
      if (!code) return;
      const decoded = result?.codeResult?.decodedCodes || [];
      const errors  = decoded.filter(x => x && x.error !== undefined).map(x => x.error);
      const avg     = errors.length ? errors.reduce((a,b) => a+b, 0) / errors.length : 0;
      if (avg >= 0.1) return;
      scannedCode = normalizeCode(code);
      document.getElementById('codeTxt').textContent = scannedCode;
      document.getElementById('codePill').classList.add('show');
      if (navigator.vibrate) navigator.vibrate(150);
      closeScanner();
      document.getElementById('scanHint').textContent = 'Chargement…';
      document.getElementById('btnSave').disabled = true;
      setEnabled(swDate, false); setEnabled(swZone, false);
      fetchBadgeFromDB(scannedCode)
        .then(data => {
          if (data.found) {
            setOn(swDate, parseInt(data.data.date_valide) === 1);
            setOn(swZone, parseInt(data.data.zone_valide) === 1);
            currentNom    = data.data.nom    || null;
            currentPrenom = data.data.prenom || null;
            const nomAffiche = (currentNom || '?') + ' ' + (currentPrenom || '?');
            document.getElementById('scanHint').textContent = `👤 ${nomAffiche} — modifiez si besoin`;
          } else {
            setOn(swDate, false); setOn(swZone, false);
            currentNom = null; currentPrenom = null;
            document.getElementById('scanHint').textContent = 'Nouveau badge 🆕';
          }
          setEnabled(swDate, true); setEnabled(swZone, true);
          document.getElementById('btnSave').disabled = false;
          refreshLabels();
        })
        .catch(() => {
          setOn(swDate, false); setOn(swZone, false);
          currentNom = null; currentPrenom = null;
          setEnabled(swDate, true); setEnabled(swZone, true);
          document.getElementById('btnSave').disabled = false;
          refreshLabels();
          document.getElementById('scanHint').textContent = 'Badge scanné (hors ligne)';
        });
    });
    document.getElementById('btnScan').addEventListener('click', openScanner);
    btnCloseScan.addEventListener('click', closeScanner);
    scannerModal.addEventListener('click', e => { if (e.target === scannerModal) closeScanner(); });
    window.addEventListener('beforeunload', () => { try { Quagga.stop(); } catch {} });

    /* ======================================= ATTESTATION - ENREGISTRER ======================================= */
    function enregistrer(btnSave) {
      saveToDatabase(scannedCode, getOn(swDate), getOn(swZone), currentNom, currentPrenom, () => {
        publishAttestation(scannedCode, getOn(swDate), getOn(swZone));
        showAlert('✅ Enregistré !', () => {
          if (localStorage.getItem('fs_actif') === '1') goFullscreen();
        });
        btnSave.disabled = false;
        btnSave.textContent = "Enregistrer";
      });
    }

    document.getElementById('btnSave').addEventListener('click', () => {
      if (!scannedCode) { showAlert('Scanne d\'abord le badge.'); return; }
      const btnSave = document.getElementById('btnSave');
      btnSave.disabled = true;
      btnSave.textContent = "En cours...";
      if (currentNom || currentPrenom) {
        showConfirm(`👤 ${currentNom || '?'} ${currentPrenom || '?'}\nModifier le nom/prénom ?`, (modifier) => {
          if (modifier) {
            showPrompt('Nouveau nom ?', (nom) => {
              showPrompt('Nouveau prénom ?', (prenom) => {
                currentNom    = nom    || currentNom;
                currentPrenom = prenom || currentPrenom;
                enregistrer(btnSave);
              });
            });
          } else {
            enregistrer(btnSave);
          }
        });
      } else {
        showPrompt('Nom de famille ?', (nom) => {
          showPrompt('Prénom ?', (prenom) => {
            currentNom    = nom;
            currentPrenom = prenom;
            enregistrer(btnSave);
          });
        });
      }
    });

    /* ======================================= ATTESTATION - RETOUR ======================================= */
    document.getElementById('backAttestation').addEventListener('click', () => {
      closeScanner(); showPage('scenario');
    });
