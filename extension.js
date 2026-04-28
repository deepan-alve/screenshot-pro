import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';

const DEBUG = true;
const LOG_FILE_PATH = GLib.get_home_dir() + '/instant-capture-debug.log';

function logDebug(msg) {
    if (!DEBUG) return;
    
    // Log to standard output (viewable in journalctl)
    console.debug(`[InstantCapture] ${msg}`);
    
    // Auto-save to a physical file so it survives a GNOME Shell crash
    try {
        const file = Gio.File.new_for_path(LOG_FILE_PATH);
        // append_to opens the stream at the end of the file
        const stream = file.append_to(Gio.FileCreateFlags.NONE, null);
        const timestamp = new GLib.DateTime().format('%Y-%m-%d %H:%M:%S');
        const formattedMsg = `[${timestamp}] ${msg}\n`;
        
        // Write and close instantly to ensure it flushes to disk immediately
        stream.write_all(formattedMsg, null);
        stream.close(null);
    } catch (e) {
        console.error(`[InstantCapture] Failed to write to log file: ${e.message}`);
    }
}

export default class AutoCaptureScreenshotExtension extends Extension {
    enable() {
        logDebug('Extension enabling...');
        const ui = Main.screenshotUI;
        if (!ui || !ui._areaSelector) {
            logDebug('Failed to find screenshotUI or areaSelector. Aborting enable.');
            return;
        }

        const AreaSelectorClass = ui._areaSelector.constructor;
        const ScreenshotUIClass = ui.constructor;
        const ext = this;

        // --- PART 0: KEY TRACKING ---
        this._isFDown = false;
        this._isRDown = false;
        this._blockImageCopy = false;

        const clipboard = St.Clipboard.get_default();
        this._origSetContent = clipboard.set_content;
        clipboard.set_content = function(type, format, bytes) {
            if (ext._blockImageCopy && format === 'image/png') {
                logDebug('Blocked image copy to clipboard.');
                return;
            }
            if (ext._origSetContent) {
                return ext._origSetContent.apply(this, arguments);
            }
        };

        ext._blockAllNotificationsUntil = 0;

        this._origMessageTrayAdd = Main.messageTray.add;
        Main.messageTray.add = function(source) {
            if (Date.now() < ext._blockAllNotificationsUntil) {
                logDebug('Blocked notification via Main.messageTray.add');
                if (source && typeof source.showNotification === 'function') {
                    source.showNotification = function() {};
                }
                return;
            }
            if (ext._origMessageTrayAdd) {
                return ext._origMessageTrayAdd.apply(this, arguments);
            }
        };

        this._keyPressId = ui.connect('key-press-event', (actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_f || symbol === Clutter.KEY_F) {
                if (!ext._isFDown) logDebug('Key F pressed');
                ext._isFDown = true;
                return Clutter.EVENT_STOP;
            } else if (symbol === Clutter.KEY_r || symbol === Clutter.KEY_R) {
                if (!ext._isRDown) logDebug('Key R pressed');
                ext._isRDown = true;
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._keyReleaseId = ui.connect('key-release-event', (actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_f || symbol === Clutter.KEY_F) {
                if (ext._isFDown) logDebug('Key F released');
                ext._isFDown = false;
                return Clutter.EVENT_STOP;
            } else if (symbol === Clutter.KEY_r || symbol === Clutter.KEY_R) {
                if (ext._isRDown) logDebug('Key R released');
                ext._isRDown = false;
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // --- PART 1: AUTO-CAPTURE ON RELEASE ---
        this._origStopDrag = AreaSelectorClass.prototype.stopDrag;
        this._isCapturing = false;

        AreaSelectorClass.prototype.stopDrag = function() {
            const wasClickWithoutDrag = (
                this._dragCursor === Clutter.CursorType.CROSSHAIR &&
                this._lastX === this._startX &&
                this._lastY === this._startY
            );

            logDebug(`stopDrag triggered. wasClickWithoutDrag: ${wasClickWithoutDrag}`);

            ext._origStopDrag.apply(this, arguments);

            if (!ext._isCapturing && !wasClickWithoutDrag) {
                ext._isCapturing = true;
                // Universally block ALL GNOME notifications for 5 seconds
                ext._blockAllNotificationsUntil = Date.now() + 5000;
                logDebug('Initiating auto-capture sequence.');

                // Capture key states precisely at release time
                const doOCR = ext._isRDown;
                const doCopyPath = ext._isFDown;
                
                // Immediately reset to prevent keys from getting stuck when UI closes
                ext._isRDown = false;
                ext._isFDown = false;
                
                logDebug(`Key states at release - OCR (r): ${doOCR}, Copy Path (f): ${doCopyPath}`);
                
                if (doOCR || doCopyPath) {
                    ext._blockImageCopy = true;
                }
                
                const activeUI = Main.screenshotUI;
                logDebug('Attaching screenshot-taken listener.');
                
                // Helper to force external clipboard managers to notice the copy
                const copyToClipboard = (text, isImage = false, filePath = '') => {
                    try {
                        if (isImage) {
                            const proc = Gio.Subprocess.new(
                                ['bash', '-c', `wl-copy -t image/png < "${filePath}"`],
                                Gio.SubprocessFlags.NONE
                            );
                            proc.wait_async(null, (proc, res) => {
                                try {
                                    proc.wait_finish(res);
                                    logDebug('wl-copy image executed successfully.');
                                } catch (e) {
                                    logDebug(`wl-copy image error: ${e.message}`);
                                }
                            });
                        } else {
                            const proc = Gio.Subprocess.new(
                                ['wl-copy'],
                                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                            );
                            proc.communicate_utf8_async(text, null, (proc, res) => {
                                try {
                                    proc.communicate_utf8_finish(res);
                                    logDebug('wl-copy executed successfully.');
                                } catch (e) {
                                    logDebug(`wl-copy error: ${e.message}, falling back to St.Clipboard`);
                                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                                }
                            });
                        }
                    } catch (e) {
                        logDebug(`Failed to launch wl-copy: ${e.message}, falling back to St.Clipboard`);
                        if (!isImage) St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                    }
                };

                // Connect a one-time listener for the file saving
                const signalId = activeUI.connect('screenshot-taken', (ui, file) => {
                    logDebug(`screenshot-taken signal received. Signal ID: ${signalId}`);
                    activeUI.disconnect(signalId);
                    
                    // Reset block states since the capture is complete
                    ext._blockImageCopy = false;
                    
                    const filePath = file.get_path();
                    logDebug(`Screenshot saved to: ${filePath}`);

                    if (doOCR) {
                        // OCR takes priority if both are held
                        logDebug('Executing OCR task...');
                        try {
                            const proc = Gio.Subprocess.new(
                                ['tesseract', filePath, 'stdout'],
                                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                            );
                            logDebug('Tesseract subprocess spawned.');
                            proc.communicate_utf8_async(null, null, (proc, res) => {
                                try {
                                    const [, stdout, stderr] = proc.communicate_utf8_finish(res);
                                    if (stdout && stdout.trim()) {
                                        logDebug('OCR completed successfully. Copying to clipboard.');
                                        copyToClipboard(stdout.trim());
                                    } else {
                                        logDebug(`OCR completed but produced no text. Stderr: ${stderr}`);
                                    }
                                } catch (e) {
                                    logDebug(`OCR process communication error: ${e.message}`);
                                    console.error('OCR Error:', e);
                                }
                            });
                        } catch (e) {
                            logDebug(`Failed to spawn tesseract: ${e.message}`);
                            console.error('Failed to start tesseract:', e);
                        }
                    } else if (doCopyPath) {
                        logDebug('Executing Copy Path task...');
                        copyToClipboard(filePath);
                        logDebug('Path copied to clipboard.');
                    } else {
                        logDebug('Normal screenshot taken. Forcing image to clipboard via wl-copy.');
                        copyToClipboard(null, true, filePath);
                    }
                });

                ext._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    ext._idleId = null;
                    const activeUI = Main.screenshotUI;
                    if (activeUI && activeUI._captureButton && activeUI._captureButton.visible) {
                        logDebug('Emitting click on capture button.');
                        activeUI._captureButton.emit('clicked', 0);
                    } else {
                        logDebug('Capture button not visible or activeUI missing.');
                    }
                    ext._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                        ext._timeoutId = null;
                        logDebug('Resetting capturing state flag.');
                        ext._isCapturing = false;
                        return GLib.SOURCE_REMOVE;
                    });
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                logDebug('Skipping auto-capture. Either already capturing, or was a simple click.');
            }
        };

        // --- PART 2: MAKE INITIAL BOX INVISIBLE UNTIL DRAG ---
        this._origOnMotion = AreaSelectorClass.prototype._onMotion;
        AreaSelectorClass.prototype._onMotion = function() {
            // As soon as the user moves the mouse during a drag, show the selector
            if (this._dragButton > 0) {
                this.opacity = 255;
            }
            return ext._origOnMotion.apply(this, arguments);
        };

        const hideSelector = (container) => {
            if (container && container._areaSelector) {
                container._areaSelector.opacity = 0;
            }
        };

        this._origOnAreaButtonClicked = ScreenshotUIClass.prototype._onAreaButtonClicked;
        ScreenshotUIClass.prototype._onAreaButtonClicked = function() {
            logDebug('Area button clicked. Hiding selector.');
            ext._origOnAreaButtonClicked.apply(this, arguments);
            hideSelector(this);
        };

        this._origOpen = ScreenshotUIClass.prototype.open;
        ScreenshotUIClass.prototype.open = function() {
            logDebug('Screenshot UI opened.');
            // Reset key states on open to prevent sticky keys
            ext._isFDown = false;
            ext._isRDown = false;

            const result = ext._origOpen.apply(this, arguments);
            if (this._areaSelector) {
                this._areaSelector.opacity = 0;
                this._areaSelector._startX = -1;
                this._areaSelector._startY = 0;
                this._areaSelector._lastX = 0;
                this._areaSelector._lastY = 0;
                if (typeof this._areaSelector._updateSelectionRect === 'function') {
                    this._areaSelector._updateSelectionRect();
                }
            }
            return result;
        };
        
        logDebug('Extension enabled successfully.');
    }

    disable() {
        logDebug('Extension disabling...');
        const ui = Main.screenshotUI;
        if (!ui) {
            logDebug('screenshotUI not found during disable.');
            return;
        }

        const AreaSelectorClass = ui._areaSelector.constructor;
        const UIClass = ui.constructor;

        if (this._keyPressId) {
            ui.disconnect(this._keyPressId);
            this._keyPressId = null;
        }
        if (this._keyReleaseId) {
            ui.disconnect(this._keyReleaseId);
            this._keyReleaseId = null;
        }
        
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = null;
        }
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        if (this._origStopDrag) AreaSelectorClass.prototype.stopDrag = this._origStopDrag;
        if (this._origOnMotion) AreaSelectorClass.prototype._onMotion = this._origOnMotion;
        if (this._origOpen) UIClass.prototype.open = this._origOpen;
        if (this._origOnAreaButtonClicked) UIClass.prototype._onAreaButtonClicked = this._origOnAreaButtonClicked;

        if (ui._areaSelector) ui._areaSelector.opacity = 255;

        this._origStopDrag = null;
        this._origOnMotion = null;
        this._origOpen = null;
        this._origOnAreaButtonClicked = null;

        const clipboard = St.Clipboard.get_default();
        if (this._origSetContent) {
            clipboard.set_content = this._origSetContent;
            this._origSetContent = null;
        }

        if (this._origMessageTrayAdd) {
            Main.messageTray.add = this._origMessageTrayAdd;
            this._origMessageTrayAdd = null;
        }
        
        this._isFDown = false;
        this._isRDown = false;
        
        logDebug('Extension disabled successfully.');
    }
}
