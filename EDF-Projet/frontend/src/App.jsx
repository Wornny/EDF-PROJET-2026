import { useState } from "react";
import Login from "./pages/Login";
import Menu from "./pages/Menu";
import C2 from "./pages/C2";

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

  if (route.page === "menu") {
    return <Menu onLogout={handleLogout} />;
  }

  return <Login onLoginSuccess={goToMenu} />;
}

export default App;