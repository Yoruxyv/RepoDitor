import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    }),
  });

  Object.defineProperties(window.HTMLMediaElement.prototype, {
    pause: { configurable: true, value: () => undefined },
    play: { configurable: true, value: () => Promise.resolve() },
  });

  if (!window.HTMLDialogElement.prototype.showModal) {
    Object.defineProperties(window.HTMLDialogElement.prototype, {
      close: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.open = false;
        },
      },
      showModal: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.open = true;
        },
      },
    });
  }
}

afterEach(cleanup);
