# Changelog

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
