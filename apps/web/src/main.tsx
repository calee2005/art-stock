import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root");
}
createRoot(root).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
