# Changelog

## 0.4.0
- **Media on tabs**: Project, Library, Upload, Record and Effects. Recording is a tab of its own (it
  carries on while you look at another tab). Upload also takes files dropped onto it.
- **The library in place**: a new `adapter.listMedia(kinds)` lists the host's files (`LibraryItem`:
  `group`, `groupNote`, `thumbnailUrl`) as tiles inside the editor, so no separate window is needed.
  `libraryKey` lists them again. `pickMedia` still works for hosts without `listMedia`.
- **Drag and drop onto the timeline**: library tiles and the project's files land on the track and at
  the time where they are dropped (snapped like a moved clip), with a marker showing where. Choosing a
  tile instead adds it at the playhead.
- **Looks and transitions** (`core/styles.ts`): ready-made looks (black and white, warm, vivid, bright,
  moody, faded film, soft focus) and fades (in, out, both, dip through black at a cut), dropped onto a
  clip or applied to the selected one. They are made of a clip's existing effects and fades, so the
  timeline schema is unchanged.
- `barStart`: content at the start of the top bar, before the title (for example a link back to the
  host's list of videos), so hosts need not spend a row above the editor on it.
- The media column is a little wider (`--ve-media-side`, default `clamp(16.5rem, 22vw, 21rem)`) so its tabs fit on one row.
- `probeUrl(url, kind)`: length and size of a file the host holds (used for library files of unknown length).

## 0.3.0
- **Workspace layout** (default, `options.layout: "workspace"`), like a desktop video editor: a slim top
  bar (title edited in place, picture size and frame rate in a popover, undo/redo, saving, Export), then
  media, preview and clip settings side by side with the timeline across the bottom. The workspace is the
  host's height (`--ve-height`; timeline `--ve-timeline-height`, side columns `--ve-side`) and each part
  scrolls on its own, so selecting a clip or opening a section never moves the others. Narrow screens
  stack the parts (preview, timeline, media, settings). `layout: "stacked"` keeps one column.
- The preview fills its area without cropping; the position slider sits in the transport bar.
- Export opens over the workspace and stays mounted while it runs.
- Recording folds away in the media panel; the timeline's help is behind "How to edit".
- Transport: icon buttons for to-start, back and forward (their words are the buttons' labels and tooltips).
- Shorter timeline tool words (`Split`, `Delete`, `Delete + close gap`, `Close gaps`, `+ Video track`, `+ Audio track`), each with a tooltip (`*Help` labels).
- New labels: `projectBar`, `videoSettings`, `fps`, `history`, `export`, `close`, `howToEdit`, and the `*Help` tooltips.

## 0.2.1
- CSS: form controls never wider than their panel (the file input overflowed the media panel); the editor sets its own `box-sizing`, so it lays out the same in any host.

## 0.2.0
- `MediaRef.url`: a direct URL to play a file, used instead of `mediaUrl` (for a just-made export the host is still processing).
- The editor follows a changed `existingExport` (a host that finishes the video on its server can show the processed file).
- `prepare` script: installing from git builds the package.
- CSS: `align-items: flex-end` instead of `end` (wider support).

## 0.1.0
- Initial version.
