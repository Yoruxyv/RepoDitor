/** Separate preview entry; the default Electron bootstrap remains unchanged. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { TauriDiscovery } from "@/features/discovery/TauriDiscovery";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TauriDiscovery />
  </StrictMode>,
);
