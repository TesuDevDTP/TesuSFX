// Look up a project item by file name in rootItem (flat scan).
// If not found, import once and return the new item. Returns null on failure.
function AmbientVideo__getOrImportItem(filePath, itemCache) {
    // Derive basename without any regex character-class (ES3 safe)
    var tmp = filePath.replace(/\\/g, '/');
    var slashIdx = tmp.lastIndexOf('/');
    var fileName = (slashIdx >= 0) ? tmp.substring(slashIdx + 1) : tmp;

    if (itemCache[fileName]) return itemCache[fileName];

    // Scan existing project items for a match by name
    var root = app.project.rootItem.children;
    for (var si = 0; si < root.numItems; si++) {
        if (root[si].name === fileName) {
            itemCache[fileName] = root[si];
            return root[si];
        }
    }

    // Not found - import it once
    var before  = app.project.rootItem.children.numItems;
    var success = app.project.importFiles([filePath], true, app.project.rootItem, false);
    if (!success || app.project.rootItem.children.numItems <= before) return null;

    var item = app.project.rootItem.children[app.project.rootItem.children.numItems - 1];
    itemCache[fileName] = item;
    return item;
}

// ============================================================
// COPYRIGHT SAFE REEL BUILDER -- helpers (file scope, ES3 safe)
// ============================================================
function AmbientVideo__overlapsUsed(usedSegments, fileName, newStart, newEnd) {
    var ranges = usedSegments[fileName];
    if (!ranges) return false;
    for (var ri = 0; ri < ranges.length; ri++) {
        if (newStart < ranges[ri][1] && newEnd > ranges[ri][0]) return !!1;
    }
    return false;
}

function AmbientVideo__recordUsed(usedSegments, fileName, startSec, endSec) {
    if (!usedSegments[fileName]) usedSegments[fileName] = [];
    usedSegments[fileName].push([startSec, endSec]);
}

function AmbientVideo__shuffle(arr) {
    for (var si = arr.length - 1; si > 0; si--) {
        var sj = Math.floor(Math.random() * (si + 1));
        var tmp = arr[si]; arr[si] = arr[sj]; arr[sj] = tmp;
    }
}

// ============================================================
// COPYRIGHT SAFE REEL BUILDER
// ============================================================
// ============================================================
// AmbientVideo_buildReel -- simple random clip placer
// Randomly picks from filePaths, assigns a random duration
// within [clipMin, clipMax], caps it to the clip's actual
// length, then places it on the chosen video track.
// Fills the timeline from first to last audio clip.
// ============================================================
function AmbientVideo_buildReel(encodedData, operationId) {
    try {
        // --- Base64 decode ---
        var b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        var clean = encodedData.replace(/\s/g, "");
        var dec = "";
        var bi = 0;
        while (bi < clean.length) {
            var e1 = b64.indexOf(clean.charAt(bi++));
            var e2 = b64.indexOf(clean.charAt(bi++));
            var e3 = b64.indexOf(clean.charAt(bi++));
            var e4 = b64.indexOf(clean.charAt(bi++));
            dec += String.fromCharCode((e1 << 2) | (e2 >> 4));
            if (e3 !== 64) dec += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
            if (e4 !== 64) dec += String.fromCharCode(((e3 & 3) << 6) | e4);
        }
        var data = JSON.parse(dec);

        var filePaths  = data.filePaths;
        var clipMin    = data.clipMin    || 7;
        var clipMax    = data.clipMax    || 30;
        var trackIndex = data.trackIndex || 0;

        if (!filePaths || filePaths.length === 0) return ET_fail("No files provided");
        if (!app.project) return ET_fail("No project open");
        var seq = app.project.activeSequence;
        if (!seq) return ET_fail("No active sequence");

        // --- Timeline bounds from audio ---
        var timelineStart = 999999;
        var timelineEnd   = -1;
        for (var at = 0; at < seq.audioTracks.numTracks; at++) {
            var aTrk = seq.audioTracks[at];
            for (var ac = 0; ac < aTrk.clips.numItems; ac++) {
                var aC = aTrk.clips[ac];
                if (aC.start.seconds < timelineStart) timelineStart = aC.start.seconds;
                if (aC.end.seconds   > timelineEnd)   timelineEnd   = aC.end.seconds;
            }
        }
        if (timelineEnd < 0) return ET_fail("No audio clips found on timeline");

        // --- Ensure target video track exists ---
        while (seq.videoTracks.numTracks <= trackIndex) { seq.videoTracks.add(); }
        var videoTrack = seq.videoTracks[trackIndex];

        // --- Pre-import all files once into a cache ---
        var itemCache = {};
        for (var pi = 0; pi < filePaths.length; pi++) {
            AmbientVideo__getOrImportItem(filePaths[pi], itemCache);
        }

        // --- Shuffle helper ---
        function shuffle(arr) {
            for (var i = arr.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
            }
        }

        var currentTime = timelineStart;
        var placedCount = 0;
        var order = [];
        for (var oi = 0; oi < filePaths.length; oi++) order.push(oi);
        shuffle(order);
        var orderIdx = 0;

        while (currentTime < timelineEnd) {
            ET__throwIfOperationCancelled(operationId, "Ambient video build");
            // Cycle through shuffled list; re-shuffle when exhausted
            if (orderIdx >= order.length) {
                shuffle(order);
                orderIdx = 0;
            }
            var fp   = filePaths[order[orderIdx++]];
            var item = AmbientVideo__getOrImportItem(fp, itemCache);
            if (!item) continue;

            // Random desired duration within slider range
            var desiredDur = clipMin + Math.random() * (clipMax - clipMin);

            // Cap to actual media duration
            var mediaDur = 0;
            try { mediaDur = item.duration ? item.duration.seconds : 0; } catch(de) {}
            var isImage = /\.(jpg|jpeg|png|gif|bmp|tif|tiff|psd|webp)$/i.test(fp);
            if (!isImage && mediaDur > 0 && mediaDur < clipMin) continue; // clip too short
            var clipDur = (!isImage && mediaDur > 0 && desiredDur > mediaDur) ? mediaDur : desiredDur;

            // Don't overshoot the timeline end
            if (currentTime + clipDur > timelineEnd) clipDur = timelineEnd - currentTime;
            if (clipDur < 0.5) break;

            // Snapshot audio before placement
            var audioSnap = [];
            for (var qs = 0; qs < seq.audioTracks.numTracks; qs++) {
                audioSnap.push(seq.audioTracks[qs].clips.numItems);
            }

            videoTrack.overwriteClip(item, currentTime);

            // Strip any audio that was added
            for (var qt = 0; qt < seq.audioTracks.numTracks; qt++) {
                var qTrk = seq.audioTracks[qt];
                for (var qc = qTrk.clips.numItems - 1; qc >= audioSnap[qt]; qc--) {
                    try { qTrk.clips[qc].remove(false, false); } catch(re) {}
                }
            }

            // Trim placed clip to clipDur
            for (var vc = 0; vc < videoTrack.clips.numItems; vc++) {
                var vClip = videoTrack.clips[vc];
                if (Math.abs(vClip.start.seconds - currentTime) < 0.5) {
                    try { vClip.end.seconds = currentTime + clipDur; } catch(te) {}
                    break;
                }
            }

            currentTime += clipDur;
            placedCount++;
        }

        return ET_ok("true|" + placedCount);

    } catch(e) {
        return ET_fail(e.toString());
    }
}

function AmbientVideo_buildCopyrightSafeReel(encodedData, operationId) {
    var debugLog = new File(Folder.temp.fsName + "\\csreel_debug.txt");
    debugLog.open('w');
    debugLog.write("=== COPYRIGHT SAFE REEL DEBUG ===\n");
    try {
        // --- Decode base64 ---
        var base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        var cleanData = encodedData.replace(/\s/g, "");
        var decoded = "";
        var bi = 0;
        while (bi < cleanData.length) {
            var e1 = base64Chars.indexOf(cleanData.charAt(bi++));
            var e2 = base64Chars.indexOf(cleanData.charAt(bi++));
            var e3 = base64Chars.indexOf(cleanData.charAt(bi++));
            var e4 = base64Chars.indexOf(cleanData.charAt(bi++));
            decoded += String.fromCharCode((e1 << 2) | (e2 >> 4));
            if (e3 !== 64) decoded += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
            if (e4 !== 64) decoded += String.fromCharCode(((e3 & 3) << 6) | e4);
        }
        var data = JSON.parse(decoded);

        var folderPath = data.folderPath;
        var filePaths  = data.filePaths;
        var clipMin    = data.clipMin  || 7;
        var clipMax    = data.clipMax  || 15;
        var trackIndex = data.trackIndex || 0;

        debugLog.write("folderPath: " + folderPath + "\n");
        debugLog.write("files: " + filePaths.length + "\n");
        debugLog.write("clipMin: " + clipMin + "  clipMax: " + clipMax + "\n");

        if (!filePaths || filePaths.length === 0) { debugLog.close(); return ET_fail("No files provided"); }
        if (!app.project || !app.project.activeSequence) { debugLog.close(); return ET_fail("No active sequence"); }

        var seq = app.project.activeSequence;

        // --- Timeline bounds from audio ---
        var timelineStart = 999999;
        var timelineEnd   = -1;
        for (var at = 0; at < seq.audioTracks.numTracks; at++) {
            var aTrk = seq.audioTracks[at];
            for (var ac = 0; ac < aTrk.clips.numItems; ac++) {
                var aC = aTrk.clips[ac];
                if (aC.start.seconds < timelineStart) timelineStart = aC.start.seconds;
                if (aC.end.seconds   > timelineEnd)   timelineEnd   = aC.end.seconds;
            }
        }
        debugLog.write("timelineStart: " + timelineStart + "  timelineEnd: " + timelineEnd + "\n");
        if (timelineEnd < 0) { debugLog.close(); return ET_fail("No audio clips found on timeline to define bounds"); }

        // --- Load or create tracking map ---
        var trackingPath = folderPath + "\\reel_used_segments.json";
        var trackingFile = new File(trackingPath);
        var usedSegments = {};
        if (trackingFile.exists) {
            try {
                trackingFile.open('r');
                var rawJson = trackingFile.read();
                trackingFile.close();
                usedSegments = JSON.parse(rawJson);
                debugLog.write("Loaded tracking file.\n");
            } catch(te) { usedSegments = {}; }
        } else {
            debugLog.write("No tracking file yet, starting fresh.\n");
        }

        // --- Ensure target video track exists ---
        while (seq.videoTracks.numTracks <= trackIndex) { seq.videoTracks.add(); }
        var videoTrack = seq.videoTracks[trackIndex];

        var MAX_ATTEMPTS = 30;
        var currentTime  = timelineStart;
        var placedCount  = 0;

        // --- Pre-build project item cache (import each file once) ---
        var itemCache = {};
        debugLog.write("Pre-importing " + filePaths.length + " file(s)...\n");
        for (var pii = 0; pii < filePaths.length; pii++) {
            AmbientVideo__getOrImportItem(filePaths[pii], itemCache);
        }
        debugLog.write("Cache ready with " + filePaths.length + " entries.\n");
        while (currentTime < timelineEnd) {
            ET__throwIfOperationCancelled(operationId, "Ambient video build");
            var clipDur = clipMin + Math.random() * (clipMax - clipMin);
            if (currentTime + clipDur > timelineEnd) clipDur = timelineEnd - currentTime;
            if (clipDur < 0.5) break;

            var shuffledPaths = filePaths.slice();
            AmbientVideo__shuffle(shuffledPaths);

            var placed = false;

            for (var fi = 0; fi < shuffledPaths.length && !placed; fi++) {
                var fp       = shuffledPaths[fi];
                var fpTmp    = fp.replace(/\\/g, '/');
                var fpSlash  = fpTmp.lastIndexOf('/');
                var fileName = (fpSlash >= 0) ? fpTmp.substring(fpSlash + 1) : fpTmp;

                // Retrieve from cache -- no re-import
                var pItem = AmbientVideo__getOrImportItem(fp, itemCache);
                if (!pItem) { debugLog.write("Item not in cache / import failed: " + fp + "\n"); continue; }
                var mediaDur = 0;
                try { mediaDur = pItem.duration ? pItem.duration.seconds : 0; } catch(de) {}
                debugLog.write("File: " + fileName + "  dur: " + mediaDur + "s\n");

                if (mediaDur < clipMin) { debugLog.write("  -> too short, skipping\n"); continue; }

                var usableClipDur = (clipDur > mediaDur) ? mediaDur : clipDur;
                var maxStart      = mediaDur - usableClipDur;
                if (maxStart < 0) continue;

                var chosenStart = -1;
                for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                    var cStart = Math.random() * maxStart;
                    if (!AmbientVideo__overlapsUsed(usedSegments, fileName, cStart, cStart + usableClipDur)) {
                        chosenStart = cStart;
                        break;
                    }
                }
                debugLog.write("  chosenStart: " + chosenStart + "\n");
                if (chosenStart < 0) { debugLog.write("  -> exhausted, trying next file\n"); continue; }

                // Snapshot audio clip counts before placement
                var audioSnap = [];
                for (var qs = 0; qs < seq.audioTracks.numTracks; qs++) {
                    audioSnap.push(seq.audioTracks[qs].clips.numItems);
                }

                videoTrack.overwriteClip(pItem, currentTime);

                // Remove any newly added audio clips
                for (var qt = 0; qt < seq.audioTracks.numTracks; qt++) {
                    var qTrk = seq.audioTracks[qt];
                    for (var qc = qTrk.clips.numItems - 1; qc >= audioSnap[qt]; qc--) {
                        try { qTrk.clips[qc].remove(false, false); } catch(re2) {}
                    }
                }

                // Set source in/out point so the clip plays from chosenStart
                for (var vc = 0; vc < videoTrack.clips.numItems; vc++) {
                    var vClip = videoTrack.clips[vc];
                    if (Math.abs(vClip.start.seconds - currentTime) < 0.5) {
                        try {
                            vClip.inPoint.seconds  = chosenStart;
                            vClip.outPoint.seconds = chosenStart + usableClipDur;
                        } catch(te2) {
                            // Fallback: just trim the timeline end
                            try { vClip.end.seconds = currentTime + usableClipDur; } catch(te3) {}
                        }
                        break;
                    }
                }

                AmbientVideo__recordUsed(usedSegments, fileName, chosenStart, chosenStart + usableClipDur);
                currentTime += usableClipDur;
                placedCount++;
                placed = true;
                debugLog.write("  -> placed at " + currentTime + "\n");
            }

            if (!placed) {
                debugLog.write("No file could be placed at " + currentTime + ", advancing.\n");
                currentTime += clipMin;
            }
        }

        // --- Save tracking file ---
        try {
            var outFile = new File(trackingPath);
            outFile.open('w');
            outFile.write(JSON.stringify(usedSegments));
            outFile.close();
            debugLog.write("Tracking file saved.\n");
        } catch(we) { debugLog.write("Failed to save tracking file: " + we.toString() + "\n"); }

        debugLog.write("Done. Placed: " + placedCount + "\n");
        debugLog.close();
        return ET_ok("true|" + placedCount);

    } catch(e) {
        debugLog.write((ET__isOperationCancelled(operationId) ? "CANCELLED: " : "FATAL: ") + e.toString() + " line:" + e.line + "\n");
        debugLog.close();
        return ET_fail(e.toString());
    }
}

// Phase 1 (opening N minutes): short random clips
// Phase 2 (after transition): longer random clips
// All placed on a user-chosen video track; video audio stripped.
// ============================================================
function AmbientVideo_buildCinematicReel(encodedData, operationId) {
    var debugLog = new File(Folder.temp.fsName + "\\cinematic_reel_debug.txt");
    debugLog.open('w');
    debugLog.write("=== CINEMATIC REEL DEBUG ===\n");
    try {
        // Decode base64 (ExtendScript has no atob -- manual decoder)
        var base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        var cleanData = encodedData.replace(/\s/g, "");
        var decoded = "";
        var bi = 0;
        while (bi < cleanData.length) {
            var e1 = base64Chars.indexOf(cleanData.charAt(bi++));
            var e2 = base64Chars.indexOf(cleanData.charAt(bi++));
            var e3 = base64Chars.indexOf(cleanData.charAt(bi++));
            var e4 = base64Chars.indexOf(cleanData.charAt(bi++));
            var c1 = (e1 << 2) | (e2 >> 4);
            var c2 = ((e2 & 15) << 4) | (e3 >> 2);
            var c3 = ((e3 & 3) << 6) | e4;
            decoded += String.fromCharCode(c1);
            if (e3 !== 64) decoded += String.fromCharCode(c2);
            if (e4 !== 64) decoded += String.fromCharCode(c3);
        }
        // Parse JSON directly (same approach as other workflow functions)
        var data = JSON.parse(decoded);

        var filePaths   = data.filePaths;
        var phases      = data.phases;   // [{durationMinutes, clipMin, clipMax}, ...last has durationMinutes=null]
        var trackIndex  = data.trackIndex || 0;

        if (!phases || phases.length === 0) return ET_fail("No phases defined");

        // Validate sequence
        if (!app.project) return ET_fail("No project open");
        var seq = app.project.activeSequence;
        if (!seq) return ET_fail("No active sequence");

        // ---- Find timeline bounds from audio tracks ----
        var timelineStart = 999999;
        var timelineEnd   = -1;
        for (var at = 0; at < seq.audioTracks.numTracks; at++) {
            var aTrack = seq.audioTracks[at];
            for (var ac = 0; ac < aTrack.clips.numItems; ac++) {
                var aClip = aTrack.clips[ac];
                if (aClip.start.seconds < timelineStart) timelineStart = aClip.start.seconds;
                if (aClip.end.seconds   > timelineEnd)   timelineEnd   = aClip.end.seconds;
            }
        }
        if (timelineEnd < 0) { debugLog.close(); return ET_fail("No audio clips found on the timeline"); }
        debugLog.write("timelineStart: " + timelineStart + "  timelineEnd: " + timelineEnd + "\n");

        // ---- Build phase boundary times ----
        // Each entry is the absolute time when that phase ends (last phase ends at timelineEnd)
        var phaseBoundaries = [];
        var accumTime = timelineStart;
        for (var pi = 0; pi < phases.length - 1; pi++) {
            accumTime += (phases[pi].durationMinutes || 0) * 60;
            phaseBoundaries.push(accumTime);
        }
        phaseBoundaries.push(timelineEnd); // last phase always ends at timeline end
        debugLog.write("Phases: " + phases.length + "  boundaries: " + phaseBoundaries.join(', ') + "\n");

        // Helper: return the phase object active at a given time
        function getPhaseAt(t) {
            for (var gi = 0; gi < phaseBoundaries.length; gi++) {
                if (t < phaseBoundaries[gi]) return phases[gi];
            }
            return phases[phases.length - 1];
        }

        // ---- Classify files ----
        var imageExts = /\.(jpg|jpeg|png|gif|bmp|tif|tiff|psd|webp)$/i;
        var videoExts = /\.(mp4|mov|avi|mkv|mxf|wmv|m4v|webm|m2v|mpg|mpeg)$/i;

        var mediaPool = [];
        for (var fi = 0; fi < filePaths.length; fi++) {
            var fp = filePaths[fi];
            var isImg = imageExts.test(fp);
            var isVid = videoExts.test(fp);
            if (isImg || isVid) {
                mediaPool.push({ path: fp, isImage: isImg, lastUsed: -99999 });
            }
        }
        if (mediaPool.length === 0) { debugLog.close(); return ET_fail("No valid media files found"); }
        debugLog.write("mediaPool: " + mediaPool.length + " items\n");

        // ---- Ensure target video track exists ----
        while (seq.videoTracks.numTracks <= trackIndex) {
            seq.videoTracks.add();
        }
        var videoTrack = seq.videoTracks[trackIndex];

        // --- Pre-build project item cache (import each file once) ---
        var reelItemCache = {};
        for (var pmi = 0; pmi < mediaPool.length; pmi++) {
            AmbientVideo__getOrImportItem(mediaPool[pmi].path, reelItemCache);
        }

        var REPEAT_COOLDOWN = 20 * 60; // 20 minutes in seconds

        // ---- Place clips ----
        var currentTime = timelineStart;
        var placedCount = 0;

        while (currentTime < timelineEnd) {
            ET__throwIfOperationCancelled(operationId, "Ambient video build");

            // Determine clip duration range from current phase
            var curPhase = getPhaseAt(currentTime);
            var durMin   = curPhase.clipMin || 7;
            var durMax   = curPhase.clipMax || 15;

            // Pick a file -- prefer files not used in last 20 min
            var available = [];
            var fallback  = [];
            for (var pi = 0; pi < mediaPool.length; pi++) {
                var elapsed = currentTime - mediaPool[pi].lastUsed;
                if (elapsed >= REPEAT_COOLDOWN) available.push(pi);
                else                            fallback.push(pi);
            }
            var pool   = (available.length > 0) ? available : fallback;
            var picked = pool[Math.floor(Math.random() * pool.length)];
            var media  = mediaPool[picked];

            // Random clip duration within range
            var clipDur = durMin + Math.random() * (durMax - durMin);
            debugLog.write("\n[" + currentTime.toFixed(2) + "s] phase durMin=" + durMin + " durMax=" + durMax + " randomDur=" + clipDur.toFixed(2) + "\n");

            // Don't exceed timeline end
            if (currentTime + clipDur > timelineEnd) {
                clipDur = timelineEnd - currentTime;
                debugLog.write("  clamped to timeline end: " + clipDur.toFixed(2) + "\n");
            }
            if (clipDur < 0.5) { debugLog.write("  remaining < 0.5s, stopping\n"); break; }

            // ---- Retrieve from project item cache (no re-import) ----
            var tmpPath    = media.path.replace(/\\/g, '/');
            var dotIdx     = tmpPath.lastIndexOf('/');
            var mediaName  = (dotIdx >= 0) ? tmpPath.substring(dotIdx + 1) : tmpPath;
            debugLog.write("  picked: " + mediaName + "\n");
            var projectItem = AmbientVideo__getOrImportItem(media.path, reelItemCache);

            if (projectItem) {

                // Snapshot audio clip counts before placement to protect existing audio
                var audioSnap2 = [];
                for (var as2 = 0; as2 < seq.audioTracks.numTracks; as2++) {
                    audioSnap2.push(seq.audioTracks[as2].clips.numItems);
                }

                // Place clip on the target video track
                videoTrack.overwriteClip(projectItem, currentTime);

                // Remove only newly added audio clips
                for (var ar2 = 0; ar2 < seq.audioTracks.numTracks; ar2++) {
                    var arTrk2 = seq.audioTracks[ar2];
                    for (var ac2 = arTrk2.clips.numItems - 1; ac2 >= audioSnap2[ar2]; ac2--) {
                        try { arTrk2.clips[ac2].remove(false, false); } catch(re3) {}
                    }
                }

                // Find the placed clip, read its ACTUAL duration from the timeline,
                // then trim to min(randomDur, actualDur)
                var trimmed = false;
                for (var vc2 = 0; vc2 < videoTrack.clips.numItems; vc2++) {
                    var vClip2 = videoTrack.clips[vc2];
                    if (Math.abs(vClip2.start.seconds - currentTime) < 0.5) {
                        try {
                            var actualDur = vClip2.end.seconds - vClip2.start.seconds;
                            debugLog.write("  actualDur from timeline=" + actualDur.toFixed(2) + "s  randomDur=" + clipDur.toFixed(2) + "s\n");
                            // Use the smaller of the two
                            if (actualDur > 0 && actualDur < clipDur) {
                                clipDur = actualDur;
                                debugLog.write("  using actualDur (clip is shorter): " + clipDur.toFixed(2) + "s\n");
                            }
                            vClip2.end.seconds = currentTime + clipDur;
                            trimmed = true;
                            debugLog.write("  trimmed end to " + (currentTime + clipDur).toFixed(2) + "s\n");
                        } catch(te2) {
                            debugLog.write("  TRIM FAILED: " + te2.toString() + "\n");
                        }
                        break;
                    }
                }
                if (!trimmed) debugLog.write("  WARNING: could not find placed clip to trim\n");

                media.lastUsed = currentTime;
                currentTime += clipDur;
                placedCount++;
                debugLog.write("  placed #" + placedCount + "  nextTime=" + currentTime.toFixed(2) + "\n");
            } else {
                debugLog.write("  projectItem not found, advancing by durMin\n");
                media.lastUsed = currentTime;
                currentTime += durMin;
            }
        }

        debugLog.write("\nDone. Placed: " + placedCount + "\n");
        debugLog.close();
        return ET_ok("true|" + placedCount);

    } catch(e) {
        debugLog.write((ET__isOperationCancelled(operationId) ? "CANCELLED: " : "FATAL: ") + e.toString() + " line:" + e.line + "\n");
        debugLog.close();
        return ET_fail(e.toString());
    }
}


