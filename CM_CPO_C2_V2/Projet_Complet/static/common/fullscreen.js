(function () {
  const STORAGE_KEY = 'fullscreenWanted';

  function hasFullscreenApi() {
    return !!document.documentElement.requestFullscreen;
  }

  function isFullscreenActive() {
    return !!document.fullscreenElement;
  }

  function setWanted(value) {
    if (value) {
      localStorage.setItem(STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function isWanted() {
    return localStorage.getItem(STORAGE_KEY) === '1';
  }

  function requestFullscreenSafe() {
    if (!hasFullscreenApi() || isFullscreenActive()) {
      return Promise.resolve();
    }

    return document.documentElement.requestFullscreen().catch(() => {});
  }

  function armNextUserInteraction() {
    const tryEnter = function () {
      if (!isWanted() || isFullscreenActive()) {
        return;
      }
      requestFullscreenSafe();
    };

    ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
      window.addEventListener(eventName, tryEnter, { once: true, passive: true });
    });
  }

  function ensureOnLifecycle() {
    const retry = function () {
      if (!isWanted() || isFullscreenActive()) {
        return;
      }
      requestFullscreenSafe().then(() => {
        if (!isFullscreenActive()) {
          armNextUserInteraction();
        }
      });
    };

    window.addEventListener('pageshow', retry);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        retry();
      }
    });
  }

  function onButtonClick() {
    if (isFullscreenActive()) {
      setWanted(false);
      document.exitFullscreen().catch(() => {});
      return;
    }

    setWanted(true);
    requestFullscreenSafe().then(() => {
      if (!isFullscreenActive()) {
        armNextUserInteraction();
      }
    });
  }

  function initButton() {
    const button = document.getElementById('fullscreenBtn');
    if (!button) {
      return;
    }

    button.addEventListener('click', onButtonClick);
  }

  function initPersistence() {
    if (!isWanted()) {
      return;
    }

    requestFullscreenSafe().then(() => {
      if (!isFullscreenActive()) {
        armNextUserInteraction();
      }
    });

    document.addEventListener('fullscreenchange', () => {
      if (isWanted() && !isFullscreenActive()) {
        armNextUserInteraction();
      }
    });

    ensureOnLifecycle();
  }

  initButton();
  initPersistence();
})();