# Screenshot Pro

![GNOME](https://img.shields.io/badge/GNOME-45--50+-4A86CF?logo=gnome&logoColor=white)
![License](https://img.shields.io/badge/License-GPL--3.0-blue)

A GNOME Shell extension that restores classic drag-to-capture screenshot behavior — press a key, drag to select, release to capture. The image lands in your clipboard immediately, with optional one-key OCR.

## Features

- **Instant capture.** Hides GNOME's central selection rectangle so the screenshot UI activates straight into drag mode.
- **Clipboard-first.** Captured images go directly to the clipboard. No save dialog, no notification.
- **Inline OCR.** Hold `R` while capturing and the selection is run through `tesseract`; the extracted text replaces the image on the clipboard.
- **Suppressed notifications.** Default GNOME screenshot toasts are blocked while the extension is active.
- **Keyboard configurable.** Triggered by GNOME's standard "Take a screenshot interactively" shortcut — bind `F` (or anything else) via Settings → Keyboard.

## Requirements

- GNOME Shell 45 – 50.1
- `tesseract` on `$PATH` (only required for OCR mode)

## Install

From the packaged ZIP:

```bash
gnome-extensions install screenshot-pro@deepan.alve.shell-extension.zip
gnome-extensions enable  screenshot-pro@deepan.alve
```

Then bind a key in **Settings → Keyboard → Keyboard Shortcuts → Take a screenshot interactively**.

## Usage

| Key (during selection) | Action                             |
| ---------------------- | ---------------------------------- |
| Drag + release         | Capture to clipboard               |
| Hold `R` + release     | Capture, OCR, copy text to clipboard |

## Build from source

```bash
git clone https://github.com/deepan-alve/screenshot-pro.git
cd screenshot-pro
gnome-extensions pack --force --podir=.
```

Produces `screenshot-pro@deepan.alve.shell-extension.zip` ready to install.

## License

[GPL-3.0-or-later](LICENSE) — Copyright (C) 2026 Deepan Alve
