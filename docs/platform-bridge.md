# Platform Bridge Contract

The application UI calls platform capabilities only through `window.bgmApi`.
Adapters are created and validated by `platform-contract.js`.

## Runtime discovery

`platform/platform-loader.js` selects the first available adapter:

1. Electron
2. Capacitor Android
3. Browser preview

The resulting adapter exposes:

```js
window.bgmApi.platform
window.bgmApi.capabilities
window.bgmApi.secureStorage
```

## Web build

Build the Capacitor-ready web artifact with:

```powershell
pnpm build:web
pnpm check:web
```

The build writes only an explicit runtime allowlist to `dist/`. Browser
dependencies are copied to `dist/vendor/`, and all `node_modules` references in
`index.html` are rewritten before the build is accepted.

`dist/` is generated output and must not be committed. Capacitor will use:

```js
webDir: "dist"
```

The validator checks required files, relative asset resolution, forbidden local
data and key files, absolute paths, empty text files, and the 2 MB size budget.
It can be run independently with `pnpm check:web`.

## Required methods

- `loadDatabase`
- `saveDatabase`
- `requestBangumi`
- `aiChat`
- `onSystemResume`
- `exportBackup`
- `importBackup`
- `exportAllMarkdown`
- `exportOneMarkdown`
- `chooseYearbookImage`
- `captureYearbookViewport`
- `saveYearbookImage`
- `revealDatabase`
- `getDatabasePath`
- `secureStorage.get`
- `secureStorage.set`
- `secureStorage.remove`

If an adapter omits a method, the contract installs an explicit unsupported
implementation. A capability marked `true` must have a real implementation or
validation fails at startup.

## Capability matrix

| Capability | Electron | Browser preview | Android placeholder |
| --- | --- | --- | --- |
| Database | Yes | localStorage | No |
| Bangumi requests | Yes | Yes, CORS permitting | No |
| AI requests | Yes | Yes, CORS permitting | No |
| Backup export | Yes | Download | No |
| Backup import | Yes | Browser file input | No |
| Markdown export | Yes | Download | No |
| Yearbook image | Yes | No | No |
| Embedded AI webpage | Yes | No | No |
| System resume event | Yes | No-op | No |
| Reveal database | Yes | No | No |
| Secure storage | Not yet | Not yet | Reserved |

The Android placeholder is intentionally not a working storage or network
adapter. Native Filesystem, CapacitorHttp, Share, App and secure-storage
implementations belong to the Android implementation phase.

## Error format

Unsupported asynchronous operations return:

```js
{
  ok: false,
  unsupported: true,
  error: "当前平台暂不支持 operationName。"
}
```

`onSystemResume` returns a no-op unsubscribe function when unsupported.

## Security rules

- The renderer must not access Electron IPC directly.
- Platform adapters must not log API keys, Bangumi tokens, or database content.
- Bangumi requests remain restricted to `https://api.bgm.tv/`.
- AI endpoints use HTTPS, except loopback HTTP for local models.
- Android secure storage must use the Android Keystore-backed implementation
  before the application stores credentials there.

## Platform-specific follow-up

- Electron: retain the current IPC and file dialogs.
- Android database: Capacitor Filesystem under application-private storage.
- Android network: CapacitorHttp with the same response shapes.
- Android export: Filesystem plus Share or the system file picker.
- Android resume: Capacitor App state events.
- Android yearbook capture: replace Electron viewport capture with a mobile
  renderer or native screenshot plugin.
