(function () {
  const TAB_AUTH_KEY = "app.auth.tab";
  const params = new URLSearchParams(window.location.search);
  const justLogged = params.get("just_logged") === "1";

  if (justLogged) {
    try {
      sessionStorage.setItem(TAB_AUTH_KEY, "1");
    } catch {
      // Ignore storage errors.
    }

    params.delete("just_logged");
    const nextQuery = params.toString();
    const nextUrl = window.location.pathname + (nextQuery ? "?" + nextQuery : "") + window.location.hash;
    window.history.replaceState({}, "", nextUrl);
    return;
  }

  let hasTabAuth = false;
  try {
    hasTabAuth = sessionStorage.getItem(TAB_AUTH_KEY) === "1";
  } catch {
    hasTabAuth = false;
  }

  if (!hasTabAuth) {
    fetch("/logout", {
      method: "GET",
      credentials: "same-origin",
      keepalive: true,
    }).finally(function () {
      window.location.replace("/login");
    });
  }
})();
