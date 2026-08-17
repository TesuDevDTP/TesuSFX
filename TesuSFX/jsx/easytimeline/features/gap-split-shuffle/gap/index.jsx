var GAP_TICKS_PER_SECOND = 254016000000;

function Gap__getSequenceTimebase(sequence) {
    var timebase = 0;
    try {
        timebase = Number(sequence && sequence.timebase ? sequence.timebase : 0);
    } catch (_eTimebase) {
        timebase = 0;
    }
    if (!isFinite(timebase) || timebase <= 0) {
        throw new Error("Invalid active sequence timebase.");
    }
    return timebase;
}

function Gap__secondsToSnappedTicks(secondsValue, timebase) {
    var seconds = Number(secondsValue || 0);
    if (!isFinite(seconds) || seconds <= 0) {
        return 0;
    }
    return Math.max(0, Math.round((seconds * GAP_TICKS_PER_SECOND) / timebase) * timebase);
}

function Gap__ticksToSeconds(ticksValue) {
    var ticks = Number(ticksValue || 0);
    if (!isFinite(ticks) || ticks === 0) {
        return 0;
    }
    return ticks / GAP_TICKS_PER_SECOND;
}

function Gap__collectSelectedClipsByMediaType(selectedClips) {
    var videoClips = [];
    var audioClips = [];
    for (var i = 0; i < selectedClips.length; i++) {
        var clip = selectedClips[i];
        try {
            var startTicks = Number(clip.start.ticks);
            var endTicks = Number(clip.end.ticks);
            var durationTicks = endTicks - startTicks;
            if (!isFinite(startTicks) || !isFinite(endTicks) || !isFinite(durationTicks)) {
                continue;
            }
            if (clip.mediaType === "Video") {
                videoClips.push({
                    clip: clip,
                    startTicks: startTicks,
                    endTicks: endTicks,
                    durationTicks: durationTicks
                });
            } else if (clip.mediaType === "Audio") {
                audioClips.push({
                    clip: clip,
                    startTicks: startTicks,
                    endTicks: endTicks,
                    durationTicks: durationTicks
                });
            }
        } catch (_eCollect) {
            continue;
        }
    }
    return {
        video: videoClips,
        audio: audioClips
    };
}

function Gap__applyFixedGapTicks(clips, gapTicks, operationId) {
    if (!clips || clips.length < 2) return false;
    clips.sort(function(a, b) { return a.startTicks - b.startTicks; });
    var currentEndTicks = clips[0].endTicks;
    for (var idx = 1; idx < clips.length; idx++) {
        ET__throwIfOperationCancelled(operationId, "Gap adjustment");
        var currentClip = clips[idx].clip;
        var targetStartTicks = currentEndTicks + gapTicks;
        var deltaTicks = targetStartTicks - clips[idx].startTicks;
        if (deltaTicks !== 0) {
            currentClip.move(Gap__ticksToSeconds(deltaTicks));
        }
        clips[idx].startTicks = targetStartTicks;
        clips[idx].endTicks = targetStartTicks + clips[idx].durationTicks;
        currentEndTicks = clips[idx].endTicks;
    }
    return true;
}

function Gap__applyRandomGapTicks(clips, minGapSeconds, maxGapSeconds, timebase, operationId) {
    if (!clips || clips.length < 2) return false;
    clips.sort(function(a, b) { return a.startTicks - b.startTicks; });
    var currentEndTicks = clips[0].endTicks;
    for (var idx = 1; idx < clips.length; idx++) {
        ET__throwIfOperationCancelled(operationId, "Gap adjustment");
        var randomGapSeconds = maxGapSeconds <= minGapSeconds
            ? minGapSeconds
            : (minGapSeconds + (Math.random() * (maxGapSeconds - minGapSeconds)));
        var randomGapTicks = Gap__secondsToSnappedTicks(randomGapSeconds, timebase);
        var targetStartTicks = currentEndTicks + randomGapTicks;
        var deltaTicks = targetStartTicks - clips[idx].startTicks;
        if (deltaTicks !== 0) {
            clips[idx].clip.move(Gap__ticksToSeconds(deltaTicks));
        }
        clips[idx].startTicks = targetStartTicks;
        clips[idx].endTicks = targetStartTicks + clips[idx].durationTicks;
        currentEndTicks = clips[idx].endTicks;
    }
    return true;
}

function Gap_adjustGapsBetweenSelectedClips(gapSeconds, operationId) {
    try {
        // Ensure gapSeconds is a number and default to 0 if undefined
        gapSeconds = parseFloat(gapSeconds) || 0;
        
        // Check if project exists
        if (!app.project) {
            return ET_fail("No project open");
        }
        
        // Check if there's an active sequence
        var sequence = app.project.activeSequence;
        if (!sequence) {
            return ET_fail("No active sequence");
        }
        
        // Get selected clips
        var selectedClips = sequence.getSelection();
        
        if (!selectedClips || selectedClips.length < 2) {
            return ET_fail("Please select at least 2 clips to adjust gaps");
        }
        
        var timebase = Gap__getSequenceTimebase(sequence);
        var gapTicks = Gap__secondsToSnappedTicks(gapSeconds, timebase);
        var clipBuckets = Gap__collectSelectedClipsByMediaType(selectedClips);
        var videoClips = clipBuckets.video;
        var audioClips = clipBuckets.audio;
        
        var processedAny = false;

        // Process video clips
        if (videoClips.length >= 2) {
            Gap__applyFixedGapTicks(videoClips, gapTicks, operationId);
            processedAny = true;
        }

        // Process audio clips
        if (audioClips.length >= 2) {
            Gap__applyFixedGapTicks(audioClips, gapTicks, operationId);
            processedAny = true;
        }

        if (processedAny) {
            var parts = [];
            if (videoClips.length >= 2) parts.push(videoClips.length + " video clip(s)");
            if (audioClips.length >= 2) parts.push(audioClips.length + " audio clip(s)");
            return ET_ok("Done: Gap adjusted for " + parts.join(" and "));
        } else {
            return ET_fail("No compatible clips found in selection");
        }
        
    } catch (e) {
        return ET_fail(e.toString());
    }
}

function Gap_adjustGapsBetweenSelectedClipsAdvanced(minGapSeconds, maxGapSeconds, operationId) {
    try {
        minGapSeconds = parseFloat(minGapSeconds);
        maxGapSeconds = parseFloat(maxGapSeconds);

        if (!isFinite(minGapSeconds) || minGapSeconds < 0) minGapSeconds = 0;
        if (!isFinite(maxGapSeconds) || maxGapSeconds < 0) maxGapSeconds = minGapSeconds;
        if (maxGapSeconds < minGapSeconds) {
            var tmp = minGapSeconds;
            minGapSeconds = maxGapSeconds;
            maxGapSeconds = tmp;
        }

        if (!app.project) {
            return ET_fail("No project open");
        }

        var sequence = app.project.activeSequence;
        if (!sequence) {
            return ET_fail("No active sequence");
        }

        var selectedClips = sequence.getSelection();

        if (!selectedClips || selectedClips.length < 2) {
            return ET_fail("Please select at least 2 clips to adjust gaps");
        }

        var timebase = Gap__getSequenceTimebase(sequence);
        var clipBuckets = Gap__collectSelectedClipsByMediaType(selectedClips);
        var videoClips = clipBuckets.video;
        var audioClips = clipBuckets.audio;

        var processedAny = false;
        if (Gap__applyRandomGapTicks(videoClips, minGapSeconds, maxGapSeconds, timebase, operationId)) processedAny = true;
        if (Gap__applyRandomGapTicks(audioClips, minGapSeconds, maxGapSeconds, timebase, operationId)) processedAny = true;

        if (processedAny) {
            var parts = [];
            if (videoClips.length >= 2) parts.push(videoClips.length + " video clip(s)");
            if (audioClips.length >= 2) parts.push(audioClips.length + " audio clip(s)");
            return ET_ok("Done: Random gaps between " + minGapSeconds.toFixed(1) + "s and " + maxGapSeconds.toFixed(1) + "s applied for " + parts.join(" and "));
        }

        return ET_fail("No compatible clips found in selection");
    } catch (e) {
        return ET_fail(e.toString());
    }
}

