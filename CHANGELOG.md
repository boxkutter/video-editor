# Changelog

## 0.2.1
- CSS: form controls never wider than their panel (the file input overflowed the media panel); the editor sets its own `box-sizing`, so it lays out the same in any host.

## 0.2.0
- `MediaRef.url`: a direct URL to play a file, used instead of `mediaUrl` (for a just-made export the host is still processing).
- The editor follows a changed `existingExport` (a host that finishes the video on its server can show the processed file).
- `prepare` script: installing from git builds the package.
- CSS: `align-items: flex-end` instead of `end` (wider support).

## 0.1.0
- Initial version.
