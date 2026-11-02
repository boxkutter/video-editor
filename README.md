# @boxkutter/video-editor

An embeddable browser video editor. Record from the camera, screen or microphone, or upload media; trim, crop, split, align, fade, add titles and effects; arrange clips on a multi-track timeline; make a finished video. Every feature is an option, every word can be changed, and the look comes from CSS variables, so it can sit inside your own application.

- **Editing and rendering run in the browser.** Nothing is sent anywhere except through *your* adapter. No server-side transcoding, no third-party service.
- **You supply storage** through a small adapter (`mediaUrl`, `uploadMedia`, `saveProject`, `uploadExport`).
- **Three ways in:** a framework-free core, a React component, and a `<video-editor>` web component for everything else (Vue, Angular, Svelte, plain HTML, Capacitor/Ionic shells).
- **Accessible:** every drag has a typed or button equivalent; keyboard, screen-reader labels, live status (WCAG 2.2 AA aimed).

Browsers: current Chrome, Edge, Firefox. Safari cannot yet make the finished video (no canvas filters or WebM recording); the editor says so.

## Install

```bash
npm install @boxkutter/video-editor
```

It is published to GitHub Packages. Add to your `.npmrc`:

```text
@boxkutter:registry=https://npm.pkg.github.com
```

React is an optional peer dependency (needed only for `/react`).

## React

```tsx
import { VideoEditor } from "@boxkutter/video-editor/react";
import "@boxkutter/video-editor/styles.css";

<VideoEditor
  project={{ title: "Induction", width: 1280, height: 720, fps: 30, timeline: { assets: [], tracks: [] } }}
  adapter={{
    mediaUrl: (asset) => `/media/${asset.ref}`,                       // must support Range requests
    uploadMedia: async (file, kind, onProgress) => ({ ref: await myUpload(file, onProgress), kind }),
    saveProject: async (project) => { await myApi.save(project); },
    uploadExport: async (file, onProgress) => ({ ref: await myUpload(file, onProgress), kind: "video" }),
    onExported: (media) => myApi.attachToCourse(media.ref),
  }}
  options={{ features: { record: { screen: false }, effects: ["grayscale", "blur"], titles: true } }}
  labels={{ play: "Lecture" }}
/>
```

## Web component (no framework)

```html
<script type="module">
  import "@boxkutter/video-editor/element";
  const el = document.querySelector("video-editor");
  el.adapter = { mediaUrl, uploadMedia, saveProject, uploadExport };
  el.project = { title: "Demo", width: 1280, height: 720, fps: 30, timeline: { assets: [], tracks: [] } };
  el.options = { features: { library: false } };
  el.addEventListener("ve-change", (e) => console.log(e.detail));    // the project
</script>
<video-editor></video-editor>
```

Set properties, not attributes. It renders in the light DOM so your CSS variables and `styles.css` apply normally.

## Core (any UI)

`@boxkutter/video-editor` exports the timeline model and operations (`addAssetClip`, `splitClip`, `trimStart`, `moveClip`, `alignClip`, `setEffect`, …), the undo state (`reduce`), the player/renderer (`VideoEngine`), recording (`openCapture`, `Recorder`), configuration (`resolveConfig`) and labels. Build any interface on it. The project data is described by `schema/timeline.schema.json`, so native apps and server-side renderers can read and write the same projects.

## Mobile

- **Capacitor, Ionic, Cordova, PWA, WebView shells:** use the web component or React component. Grant the shell camera and microphone permission. Screen recording needs a browser that offers `getDisplayMedia`; turn it off elsewhere with `features.record.screen: false`.
- **React Native, Flutter, native:** use the timeline schema and the core's rules as the shared format. A native UI and a native recorder/renderer implement the same data; the web editor can open projects they make and the reverse. A native adapter is not included.

## The adapter

| Function | Needed for | Notes |
|---|---|---|
| `mediaUrl(asset)` | everything | A URL the browser can play. Same origin, or CORS-enabled with `options.crossOrigin: "anonymous"`. Must support `Range`. |
| `uploadMedia(file, kind, onProgress)` | upload, recording | Return `{ ref, kind }`. Throw to refuse; the message is shown. Missing: upload and recording are off. |
| `uploadExport(file, onProgress, project)` | making the video | Missing: no export. |
| `saveProject(project)` | autosave, Save | Missing: no saving UI. |
| `pickMedia(kinds)` | `features.library` | Your own media library. |
| `onChange`, `onExported`, `onError` | | Hooks for your app. |

## Options

Pass only what differs from the defaults (`DEFAULT_CONFIG`).

```ts
options={{
  features: {
    upload: true | { kinds: ["video","audio"], accept: "video/mp4" },
    record: true | { camera: true, screen: false, microphone: true },
    library, split, trim, crop: true | { presets: [["Banner", 3]] },
    speed, fades, volume, placement,
    effects: true | ["grayscale", "blur"],
    titles, tracks, arrange, history, zoom, export,
    preview, mediaPanel, inspector, projectBar,
  },
  limits: { maxDurationMs, maxTracks, maxClips, maxAssets, maxUploadBytes },
  canvas: { width, height, fps, sizes: [...], fpsChoices: [...] },
  autosave: 1500 | false,
  zoom: 60,
  crossOrigin: "anonymous",
}}
```

## Fitting it in

- **Words:** `labels={{ ... }}` replaces any text (see `DEFAULT_LABELS`), including translations; `{name}` style placeholders are kept.
- **Look:** set `--ve-accent`, `--ve-bg`, `--ve-text`, `--ve-border`, `--ve-radius`, `--ve-font` and the rest listed at the top of `styles.css` on any ancestor. Dark mode follows `prefers-color-scheme`, or set `data-theme="dark" | "light"` on `.ve-root`.
- **Your own styles:** skip `styles.css`, target the `.ve-*` classes, or pass `classNames={{ button: "btn", buttonSecondary: "btn btn-outline", input: "form-control", panel: "card" }}`.
- **Extra UI:** `header` (above the editor) and `exportActions(media, project)` (after the video is made, for "use in a course" style buttons).
- **Imperative:** `ref` gives `getProject()` and `save()`.

## Limits

- Making the video takes as long as the video lasts and needs the tab open and visible.
- Output is WebM where the browser supports it. Messages from the engine itself (for example "Export cancelled.") are English.
- Media files are not validated by the package; validate on your server (type, size, malware scan). Your server should also validate the saved timeline against the schema.

## Development

```bash
npm install
npm run typecheck && npm test && npm run build
```

Release: bump `version`, tag `vX.Y.Z`, `npm publish`.
