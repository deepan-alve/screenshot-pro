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
    console.debug(`[InstantCapture] ${msg}`);
    try {
        const file = Gio.File.new_for_path(LOG_FILE_PATH);
        const stream = file.append_to(Gio.FileCreateFlags.NONE, null);
        const timestamp = new GLib.DateTime().format('%Y-%m-%d %H:%M:%S');
        const formattedMsg = `[${timestamp}] ${msg}\n`;
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

        // Track GLib sources
        this._sourceIds = new Set();
        const safeIdleAdd = (priority, func) => {
            const id = GLib.idle_add(priority, () => {
                const result = func();
                ext._sourceIds.delete(id);
                return result;
            });
            this._sourceIds.add(id);
        };
        const safeTimeoutAdd = (priority, interval, func) => {
            const id = GLib.timeout_add(priority, interval, () => {
                const result = func();
                ext._sourceIds.delete(id);
                return result;
            });
            this._sourceIds.add(id);
        };

        // Key tracking
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

        // Auto‑capture on release
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
                safeTimeoutAdd(GLib.PRIORITY_DEFAULT, 500, () => {
                    ext._blockAllNotificationsUntil = Date.now() + 5000;
                    logDebug('Initiating auto‑capture sequence.');
                    const doOCR = ext._isRDown;
                    const doCopyPath = ext._isFDown;
                    ext._isRDown = false;
                    ext._isFDown = false;
                    if (doOCR || doCopyPath) ext._blockImageCopy = true;
                    const activeUI = Main.screenshotUI;
                    const copyToClipboard = (text, isImage = false, filePath = '') => {
                        try {
                            if (isImage) {
                                const proc = Gio.Subprocess.new(
                                    ['bash', '-c', `wl-copy -t image/png < "${filePath}"`],
                                    Gio.SubprocessFlags.NONE
                                );
                                proc.wait_async(null, (p, r) => {
                                    try { p.wait_finish(r); logDebug('wl‑copy image succeeded'); }
                                    catch (e) { logDebug(`wl‑copy image error: ${e.message}`); }
                                });
                            } else {
                                const proc = Gio.Subprocess.new(
                                    ['wl-copy'],
                                    Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                                );
                                proc.communicate_utf8_async(text, null, (p, r) => {
                                    try { p.communicate_utf8_finish(r); logDebug('wl‑copy succeeded'); }
                                    catch (e) {
                                        logDebug(`wl‑copy error: ${e.message}, falling back to St.Clipboard`);
                                        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                                    }
                                });
                            }
                        } catch (e) {
                            logDebug(`Failed to launch wl‑copy: ${e.message}`);
                            if (!isImage) St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                        }
                    };
                    const signalId = activeUI.connect('screenshot-taken', (ui, file) => {
                        activeUI.disconnect(signalId);
                        ext._blockImageCopy = false;
                        const filePath = file.get_path();
                        logDebug(`Screenshot saved to: ${filePath}`);
                        if (doOCR) {
                            logDebug('Executing OCR task');
                            try {
                                const proc = Gio.Subprocess.new(
                                    ['tesseract', filePath, 'stdout'],
                                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                                );
                                proc.communicate_utf8_async(null, null, (p, r) => {
                                    try {
                                        const [, stdout, stderr] = p.communicate_utf8_finish(r);
                                        if (stdout && stdout.trim()) {
                                            logDebug('OCR succeeded, copying to clipboard');
                                            copyToClipboard(stdout.trim());
                                        } else {
                                            logDebug(`OCR produced no output. Stderr: ${stderr}`);
                                        }
                                    } catch (e) { logDebug(`OCR error: ${e.message}`); }
                                });
                            } catch (e) { logDebug(`Failed to start tesseract: ${e.message}`); }
                        } else if (doCopyPath) {
                            logDebug('Copying file path to clipboard');
                            copyToClipboard(filePath);
                        } else {
                            logDebug('Copying image to clipboard');
                            copyToClipboard(null, true, filePath);
                        }
                    });
                    if (activeUI && activeUI._captureButton && activeUI._captureButton.visible) {
                        logDebug('Triggering capture button');
                        activeUI._captureButton.emit('clicked', 0);
                    } else {
                        logDebug('Capture button not available');
                    }
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                logDebug('Skipping auto‑capture (already capturing or simple click)');
            }
        };

        // Make initial selector invisible until drag
        this._origOnMotion = AreaSelectorClass.prototype._onMotion;
        AreaSelectorClass.prototype._onMotion = function() {
            if (this._dragButton > 0) this.opacity = 255;
            return ext._origOnMotion.apply(this, arguments);
        };
        const hideSelector = (container) => {
            if (container && container._areaSelector) container._areaSelector.opacity = 0;
        };
        this._origOnAreaButtonClicked = ScreenshotUIClass.prototype._onAreaButtonClicked;
        ScreenshotUIClass.prototype._onAreaButtonClicked = function() {
            logDebug('Area button clicked, hiding selector');
            ext._origOnAreaButtonClicked.apply(this, arguments);
            hideSelector(this);
        };
        this._origOpen = ScreenshotUIClass.prototype.open;
        ScreenshotUIClass.prototype.open = function() {
            logDebug('Screenshot UI opened');
            ext._isFDown = false;
            ext._isRDown = false;
            const result = ext._origOpen.apply(this, arguments);
            if (this._areaSelector) {
                this._areaSelector.opacity = 0;
                this._areaSelector._startX = -1;
                this._areaSelector._startY = 0;
                this._areaSelector._lastX = 0;
                this._areaSelector._lastY = 0;
                if (typeof this._areaSelector._updateSelectionRect === 'function')
                    this._areaSelector._updateSelectionRect();
            }
            return result;
        };
        logDebug('Extension enabled successfully');
    }

    disable() {
        logDebug('Extension disabling...');
        const ui = Main.screenshotUI;
        if (!ui) { logDebug('screenshotUI not found'); return; }
        if (this._sourceIds) {
            this._sourceIds.forEach(id => GLib.source_remove(id));
            this._sourceIds.clear();
        }
        if (this._keyPressId) { ui.disconnect(this._keyPressId); this._keyPressId = null; }
        if (this._keyReleaseId) { ui.disconnect(this._keyReleaseId); this._keyReleaseId = null; }
        if (this._idleId) { GLib.source_remove(this._idleId); this._idleId = null; }
        if (this._timeoutId) { GLib.source_remove(this._timeoutId); this._timeoutId = null; }
        const AreaSelectorClass = ui._areaSelector?.constructor;
        const UIClass = ui.constructor;
        if (this._origStopDrag && AreaSelectorClass) AreaSelectorClass.prototype.stopDrag = this._origStopDrag;
        if (this._origOnMotion && AreaSelectorClass) AreaSelectorClass.prototype._onMotion = this._origOnMotion;
        if (this._origOpen) UIClass.prototype.open = this._origOpen;
        if (this._origOnAreaButtonClicked) UIClass.prototype._onAreaButtonClicked = this._origOnAreaButtonClicked;
        const clipboard = St.Clipboard.get_default();
        if (this._origSetContent) { clipboard.set_content = this._origSetContent; this._origSetContent = null; }
        if (this._origMessageTrayAdd) { Main.messageTray.add = this._origMessageTrayAdd; this._origMessageTrayAdd = null; }
        this._isFDown = false;
        this._isRDown = false;
        if (ui._areaSelector) ui._areaSelector.opacity = 255;
        this._origStopDrag = null;
        this._origOnMotion = null;
        this._origOpen = null;
        this._origOnAreaButtonClicked = null;
        logDebug('Extension disabled successfully');
    }
}
