"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./pwa-status.module.css";

type ConnectionState = "online" | "offline";

/**
 * Register the PWA worker and keep the connection/update affordances small.
 * The worker itself never receives user data from this component.
 */
export function PwaStatus() {
  const [connection, setConnection] = useState<ConnectionState>("online");
  const [updateReady, setUpdateReady] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const updateRequestedRef = useRef(false);

  useEffect(() => {
    const updateConnection = () => {
      setConnection(navigator.onLine ? "online" : "offline");
    };

    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);

    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;
    let installing: ServiceWorker | null = null;

    const showWaitingWorker = () => {
      if (!disposed && registration?.waiting && navigator.serviceWorker.controller) {
        setUpdateReady(true);
      }
    };

    const observeInstallingWorker = () => {
      installing = registration?.installing ?? null;
      installing?.addEventListener("statechange", () => {
        if (installing?.state === "installed") {
          showWaitingWorker();
        }
      });
    };

    const onControllerChange = () => {
      if (updateRequestedRef.current) {
        window.location.reload();
      }
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((nextRegistration) => {
          if (disposed) return;
          registration = nextRegistration;
          registrationRef.current = nextRegistration;
          showWaitingWorker();
          observeInstallingWorker();
          nextRegistration.addEventListener("updatefound", observeInstallingWorker);
          void nextRegistration.update().catch(() => {
            // A failed update check is harmless; the current worker remains active.
          });
        })
        .catch(() => {
          // PWA support is progressive; the application remains usable without it.
        });
    }

    return () => {
      disposed = true;
      installing = null;
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      }
      registration?.removeEventListener("updatefound", observeInstallingWorker);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    const waitingWorker = registrationRef.current?.waiting;
    if (!waitingWorker) {
      setUpdateReady(false);
      return;
    }

    updateRequestedRef.current = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }, []);

  return (
    <div className={styles.container} aria-live="polite">
      <span className={`${styles.connection} ${connection === "offline" ? styles.offline : styles.online}`}>
        {connection === "offline" ? "オフライン：保存済みの画面を表示中" : "オンライン"}
      </span>
      {updateReady && (
        <button className={styles.update} type="button" onClick={applyUpdate}>
          更新があります
        </button>
      )}
    </div>
  );
}
