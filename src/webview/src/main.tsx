import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import { App } from "./App";
import { ComputerActivityRoot } from "./components/computerActivity/ComputerActivityRoot";

const computerOverlay = window.location.hash === "#computer-activity";
if (computerOverlay) document.documentElement.classList.add("computer-overlay-host");

const container = document.getElementById("root");
if (!container) throw new Error("#root missing in index.html");

createRoot(container).render(
  <StrictMode>
    {computerOverlay ? <ComputerActivityRoot /> : <App />}
  </StrictMode>,
);
