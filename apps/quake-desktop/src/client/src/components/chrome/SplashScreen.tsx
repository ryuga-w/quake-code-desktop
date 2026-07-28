import React from "react";
import styles from "./SplashScreen.module.css";

export function SplashScreen({ fading = false }: { fading?: boolean }) {
  return (
    <div
      className={`${styles.root} ${fading ? styles.fading : ""}`}
      aria-label="Quake Code"
      data-component="splash-screen"
    >
      <img className={styles.logo} src="/quake-code-q.png" alt="" aria-hidden="true" />
    </div>
  );
}

export default SplashScreen;
