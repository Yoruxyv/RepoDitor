import {
  contextBridge,
  ipcRenderer,
} from "electron";

contextBridge.exposeInMainWorld(
  "repoditor",
  {
    ping: () =>
      ipcRenderer.invoke("app:ping"),

    pingPython: () =>
      ipcRenderer.invoke("python:ping"),
  },
);