import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/router";
import { PlanProvider } from "./app/planStore";

import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/utilities.css";
import "./components/warehouse-map/map.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlanProvider>
      <RouterProvider router={router} />
    </PlanProvider>
  </StrictMode>,
);
