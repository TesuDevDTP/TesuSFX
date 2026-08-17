// EasyTimeline -- ExtendScript entry point
// Loaded via <ScriptPath> in manifest.xml (preprocessor handles #include)
var tempFolder = Folder.temp;

// Safe JSON serialization for ExtendScript engines that lack native JSON methods.
function ET__quoteString(str) {
    var s = String(str);
    var out = '"';
    for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        var code = s.charCodeAt(i);
        if (ch === '"') {
            out += '\\"';
        } else if (ch === '\\') {
            out += '\\\\';
        } else if (ch === '\b') {
            out += '\\b';
        } else if (ch === '\f') {
            out += '\\f';
        } else if (ch === '\n') {
            out += '\\n';
        } else if (ch === '\r') {
            out += '\\r';
        } else if (ch === '\t') {
            out += '\\t';
        } else if (code < 32) {
            var hex = code.toString(16);
            while (hex.length < 4) {
                hex = "0" + hex;
            }
            out += '\\u' + hex;
        } else {
            out += ch;
        }
    }
    return out + '"';
}

function ET__safeStringify(value, stack) {
    var t = typeof value;
    if (value === null) return "null";
    if (t === "string") return ET__quoteString(value);
    if (t === "number") return isFinite(value) ? String(value) : "null";
    if (t === "boolean") return value ? "true" : "false";
    if (t === "undefined" || t === "function") return undefined;
    if (t !== "object") return "null";

    stack = stack || [];
    for (var s = 0; s < stack.length; s++) {
        if (stack[s] === value) {
            throw new Error("Converting circular structure to JSON");
        }
    }
    stack.push(value);

    var out = [];
    var i;
    var isArr = (value instanceof Array) || (value && value.constructor === Array);
    if (isArr) {
        for (i = 0; i < value.length; i++) {
            var item = ET__safeStringify(value[i], stack);
            out.push(typeof item === "undefined" ? "null" : item);
        }
        stack.pop();
        return "[" + out.join(",") + "]";
    }

    for (var key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            var v = ET__safeStringify(value[key], stack);
            if (typeof v !== "undefined") {
                out.push(ET__quoteString(key) + ":" + v);
            }
        }
    }
    stack.pop();
    return "{" + out.join(",") + "}";
}

function ET__serialize(value) {
    return ET__safeStringify(value);
}

if (typeof JSON === "undefined") {
    JSON = {};
}
function ET__parseJsonFallback(text) {
    // ES3-safe JSON.parse fallback for older ExtendScript runtimes.
    var src = String(text);
    // Trim common leading whitespace/BOM.
    src = src.replace(/^\uFEFF/, "").replace(/^\s+|\s+$/g, "");
    if (!src.length) {
        throw new Error("Invalid JSON: empty input");
    }

    // Validate JSON shape before eval (json2-style safety check).
    var sanitized = src
        .replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "@")
        .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
        .replace(/(?:^|:|,)(?:\s*\[)+/g, "");

    if (!/^[\],:{}\s]*$/.test(sanitized)) {
        throw new Error("Invalid JSON: malformed input");
    }

    // Eval only after validation; wrap in parens so objects parse correctly.
    return eval("(" + src + ")");
}

function ET__hasWorkingJsonParse() {
    if (typeof JSON === "undefined" || typeof JSON.parse !== "function") return false;
    try {
        var probe = JSON.parse('{"__et_probe":1}');
        return !!(probe && probe.__et_probe === 1);
    } catch (e) {
        return false;
    }
}

// Important: replace broken stubs from previous engine sessions too.
if (!ET__hasWorkingJsonParse()) {
    JSON.parse = ET__parseJsonFallback;
}
if (typeof JSON.stringify !== "function") {
    JSON.stringify = function(value) {
        return ET__safeStringify(value);
    };
}

function ET_ping() { return "pong"; }
function ET_jsonParseSelfTest() {
    try {
        var obj = JSON.parse('{"ok":true,"n":1}');
        return ET_ok(!!(obj && obj.ok === true && obj.n === 1));
    } catch (e) {
        return ET_fail("JSON.parse self-test failed: " + e.toString());
    }
}

function ET_ok(data) {
    return ET__serialize({ success: true, data: data });
}

function ET_fail(msg) {
    return ET__serialize({ success: false, error: String(msg) });
}

function ET_wrap(fn) {
    try {
        return ET_ok(fn());
    } catch (e) {
        return ET_fail(e.toString());
    }
}

var ET__operationCancelFolders = null;
var ET__hostRootFolder = null;

function ET__normalizeOperationId(value) {
    var normalized = String(value || "")
        .replace(/^\s+|\s+$/g, "")
        .replace(/[^A-Za-z0-9_.-]/g, "_");
    return normalized;
}

function ET__coerceFolder(pathOrFolder) {
    if (!pathOrFolder) return null;
    try {
        if (pathOrFolder instanceof Folder) {
            return pathOrFolder;
        }
    } catch (_folderInstanceErr) {}
    try {
        var folder = new Folder(String(pathOrFolder));
        return folder;
    } catch (_folderCreateErr) {
        return null;
    }
}

function ET__pushUniqueCancelFolder(folders, folder) {
    var i;
    if (!folders || !folder || !folder.fsName) return;
    for (i = 0; i < folders.length; i++) {
        if (folders[i] && folders[i].fsName === folder.fsName) {
            return;
        }
    }
    folders.push(folder);
}

function ET__ensureFolderExists(folder) {
    if (!folder) return null;
    try {
        if (folder.parent && !folder.parent.exists) {
            ET__ensureFolderExists(folder.parent);
        }
        if (!folder.exists) {
            folder.create();
        }
        return folder.exists ? folder : null;
    } catch (_ensureFolderErr) {
        return null;
    }
}

function ET__ensureOperationCancelFolders() {
    var folders = [];
    var hostRootFolder;
    var extensionRootFolder;
    var tempCancelFolder;
    var extensionCancelFolder;

    if (ET__operationCancelFolders && ET__operationCancelFolders.length) {
        folders = ET__operationCancelFolders.slice(0);
        for (var i = folders.length - 1; i >= 0; i--) {
            if (!folders[i] || !folders[i].exists) {
                folders.splice(i, 1);
            }
        }
        if (folders.length) {
            ET__operationCancelFolders = folders;
            return folders;
        }
    }

    tempCancelFolder = ET__ensureFolderExists(new Folder(Folder.temp.fsName + "/EasyTimeline/operation-cancel"));
    if (tempCancelFolder) {
        ET__pushUniqueCancelFolder(folders, tempCancelFolder);
    }

    try {
        hostRootFolder = ET__resolveHostRootFolder();
        extensionRootFolder = hostRootFolder && hostRootFolder.parent && hostRootFolder.parent.exists
            ? hostRootFolder.parent
            : null;
        if (extensionRootFolder) {
            extensionCancelFolder = ET__ensureFolderExists(new Folder(extensionRootFolder.fsName + "/.runtime/operation-cancel"));
            if (extensionCancelFolder) {
                ET__pushUniqueCancelFolder(folders, extensionCancelFolder);
            }
        }
    } catch (_extensionCancelFolderErr) {}

    ET__operationCancelFolders = folders;
    return folders;
}

function ET__getOperationCancelFiles(operationId) {
    var normalizedId = ET__normalizeOperationId(operationId);
    var folders;
    var cancelFiles = [];
    var i;
    if (!normalizedId) return null;

    folders = ET__ensureOperationCancelFolders();
    if (!folders || !folders.length) return cancelFiles;

    for (i = 0; i < folders.length; i++) {
        if (!folders[i] || !folders[i].fsName) continue;
        cancelFiles.push(new File(folders[i].fsName + "/" + normalizedId + ".cancel"));
    }

    return cancelFiles;
}

function ET__getOperationCancelFile(operationId) {
    var cancelFiles = ET__getOperationCancelFiles(operationId);
    if (!cancelFiles || !cancelFiles.length) return null;
    return cancelFiles[0];
}

function ET__isOperationCancelled(operationId) {
    var cancelFiles = ET__getOperationCancelFiles(operationId);
    var i;
    if (!cancelFiles || !cancelFiles.length) return false;
    for (i = 0; i < cancelFiles.length; i++) {
        if (cancelFiles[i] && cancelFiles[i].exists) {
            return true;
        }
    }
    return false;
}

function ET__throwIfOperationCancelled(operationId, label) {
    if (!ET__isOperationCancelled(operationId)) return false;
    throw new Error(String(label || "Operation") + " cancelled.");
}

function ET_cancelOperation(operationId) {
    try {
        var cancelFiles = ET__getOperationCancelFiles(operationId);
        var wroteAny = false;
        var i;
        if (!cancelFiles || !cancelFiles.length) return ET_fail("Missing operation id.");
        for (i = 0; i < cancelFiles.length; i++) {
            var cancelFile = cancelFiles[i];
            if (!cancelFile) continue;
            if (!cancelFile.exists) {
                cancelFile.open("w");
                cancelFile.write("1");
                cancelFile.close();
            }
            wroteAny = true;
        }
        return ET_ok(wroteAny);
    } catch (e) {
        return ET_fail(e.toString());
    }
}

function ET_clearOperationCancel(operationId) {
    try {
        var cancelFiles = ET__getOperationCancelFiles(operationId);
        var clearedAny = false;
        var i;
        if (!cancelFiles || !cancelFiles.length) {
            return ET_ok(false);
        }
        for (i = 0; i < cancelFiles.length; i++) {
            var cancelFile = cancelFiles[i];
            if (cancelFile && cancelFile.exists) {
                cancelFile.remove();
                clearedAny = true;
            }
        }
        return ET_ok(clearedAny);
    } catch (e) {
        return ET_fail(e.toString());
    }
}

// Core APIs available even before tool includes.
function Utils_getAppState() {
    try {
        var result = {
            sequenceName: null,
            sequenceFPS: null,
            projectName: null,
            projectPath: null
        };

        if (app.project) {
            result.projectName = app.project.name || null;
            result.projectPath = app.project.path || null;

            var seq = app.project.activeSequence;
            if (seq) {
                result.sequenceName = seq.name || null;
                if (seq.timebase) {
                    var ticksPerSecond = 254016000000;
                    result.sequenceFPS = ticksPerSecond / parseInt(seq.timebase, 10);
                } else if (seq.framerate) {
                    result.sequenceFPS = parseFloat(seq.framerate);
                }
            }
        }

        return ET_ok(result);
    } catch (e) {
        return ET_fail(e.toString());
    }
}

function Utils_getSequenceFrameRate() {
    try {
        if (!app.project || !app.project.activeSequence) {
            return ET_ok("23.976");
        }

        var seq = app.project.activeSequence;
        if (seq.timebase) {
            var ticksPerSecond = 254016000000;
            var ticksPerFrame = parseInt(seq.timebase, 10);
            var preciseFrameRate = ticksPerSecond / ticksPerFrame;
            return ET_ok(preciseFrameRate.toString());
        }

        return ET_ok(String(seq.framerate));
    } catch (e) {
        return ET_ok("23.976");
    }
}

// Optional diagnostics hook retained for compatibility.
var ET__hostLoadErrors = [];

function ET__recordHostLoadError(message) {
    ET__hostLoadErrors.push(String(message || 'Unknown host module load error.'));
}

function ET__resolveHostRootFolder() {
    if (ET__hostRootFolder && ET__hostRootFolder.exists) {
        return ET__hostRootFolder;
    }
    try {
        if (typeof $.fileName === "string" && $.fileName) {
            var hostFile = new File($.fileName);
            if (hostFile && hostFile.parent && hostFile.parent.exists) {
                return hostFile.parent;
            }
        }
    } catch (_eResolve) {}
    return null;
}

function ET_setHostRootPath(hostRootPath) {
    try {
        var folder = ET__coerceFolder(hostRootPath);
        if (!folder || !folder.exists) {
            return ET_fail("Invalid host root path.");
        }
        ET__hostRootFolder = folder;
        ET__operationCancelFolders = null;
        ET__hostLoadErrors = [];
        ET__loadHostModules();
        return ET_ok({
            hostRoot: folder.fsName,
            loadErrors: ET__hostLoadErrors.slice(0)
        });
    } catch (e) {
        return ET_fail(e.toString());
    }
}

function ET__resolveHostModuleFile(hostRootFolder, relativePath) {
    var normalized = String(relativePath || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
    if (!hostRootFolder || !normalized) return null;
    return new File(hostRootFolder.fsName + '/' + normalized);
}

function ET__loadHostModule(hostRootFolder, relativePath, required) {
    var moduleFile = ET__resolveHostModuleFile(hostRootFolder, relativePath);
    var modulePath = '';
    var evalScript = '';
    if (!moduleFile || !moduleFile.exists) {
        if (required) {
            ET__recordHostLoadError('Missing host module: ' + relativePath);
        }
        return false;
    }

    try {
        modulePath = String(moduleFile.fsName || '').replace(/\\/g, '/').replace(/"/g, '\\"');
        if (modulePath && $.global && typeof $.global.eval === 'function') {
            evalScript = '$.evalFile("' + modulePath + '");';
            $.global.eval(evalScript);
        } else {
            $.evalFile(moduleFile);
        }
        return true;
    } catch (e) {
        ET__recordHostLoadError('Failed to load host module ' + relativePath + ': ' + e.toString());
        return false;
    }
}

// Prefer static includes so tool functions are defined in the global
// ExtendScript scope across CEP runtimes on both macOS and Windows.
#include "./core/utils.jsx"
#include "./core/import.jsx"
#include "./features/ambient-video/index.jsx"
#include "./features/gap-split-shuffle/gap/index.jsx"
#include "./features/gap-split-shuffle/shared/index.jsx"
#include "./features/auto-clip-colorizer/index.jsx"
#include "./features/black-frames-detector/index.jsx"
#include "./features/update-mogrts/shared/index.jsx"
#include "./features/update-mogrts/shared/mogrt-utils.jsx"

var ET__useStaticHostIncludes = true;

function ET__loadHostModules() {
    if (ET__useStaticHostIncludes) {
        return;
    }
    var hostRootFolder = ET__resolveHostRootFolder();
    var modules;
    var i;

    if (!hostRootFolder) {
        ET__recordHostLoadError('Could not resolve the host script directory.');
        return;
    }

    modules = [
        { path: 'core/utils.jsx', required: true },
        { path: 'core/import.jsx', required: true },
        { path: 'features/ambient-video/index.jsx', required: false },
        { path: 'features/gap-split-shuffle/gap/index.jsx', required: false },
        { path: 'features/gap-split-shuffle/shared/index.jsx', required: false },
        { path: 'features/auto-editing/transition-support/index.jsx', required: false },
        { path: 'features/easy-curve/index.jsx', required: false },
        { path: 'features/easy-anchor/index.jsx', required: false },
        { path: 'features/auto-clip-colorizer/index.jsx', required: false },
        { path: 'features/black-frames-detector/index.jsx', required: false },
        { path: 'features/auto-editing/index.jsx', required: false },
        { path: 'features/auto-editing/db.jsx', required: false },
        { path: 'features/auto-editing/reel.jsx', required: false },
        { path: 'features/update-mogrts/shared/index.jsx', required: false },
        { path: 'features/update-mogrts/shared/mogrt-utils.jsx', required: false },
        { path: 'features/rifle/clipboard-cache.jsx', required: false },
        { path: 'features/rifle/library.jsx', required: false },
        { path: 'features/rifle/subsequence.jsx', required: false },
        { path: 'features/rifle/dock.jsx', required: false }
    ];

    for (i = 0; i < modules.length; i++) {
        ET__loadHostModule(hostRootFolder, modules[i].path, modules[i].required);
    }
}

function ET_getHostLoadErrors() {
    return ET_ok(ET__hostLoadErrors.slice(0));
}

function ET_probeHostFunctions(namesJson) {
    try {
        var names = namesJson;
        var result = {};
        var i;

        if (typeof namesJson === "string") {
            try {
                names = JSON.parse(namesJson);
            } catch (_eParseNames) {
                names = [namesJson];
            }
        }

        if (!(names instanceof Array)) {
            names = [];
        }

        for (i = 0; i < names.length; i++) {
            var name = String(names[i] || "");
            if (!name) continue;
            try {
                result[name] = typeof $.global[name];
            } catch (_eProbeName) {
                result[name] = "unavailable";
            }
        }

        return ET_ok(result);
    } catch (e) {
        return ET_fail(e.toString());
    }
}

ET__loadHostModules();
