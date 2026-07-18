import React from "react";
import { createRoot } from "react-dom/client";
import { SplashScreen } from "./components/chrome/SplashScreen";
import { AppErrorBoundary } from "./components/common/AppErrorBoundary";
import { installChunkLoadRecovery } from "./lib/chunk-load-recovery";
import { applyStoredAppearanceRuntimeAttributes } from "./lib/appearance-runtime";
import { configureLocalMonaco } from "./lib/monaco";
import { App } from "./app/App";
import "../tailwind.css";
import "../styles.css";
import "../foundation.css";
import "./components/timeline/timeline.css";
import "../styles-responsive.css";

installChunkLoadRecovery();
applyStoredAppearanceRuntimeAttributes();

// Monaco CDN kullanmaz; npm paketi ve worker'lar Vite bundle'ından gelir.
configureLocalMonaco();

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <React.Suspense fallback={<SplashScreen />}>
      <App />
    </React.Suspense>
  </AppErrorBoundary>,
);
