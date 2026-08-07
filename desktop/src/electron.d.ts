export {};

interface BridgeResponse {
  ok: boolean;
  message: string;
}

interface PythonBridgeResponse {
  ok: boolean;
  message: string;
  source: string;
}

declare global {
  interface Window {
    repoditor: {
      ping: () => Promise<BridgeResponse>;
      pingPython: () => Promise<PythonBridgeResponse>;
    };
  }
}