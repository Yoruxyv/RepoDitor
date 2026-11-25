import { invoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { usePreferences } from "@/app/preferences/preferences";

const STORAGE_KEY = "repoditor.migration.electron-0.2.1";
const REMINDER_DELAY = 7 * 24 * 60 * 60 * 1000;
const SECONDARY_ACTION =
  "ui-feedback rounded-sm border border-control px-3 py-1.5 font-semibold text-secondary hover:bg-surface hover:text-ink";

function reminderIsDeferred() {
  try {
    const decision = localStorage.getItem(STORAGE_KEY);
    const remindAfter = Number(decision);
    return decision === "dismissed" || (Number.isFinite(remindAfter) && remindAfter > Date.now());
  } catch {
    return false;
  }
}

export function TauriLegacyInstallNotice({ suspended = false }: { readonly suspended?: boolean }) {
  const { t } = usePreferences();
  const [registered, setRegistered] = useState(false);
  const [dismissed, setDismissed] = useState(reminderIsDeferred);
  const [settingsFailed, setSettingsFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const laterButton = useRef<HTMLButtonElement>(null);
  const visible = registered && !dismissed && !suspended;

  useLayoutEffect(() => {
    const modal = dialog.current;
    if (!visible || !modal) return;
    modal.showModal();
    laterButton.current?.focus();
    return () => {
      if (modal.open) modal.close();
    };
  }, [visible]);

  useEffect(() => {
    if (dismissed) return;
    let active = true;
    let checking = false;
    let found = false;

    async function check() {
      if (!active || checking) return;
      checking = true;
      try {
        found = (await invoke<boolean>("legacy_install_registered")) === true;
      } catch {
        found = false;
      }
      checking = false;
      if (active) setRegistered(found);
    }
    function recheckVisibleNotice() {
      if (found) void check();
    }

    // A StrictMode effect that has already been cleaned up can skip its probe.
    queueMicrotask(() => void check());
    window.addEventListener("focus", recheckVisibleNotice);
    return () => {
      active = false;
      window.removeEventListener("focus", recheckVisibleNotice);
    };
  }, [dismissed]);

  function dismiss(decision: string) {
    try {
      localStorage.setItem(STORAGE_KEY, decision);
    } catch {
      // Keep the notice closed for this session when storage is blocked.
    }
    setDismissed(true);
  }

  function remindLater() {
    dismiss(String(Date.now() + REMINDER_DELAY));
  }

  async function openSettings() {
    try {
      setSettingsFailed((await invoke<boolean>("open_installed_apps")) !== true);
    } catch {
      setSettingsFailed(true);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="legacy-install-title"
      aria-describedby="legacy-install-description"
      aria-modal="true"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-sm border border-control bg-surface p-4 text-ink shadow-lg backdrop:bg-black/60 sm:p-6"
      onCancel={(event) => {
        event.preventDefault();
        remindLater();
      }}
    >
      <h2 className="text-lg font-semibold" id="legacy-install-title">
        {t("migration.title")}
      </h2>
      <p className="mt-3 text-sm/6 text-secondary" id="legacy-install-description">
        {t("migration.description")}
      </p>
      <div className="mt-5 flex flex-wrap gap-2 text-sm">
        <button
          className="ui-feedback rounded-sm bg-accent px-3 py-1.5 font-semibold text-accent-ink hover:brightness-110"
          type="button"
          onClick={() => void openSettings()}
        >
          {t("migration.openInstalledApps")}
        </button>
        <button ref={laterButton} className={SECONDARY_ACTION} type="button" onClick={remindLater}>
          {t("migration.remindLater")}
        </button>
        <button className={SECONDARY_ACTION} type="button" onClick={() => dismiss("dismissed")}>
          {t("migration.dismiss")}
        </button>
      </div>
      {settingsFailed ? (
        <output className="mt-2 block text-sm text-secondary">
          {t("migration.settingsUnavailable")}
        </output>
      ) : null}
    </dialog>
  );
}
