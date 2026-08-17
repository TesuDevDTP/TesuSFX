function MU_addMogrtAtCursor(mogrtPath) {
    try {
        // 1. Check if project exists
        if (!app.project) {
            return ET_fail("No project open");
        }
        
        // 2. Check if there's an active sequence
        var sequence = app.project.activeSequence;
        if (!sequence) {
            return ET_fail("No active sequence. Please create or open a sequence first.");
        }
        
        // 3. Get cursor position (CTI)
        var cursorTime = sequence.getPlayerPosition();
        
        // IMPORTANT: The importMGT function typically requires time in 'ticks', not seconds.
        // cursorTime.ticks is a string like "254016000000"
        var timeInTicks = cursorTime.ticks;
        
        // 4. Validate Video Tracks
        var videoTracks = sequence.videoTracks;
        if (videoTracks.numTracks === 0) {
            return ET_fail("No video tracks in sequence");
        }
        
        // 5. Import the MOGRT
        // Parameters: (Path, Time in Ticks, Video Track Index, Audio Track Index)
        var newTrackItem = sequence.importMGT(
            mogrtPath,      // Full OS Path (e.g. "C:\\Folder\\Title.mogrt")
            timeInTicks,    // Time must be in ticks to place correctly!
            2,              // Video Track Index (0=V1, 1=V2, 2=V3). Will fail if V3 doesn't exist.
            0               // Audio Track Index (0=A1). Use 0 even if no audio, or -1.
        );
        
        // 6. Verify success
        // importMGT returns the new TrackItem object if successful, or null/undefined if failed.
        if (!newTrackItem) {
            return ET_fail("Failed to import MOGRT. Please check if the file path is correct: " + mogrtPath);
        }
        
        // 7. Change the text to custom value
        try {
            var mgtComp = newTrackItem.getMGTComponent();
            if (mgtComp && mgtComp.properties) {
                // Try to find the Text parameter
                var textParam = mgtComp.properties.getParamForDisplayName("Text");
                
                // If "Text" parameter not found, search for any text-like parameter
                if (!textParam) {
                    var props = mgtComp.properties;
                    for (var p = 0; p < props.numItems; p++) {
                        var prop = props[p];
                        var propName = prop.displayName.toLowerCase();
                        if (propName.indexOf("text") !== -1) {
                            textParam = prop;
                            break;
                        }
                    }
                }
                
                // Set the text using JSON method for Premiere 14.1+
                if (textParam) {
                    var textObj = JSON.parse(textParam.getValue());
                    textObj.textEditValue = "WE ARE THERE";
                    textParam.setValue(JSON.stringify(textObj), true);
                }
            }
        } catch (textErr) {
            // Text setting failed but MOGRT was added successfully
            return ET_fail("MOGRT added but couldn't set text: " + textErr.toString());
        }
        
        return ET_ok(""); // Success
        
    } catch (e) {
        return ET_fail(e.toString());
    }
}

// =============================================
// MOGRT COPY / PASTE -- Reference-Based Approach
// Stores the SOURCE CLIP reference; reads fresh during paste.
// Color properties get special handling (precision-safe).
// =============================================

var cachedSourceClip = null;   // reference to the source TrackItem

/**
 * MU_getSelectedMogrtPath()
 * Returns the file path of the .mogrt source for the first selected clip,
 * or 'null' if no MOGRT clip is selected.
 */
function MU_getSelectedMogrtPath() {
    var seq = app.project.activeSequence;
    if (!seq) return ET_ok('null');
    var selection = seq.getSelection();
    if (!selection || !selection.length) return ET_ok('null');
    var clip = selection[0];
    var mgc = MU_getMGC(clip);
    if (!mgc) return ET_ok('null');
    try {
        var mediaPath = clip.projectItem.getMediaPath();
        return ET_ok(mediaPath || 'null');
    } catch (e) {
        return ET_ok('null');
    }
}

/**
 * MU_placeImageInSafeZone(dataJson)
 * Places the selected image/video clip on the timeline at the position and
 * scale described by normalized Safe Zone coordinates from the UI.
 *
 * dataJson: JSON string with { normX, normY, normWidth, normHeight }
 *   normX / normY     = center of the rect (0.0 = left/top, 1.0 = right/bottom)
 *   normWidth/Height  = size of the rect relative to canvas
 */
function MU_placeImageInSafeZone(dataJson) {
    try {
        var data      = JSON.parse(dataJson);
        var normX     = parseFloat(data.normX);
        var normY     = parseFloat(data.normY);
        var normW     = parseFloat(data.normWidth);
        var normH     = parseFloat(data.normHeight);

        var seq = app.project.activeSequence;
        if (!seq) return ET_fail('No active sequence.');

        var seqW = seq.frameSizeHorizontal;   // e.g. 1920
        var seqH = seq.frameSizeVertical;     // e.g. 1080

        // Premiere Pro Motion effect coordinates: origin at top-left,
        // so center of frame = (seqW/2, seqH/2)
        var targetX = normX * seqW;           // pixel X (sequence space)
        var targetY = normY * seqH;           // pixel Y (sequence space)
        var targetW = normW * seqW;           // desired width in pixels

        // Get the selected image/video clip (first non-audio clip)
        var selection = seq.getSelection();
        var clip = null;
        if (selection && selection.length) {
            for (var i = 0; i < selection.length; i++) {
                if (selection[i].mediaType !== 'Audio') { clip = selection[i]; break; }
            }
        }
        if (!clip) return ET_fail('Please select an image or video clip on the timeline first.');

        // Find the Motion effect component
        var motionComp = null;
        var comps = clip.components;
        for (var c = 0; c < comps.numItems; c++) {
            var comp = comps[c];
            if (comp.displayName === 'Motion' ||
                comp.matchName   === 'AE.ADBE Motion') {
                motionComp = comp;
                break;
            }
        }
        if (!motionComp) return ET_fail('Motion component not found on selected clip.');

        // Try to determine native clip width for accurate scale calculation
        var nativeW = seqW;   // fallback: assume clip same size as sequence
        try {
            var pmItem = clip.projectItem;
            // Iterate project items to find matching one and read video metadata
            // Premiere ExtendScript exposes clip.source.videoComponents on some APIs;
            // safest cross-version method is parsing project metadata XML
            var xmlStr  = pmItem.getProjectMetadata();
            var wMatch  = xmlStr.match(/<premierePrivateProjectMetaData:Column\.Intrinsic\.MediaWidth>(\d+)/);
            if (wMatch) nativeW = parseInt(wMatch[1], 10) || seqW;
        } catch(e) { /* use fallback */ }

        // Scale = how much to grow/shrink the clip so its width == targetW
        // Premiere scale is in percent: 100 = native size
        var scalePercent = (targetW / nativeW) * 100;

        // Set Motion properties
        var props = motionComp.properties;
        for (var p = 0; p < props.numItems; p++) {
            var prop = props[p];
            if (prop.displayName === 'Position') {
                prop.setValue([targetX, targetY], true);
            }
            if (prop.displayName === 'Scale') {
                prop.setValue([scalePercent], true);
            }
            if (prop.displayName === 'Uniform Scale') {
                prop.setValue(true, true);
            }
        }

        return ET_ok('Done: Position (' + Math.round(targetX) + ', ' + Math.round(targetY) +
               ')  Scale ' + scalePercent.toFixed(1) + '%');
    } catch(e) {
        return ET_fail(e.toString());
    }
}

/**
 * MU_copyMogrtAttributes()
 * Stores a reference to the first selected clip. No values are read yet.
 */
function MU_copyMogrtAttributes() {
    var seq = app.project.activeSequence;
    if (!seq) return ET_fail('No active sequence');
    var selection = seq.getSelection();
    if (!selection || !selection.length) return ET_fail('Select a clip first.');

    var mgc = MU_getMGC(selection[0]);
    if (!mgc) return ET_fail('Selected clip is not a MOGRT.');

    cachedSourceClip = selection[0];
    return ET_ok('OK');
}

function MU_clearCopiedMogrtSource() {
    cachedSourceClip = null;
    return ET_ok(true);
}

/**
 * MU_pasteMogrtAttributes()
 * Walks both source and target property trees simultaneously.
 * Non-color props: direct getValue--setValue.
 * Text props: merge style only (keep target text).
 * Color props: try getColorValue/setColorValue, then try direct, then try fontColor fallback.
 */
/**
 * MU_pasteMogrtAttributes()
 * Legacy single-call paste (kept as fallback).
 */
function MU_pasteMogrtAttributes() {
    if (!cachedSourceClip) return ET_fail('Click Copy first.');
    var seq = app.project.activeSequence;
    if (!seq) return ET_fail('No active sequence');
    var selection = seq.getSelection();
    if (!selection || !selection.length) return ET_fail('Select target clip(s) first.');

    var srcMGC = MU_getMGC(cachedSourceClip);
    if (!srcMGC) return ET_fail('Source MOGRT component not found (clip deleted?).');

    var pastedCount = 0;
    for (var s = 0; s < selection.length; s++) {
        if (selection[s] === cachedSourceClip) continue;
        var tgtMGC = MU_getMGC(selection[s]);
        if (!tgtMGC) continue;
        MU_transferProperties(srcMGC.properties, tgtMGC.properties, srcMGC.properties);
        pastedCount++;
    }
    if (pastedCount > 0) cachedSourceClip = null;
    return ET_ok('Pasted to ' + pastedCount + ' clip(s).');
}

function MU_normalizeMogrtName(name) {
    try {
        var n = String(name || '');
        n = n.replace(/\.mogrt$/i, '');
        n = n.replace(/\s+/g, ' ');
        n = n.replace(/^\s+|\s+$/g, '');
        return n.toLowerCase();
    } catch (e) {
        return '';
    }
}

function MU_getTrackItemMogrtName(clip) {
    if (!clip) return '';
    try {
        if (clip.projectItem && clip.projectItem.name) return String(clip.projectItem.name);
    } catch (e) {}
    try {
        if (clip.name) return String(clip.name);
    } catch (e2) {}
    return '';
}

function MU_getTrackItemVideoTrackLabel(seq, clip) {
    if (!seq || !clip) return '';
    try {
        var tracks = seq.videoTracks;
        for (var t = 0; t < tracks.numTracks; t++) {
            var track = tracks[t];
            for (var c = 0; c < track.clips.numItems; c++) {
                if (track.clips[c] === clip) return 'V' + (t + 1);
            }
        }
    } catch (e) {}
    return '';
}

function MU_getCopiedMogrtInfo() {
    var seq = app.project.activeSequence;
    if (!cachedSourceClip) return ET_ok({ copied: false });

    var srcMGC = MU_getMGC(cachedSourceClip);
    if (!srcMGC) return ET_ok({
        copied: false,
        lost: true,
        message: 'The copied source MOGRT is no longer available.'
    });

    return ET_ok({
        copied: true,
        name: MU_getTrackItemMogrtName(cachedSourceClip) || 'Selected MOGRT',
        trackLabel: MU_getTrackItemVideoTrackLabel(seq, cachedSourceClip),
        clipName: String(cachedSourceClip.name || ''),
        textSafe: true
    });
}

function MU_getSelectedMogrtTargetsInfo() {
    var seq = app.project.activeSequence;
    if (!seq) return ET_ok({
        hasSequence: false,
        selectionCount: 0,
        validTargetCount: 0,
        includesSource: false,
        distinctNames: [],
        allMatchSource: false
    });

    var selection = seq.getSelection();
    if (!selection || !selection.length) return ET_ok({
        hasSequence: true,
        selectionCount: 0,
        validTargetCount: 0,
        includesSource: false,
        distinctNames: [],
        allMatchSource: false
    });

    var sourceName = MU_normalizeMogrtName(MU_getTrackItemMogrtName(cachedSourceClip));
    var distinctMap = {};
    var distinctNames = [];
    var validTargetCount = 0;
    var includesSource = false;
    var mismatched = false;

    for (var s = 0; s < selection.length; s++) {
        var clip = selection[s];
        if (clip === cachedSourceClip) {
            includesSource = true;
            continue;
        }
        var tgtMGC = MU_getMGC(clip);
        if (!tgtMGC) continue;

        validTargetCount++;
        var rawName = MU_getTrackItemMogrtName(clip) || 'Selected MOGRT';
        var normalized = MU_normalizeMogrtName(rawName);
        if (!distinctMap[rawName]) {
            distinctMap[rawName] = true;
            distinctNames.push(rawName);
        }
        if (sourceName && normalized && normalized !== sourceName) mismatched = true;
    }

    return ET_ok({
        hasSequence: true,
        selectionCount: selection.length,
        validTargetCount: validTargetCount,
        includesSource: includesSource,
        distinctNames: distinctNames,
        allMatchSource: validTargetCount > 0 ? !mismatched : false,
        sourceCopied: !!cachedSourceClip
    });
}

/**
 * MU_validateMogrtPasteNames()
 * Ensures source and selected target MOGRT names match before paste.
 * Returns 'true' if valid, otherwise returns an Error string.
 */
function MU_validateMogrtPasteNames(operationId) {
    if (!cachedSourceClip) return ET_fail('Click Copy first.');
    var seq = app.project.activeSequence;
    if (!seq) return ET_fail('No active sequence');
    var selection = seq.getSelection();
    if (!selection || !selection.length) return ET_fail('Select target clip(s) first.');

    var srcMGC = MU_getMGC(cachedSourceClip);
    if (!srcMGC) return ET_fail('Source MOGRT component not found (clip deleted?).');

    var srcNameRaw = MU_getTrackItemMogrtName(cachedSourceClip);
    var srcName = MU_normalizeMogrtName(srcNameRaw);
    var validTargets = 0;

    for (var s = 0; s < selection.length; s++) {
        ET__throwIfOperationCancelled(operationId, "MOGRT paste");
        if (selection[s] === cachedSourceClip) continue;
        var tgtMGC = MU_getMGC(selection[s]);
        if (!tgtMGC) continue;
        validTargets++;

        var tgtNameRaw = MU_getTrackItemMogrtName(selection[s]);
        var tgtName = MU_normalizeMogrtName(tgtNameRaw);
        if (srcName && tgtName && srcName !== tgtName) {
            return ET_fail('MOGRT name mismatch. Source "' + (srcNameRaw || '?') + '" and target "' + (tgtNameRaw || '?') + '" must match.');
        }
    }

    if (validTargets === 0) return ET_fail('No valid MOGRT targets in selection.');
    return ET_ok(true);
}

/**
 * MU_getPasteTargetCount()
 * Returns the number of valid MOGRT target clips in the current selection
 * (excludes the source clip). Used by JS to drive per-clip progress.
 */
function MU_getPasteTargetCount(operationId) {
    if (!cachedSourceClip) return ET_fail('Click Copy first.');
    var seq = app.project.activeSequence;
    if (!seq) return ET_fail('No active sequence');
    var selection = seq.getSelection();
    if (!selection || !selection.length) return ET_fail('Select target clip(s) first.');

    var srcMGC = MU_getMGC(cachedSourceClip);
    if (!srcMGC) return ET_fail('Source MOGRT component not found (clip deleted?).');

    var count = 0;
    for (var s = 0; s < selection.length; s++) {
        ET__throwIfOperationCancelled(operationId, "MOGRT paste");
        if (selection[s] === cachedSourceClip) continue;
        var tgtMGC = MU_getMGC(selection[s]);
        if (tgtMGC) count++;
    }
    if (count === 0) return ET_fail('No valid MOGRT targets in selection.');
    return ET_ok(String(count));
}

/**
 * MU_pasteMogrtToIndex(idx)
 * Pastes attributes to the Nth valid MOGRT target in the current selection.
 * idx is 0-based. Returns a status string.
 */
function MU_pasteMogrtToIndex(idx, operationId) {
    if (!cachedSourceClip) return ET_fail('No source.');
    var seq = app.project.activeSequence;
    if (!seq) return ET_fail('No sequence.');
    var selection = seq.getSelection();
    if (!selection || !selection.length) return ET_fail('No selection.');

    var srcMGC = MU_getMGC(cachedSourceClip);
    if (!srcMGC) return ET_fail('Source lost.');

    var targetIdx = parseInt(idx, 10);
    var current = 0;
    for (var s = 0; s < selection.length; s++) {
        ET__throwIfOperationCancelled(operationId, "MOGRT paste");
        if (selection[s] === cachedSourceClip) continue;
        var tgtMGC = MU_getMGC(selection[s]);
        if (!tgtMGC) continue;
        if (current === targetIdx) {
            MU_transferProperties(srcMGC.properties, tgtMGC.properties, srcMGC.properties, operationId);
            ET__throwIfOperationCancelled(operationId, "MOGRT paste");
            return ET_ok('OK');
        }
        current++;
    }
    return ET_fail('Index out of range.');
}

/**
 * MU_transferProperties(srcProps, tgtProps, allSrcProps)
 *
 * Walks source & target property lists in parallel (by index, with name check).
 *   - Text props -- merge style (keep target text)
 *   - Color props -- direct transfer + fontColor fallback
 *   - Other props -- direct getValue--setValue
 *   - Groups -- recurse
 */
function MU_transferProperties(srcProps, tgtProps, allSrcProps, operationId) {
    var count = Math.min(srcProps.numItems, tgtProps.numItems);

    for (var i = 0; i < count; i++) {
        ET__throwIfOperationCancelled(operationId, "MOGRT paste");
        var srcP = srcProps[i];
        var tgtP = tgtProps[i];
        var name = srcP.displayName || '';

        // Verify names match; if not, try to find by name
        if (name !== (tgtP.displayName || '')) {
            tgtP = MU_findPropByName(tgtProps, name, operationId);
            if (!tgtP) continue;
        }

        // ---- TEXT property ----
        if (MU_isTextProperty(srcP)) {
            try {
                var srcObj = JSON.parse(srcP.getValue());
                var tgtObj = JSON.parse(tgtP.getValue());
                for (var key in srcObj) {
                    if (!srcObj.hasOwnProperty(key)) continue;
                    if (key === 'textEditValue' || key === 'capPropTextEdit') continue;
                    tgtObj[key] = srcObj[key];
                }
                tgtP.setValue(JSON.stringify(tgtObj), 1);
            } catch(e) {}
            continue;
        }

        // ---- COLOR property (name contains "COLOR", case-insensitive) ----
        if (name.toUpperCase().indexOf('COLOR') !== -1) {
            MU_transferColor(srcP, tgtP, allSrcProps, name, operationId);
            continue;
        }

        // ---- GENERIC property ----
        try { tgtP.setValue(srcP.getValue(), 1); } catch(e) {}

        // ---- Recurse into children ----
        try {
            if (srcP.properties && tgtP.properties &&
                srcP.properties.numItems > 0 && tgtP.properties.numItems > 0) {
                MU_transferProperties(srcP.properties, tgtP.properties, allSrcProps, operationId);
            }
        } catch(e) {}
    }
}

function MU_findPropByName(props, name, operationId) {
    for (var i = 0; i < props.numItems; i++) {
        ET__throwIfOperationCancelled(operationId, "MOGRT paste");
        if (props[i].displayName === name) return props[i];
    }
    return null;
}

/**
 * MU_transferColor(srcP, tgtP, allSrcProps, name)
 *
 * MOGRT color properties use getColorValue/setColorValue API.
 * getColorValue() returns [alpha, R, G, B] with 0-255 integers.
 * setColorValue(alpha, R, G, B, updateUI) takes the same format.
 */
function MU_transferColor(srcP, tgtP, allSrcProps, name, operationId) {
    ET__throwIfOperationCancelled(operationId, "MOGRT paste");
    // Primary approach: getColorValue -- setColorValue (0-255 integers)
    try {
        if (typeof srcP.getColorValue === 'function' && typeof tgtP.setColorValue === 'function') {
            var cv = srcP.getColorValue();  // [alpha, R, G, B]
            tgtP.setColorValue(cv[0], cv[1], cv[2], cv[3], true);
            return;
        }
    } catch(e) {}

    // Fallback: extract from 64-bit value and use setColorValue
    var srcVal;
    try { srcVal = srcP.getValue(); } catch(e) { return; }

    var R = Math.floor(srcVal / 1099511627776) & 0xFF;  // byte 5
    var G = Math.floor(srcVal / 16777216) & 0xFF;       // byte 3
    var B = Math.floor(srcVal / 256) & 0xFF;             // byte 1

    try {
        if (typeof tgtP.setColorValue === 'function') {
            tgtP.setColorValue(1, R, G, B, true);
            return;
        }
    } catch(e) {}

    // Last resort: fontColor from associated text property
    var textPropName = name.replace(/\s*COLOR\s*$/i, '').replace(/\s+$/, '');
    var srcTextP = MU_findPropByName(allSrcProps, textPropName, operationId);
    if (srcTextP && MU_isTextProperty(srcTextP)) {
        try {
            var txtObj = JSON.parse(srcTextP.getValue());
            if (txtObj.fontColor !== undefined) {
                var fc = txtObj.fontColor;
                if (fc instanceof Array && fc.length >= 3) {
                    var rgb = Math.round(fc[0]) * 65536 + Math.round(fc[1]) * 256 + Math.round(fc[2]);
                    tgtP.setValue(rgb, 1);
                }
            }
        } catch(e) {}
    }
}

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

// Fast text-property check: look for the textEditValue marker
// without full JSON.parse -- just a substring check on the raw value.
// Uses String() to handle both primitive strings and String objects.
function MU_isTextProperty(prop) {
    try {
        var v = String(prop.getValue());
        return v.indexOf('textEditValue') !== -1;
    } catch(e) { return false; }
}

function MU_getMGC(trackItem) {
    if (!trackItem) return null;
    try { var mgt = trackItem.getMGTComponent(); if (mgt) return mgt; } catch(e) {}
    try {
        var components = trackItem.components;
        if (!components) return null;
        for (var i = 0; i < components.numItems; i++) {
            var c = components[i];
            if (c.displayName === 'Motion Graphics' || c.matchName === 'AE.ADBE MOGRT') return c;
        }
    } catch(e) {}
    return null;
}

/**
 * MU_debugMogrtTree()
 * Dumps the property tree of the selected MOGRT, showing for each property:
 *   path, type, value, isText result, and whether it has children.
 * Also shows what the color transfer would do.
 */
function MU_debugMogrtTree() {
    var seq = app.project.activeSequence;
    if (!seq) return ET_fail('No active sequence');
    var selection = seq.getSelection();
    if (!selection || !selection.length) return ET_fail('Select a MOGRT clip first.');

    var clip = selection[0];
    var mgc = MU_getMGC(clip);
    if (!mgc) return ET_fail('Selected clip is not a MOGRT.');

    var lines = [];
    lines.push('=== MOGRT Debug: ' + (clip.name || '(unnamed)') + ' ===');
    lines.push('Component: ' + (mgc.displayName || '?'));
    lines.push('Props: ' + mgc.properties.numItems);
    lines.push('');

    MU_debugDumpProps(mgc.properties, lines, '', 0);

    // Source clip info
    lines.push('');
    lines.push('=== Source Clip ===');
    if (cachedSourceClip) {
        lines.push('Name: ' + (cachedSourceClip.name || '?'));
        var srcMGC = MU_getMGC(cachedSourceClip);
        if (srcMGC) {
            lines.push('Source props: ' + srcMGC.properties.numItems);
            // Show what color transfer would do
            lines.push('');
            lines.push('=== Color Transfer Simulation ===');
            MU_debugColorTransfer(srcMGC.properties, mgc.properties, srcMGC.properties, lines);
        } else {
            lines.push('Source MGC: NOT FOUND');
        }
    } else {
        lines.push('(no source -- click Copy first)');
    }

    return ET_ok(lines.join('\n'));
}

function MU_debugDumpProps(props, lines, prefix, depth) {
    var indent = '';
    for (var d = 0; d < depth; d++) indent += '  ';

    for (var i = 0; i < props.numItems; i++) {
        var prop = props[i];
        var name = '';
        try { name = prop.displayName || '(none)'; } catch(e) { name = '(error)'; }

        var valStr = '', valType = '';
        try {
            var v = prop.getValue();
            valType = typeof v;
            if (v instanceof Array) {
                valType = 'Array[' + v.length + ']';
                var parts = [];
                for (var ai = 0; ai < v.length && ai < 6; ai++) parts.push(v[ai]);
                valStr = '[' + parts.join(', ') + ']';
            } else if (typeof v === 'number') {
                valStr = String(v);
                if (v > 9007199254740992) valStr += ' !!UNSAFE_INT';
            } else {
                valStr = String(v);
                if (valStr.length > 80) valStr = valStr.substring(0, 80) + '...';
            }
        } catch(e) {
            valStr = '<err: ' + e + '>';
            valType = 'error';
        }

        var isText = MU_isTextProperty(prop);
        var hasKids = false;
        try { hasKids = prop.properties && prop.properties.numItems > 0; } catch(e) {}
        var isColor = name.toUpperCase().indexOf('COLOR') !== -1;

        var tag = isText ? '[TEXT]' : isColor ? '[COLOR]' : '';
        var path = prefix + name;
        lines.push(indent + path + '  |  ' + valType + '=' + valStr +
                   (hasKids ? '  |  kids=' + prop.properties.numItems : '  |  LEAF') +
                   (tag ? '  ' + tag : ''));

        if (hasKids) {
            MU_debugDumpProps(prop.properties, lines, path + '/', depth + 1);
        }
    }
}

function MU_debugColorTransfer(srcProps, tgtProps, allSrcProps, lines) {
    var count = Math.min(srcProps.numItems, tgtProps.numItems);
    for (var i = 0; i < count; i++) {
        var srcP = srcProps[i];
        var tgtP = tgtProps[i];
        var name = srcP.displayName || '';
        if (name.toUpperCase().indexOf('COLOR') === -1) continue;

        // Verify target name matches
        if (name !== (tgtP.displayName || '')) {
            tgtP = MU_findPropByName(tgtProps, name);
            if (!tgtP) { lines.push('Property: ' + name + ' -- NO MATCHING TARGET'); continue; }
        }

        lines.push('Property: ' + name);

        var srcVal;
        try {
            srcVal = srcP.getValue();
            lines.push('  src getValue() = ' + srcVal + ' (typeof=' + typeof srcVal + ')');
        } catch(e) { lines.push('  src getValue() ERROR: ' + e); continue; }

        // Extract R,G,B from 64-bit interleaved format
        var R = Math.floor(srcVal / 1099511627776) & 0xFF;
        var G = Math.floor(srcVal / 16777216) & 0xFF;
        var B = Math.floor(srcVal / 256) & 0xFF;
        lines.push('  Extracted: R=' + R + ' G=' + G + ' B=' + B +
                   ' => #' + MU_padHex(R) + MU_padHex(G) + MU_padHex(B));

        // Save original target value
        var origTgt;
        try { origTgt = tgtP.getValue(); } catch(e) { origTgt = 0; }
        lines.push('  Target original: ' + origTgt);

        // Test various setValue encodings
        lines.push('  --- setValue experiments ---');
        var encodings = [
            { label: 'srcVal (direct)',     val: srcVal },
            { label: '64bit reconstruct',   val: 72057594037927936 + R * 1099511627776 + G * 16777216 + B * 256 },
            { label: 'ARGB 0xFFRRGGBB',    val: 4278190080 + R * 65536 + G * 256 + B },
            { label: 'RGB 0xRRGGBB',       val: R * 65536 + G * 256 + B },
            { label: '[R][00][G][00][B][00]', val: R * 1099511627776 + G * 16777216 + B * 256 },
            { label: '[R][G][B][00]',       val: R * 16777216 + G * 65536 + B * 256 },
            { label: '[00][R][G][B]',       val: R * 65536 + G * 256 + B },
            { label: 'ABGR 0xFFBBGGRR',    val: 4278190080 + B * 65536 + G * 256 + R },
            { label: 'float [0-1] R*2^32+G*2^16+B', val: (R/255)*4294967296 + (G/255)*65536 + (B/255) }
        ];

        for (var t = 0; t < encodings.length; t++) {
            try {
                tgtP.setValue(encodings[t].val, 1);
                var rb = tgtP.getValue();
                var rbR = Math.floor(rb / 1099511627776) & 0xFF;
                var rbG = Math.floor(rb / 16777216) & 0xFF;
                var rbB = Math.floor(rb / 256) & 0xFF;
                var match = (rbR === R && rbG === G && rbB === B) ? ' *** MATCH! ***' : '';
                lines.push('  ' + encodings[t].label + ' = ' + encodings[t].val +
                           ' => readBack=' + rb +
                           ' => R=' + rbR + ' G=' + rbG + ' B=' + rbB + match);
            } catch(e) {
                lines.push('  ' + encodings[t].label + ' => ERROR: ' + e);
            }
        }

        // Try setColorValue / getColorValue - the CORRECT approach
        lines.push('  --- setColorValue test (0-255 ints) ---');
        try {
            if (typeof srcP.getColorValue === 'function') {
                var cv = srcP.getColorValue();
                lines.push('  src getColorValue() = [' + cv.join(', ') + ']  (alpha,R,G,B)');

                if (typeof tgtP.setColorValue === 'function') {
                    tgtP.setColorValue(cv[0], cv[1], cv[2], cv[3], true);
                    var rb2 = tgtP.getValue();
                    var rb2R = Math.floor(rb2 / 1099511627776) & 0xFF;
                    var rb2G = Math.floor(rb2 / 16777216) & 0xFF;
                    var rb2B = Math.floor(rb2 / 256) & 0xFF;
                    var m2 = (rb2R === R && rb2G === G && rb2B === B) ? ' *** MATCH! ***' : '';
                    lines.push('  setColorValue(' + cv.join(',') + ',true) => readBack=' + rb2 +
                               ' => R=' + rb2R + ' G=' + rb2G + ' B=' + rb2B + m2);

                    // Also check via getColorValue on target
                    var tgtCV = tgtP.getColorValue();
                    lines.push('  tgt getColorValue() after set = [' + tgtCV.join(', ') + ']');
                } else {
                    lines.push('  tgt setColorValue: NOT a function');
                }
            } else {
                lines.push('  src getColorValue: NOT a function');
            }
        } catch(e) { lines.push('  setColorValue ERROR: ' + e); }

        // Restore original
        try { tgtP.setValue(origTgt, 1); } catch(e) {}
        lines.push('  (restored original)');
        lines.push('');
    }
}

function MU_padHex(n) {
    var h = n.toString(16).toUpperCase();
    return h.length < 2 ? '0' + h : h;
}

// Replace all MOGRT clips on a track with a new template, preserving timing and text
function MU_updateMogrtsOnTrack(mogrtPath, trackNumber) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return ET_fail("No active sequence");

        var tidx = parseInt(trackNumber, 10) - 1;
        if (isNaN(tidx) || tidx < 0) tidx = 0;
        if (tidx >= seq.videoTracks.numTracks) return ET_fail("Track " + trackNumber + " does not exist (sequence has " + seq.videoTracks.numTracks + " video track(s))");

        var track = seq.videoTracks[tidx];
        var clipCount = track.clips.numItems;
        if (clipCount === 0) return ET_fail("No clips on track " + trackNumber);

        // Collect info about every MOGRT on this track
        var mogrtClips = [];
        for (var c = 0; c < clipCount; c++) {
            var clip = track.clips[c];
            var mgt = null;
            try { mgt = clip.getMGTComponent(); } catch(e) {}
            if (!mgt) continue;

            // Read existing text content
            var existingText = "";
            try {
                for (var sp = 0; sp < mgt.properties.numItems; sp++) {
                    var prop = mgt.properties[sp];
                    try {
                        var pv = prop.getValue();
                        var po = JSON.parse(pv);
                        if (po.hasOwnProperty("textEditValue")) {
                            existingText = po.textEditValue;
                            break;
                        }
                    } catch(pe) {}
                }
            } catch(te) {}

            mogrtClips.push({
                startTicks: clip.start.ticks,
                endTicks:   clip.end.ticks,
                text:        existingText
            });
        }

        if (mogrtClips.length === 0) return ET_fail("No MOGRT clips found on track " + trackNumber);

        // Remove old MOGRT clips (backwards to keep indices stable)
        for (var r = clipCount - 1; r >= 0; r--) {
            var rclip = track.clips[r];
            var rmgt = null;
            try { rmgt = rclip.getMGTComponent(); } catch(e) {}
            if (rmgt) {
                try { rclip.remove(false, false); } catch(re) {}
            }
        }

        // Insert new MOGRTs restoring timing and text
        var placed = 0, textSet = 0;
        for (var i = 0; i < mogrtClips.length; i++) {
            var cap = mogrtClips[i];
            var newClip = null;
            try {
                newClip = seq.importMGT(mogrtPath, cap.startTicks.toString(), tidx, 0);
            } catch(ie) {}

            // importMGT sometimes returns undefined -- find the new clip by start time
            if (!newClip) {
                for (var fc = 0; fc < track.clips.numItems; fc++) {
                    if (track.clips[fc].start.ticks === cap.startTicks.toString()) {
                        newClip = track.clips[fc];
                        break;
                    }
                }
            }

            if (newClip) {
                // Restore end time
                try {
                    var newEnd = new Time();
                    newEnd.ticks = cap.endTicks.toString();
                    newClip.end = newEnd;
                } catch(ed) {}

                // Restore text
                if (cap.text) {
                    try {
                        var mgtC = newClip.getMGTComponent();
                        if (mgtC && mgtC.properties) {
                            for (var tp = 0; tp < mgtC.properties.numItems; tp++) {
                                var tprop = mgtC.properties[tp];
                                try {
                                    var tv = tprop.getValue();
                                    var to = JSON.parse(tv);
                                    if (to.hasOwnProperty("textEditValue")) {
                                        to.textEditValue = cap.text;
                                        tprop.setValue(JSON.stringify(to), true);
                                        textSet++;
                                        break;
                                    }
                                } catch(tpe) {}
                            }
                        }
                    } catch(te2) {}
                }
                placed++;
            }
        }

        return ET_ok("Done: Updated " + placed + " of " + mogrtClips.length + " MOGRT(s), text restored on " + textSet);
    } catch(e) {
        return ET_fail(e.toString());
    }
}
