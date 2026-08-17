function SS_captureShufflerSelection() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return ET_ok({ count: 0, message: "No active sequence" });

        function _sameSlot(a, b) {
            if (!a || !b) return false;
            if (String(a.trackType || "video") !== String(b.trackType || "video")) return false;
            if (a.trackIdx !== b.trackIdx) return false;
            if (Math.abs(a.startSec - b.startSec) > 0.05) return false;
            return true;
        }

        function _pushUnique(list, slot) {
            if (!slot) return;
            for (var i = 0; i < list.length; i++) {
                if (_sameSlot(list[i], slot)) return;
            }
            list.push(slot);
        }

        function _toSlot(clip, trackType, trackIdx) {
            return {
                trackType: trackType,
                trackIdx: trackIdx,
                startSec: clip.start.seconds,
                endSec: clip.end.seconds
            };
        }

        function _findVideoTrackIndexForClip(clip) {
            for (var t = 0; t < seq.videoTracks.numTracks; t++) {
                var track = seq.videoTracks[t];
                for (var c = 0; c < track.clips.numItems; c++) {
                    var tc = track.clips[c];
                    if (Math.abs(tc.start.seconds - clip.start.seconds) > 0.05) continue;
                    if (Math.abs(tc.end.seconds - clip.end.seconds) > 0.05) continue;
                    return t;
                }
            }
            return -1;
        }

        function _findAudioTrackIndexForClip(clip) {
            for (var t = 0; t < seq.audioTracks.numTracks; t++) {
                var track = seq.audioTracks[t];
                for (var c = 0; c < track.clips.numItems; c++) {
                    var tc = track.clips[c];
                    if (Math.abs(tc.start.seconds - clip.start.seconds) > 0.05) continue;
                    if (Math.abs(tc.end.seconds - clip.end.seconds) > 0.05) continue;
                    return t;
                }
            }
            return -1;
        }

        var slots = [];

        // Direct track scan.
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var track = seq.videoTracks[t];
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                if (clip.isSelected()) {
                    _pushUnique(slots, _toSlot(clip, "video", t));
                }
            }
        }
        for (var at = 0; at < seq.audioTracks.numTracks; at++) {
            var aTrack = seq.audioTracks[at];
            for (var ac = 0; ac < aTrack.clips.numItems; ac++) {
                var aClip = aTrack.clips[ac];
                if (aClip.isSelected()) {
                    _pushUnique(slots, _toSlot(aClip, "audio", at));
                }
            }
        }

        // Merge sequence selection as backup.
        var seqSelection = null;
        try { seqSelection = seq.getSelection(); } catch (eSel) {}
        if (seqSelection && seqSelection.length) {
            for (var si = 0; si < seqSelection.length; si++) {
                var sClip = seqSelection[si];
                if (!sClip) continue;

                if (!sClip.mediaType || sClip.mediaType === "Video") {
                    var trackIdx = _findVideoTrackIndexForClip(sClip);
                    if (trackIdx >= 0) _pushUnique(slots, _toSlot(sClip, "video", trackIdx));
                } else if (sClip.mediaType === "Audio") {
                    var audioTrackIdx = _findAudioTrackIndexForClip(sClip);
                    if (audioTrackIdx >= 0) _pushUnique(slots, _toSlot(sClip, "audio", audioTrackIdx));
                }
            }
        }

        var videoCount = 0;
        var audioCount = 0;
        for (var si2 = 0; si2 < slots.length; si2++) {
            if (slots[si2].trackType === "audio") audioCount++;
            else videoCount++;
        }

        var preferredType = "";
        if (audioCount > 0 && videoCount === 0) preferredType = "audio";
        else if (videoCount > 0) preferredType = "video";

        $.global.ET_lastShuffleSelection = {
            sequenceName: seq.name || '',
            createdAtMs: (new Date()).getTime(),
            preferredType: preferredType,
            slots: slots
        };

        return ET_ok({
            count: slots.length,
            videoCount: videoCount,
            audioCount: audioCount,
            preferredType: preferredType
        });
    } catch (e) {
        return ET_fail(e.toString());
    }
}

function SS_shuffleSelectedClips(operationId) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return ET_fail("No active sequence");

        function _clipToSlot(clip, trackType, trackIdx) {
            return {
                trackType: trackType,
                trackIdx: trackIdx,
                startSec: clip.start.seconds,
                endSec: clip.end.seconds,
                durSec: clip.duration.seconds,
                inPtSec: clip.inPoint.seconds,
                outPtSec: clip.outPoint.seconds,
                projectItem: clip.projectItem
            };
        }

        function _sameSlot(a, b) {
            if (!a || !b) return false;
            if (String(a.trackType || "video") !== String(b.trackType || "video")) return false;
            if (a.trackIdx !== b.trackIdx) return false;
            if (Math.abs(a.startSec - b.startSec) > 0.05) return false;
            return true;
        }

        function _pushUniqueSlot(list, slot) {
            if (!slot) return;
            for (var i = 0; i < list.length; i++) {
                if (_sameSlot(list[i], slot)) return;
            }
            list.push(slot);
        }

        function _findVideoTrackIndexForClip(clip) {
            for (var t = 0; t < seq.videoTracks.numTracks; t++) {
                var track = seq.videoTracks[t];
                for (var c = 0; c < track.clips.numItems; c++) {
                    var tc = track.clips[c];
                    if (Math.abs(tc.start.seconds - clip.start.seconds) > 0.05) continue;
                    if (Math.abs(tc.end.seconds - clip.end.seconds) > 0.05) continue;
                    return t;
                }
            }
            return -1;
        }

        function _findAudioTrackIndexForClip(clip) {
            for (var t = 0; t < seq.audioTracks.numTracks; t++) {
                var track = seq.audioTracks[t];
                for (var c = 0; c < track.clips.numItems; c++) {
                    var tc = track.clips[c];
                    if (Math.abs(tc.start.seconds - clip.start.seconds) > 0.05) continue;
                    if (Math.abs(tc.end.seconds - clip.end.seconds) > 0.05) continue;
                    return t;
                }
            }
            return -1;
        }

        function _getTrack(trackType, trackIdx) {
            if (trackType === "audio") {
                if (trackIdx < 0 || trackIdx >= seq.audioTracks.numTracks) return null;
                return seq.audioTracks[trackIdx];
            }
            if (trackIdx < 0 || trackIdx >= seq.videoTracks.numTracks) return null;
            return seq.videoTracks[trackIdx];
        }

        // Collect selected clips from track scan.
        var selected = [];
        var selectionSource = 'live selection';
        var preferredType = '';
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            ET__throwIfOperationCancelled(operationId, "Shuffle");
            var track = seq.videoTracks[t];
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                if (clip.isSelected()) {
                    _pushUniqueSlot(selected, _clipToSlot(clip, "video", t));
                }
            }
        }
        for (var at = 0; at < seq.audioTracks.numTracks; at++) {
            ET__throwIfOperationCancelled(operationId, "Shuffle");
            var aTrack = seq.audioTracks[at];
            for (var ac = 0; ac < aTrack.clips.numItems; ac++) {
                var aClip = aTrack.clips[ac];
                if (aClip.isSelected()) {
                    _pushUniqueSlot(selected, _clipToSlot(aClip, "audio", at));
                }
            }
        }

        // Merge in sequence.getSelection() video clips (more reliable in some PPro states).
        var seqSelection = null;
        try { seqSelection = seq.getSelection(); } catch (selErr) {}
        if (seqSelection && seqSelection.length) {
            for (var si = 0; si < seqSelection.length; si++) {
                var sClip = seqSelection[si];
                if (!sClip) continue;
                var trackIdx = -1;
                if (!sClip.mediaType || sClip.mediaType === "Video") {
                    trackIdx = _findVideoTrackIndexForClip(sClip);
                    if (trackIdx >= 0) _pushUniqueSlot(selected, _clipToSlot(sClip, "video", trackIdx));
                } else if (sClip.mediaType === "Audio") {
                    trackIdx = _findAudioTrackIndexForClip(sClip);
                    if (trackIdx >= 0) _pushUniqueSlot(selected, _clipToSlot(sClip, "audio", trackIdx));
                } else {
                    trackIdx = _findVideoTrackIndexForClip(sClip);
                    if (trackIdx >= 0) {
                        _pushUniqueSlot(selected, _clipToSlot(sClip, "video", trackIdx));
                    } else {
                        trackIdx = _findAudioTrackIndexForClip(sClip);
                        if (trackIdx >= 0) _pushUniqueSlot(selected, _clipToSlot(sClip, "audio", trackIdx));
                    }
                }
            }
        }

        var liveVideoCount = 0;
        var liveAudioCount = 0;
        for (var li = 0; li < selected.length; li++) {
            if (selected[li].trackType === "audio") liveAudioCount++;
            else liveVideoCount++;
        }
        if (liveAudioCount > 0 && liveVideoCount === 0) preferredType = "audio";
        else if (liveVideoCount > 0) preferredType = "video";

        function _collectFromLastSplitContext(requestedType) {
            var out = [];
            if (requestedType === "audio") return out;
            var ctx = null;
            try { ctx = $.global.ET_lastSplitContext || null; } catch (eCtx) {}
            if (!ctx || !ctx.ranges || !ctx.ranges.length) return out;

            var nowMs = (new Date()).getTime();
            var ageMs = ctx.createdAtMs ? (nowMs - ctx.createdAtMs) : 0;
            if (ageMs > 10 * 60 * 1000) return out; // stale context
            if (ctx.sequenceName && seq.name && String(ctx.sequenceName) !== String(seq.name)) return out;

            var tol = 0.08;
            for (var ri = 0; ri < ctx.ranges.length; ri++) {
                var range = ctx.ranges[ri];
                if (!range) continue;
                var trackIdx = parseInt(range.trackIdx, 10);
                if (isNaN(trackIdx) || trackIdx < 0 || trackIdx >= seq.videoTracks.numTracks) continue;

                var track = seq.videoTracks[trackIdx];
                var rStart = parseFloat(range.startSec);
                var rEnd = parseFloat(range.endSec);
                if (!(rEnd > rStart)) continue;

                for (var ci = 0; ci < track.clips.numItems; ci++) {
                    var clip = track.clips[ci];
                    var cStart = clip.start.seconds;
                    var cEnd = clip.end.seconds;
                    var contained = (cStart >= rStart - tol) && (cEnd <= rEnd + tol);
                    var overlaps = (cStart < rEnd - 0.01) && (cEnd > rStart + 0.01);
                    if (contained || overlaps) {
                        _pushUniqueSlot(out, _clipToSlot(clip, "video", trackIdx));
                    }
                }
            }
            return out;
        }

        function _collectFromCachedSelection(requestedType) {
            var out = [];
            var ctx = null;
            try { ctx = $.global.ET_lastShuffleSelection || null; } catch (eCtx2) {}
            if (!ctx || !ctx.slots || !ctx.slots.length) return out;

            var nowMs = (new Date()).getTime();
            var ageMs = ctx.createdAtMs ? (nowMs - ctx.createdAtMs) : 0;
            if (ageMs > 2 * 60 * 1000) return out; // stale cache
            if (ctx.sequenceName && seq.name && String(ctx.sequenceName) !== String(seq.name)) return out;

            var requested = requestedType || ctx.preferredType || "";
            var tol = 0.08;
            for (var si = 0; si < ctx.slots.length; si++) {
                var slot = ctx.slots[si];
                if (!slot) continue;
                var slotType = slot.trackType === "audio" ? "audio" : "video";
                if (requested && slotType !== requested) continue;
                var trackIdx = parseInt(slot.trackIdx, 10);
                if (isNaN(trackIdx)) continue;

                var track = _getTrack(slotType, trackIdx);
                if (!track) continue;
                var sStart = parseFloat(slot.startSec);
                var sEnd = parseFloat(slot.endSec);
                if (!(sEnd > sStart)) continue;

                for (var ci = 0; ci < track.clips.numItems; ci++) {
                    var clip = track.clips[ci];
                    var cStart = clip.start.seconds;
                    var cEnd = clip.end.seconds;
                    var nearStart = Math.abs(cStart - sStart) <= tol;
                    var nearEnd = Math.abs(cEnd - sEnd) <= tol;
                    if (nearStart || nearEnd) {
                        _pushUniqueSlot(out, _clipToSlot(clip, slotType, trackIdx));
                    }
                }
            }
            return out;
        }

        function _findSeedSlotAroundPlayhead(requestedType) {
            var ctiSec = 0;
            try {
                var p = seq.getPlayerPosition();
                if (p && typeof p.seconds === 'number') {
                    ctiSec = p.seconds;
                } else if (p !== null && p !== undefined) {
                    ctiSec = parseFloat(p) || 0;
                }
            } catch (ePos) {}

            var nearest = null;
            var nearestDist = 999999999;
            var types = [];
            if (requestedType === "audio" || requestedType === "video") {
                types.push(requestedType);
            } else {
                types.push("video");
                types.push("audio");
            }

            for (var ti = 0; ti < types.length; ti++) {
                var type = types[ti];
                var tracks = type === "audio" ? seq.audioTracks : seq.videoTracks;
                for (var vt = 0; vt < tracks.numTracks; vt++) {
                    var track = tracks[vt];
                    for (var vc = 0; vc < track.clips.numItems; vc++) {
                        var clip = track.clips[vc];
                    var cStart = clip.start.seconds;
                    var cEnd = clip.end.seconds;

                    // Best case: CTI is inside a clip.
                    if (ctiSec >= cStart - 0.0001 && ctiSec <= cEnd + 0.0001) {
                            return _clipToSlot(clip, type, vt);
                    }

                    var dStart = Math.abs(ctiSec - cStart);
                    var dEnd = Math.abs(ctiSec - cEnd);
                    var dist = dStart < dEnd ? dStart : dEnd;
                    if (dist < nearestDist) {
                        nearestDist = dist;
                            nearest = _clipToSlot(clip, type, vt);
                        }
                    }
                }
            }
            return nearest;
        }

        if (!preferredType) {
            try {
                var cachePref = $.global.ET_lastShuffleSelection;
                if (cachePref && (cachePref.preferredType === "audio" || cachePref.preferredType === "video")) {
                    preferredType = cachePref.preferredType;
                }
            } catch (ePref) {}
        }

        if (preferredType) {
            var selectedFiltered = [];
            for (var sf = 0; sf < selected.length; sf++) {
                if (selected[sf].trackType === preferredType) selectedFiltered.push(selected[sf]);
            }
            selected = selectedFiltered;
        }

        if (selected.length < 2) {
            var fromCachedSelection = _collectFromCachedSelection(preferredType);
            if (fromCachedSelection.length > 1) {
                selected = fromCachedSelection;
                selectionSource = 'cached selection';
                if (!preferredType) preferredType = fromCachedSelection[0].trackType;
            }
        }

        if (selected.length < 2) {
            var fromSplitContext = _collectFromLastSplitContext(preferredType);
            if (fromSplitContext.length > 1) {
                selected = fromSplitContext;
                selectionSource = 'last split context';
                preferredType = 'video';
            }
        }

        if (selected.length === 0) {
            var seedFromPlayhead = _findSeedSlotAroundPlayhead(preferredType);
            if (seedFromPlayhead) {
                selected = [seedFromPlayhead];
                selectionSource = 'playhead seed';
                if (!preferredType) preferredType = seedFromPlayhead.trackType;
            }
        }

        // Fallback for split workflows: when only one segment is selected,
        // expand to contiguous segments on the same track.
        if (selected.length === 1) {
            var seed = selected[0];
            var seedTrack = _getTrack(seed.trackType, seed.trackIdx);
            if (seedTrack) {
                var trackSlots = [];
                for (var sc = 0; sc < seedTrack.clips.numItems; sc++) {
                    var tc = seedTrack.clips[sc];
                    trackSlots.push(_clipToSlot(tc, seed.trackType, seed.trackIdx));
                }

                if (trackSlots.length > 1) {
                    trackSlots.sort(function (a, b) { return a.startSec - b.startSec; });

                    var seedIndex = -1;
                    for (var idx = 0; idx < trackSlots.length; idx++) {
                        if (Math.abs(trackSlots[idx].startSec - seed.startSec) < 0.05) {
                            seedIndex = idx;
                            break;
                        }
                    }

                    function _collectContiguous(requireSameSource) {
                        if (seedIndex < 0) return [];
                        var chain = [trackSlots[seedIndex]];
                        var left = seedIndex - 1;
                        while (left >= 0) {
                            var leftClip = trackSlots[left];
                            var rightOfLeft = trackSlots[left + 1];
                            if (Math.abs(leftClip.endSec - rightOfLeft.startSec) > 0.06) break;
                            if (requireSameSource && seed.projectItem && leftClip.projectItem !== seed.projectItem) break;
                            chain.unshift(leftClip);
                            left--;
                        }
                        var right = seedIndex + 1;
                        while (right < trackSlots.length) {
                            var leftOfRight = trackSlots[right - 1];
                            var rightClip = trackSlots[right];
                            if (Math.abs(leftOfRight.endSec - rightClip.startSec) > 0.06) break;
                            if (requireSameSource && seed.projectItem && rightClip.projectItem !== seed.projectItem) break;
                            chain.push(rightClip);
                            right++;
                        }
                        return chain;
                    }

                    if (seedIndex >= 0) {
                        var contiguous = _collectContiguous(true);
                        if (contiguous.length < 2) contiguous = _collectContiguous(false);

                        if (contiguous.length > 1) {
                            selected = contiguous;
                            if (selectionSource === 'playhead seed') {
                                selectionSource = 'playhead contiguous chain';
                            } else if (selectionSource !== 'live selection') {
                                selectionSource = selectionSource + ' contiguous chain';
                            }
                        }
                    }
                }
            }
        }

        if (selected.length < 2) return ET_fail(
            "Select at least 2 clips to shuffle (detected " +
            selected.length +
            ", media " + (preferredType || "unknown") +
            ", source " + selectionSource + ")"
        );

        // Fisher-Yates shuffle of source references
        var sources = [];
        for (var i = 0; i < selected.length; i++) {
            sources.push({
                projectItem: selected[i].projectItem,
                inPtSec:     selected[i].inPtSec,
                outPtSec:    selected[i].outPtSec,
                durSec:      selected[i].durSec
            });
        }
        for (var j = sources.length - 1; j > 0; j--) {
            var k = Math.floor(Math.random() * (j + 1));
            var tmp = sources[j]; sources[j] = sources[k]; sources[k] = tmp;
        }

        // Group selected clips by track, sorted by timeline position.
        var byTrack = {};
        var trackOrder = [];
        for (var r = 0; r < selected.length; r++) {
            var trackKey = selected[r].trackType + ":" + selected[r].trackIdx;
            if (!byTrack[trackKey]) {
                byTrack[trackKey] = [];
                trackOrder.push(trackKey);
            }
            byTrack[trackKey].push(selected[r]);
        }
        for (var to = 0; to < trackOrder.length; to++) {
            var key = trackOrder[to];
            byTrack[key].sort(function(a, b) { return a.startSec - b.startSec; });
        }

        // Remove selected clips first (reverse per track keeps indices stable).
        // Use a moving cursor so each track is scanned only once.
        for (var tr = 0; tr < trackOrder.length; tr++) {
            ET__throwIfOperationCancelled(operationId, "Shuffle");
            var removeTrackKey = trackOrder[tr];
            var removeParts = removeTrackKey.split(":");
            var removeTrackType = removeParts[0] === "audio" ? "audio" : "video";
            var removeTrackIdx = parseInt(removeParts[1], 10);
            var removeSlots = byTrack[removeTrackKey];
            var trk = _getTrack(removeTrackType, removeTrackIdx);
            if (!trk) continue;
            var removeCursor = trk.clips.numItems - 1;
            for (var ri = removeSlots.length - 1; ri >= 0; ri--) {
                var targetStart = removeSlots[ri].startSec;
                while (removeCursor >= 0) {
                    if (Math.abs(trk.clips[removeCursor].start.seconds - targetStart) < 0.05) {
                        trk.clips[removeCursor].remove(false, false);
                        removeCursor--;
                        break;
                    }
                    removeCursor--;
                }
            }
        }

        // Per-track insertion cursor: first selected start is preserved,
        // then each next insert starts at previous insert end.
        var insertTimeByTrack = {};
        for (var it = 0; it < trackOrder.length; it++) {
            var insertTrackKey = trackOrder[it];
            insertTimeByTrack[insertTrackKey] = byTrack[insertTrackKey][0].startSec;
        }

        // Place shuffled sources using running insertion timestamps.
        // Use a forward search cursor per track to avoid rescanning from index 0
        // after every insert.
        var srcIndex = 0;
        for (var pt = 0; pt < trackOrder.length; pt++) {
            ET__throwIfOperationCancelled(operationId, "Shuffle");
            var placeTrackKey = trackOrder[pt];
            var placeParts = placeTrackKey.split(":");
            var placeTrackType = placeParts[0] === "audio" ? "audio" : "video";
            var placeTrackIdx = parseInt(placeParts[1], 10);
            var slots = byTrack[placeTrackKey];
            var placeTrack = _getTrack(placeTrackType, placeTrackIdx);
            if (!placeTrack) continue;
            var findCursor = 0;

            for (var s = 0; s < slots.length; s++) {
                ET__throwIfOperationCancelled(operationId, "Shuffle");
                if (srcIndex >= sources.length) break;
                var src = sources[srcIndex++];
                var insertSec = insertTimeByTrack[placeTrackKey];
                var tPos = new Time(); tPos.seconds = insertSec;

                placeTrack.overwriteClip(src.projectItem, tPos);

                var foundClip = null;
                var clipCount = placeTrack.clips.numItems;
                if (findCursor < 0) findCursor = 0;
                if (findCursor >= clipCount) findCursor = clipCount - 1;

                for (var ci2 = findCursor; ci2 < clipCount; ci2++) {
                    var scanClip = placeTrack.clips[ci2];
                    if (Math.abs(scanClip.start.seconds - insertSec) < 0.05) {
                        foundClip = scanClip;
                        findCursor = ci2 + 1;
                        break;
                    }
                }

                // Fallback safety scan in case timeline reindexing moved the clip.
                if (!foundClip) {
                    for (var ci3 = 0; ci3 < clipCount; ci3++) {
                        var fallbackClip = placeTrack.clips[ci3];
                        if (Math.abs(fallbackClip.start.seconds - insertSec) < 0.05) {
                            foundClip = fallbackClip;
                            findCursor = ci3 + 1;
                            break;
                        }
                    }
                }

                if (foundClip) {
                    var newIn = new Time(); newIn.seconds = src.inPtSec;
                    try { foundClip.inPoint = newIn; } catch (e1) {}
                    var newEnd = new Time(); newEnd.seconds = insertSec + src.durSec;
                    try { foundClip.end = newEnd; } catch (e2) {}
                }

                insertTimeByTrack[placeTrackKey] = insertSec + src.durSec;
            }
        }

        return ET_ok(
            "Done: Shuffled " +
            selected.length +
            " " + (preferredType || "media") +
            " clip(s) [" + selectionSource + "]"
        );
    } catch(e) {
        return ET_fail(e.toString());
    }
}

function SS_applyNativeTransition(transitionName, positionSetting, durationStr, operationId) {
    try {
        if (!transitionName || !String(transitionName).length) return ET_fail("Missing transition name");
        var durationValue = String(durationStr || "15");
        if (!/^\d+$/.test(durationValue)) durationValue = "15";

        app.enableQE();
        var seq = app.project.activeSequence;
        if (!seq) return ET_fail("No active sequence");

        var selection = seq.getSelection();
        if (!selection || selection.length === 0) return ET_fail("Select at least one clip");

        // 1. Create a fast-lookup map of selected clip Node IDs
        var selectedIds = {};
        for (var s = 0; s < selection.length; s++) {
            ET__throwIfOperationCancelled(operationId, "Transition apply");
            selectedIds[selection[s].nodeId] = true;
        }

        var qeSeq = qe.project.getActiveSequence();
        if (!qeSeq) return ET_fail("Could not access QE sequence");

        var qeTransition = qe.project.getVideoTransitionByName(transitionName);
        if (!qeTransition) return ET_fail("Transition not found: " + transitionName);

        var appliedCount = 0;

        // 2. Loop through all video tracks
        for (var i = 0; i < seq.videoTracks.numTracks; i++) {
            var standardTrack = seq.videoTracks[i];
            var qeTrack = qeSeq.getVideoTrackAt(i);
            if (!standardTrack || !qeTrack) continue;

            // 3. Map ALL non-empty QE clips into an array so indices match the Standard API
            var qeClipsMap = [];
            for (var k = 0; k < qeTrack.numItems; k++) {
                var qeItem = qeTrack.getItemAt(k);
                if (qeItem.name && qeItem.name !== "Empty") {
                    qeClipsMap.push(qeItem);
                }
            }

            // 4. Loop through standard clips and apply logic
            for (var j = 0; j < standardTrack.clips.numItems; j++) {
                var standardClip = standardTrack.clips[j];

                // If this specific clip is selected by the user
                if (selectedIds[standardClip.nodeId]) {
                    var qeTargetClip = qeClipsMap[j];
                    if (!qeTargetClip) continue;

                    try {
                        if (positionSetting === "between") {
                            // Check if the NEXT clip on this track exists AND is also selected
                            if (j + 1 < standardTrack.clips.numItems) {
                                var nextClip = standardTrack.clips[j + 1];
                                if (selectedIds[nextClip.nodeId]) {
                                    // Apply to the END of the current clip to bridge the cut
                                    qeTargetClip.addTransition(qeTransition, false, durationValue);
                                    appliedCount++;
                                }
                            }
                        } else if (positionSetting === "start") {
                            qeTargetClip.addTransition(qeTransition, true, durationValue);
                            appliedCount++;
                        } else if (positionSetting === "end") {
                            qeTargetClip.addTransition(qeTransition, false, durationValue);
                            appliedCount++;
                        }
                    } catch (err) {
                        // Fail silently for individual clip errors to keep loop running
                    }
                }
            }
        }

        if (appliedCount <= 0) return ET_fail("No eligible cuts/clips found for '" + positionSetting + "'");
        return ET_ok("Done: Applied " + transitionName + " to " + appliedCount + " location(s)");
    } catch (e) {
        return ET_fail(e.toString());
    }
}

// Split selected clip(s) into segments of a given interval (in seconds)
function SS_splitSelectedClip(intervalSeconds, operationId) {
    try {
        intervalSeconds = parseFloat(intervalSeconds) || 0;
        if (intervalSeconds <= 0) return ET_fail("Interval must be greater than 0");

        if (!app.project) return ET_fail("No project open");

        var sequence = app.project.activeSequence;
        if (!sequence) return ET_fail("No active sequence");

        var selectedClips = sequence.getSelection();
        if (!selectedClips || selectedClips.length === 0) {
            return ET_fail("No clips selected. Please select a clip on the timeline first.");
        }

        // Enable QE DOM (populates global `qe`)
        if (typeof app.enableQE === 'function') app.enableQE();
        if (typeof qe === 'undefined' || !qe.project) return ET_fail("Could not enable QE DOM");

        var qeSeq = qe.project.getActiveSequence();
        if (!qeSeq) return ET_fail("Could not get QE sequence");

        var frameRate     = sequence.getSettings().videoFrameRate;
        var displayFormat = sequence.getSettings().videoDisplayFormat;

        function secToTimecode(sec) {
            var t = new Time();
            t.seconds = sec;
            return t.getFormatted(frameRate, displayFormat);
        }

        // Find video track index for a clip
        function findVideoTrackIndex(clip) {
            for (var t = 0; t < sequence.videoTracks.numTracks; t++) {
                var track = sequence.videoTracks[t];
                for (var ci = 0; ci < track.clips.numItems; ci++) {
                    var tc = track.clips[ci];
                    if (Math.abs(tc.start.seconds - clip.start.seconds) < 0.01 &&
                        Math.abs(tc.end.seconds   - clip.end.seconds)   < 0.01) {
                        return t;
                    }
                }
            }
            return -1;
        }

        // Find audio track index for a clip
        function findAudioTrackIndex(clip) {
            for (var t = 0; t < sequence.audioTracks.numTracks; t++) {
                var track = sequence.audioTracks[t];
                for (var ci = 0; ci < track.clips.numItems; ci++) {
                    var tc = track.clips[ci];
                    if (Math.abs(tc.start.seconds - clip.start.seconds) < 0.01 &&
                        Math.abs(tc.end.seconds   - clip.end.seconds)   < 0.01) {
                        return t;
                    }
                }
            }
            return -1;
        }

        var totalCuts = 0;
        var splitRanges = [];

        for (var i = 0; i < selectedClips.length; i++) {
            ET__throwIfOperationCancelled(operationId, "Split");
            var clip = selectedClips[i];
            var clipStartSec = clip.start.seconds;
            var clipEndSec   = clip.end.seconds;
            var clipDuration = clipEndSec - clipStartSec;

            if (clipDuration <= intervalSeconds) continue;

            // Get the QE track directly -- same proven approach as jumpcut
            var qeTrack = null;
            if (clip.mediaType === "Video") {
                var vIdx = findVideoTrackIndex(clip);
                if (vIdx >= 0) {
                    qeTrack = qeSeq.getVideoTrackAt(vIdx);
                    splitRanges.push({
                        trackIdx: vIdx,
                        startSec: clipStartSec,
                        endSec: clipEndSec
                    });
                }
            } else if (clip.mediaType === "Audio") {
                var aIdx = findAudioTrackIndex(clip);
                if (aIdx >= 0) qeTrack = qeSeq.getAudioTrackAt(aIdx);
            }

            if (!qeTrack) continue;

            // Cut at every interval boundary using frame-accurate timecodes
            var offset = intervalSeconds;
            while (offset < clipDuration - 0.02) {
                ET__throwIfOperationCancelled(operationId, "Split");
                var tc = secToTimecode(clipStartSec + offset);
                qeTrack.razor(tc);
                totalCuts++;
                offset += intervalSeconds;
            }
        }

        if (totalCuts === 0) {
            return ET_fail("No cuts made - clip is shorter than or equal to the interval");
        }

        // Persist context so shuffle can recover even if Premiere drops selection
        // right after split.
        try {
            var mergedByTrack = {};
            for (var sr = 0; sr < splitRanges.length; sr++) {
                var r = splitRanges[sr];
                var k = String(r.trackIdx);
                if (!mergedByTrack[k]) {
                    mergedByTrack[k] = {
                        trackIdx: r.trackIdx,
                        startSec: r.startSec,
                        endSec: r.endSec
                    };
                } else {
                    if (r.startSec < mergedByTrack[k].startSec) mergedByTrack[k].startSec = r.startSec;
                    if (r.endSec > mergedByTrack[k].endSec) mergedByTrack[k].endSec = r.endSec;
                }
            }

            var ranges = [];
            for (var key in mergedByTrack) {
                if (mergedByTrack.hasOwnProperty(key)) {
                    ranges.push(mergedByTrack[key]);
                }
            }
            $.global.ET_lastSplitContext = {
                sequenceName: sequence.name || '',
                createdAtMs: (new Date()).getTime(),
                ranges: ranges
            };
        } catch (ctxErr) {}

        return ET_ok("Done - made " + totalCuts + " cut(s) on " + selectedClips.length + " clip(s)");

    } catch (e) {
        return ET_fail(e.toString());
    }
}

// Returns selected clip info for the Split Clip ruler preview UI.
function SS_getSplitClipPreview() {
    try {
        var sequence = app.project.activeSequence;
        if (!sequence) {
            return ET_ok({ message: "No active sequence." });
        }

        var selectedClips = sequence.getSelection();
        if (!selectedClips || selectedClips.length === 0) {
            return ET_ok({ message: "No clip selected on timeline." });
        }

        var clip = selectedClips[0];
        var clipName = "Selected clip";
        try {
            if (clip.projectItem && clip.projectItem.name) clipName = clip.projectItem.name;
            else if (clip.name) clipName = clip.name;
        } catch (nameErr) {}

        var duration = 0;
        try { duration = clip.end.seconds - clip.start.seconds; } catch (durErr1) {}
        if (!(duration > 0)) {
            try { duration = clip.duration.seconds; } catch (durErr2) {}
        }
        if (!(duration > 0)) {
            return ET_ok({ message: "Could not read selected clip duration." });
        }

        return ET_ok({
            clipName: clipName,
            duration: duration,
            selectedCount: selectedClips.length
        });
    } catch (e) {
        return ET_fail(e.toString().replace(/\\/g, '/'));
    }
}
