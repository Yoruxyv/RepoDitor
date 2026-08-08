# RepoDitor desktop

Run desktop commands from this directory. The renderer uses `@/` for imports
from `src` and `@electron/` for shared Electron contracts. Parent-directory
imports are not allowed; same-directory relatives remain valid.

The durable frontend quality gate is:

```powershell
npm run imports:check
npm run lint
npm run build
npm run bundle:check
npm test
npm run test:e2e
```

Use `npm run imports:preview` to inspect import normalization and
`npm run imports:fix` to apply it. The Electron-aware `dev`, `build`, and test
commands must remain intact.
