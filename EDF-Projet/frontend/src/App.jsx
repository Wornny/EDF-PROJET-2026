import { useState } from "react";
import Login from "./pages/Login";
import Menu from "./pages/Menu";
import C2 from "./pages/C2";
import CPO from "./pages/CPO";
import CM from "./pages/CM";

function resolveRoute() {
  const token = localStorage.getItem("authToken");
  if (!token) {
    return { page: "login" };
  }

  const pathname = window.location.pathname || "/";
  const c2Match = pathname.match(/^\/C2\/(\d+)$/i);
  if (c2Match) {
    return { page: "c2", c2Id: Number.parseInt(c2Match[1], 10) || 1 };
  }

  const cmMatch = pathname.match(/^\/CM\/(\d+)$/i);
  if (cmMatch) {
    return { page: "cm", cmId: Number.parseInt(cmMatch[1], 10) || 1 };
  }

  const legacyCmMatch = pathname.match(/^\/ControllerMobile\/(\d+)$/i);
  if (legacyCmMatch) {
    return { page: "cm", cmId: Number.parseInt(legacyCmMatch[1], 10) || 1 };
  }

  const cpoMatch = pathname.match(/^\/CPO\/(\d+)$/i);
  if (cpoMatch) {
    return { page: "cpo", cpoId: Number.parseInt(cpoMatch[1], 10) || 1 };
  }

  return { page: "menu" };
}

function App() {
  const [route, setRoute] = useState(resolveRoute);

  const goToMenu = () => {
    window.history.replaceState({}, "", "/menu");
    setRoute({ page: "menu" });
  };

  const handleLogout = () => {
    window.history.replaceState({}, "", "/");
    setRoute({ page: "login" });
  };

  if (route.page === "c2") {
    return <C2 c2Id={route.c2Id} />;
  }

  if (route.page === "cm") {
    return <CM cmId={route.cmId} />;
  }

  if (route.page === "cpo") {
    return <CPO cpoId={route.cpoId} />;
  }

  if (route.page === "menu") {
    return <Menu onLogout={handleLogout} />;
  }

  return <Login onLoginSuccess={goToMenu} />;
}

export default App;