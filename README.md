# Screenshot Pro

![GNOME Extension Version](https://img.shields.io/badge/GNOME%20Extension-1.0.0-blue) ![License](https://img.shields.io/badge/License-GPL--3.0-blue)

**Screenshot Pro** provides a fast, drag‑and‑release screenshot workflow for GNOME Shell. It quietly hides the default overlay and automatically copies the captured image to the clipboard.

---

## Features

- **Instant capture (F key)** – Press the configured **F** shortcut, drag to select an area and release to capture instantly.
- **OCR integration (R key)** – After a capture, press **R** to run OCR; the extracted text is copied to the clipboard.
- **No UI flash** – The default central rectangle overlay stays hidden until you start dragging.
- **Clipboard ready** – Captured images are automatically placed in the clipboard (compatible with Vicuna).
- **Keyboard‑friendly** – Fully configurable via GNOME custom shortcuts or `keyd`.

---

## Compatibility

Works on GNOME 45‑50+ (including 50.1).

---

## Installation

```bash
# Install the extension from the packaged ZIP
$ gnome-extensions install screenshot-pro@deepan.alve.shell-extension.zip
# Enable it
$ gnome-extensions enable screenshot-pro@deepan.alve
```

Or upload the ZIP to the [GNOME Extensions website](https://extensions.gnome.org) for automatic updates.

---

## Building the ZIP

If you need to rebuild the package after making changes:

```bash
cd /home/deepan/screenshot-pro
# Pack the extension (force overwrites existing zip)
$ gnome-extensions pack --force --podir=.
```

The resulting file will be named `screenshot-pro@deepan.alve.shell-extension.zip`.

---

## Screenshots

*Add a screenshot of the extension in action here.*

---

## License

GNU GPL‑3.0 – see the `LICENSE` file for details.
](https://extensions.gnome.org).
