import { useCallback, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { api, getToken } from "./api.js";
import Sidebar from "./components/Sidebar.jsx";
import Login from "./pages/Login.jsx";
import Home from "./pages/Home.jsx";
import MandatePage from "./pages/Mandate.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Observability from "./pages/Observability.jsx";
import SearchPage from "./pages/Search.jsx";
import Clients from "./pages/Clients.jsx";
import Settings from "./pages/Settings.jsx";

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [health, setHealth] = useState(null);
  const [mandates, setMandates] = useState([]);

  const refreshMandates = useCallback(() => api.get("/mandates").then(setMandates).catch(() => {}), []);

  useEffect(() => {
    if (!authed) return;
    api.get("/health").then(setHealth).catch(() => {});
    refreshMandates();
  }, [authed, refreshMandates]);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const ctx = { health, mandates, refreshMandates };
  return (
    <div className="shell">
      <Sidebar mandates={mandates} health={health} />
      <main className="main">
        <Routes>
          <Route path="/" element={<Home {...ctx} />} />
          <Route path="/mandates/:id" element={<MandatePage {...ctx} />} />
          <Route path="/mandates/:id/:tab" element={<MandatePage {...ctx} />} />
          <Route path="/dashboard" element={<Dashboard {...ctx} />} />
          <Route path="/observability" element={<Observability {...ctx} />} />
          <Route path="/search" element={<SearchPage {...ctx} />} />
          <Route path="/clients" element={<Clients {...ctx} />} />
          <Route path="/settings" element={<Settings {...ctx} />} />
        </Routes>
      </main>
    </div>
  );
}
