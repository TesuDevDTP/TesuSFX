// ===== CAPTION TO MOGRT =====

var CM__activeBuildState = {
    requestKey: "",
    operationId: "",
    startedAtMs: 0
};
var CM__lastCompletedBuildState = {
    requestKey: "",
    operationId: "",
    finishedAtMs: 0
};
var CM__duplicateBuildCooldownMs = 8000;

// Step 1: Force save project and return the .prproj file path
function CM_saveAndGetProjectPath() {
    try {
        app.project.save();
        var projectPath = app.project.path;
        if (!projectPath || projectPath.length === 0) return ET_fail("Project has no saved path");
        projectPath = projectPath.replace(/\\/g, '/');
        return ET_ok(projectPath);
    } catch(e) {
        return ET_fail(e.toString());
    }
}

function CM__writeDebug(debugLog, line) {
    try {
        if (debugLog) debugLog.write(line + "\n");
    } catch (_writeErr) {}
}

function CM__closeDebug(debugLog) {
    try {
        if (debugLog) debugLog.close();
    } catch (_closeErr) {}
}

function CM__ticksToSeconds(ticksValue) {
    var ticksNumber = Number(ticksValue);
    if (!isFinite(ticksNumber)) return 0;
    return ticksNumber / 254016000000;
}

function CM__joinFsPath(basePath, leafName) {
    var base = String(basePath || "");
    var leaf = String(leafName || "");
    if (!base) return leaf;
    if (!leaf) return base;
    base = base.replace(/[\\\/]+$/, "");
    leaf = leaf.replace(/^[\\\/]+/, "");
    return base + "/" + leaf;
}

function CM__openDebugLog(debugDirPath) {
    var debugPath = CM__joinFsPath(Folder.temp.fsName, "caption_mogrt_debug.log");
    try {
        var folderPath = String(debugDirPath || "");
        if (folderPath) {
            var debugFolder = new Folder(folderPath);
            if (!debugFolder.exists) debugFolder.create();
            debugPath = CM__joinFsPath(debugFolder.fsName, "premiere_insert.log");
        }
    } catch (_folderErr) {}

    try {
        var debugLog = new File(debugPath);
        if (!debugLog.open('w')) return null;
        debugLog.__etPath = debugLog.fsName;
        return debugLog;
    } catch (_debugOpenErr) {
        return null;
    }
}

function CM__previewDebugValue(value) {
    var text = "";
    try {
        text = String(value == null ? "" : value);
    } catch (_stringifyErr) {
        text = "(unprintable)";
    }

    text = text.replace(/\r\n/g, " ").replace(/\n/g, " ").replace(/\r/g, " ");
    if (text.length > 180) {
        text = text.substring(0, 180) + "...";
    }
    return text;
}

function CM__writeBuildTotals(debugLog, label, placed, expectedInsertions, textSet, videoTrack) {
    var trackClipCount = -1;
    try {
        if (videoTrack && videoTrack.clips) trackClipCount = videoTrack.clips.numItems;
    } catch (_trackCountErr) {}

    CM__writeDebug(
        debugLog,
        String(label || "Build totals") +
        " | expected=" + String(expectedInsertions || 0) +
        " | placed=" + String(placed || 0) +
        " | textSet=" + String(textSet || 0) +
        (trackClipCount >= 0 ? (" | trackClips=" + String(trackClipCount)) : "")
    );
}

function CM__scanMogrtProperties(props, debugLog, pathPrefix, textPropsFound, operationId) {
    if (!props || props.numItems == null) return;

    for (var i = 0; i < props.numItems; i++) {
        ET__throwIfOperationCancelled(operationId, "Caption MOGRT build");
        var prop = props[i];
        var propName = prop && prop.displayName ? String(prop.displayName) : ("Property " + i);
        var propPath = pathPrefix ? (pathPrefix + " > " + propName) : propName;
        var preview = "";
        var hasTextEditValue = false;

        try {
            var rawValue = prop.getValue();
            preview = CM__previewDebugValue(rawValue);
            if (typeof rawValue === "string" && rawValue.indexOf("textEditValue") !== -1) {
                try {
                    var parsedValue = JSON.parse(rawValue);
                    if (parsedValue && parsedValue.hasOwnProperty("textEditValue")) {
                        hasTextEditValue = true;
                    }
                } catch (_jsonParseErr) {}
            }
        } catch (valueErr) {
            preview = "(unreadable: " + valueErr.toString() + ")";
        }

        CM__writeDebug(
            debugLog,
            "Property scan: " + propPath +
            " | hasChildren=" + (!!(prop && prop.properties && prop.properties.numItems > 0)) +
            " | hasTextEditValue=" + hasTextEditValue +
            " | preview=" + preview
        );

        if (hasTextEditValue) {
            textPropsFound.push({
                prop: prop,
                path: propPath
            });
        }

        if (prop && prop.properties && prop.properties.numItems > 0) {
            CM__scanMogrtProperties(prop.properties, debugLog, propPath, textPropsFound, operationId);
        }
    }
}

function CM__throwIfCaptionBuildCancelled(operationId) {
    if (!operationId || !ET__isOperationCancelled(operationId)) return false;
    throw new Error("Caption MOGRT build cancelled.");
}

function CM__getNowMs() {
    try {
        return new Date().getTime();
    } catch (_nowErr) {
        return 0;
    }
}

function CM__buildRequestKey(captions, mogrtPath, trackIndex) {
    var list = captions instanceof Array ? captions : [];
    var firstCaption = list.length ? list[0] : null;
    var lastCaption = list.length ? list[list.length - 1] : null;

    return [
        String(mogrtPath || ""),
        String(trackIndex || 0),
        String(list.length),
        firstCaption && firstCaption.startTicks != null ? String(firstCaption.startTicks) : "",
        lastCaption && lastCaption.startTicks != null ? String(lastCaption.startTicks) : ""
    ].join("|");
}

function CM__acquireBuildGuard(requestKey, operationId) {
    var nowMs = CM__getNowMs();

    if (
        CM__activeBuildState.requestKey &&
        CM__activeBuildState.requestKey === requestKey
    ) {
        return {
            ok: false,
            reason: "An identical Caption MOGRT build is already running."
        };
    }

    if (
        CM__lastCompletedBuildState.requestKey &&
        CM__lastCompletedBuildState.requestKey === requestKey &&
        nowMs > 0 &&
        CM__lastCompletedBuildState.finishedAtMs > 0 &&
        (nowMs - CM__lastCompletedBuildState.finishedAtMs) < CM__duplicateBuildCooldownMs
    ) {
        return {
            ok: false,
            reason: "Blocked a duplicate Caption MOGRT build request that retriggered immediately after completion."
        };
    }

    CM__activeBuildState.requestKey = String(requestKey || "");
    CM__activeBuildState.operationId = String(operationId || "");
    CM__activeBuildState.startedAtMs = nowMs;
    return { ok: true };
}

function CM__releaseBuildGuard(requestKey, operationId) {
    var key = String(requestKey || "");
    var opId = String(operationId || "");
    var nowMs = CM__getNowMs();

    if (
        CM__activeBuildState.requestKey === key &&
        CM__activeBuildState.operationId === opId
    ) {
        CM__activeBuildState.requestKey = "";
        CM__activeBuildState.operationId = "";
        CM__activeBuildState.startedAtMs = 0;
    }

    if (key) {
        CM__lastCompletedBuildState.requestKey = key;
        CM__lastCompletedBuildState.operationId = opId;
        CM__lastCompletedBuildState.finishedAtMs = nowMs;
    }
}

function CM__importMogrtWithFallback(seq, track, mogrtPath, startTicks, trackIndex, debugLog, operationId) {
    var clipCountBefore = -1;
    var insertedClip = null;
    var expectedTicks = String(startTicks || "0");

    ET__throwIfOperationCancelled(operationId, "Caption MOGRT build");
    try {
        if (track && track.clips) clipCountBefore = track.clips.numItems;
    } catch (_countErr) {}

    insertedClip = seq.importMGT(mogrtPath, expectedTicks, trackIndex, 0);
    ET__throwIfOperationCancelled(operationId, "Caption MOGRT build");
    if (insertedClip) return insertedClip;

    CM__writeDebug(debugLog, "importMGT returned null, attempting fallback lookup");

    try {
        if (!track || !track.clips) return null;

        var clipCountAfter = track.clips.numItems;
        for (var i = 0; i < clipCountAfter; i++) {
            ET__throwIfOperationCancelled(operationId, "Caption MOGRT build");
            var candidate = track.clips[i];
            try {
                if (candidate && candidate.start && candidate.start.ticks != null && String(candidate.start.ticks) === expectedTicks) {
                    insertedClip = candidate;
                    break;
                }
            } catch (_matchErr) {}
        }

        if (!insertedClip && clipCountAfter > clipCountBefore && clipCountAfter > 0) {
            insertedClip = track.clips[clipCountAfter - 1];
            CM__writeDebug(debugLog, "Fallback matched newest clip on track");
        } else if (insertedClip) {
            CM__writeDebug(debugLog, "Fallback matched clip by start ticks");
        }
    } catch (fallbackErr) {
        CM__writeDebug(debugLog, "Fallback lookup failed: " + fallbackErr.toString());
    }

    return insertedClip;
}

// Step 4: Receive parsed captions JSON from CEP and insert MOGRTs
function CM_insertMogrtsFromData(captionsJson, mogrtPath, trackIndex, debugDirPath, operationId) {
    var debugLog = CM__openDebugLog(debugDirPath);
    var buildGuardAcquired = false;
    var buildRequestKey = "";
    var captions = null;
    var placed = 0;
    var textSet = 0;
    var expectedInsertions = 0;
    var videoTrack = null;

    function finish(result) {
        if (buildGuardAcquired) {
            CM__releaseBuildGuard(buildRequestKey, operationId);
            buildGuardAcquired = false;
        }
        CM__closeDebug(debugLog);
        return result;
    }

    try {
        CM__writeDebug(debugLog, "=== CAPTION MOGRT DEBUG ===");
        CM__writeDebug(debugLog, "Started: " + new Date().toString());
        if (debugLog && debugLog.__etPath) {
            CM__writeDebug(debugLog, "Debug log path: " + debugLog.__etPath);
        }
        CM__writeDebug(debugLog, "MOGRT path: " + mogrtPath);
        CM__writeDebug(debugLog, "Operation id: " + String(operationId || ""));
        try {
            if (operationId && typeof ET__getOperationCancelFiles === "function") {
                var cancelFiles = ET__getOperationCancelFiles(operationId);
                var cancelPaths = [];
                for (var cancelIdx = 0; cancelFiles && cancelIdx < cancelFiles.length; cancelIdx++) {
                    if (cancelFiles[cancelIdx] && cancelFiles[cancelIdx].fsName) {
                        cancelPaths.push(cancelFiles[cancelIdx].fsName);
                    }
                }
                if (cancelPaths.length) {
                    CM__writeDebug(debugLog, "Cancel paths: " + cancelPaths.join(" | "));
                }
            }
        } catch (_cancelPathDebugErr) {}

        var seq = app.project.activeSequence;
        if (!seq) {
            CM__writeDebug(debugLog, "ERROR: No active sequence");
            return finish(ET_fail("No active sequence"));
        }

        captions = JSON.parse(captionsJson);
        if (!captions || captions.length === 0) {
            CM__writeDebug(debugLog, "ERROR: No captions in data");
            return finish(ET_fail("No captions in data"));
        }
        expectedInsertions = captions.length;

        var targetTrackIndex = parseInt(trackIndex, 10);
        if (isNaN(targetTrackIndex) || targetTrackIndex < 0) targetTrackIndex = 0;
        buildRequestKey = CM__buildRequestKey(captions, mogrtPath, targetTrackIndex);
        var buildGuard = CM__acquireBuildGuard(buildRequestKey, operationId);
        if (!buildGuard || !buildGuard.ok) {
            CM__writeDebug(debugLog, "DUPLICATE BUILD BLOCKED: " + String(buildGuard && buildGuard.reason ? buildGuard.reason : "Unknown duplicate request."));
            return finish(ET_fail(buildGuard && buildGuard.reason ? buildGuard.reason : "Duplicate Caption MOGRT build request blocked."));
        }
        buildGuardAcquired = true;
        CM__writeDebug(debugLog, "Build request key: " + buildRequestKey);

        while (seq.videoTracks.numTracks <= targetTrackIndex) {
            ET__throwIfOperationCancelled(operationId, "Caption MOGRT build");
            seq.videoTracks.add();
        }

        videoTrack = seq.videoTracks[targetTrackIndex];
        var clipCountBefore = videoTrack.clips.numItems;

        CM__writeDebug(debugLog, "Sequence: " + seq.name);
        CM__writeDebug(debugLog, "Target track: V" + (targetTrackIndex + 1));
        CM__writeDebug(debugLog, "Caption count: " + captions.length);
        CM__writeDebug(debugLog, "Initial target track clip count: " + clipCountBefore);
        CM__writeBuildTotals(debugLog, "Build target totals", placed, expectedInsertions, textSet, videoTrack);
        CM__writeDebug(debugLog, "");

        for (var i = 0; i < captions.length; i++) {
            ET__throwIfOperationCancelled(operationId, "Caption MOGRT build");
            var cap = captions[i];
            var startTicks = String(cap.startTicks);
            var endTicks = String(cap.endTicks);
            var expectedStartSeconds = cap.startSeconds != null ? Number(cap.startSeconds) : CM__ticksToSeconds(startTicks);
            var expectedEndSeconds = cap.endSeconds != null ? Number(cap.endSeconds) : CM__ticksToSeconds(endTicks);

            CM__writeDebug(debugLog, "--- Caption " + (i + 1) + " of " + captions.length + " ---");
            CM__writeDebug(debugLog, "Text: " + cap.text);
            CM__writeDebug(debugLog, "Text preview: " + CM__previewDebugValue(cap.text));
            CM__writeDebug(debugLog, "Text length: " + String(cap.text != null ? String(cap.text).length : 0));
            CM__writeDebug(debugLog, "Text source: " + (cap.textSource || "unknown"));
            CM__writeDebug(debugLog, "Source block: " + (cap.sourceBlockId || ""));
            CM__writeDebug(debugLog, "Source hash: " + (cap.sourceBinaryHash || ""));
            CM__writeDebug(debugLog, "Expected start: " + expectedStartSeconds.toFixed(6) + "s (" + startTicks + " ticks)");
            CM__writeDebug(debugLog, "Expected end: " + expectedEndSeconds.toFixed(6) + "s (" + endTicks + " ticks)");
            CM__writeDebug(debugLog, "Insertion attempt: " + (i + 1) + " of " + expectedInsertions + " | placedSoFar=" + placed + " | textSetSoFar=" + textSet);

            var newMogrtClip = CM__importMogrtWithFallback(seq, videoTrack, mogrtPath, startTicks, targetTrackIndex, debugLog, operationId);
            CM__throwIfCaptionBuildCancelled(operationId);

            if (newMogrtClip) {
                clipCountBefore = videoTrack.clips.numItems;

                try {
                    CM__writeDebug(debugLog, "Actual start: " + newMogrtClip.start.seconds + "s (" + newMogrtClip.start.ticks + " ticks)");
                    CM__writeDebug(debugLog, "Start difference: " + (newMogrtClip.start.seconds - expectedStartSeconds).toFixed(6) + "s");
                } catch (_actualStartErr) {}

                // Adjust end point to match caption duration
                try {
                    ET__throwIfOperationCancelled(operationId, "Caption MOGRT build");
                    var newEnd = new Time();
                    newEnd.ticks = endTicks;
                    newMogrtClip.end = newEnd;
                    CM__writeDebug(debugLog, "End set from raw caption ticks");
                } catch(ed) {
                    CM__writeDebug(debugLog, "WARNING: Failed to set end time: " + ed.toString());
                }
                CM__throwIfCaptionBuildCancelled(operationId);

                // Set text on the MOGRT -- same method as Authentic tab
                var thisTextSet = false;
                try {
                    ET__throwIfOperationCancelled(operationId, "Caption MOGRT build");
                    var mgtComp = newMogrtClip.getMGTComponent();
                    if (mgtComp && mgtComp.properties) {
                        CM__writeDebug(debugLog, "MGT component found, properties: " + mgtComp.properties.numItems);
                        // Scan all properties so the debug log shows whether Premiere exposed a text-editable field.
                        var textPropsFound = [];
                        CM__scanMogrtProperties(mgtComp.properties, debugLog, "", textPropsFound, operationId);
                        CM__throwIfCaptionBuildCancelled(operationId);

                        CM__writeDebug(debugLog, "Text properties found: " + textPropsFound.length);

                        // Set the first text property to caption text
                        if (textPropsFound.length > 0) {
                            CM__writeDebug(debugLog, "Using text property: " + textPropsFound[0].path);
                            try {
                                var txtVal = textPropsFound[0].prop.getValue();
                                var txtObj = JSON.parse(txtVal);
                                txtObj.textEditValue = cap.text;
                                textPropsFound[0].prop.setValue(JSON.stringify(txtObj), true);
                                thisTextSet = true;
                                CM__writeDebug(debugLog, "Text set via JSON");
                            } catch (e1) {
                                try {
                                    textPropsFound[0].prop.setValue(cap.text, true);
                                    thisTextSet = true;
                                    CM__writeDebug(debugLog, "Text set via direct setValue");
                                } catch (e2) {
                                    CM__writeDebug(debugLog, "WARNING: Direct text set failed: " + e2.toString());
                                }
                            }
                        } else {
                            CM__writeDebug(debugLog, "WARNING: Premiere did not expose any property with textEditValue for this MOGRT");
                        }
                        CM__throwIfCaptionBuildCancelled(operationId);

                        if (!thisTextSet) {
                            thisTextSet = CM_setMogrtTextProperty(mgtComp.properties, cap.text, debugLog, "", operationId);
                            if (thisTextSet) {
                                CM__writeDebug(debugLog, "Text set via recursive fallback");
                            } else {
                                CM__writeDebug(debugLog, "WARNING: Recursive fallback did not find a writable text property");
                            }
                        }
                    } else {
                        CM__writeDebug(debugLog, "WARNING: MGT component missing or has no properties");
                    }
                } catch(et) {
                    CM__writeDebug(debugLog, "WARNING: Text set error: " + et.toString());
                }
                CM__throwIfCaptionBuildCancelled(operationId);

                if (thisTextSet) textSet++;
                placed++;
                CM__writeDebug(debugLog, "Inserted successfully");
                CM__writeBuildTotals(debugLog, "Running totals after insertion", placed, expectedInsertions, textSet, videoTrack);
            } else {
                CM__writeDebug(debugLog, "WARNING: importMGT returned null and fallback found no clip");
                CM__writeBuildTotals(debugLog, "Running totals after failed insertion", placed, expectedInsertions, textSet, videoTrack);
            }

            CM__writeDebug(debugLog, "");
        }

        CM__writeDebug(debugLog, "=== COMPLETE ===");
        CM__writeDebug(debugLog, "Placed: " + placed);
        CM__writeDebug(debugLog, "Text set: " + textSet);
        CM__writeBuildTotals(debugLog, "Final totals", placed, expectedInsertions, textSet, videoTrack);
        return finish(ET_ok(
            "Done: Placed " + placed +
            " MOGRT(s), text set on " + textSet +
            " of " + captions.length +
            " caption(s)." +
            (debugLog && debugLog.__etPath ? (" Premiere log: " + debugLog.__etPath) : "")
        ));
    } catch(e) {
        if (ET__isOperationCancelled(operationId)) {
            CM__writeDebug(debugLog, "CANCELLED: " + e.toString());
            CM__writeBuildTotals(debugLog, "Cancelled totals", placed, expectedInsertions, textSet, videoTrack);
        } else {
            CM__writeDebug(debugLog, "FATAL ERROR: " + e.toString());
            CM__writeBuildTotals(debugLog, "Abort totals", placed, expectedInsertions, textSet, videoTrack);
        }
        return finish(ET_fail(
            e.toString() +
            (debugLog && debugLog.__etPath ? (" Premiere log: " + debugLog.__etPath) : "")
        ));
    }
}

// Recursively find and set the first text property in a MOGRT component
function CM_setMogrtTextProperty(props, newText, debugLog, pathPrefix, operationId) {
    for (var i = 0; i < props.numItems; i++) {
        ET__throwIfOperationCancelled(operationId, "Caption MOGRT build");
        var prop = props[i];
        var displayName = prop && prop.displayName ? String(prop.displayName) : ("Property " + i);
        var name = displayName.toLowerCase();
        var propPath = pathPrefix ? (pathPrefix + " > " + displayName) : displayName;

        // Check if this looks like a text property
        if (name.indexOf("text") !== -1 || name.indexOf("caption") !== -1 || name.indexOf("source") !== -1) {
            CM__writeDebug(debugLog, "Recursive candidate: " + propPath);
            try {
                var val = prop.getValue();
                // MOGRT text properties store JSON with textEditValue
                if (typeof val === "string" && val.indexOf("textEditValue") !== -1) {
                    var obj = JSON.parse(val);
                    obj.textEditValue = newText;
                    prop.setValue(JSON.stringify(obj), true);
                    CM__writeDebug(debugLog, "Recursive JSON set succeeded on: " + propPath);
                    return !!1;
                }
            } catch(e1) {
                CM__writeDebug(debugLog, "Recursive JSON set failed on: " + propPath + " => " + e1.toString());
            }
            // Try raw setValue
            try {
                prop.setValue(newText, true);
                CM__writeDebug(debugLog, "Recursive direct setValue succeeded on: " + propPath);
                return !!1;
            } catch(e2) {
                CM__writeDebug(debugLog, "Recursive direct setValue failed on: " + propPath + " => " + e2.toString());
            }
        }

        // Recurse into groups
        if (prop.properties && prop.properties.numItems > 0) {
            if (CM_setMogrtTextProperty(prop.properties, newText, debugLog, propPath, operationId)) return !!1;
        }
    }

    // Last resort: try setting ANY property that has a string value containing textEditValue
    for (var j = 0; j < props.numItems; j++) {
        ET__throwIfOperationCancelled(operationId, "Caption MOGRT build");
        var prop2 = props[j];
        var displayName2 = prop2 && prop2.displayName ? String(prop2.displayName) : ("Property " + j);
        var propPath2 = pathPrefix ? (pathPrefix + " > " + displayName2) : displayName2;
        try {
            var val2 = prop2.getValue();
            if (typeof val2 === "string" && val2.indexOf("textEditValue") !== -1) {
                var obj2 = JSON.parse(val2);
                obj2.textEditValue = newText;
                prop2.setValue(JSON.stringify(obj2), true);
                CM__writeDebug(debugLog, "Last-resort JSON set succeeded on: " + propPath2);
                return !!1;
            }
        } catch(e3) {
            CM__writeDebug(debugLog, "Last-resort JSON set failed on: " + propPath2 + " => " + e3.toString());
        }
        if (prop2.properties && prop2.properties.numItems > 0) {
            if (CM_setMogrtTextProperty(prop2.properties, newText, debugLog, propPath2, operationId)) return !!1;
        }
    }
    return false;
}

// Dump all MOGRT property names/values for the first clip on V1 (for debugging)
function CM_dumpMogrtProps() {
    var seq = app.project.activeSequence;
    if (!seq) return ET_fail("No active sequence");
    var clip = seq.videoTracks[0].clips[0];
    if (!clip) return ET_fail("No clip on V1");
    var mgt = clip.getMGTComponent();
    if (!mgt) return ET_fail("Not a MOGRT");
    var log = "";
    function dig(props, indent) {
        for (var i = 0; i < props.numItems; i++) {
            var p = props[i];
            var val = "";
            try { val = String(p.getValue()).substring(0, 120); } catch(e) { val = "(no value)"; }
            log += indent + p.displayName + " = " + val + "\n";
            if (p.properties && p.properties.numItems > 0) dig(p.properties, indent + "  ");
        }
    }
    dig(mgt.properties, "");
    return ET_ok(log);
}
