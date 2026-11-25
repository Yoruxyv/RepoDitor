import { CheckIcon, CopyIcon, FolderOpenIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { TranslationKey } from "@/app/i18n/catalog";
import { useI18n } from "@/app/i18n/context";
import {
  detectInitialGuidancePlatform,
  PROTON_REPO_SUFFIX,
  type GuidancePlatform,
  WINDOWS_META_PATH,
  WINDOWS_RUN_PATH,
} from "@/features/save-file/saveLocations";

const WINDOWS_PATH_STEP_KEYS = [
  "save.find.pressWinR",
  "save.find.pastePath",
  "save.find.pressEnter",
] as const satisfies readonly TranslationKey[];

interface CopyPathButtonProps {
  readonly labelKey: TranslationKey;
  readonly onCopy: (path: string, labelKey: TranslationKey) => void;
  readonly path: string;
}

function CopyPathButton({ labelKey, onCopy, path }: CopyPathButtonProps) {
  const { t } = useI18n();
  return (
    <button
      aria-label={t("save.find.copyLabel", { label: t(labelKey) })}
      className="inline-flex shrink-0 items-center gap-2 rounded-sm border border-control px-3 py-2 text-xs font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
      onClick={() => onCopy(path, labelKey)}
      type="button"
    >
      <CopyIcon aria-hidden="true" size={15} />
      {t("save.find.copyPath")}
    </button>
  );
}

interface PathBlockProps {
  readonly children: ReactNode;
  readonly copyLabelKey: TranslationKey;
  readonly heading: string;
  readonly id: string;
  readonly onCopy: (path: string, labelKey: TranslationKey) => void;
  readonly path: string;
}

function PathBlock({ children, copyLabelKey, heading, id, onCopy, path }: PathBlockProps) {
  const headingId = `${id}-title`;
  return (
    <section aria-labelledby={headingId} className="border-t border-line pt-4">
      <h3 className="text-sm font-semibold text-ink" id={headingId}>
        {heading}
      </h3>
      <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <code className="min-w-0 select-text whitespace-normal break-all rounded-sm bg-app px-3 py-2 font-mono text-xs/5 text-secondary">
          {path}
        </code>
        <CopyPathButton labelKey={copyLabelKey} onCopy={onCopy} path={path} />
      </div>
      {children}
    </section>
  );
}

export function FindSaveDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<GuidancePlatform>(detectInitialGuidancePlatform);
  const [copyStatus, setCopyStatus] = useState<
    | { readonly labelKey: TranslationKey; readonly status: "copied" }
    | { readonly status: "error" }
    | null
  >(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const windowsTabRef = useRef<HTMLButtonElement>(null);
  const linuxTabRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open) {
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") {
          dialog.showModal();
        } else {
          dialog.setAttribute("open", "");
        }
      }
      closeRef.current?.focus();
      return;
    }
    if (dialog.open) {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    }
    if (returnFocus.current) {
      triggerRef.current?.focus();
      returnFocus.current = false;
    }
  }, [open]);

  function closeDialog(): void {
    returnFocus.current = true;
    setOpen(false);
  }

  function choosePlatform(next: GuidancePlatform): void {
    setPlatform(next);
    setCopyStatus(null);
  }

  function movePlatformTab(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const next = platform === "windows" ? "linux" : "windows";
    choosePlatform(next);
    (next === "windows" ? windowsTabRef : linuxTabRef).current?.focus();
  }

  async function copyPath(path: string, labelKey: TranslationKey): Promise<void> {
    try {
      await navigator.clipboard.writeText(path);
      setCopyStatus({ labelKey, status: "copied" });
    } catch {
      setCopyStatus({ status: "error" });
    }
  }

  let copyMessage = "";
  if (copyStatus?.status === "copied") {
    copyMessage = t("save.find.copied", { label: t(copyStatus.labelKey) });
  } else if (copyStatus?.status === "error") {
    copyMessage = t("save.find.copyFailed");
  }

  return (
    <>
      <button
        className="inline-flex items-center gap-2 whitespace-nowrap rounded-sm border border-control px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        <FolderOpenIcon aria-hidden="true" size={17} />
        {t("save.find.action")}
      </button>

      <dialog
        aria-labelledby="find-save-title"
        aria-modal="true"
        className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-sm border border-line bg-surface p-0 text-ink shadow-panel backdrop:bg-app/85"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        ref={dialogRef}
      >
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-4 p-5 pb-0 sm:p-6 sm:pb-0">
            <div>
              <h2
                className="font-display text-4xl font-semibold uppercase leading-none text-ink"
                id="find-save-title"
              >
                {t("save.find.title")}
              </h2>
              <p className="mt-2 max-w-xl text-sm/6 text-secondary">{t("save.find.intro")}</p>
            </div>
            <button
              aria-label={t("save.find.close")}
              className="grid size-10 place-items-center rounded-sm border border-control text-secondary transition-colors hover:border-accent hover:text-accent"
              onClick={closeDialog}
              ref={closeRef}
              type="button"
            >
              <XIcon aria-hidden="true" size={18} />
            </button>
          </header>

          <div
            className="min-h-0 min-w-0 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6"
            data-testid="find-save-scroll-region"
          >
            <div
              aria-label={t("save.find.platform")}
              className="mt-5 flex border-b border-line"
              role="tablist"
            >
              {(["windows", "linux"] as const).map((entry) => (
                <button
                  aria-controls={`find-save-${entry}-panel`}
                  aria-selected={platform === entry}
                  className="-mb-px border-b-2 border-transparent px-3 py-2.5 text-sm font-semibold text-secondary transition-colors hover:text-ink aria-selected:border-accent aria-selected:text-accent"
                  id={`find-save-${entry}-tab`}
                  key={entry}
                  onClick={() => choosePlatform(entry)}
                  onKeyDown={movePlatformTab}
                  ref={entry === "windows" ? windowsTabRef : linuxTabRef}
                  role="tab"
                  tabIndex={platform === entry ? 0 : -1}
                  type="button"
                >
                  {t(entry === "windows" ? "save.find.windows" : "save.find.linux")}
                </button>
              ))}
            </div>

            {platform === "windows" ? (
              <div
                aria-labelledby="find-save-windows-tab"
                className="mt-5 grid gap-5"
                id="find-save-windows-panel"
                role="tabpanel"
              >
                <PathBlock
                  copyLabelKey="save.find.windowsRunPath"
                  heading={t("save.find.runSaves")}
                  id="windows-run-path"
                  onCopy={(path, label) => void copyPath(path, label)}
                  path={WINDOWS_RUN_PATH}
                >
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm/6 text-secondary">
                    {WINDOWS_PATH_STEP_KEYS.map((key) => (
                      <li key={key}>{t(key)}</li>
                    ))}
                    <li>{t("save.find.selectRun")}</li>
                  </ol>
                </PathBlock>

                <PathBlock
                  copyLabelKey="save.find.windowsMetaPath"
                  heading={t("save.find.cosmetics")}
                  id="windows-meta-path"
                  onCopy={(path, label) => void copyPath(path, label)}
                  path={WINDOWS_META_PATH}
                >
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm/6 text-secondary">
                    {WINDOWS_PATH_STEP_KEYS.map((key) => (
                      <li key={key}>{t(key)}</li>
                    ))}
                    <li>{t("save.find.selectMeta")}</li>
                  </ol>
                </PathBlock>
              </div>
            ) : (
              <div
                aria-labelledby="find-save-linux-tab"
                className="mt-5 grid gap-5"
                id="find-save-linux-panel"
                role="tabpanel"
              >
                <p className="text-sm/6 text-secondary">{t("save.find.locateSteam")}</p>
                <PathBlock
                  copyLabelKey="save.find.protonPath"
                  heading={t("save.find.protonDirectory")}
                  id="linux-proton-path"
                  onCopy={(path, label) => void copyPath(path, label)}
                  path={PROTON_REPO_SUFFIX}
                >
                  <p className="mt-3 text-sm/6 text-secondary">{t("save.find.linuxInstruction")}</p>
                </PathBlock>
                <section className="border-t border-line pt-4">
                  <h3 className="text-sm font-semibold text-ink">{t("save.find.steamRoots")}</h3>
                  <div className="mt-2 grid gap-1 font-mono text-xs/5 text-secondary">
                    <code>~/.local/share/Steam/</code>
                    <code>~/.steam/steam/</code>
                  </div>
                  <p className="mt-2 text-sm/6 text-secondary">{t("save.find.customLibrary")}</p>
                </section>
              </div>
            )}

            <output
              aria-live="polite"
              className={
                copyStatus
                  ? "mt-4 flex min-h-5 items-center gap-2 text-xs text-secondary"
                  : "sr-only"
              }
            >
              {copyStatus ? (
                <CheckIcon aria-hidden="true" className="text-accent" size={15} />
              ) : null}
              {copyMessage}
            </output>
          </div>
        </div>
      </dialog>
    </>
  );
}
