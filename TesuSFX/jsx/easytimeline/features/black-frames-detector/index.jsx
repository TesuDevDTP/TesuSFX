var BFD__MARKER_NAME = 'Black Frame';
var BFD__MARKER_COMMENT_PREFIX = 'EasyTimeline Black Frames Detector';
var BFD__MARKER_COLOR_INDEX = 15;
var BFD__TICKS_PER_SECOND = 254016000000;

function BFD__parsePayload(raw) {
    if (typeof raw === 'string') {
        if (!raw.length) return {};
        return JSON.parse(raw);
    }
    return raw || {};
}

function BFD__trim(value) {
    return String(value || '').replace(/^\s+|\s+$/g, '');
}

function BFD__activeSequenceOrNull() {
    try {
        if (app.project && app.project.activeSequence) return app.project.activeSequence;
    } catch (_e) {}
    return null;
}

function BFD__collectionCount(collection) {
    if (!collection) return 0;
    if (typeof collection.numItems === 'number') return collection.numItems;
    if (typeof collection.length === 'number') return collection.length;
    if (typeof collection.numTracks === 'number') return collection.numTracks;
    return 0;
}

function BFD__collectionItem(collection, index) {
    if (!collection) return null;
    try {
        if (typeof collection[index] !== 'undefined') return collection[index];
    } catch (_eIndex) {}
    try {
        if (typeof collection.getItemAt === 'function') return collection.getItemAt(index);
    } catch (_eGet) {}
    return null;
}

function BFD__timeToSeconds(timeObj) {
    try {
        if (timeObj && typeof timeObj.seconds === 'number') return Number(timeObj.seconds);
    } catch (_eSeconds) {}
    return 0;
}

function BFD__sequenceFrameSeconds(sequence) {
    var ticksPerFrame = 0;
    try { ticksPerFrame = parseFloat(sequence && sequence.timebase ? sequence.timebase : 0); } catch (_e) { ticksPerFrame = 0; }
    if (ticksPerFrame > 0) {
        return ticksPerFrame / BFD__TICKS_PER_SECOND;
    }
    return 1 / 30;
}

function BFD__secondsToTicksString(seconds) {
    var timeObj = new Time();
    timeObj.seconds = Number(seconds || 0);
    return String(timeObj.ticks || '0');
}

function BFD__secondsToTimecode(sequence, seconds) {
    var timeObj = new Time();
    try {
        timeObj.seconds = Number(seconds || 0);
        return timeObj.getFormatted(sequence.getSettings().videoFrameRate, sequence.getSettings().videoDisplayFormat);
    } catch (_e) {}
    return Number(seconds || 0).toFixed(2) + 's';
}

function BFD__videoTrackMuted(track) {
    try {
        if (track && typeof track.isMuted === 'function') {
            return !!track.isMuted();
        }
    } catch (_eFn) {}
    try {
        if (track && typeof track.isMuted === 'boolean') {
            return !!track.isMuted;
        }
    } catch (_eProp) {}
    return false;
}

function BFD__clipVisible(clip) {
    try {
        if (!clip) return false;
        if (clip.disabled) return false;
    } catch (_eDisabled) {}
    return !!clip;
}

function BFD__sequenceRangeEnd(sequence) {
    var maxEnd = 0;
    var hasItems = false;
    var trackGroups = [];
    var g;
    var t;
    var track;
    var clips;
    var c;
    var clip;
    var clipEnd = 0;
    var seqEnd = 0;

    trackGroups.push(sequence.videoTracks);
    trackGroups.push(sequence.audioTracks);

    for (g = 0; g < trackGroups.length; g += 1) {
        for (t = 0; t < BFD__collectionCount(trackGroups[g]); t += 1) {
            track = BFD__collectionItem(trackGroups[g], t);
            if (!track) continue;
            clips = track.clips;
            for (c = 0; c < BFD__collectionCount(clips); c += 1) {
                clip = BFD__collectionItem(clips, c);
                if (!clip) continue;
                hasItems = true;
                clipEnd = BFD__timeToSeconds(clip.end);
                if (clipEnd > maxEnd) maxEnd = clipEnd;
            }
        }
    }

    if (!hasItems) return 0;

    try { seqEnd = BFD__timeToSeconds(sequence.end); } catch (_eSeqEnd) { seqEnd = 0; }
    if (seqEnd > maxEnd) maxEnd = seqEnd;
    return maxEnd;
}

function BFD__buildVideoEvents(sequence) {
    var events = [];
    var trackCount = BFD__collectionCount(sequence.videoTracks);
    var t;
    var track;
    var clips;
    var c;
    var clip;
    var startSec = 0;
    var endSec = 0;

    for (t = 0; t < trackCount; t += 1) {
        track = BFD__collectionItem(sequence.videoTracks, t);
        if (!track) continue;
        if (BFD__videoTrackMuted(track)) continue;
        clips = track.clips;
        for (c = 0; c < BFD__collectionCount(clips); c += 1) {
            clip = BFD__collectionItem(clips, c);
            if (!BFD__clipVisible(clip)) continue;
            startSec = BFD__timeToSeconds(clip.start);
            endSec = BFD__timeToSeconds(clip.end);
            if (!(endSec > startSec)) continue;
            events.push({ time: startSec, delta: 1 });
            events.push({ time: endSec, delta: -1 });
        }
    }

    events.sort(function (a, b) {
        if (a.time < b.time) return -1;
        if (a.time > b.time) return 1;
        return a.delta - b.delta;
    });
    return events;
}

function BFD__buildIssues(sequence) {
    var rangeEnd = BFD__sequenceRangeEnd(sequence);
    var frameSec = BFD__sequenceFrameSeconds(sequence);
    var minDuration = frameSec * 0.5;
    var events = BFD__buildVideoEvents(sequence);
    var issues = [];
    var prevTime = 0;
    var activeCount = 0;
    var i = 0;
    var currentTime = 0;
    var delta = 0;
    var startSec = 0;
    var endSec = 0;

    if (!(rangeEnd > minDuration)) {
        return {
            issues: [],
            rangeEnd: 0
        };
    }

    if (!events.length) {
        issues.push({
            label: BFD__MARKER_NAME,
            startSec: 0,
            endSec: rangeEnd,
            durationSec: rangeEnd,
            startTicks: BFD__secondsToTicksString(0),
            endTicks: BFD__secondsToTicksString(rangeEnd),
            startTimecode: BFD__secondsToTimecode(sequence, 0),
            endTimecode: BFD__secondsToTimecode(sequence, rangeEnd)
        });
        return {
            issues: issues,
            rangeEnd: rangeEnd
        };
    }

    while (i < events.length) {
        currentTime = Number(events[i].time || 0);
        if ((currentTime - prevTime) > minDuration && activeCount <= 0) {
            startSec = prevTime;
            endSec = currentTime;
            issues.push({
                label: BFD__MARKER_NAME,
                startSec: startSec,
                endSec: endSec,
                durationSec: endSec - startSec,
                startTicks: BFD__secondsToTicksString(startSec),
                endTicks: BFD__secondsToTicksString(endSec),
                startTimecode: BFD__secondsToTimecode(sequence, startSec),
                endTimecode: BFD__secondsToTimecode(sequence, endSec)
            });
        }

        delta = 0;
        while (i < events.length && Math.abs(Number(events[i].time || 0) - currentTime) <= 0.000001) {
            delta += Number(events[i].delta || 0);
            i += 1;
        }
        activeCount += delta;
        if (activeCount < 0) activeCount = 0;
        prevTime = currentTime;
    }

    if ((rangeEnd - prevTime) > minDuration && activeCount <= 0) {
        startSec = prevTime;
        endSec = rangeEnd;
        issues.push({
            label: BFD__MARKER_NAME,
            startSec: startSec,
            endSec: endSec,
            durationSec: endSec - startSec,
            startTicks: BFD__secondsToTicksString(startSec),
            endTicks: BFD__secondsToTicksString(endSec),
            startTimecode: BFD__secondsToTimecode(sequence, startSec),
            endTimecode: BFD__secondsToTimecode(sequence, endSec)
        });
    }

    return {
        issues: issues,
        rangeEnd: rangeEnd
    };
}

function BFD__markerMatches(marker) {
    var name = '';
    var comments = '';
    try { name = BFD__trim(marker && marker.name); } catch (_eName) {}
    try { comments = BFD__trim(marker && marker.comments); } catch (_eComments) {}
    if (name !== BFD__MARKER_NAME) return false;
    return comments.indexOf(BFD__MARKER_COMMENT_PREFIX) === 0;
}

function BFD__clearManagedMarkers(sequence) {
    var markers = null;
    var list = [];
    var current = null;
    var previous = null;
    var count = 0;
    var i;

    try { markers = sequence && sequence.markers ? sequence.markers : null; } catch (_eMarkers) { markers = null; }
    if (!markers || typeof markers.getFirstMarker !== 'function' || typeof markers.deleteMarker !== 'function') {
        return 0;
    }

    try {
        current = markers.getFirstMarker();
        while (current) {
            if (BFD__markerMatches(current)) {
                list.push(current);
            }
            previous = current;
            current = markers.getNextMarker(previous);
        }
    } catch (_eIterate) {}

    for (i = 0; i < list.length; i += 1) {
        try {
            markers.deleteMarker(list[i]);
            count += 1;
        } catch (_eDelete) {}
    }
    return count;
}

function BFD__createIssueMarker(sequence, issue) {
    var marker = null;
    var startSec = Number(issue && issue.startSec || 0);
    var endSec = Number(issue && issue.endSec || 0);
    if (!(endSec > startSec)) return false;
    try {
        if (!sequence || !sequence.markers || typeof sequence.markers.createMarker !== 'function') {
            return false;
        }
        marker = sequence.markers.createMarker(startSec);
        if (!marker) return false;
        marker.name = BFD__MARKER_NAME;
        marker.comments = BFD__MARKER_COMMENT_PREFIX + ' | ' + String(issue.startTimecode || '') + ' -> ' + String(issue.endTimecode || '');
        marker.end = endSec;
        if (typeof marker.setColorByIndex === 'function') {
            marker.setColorByIndex(BFD__MARKER_COLOR_INDEX);
        }
        return true;
    } catch (_eCreate) {}
    return false;
}

function BFD__createIssueMarkers(sequence, issues) {
    var list = issues instanceof Array ? issues : [];
    var count = 0;
    var i;
    for (i = 0; i < list.length; i += 1) {
        if (BFD__createIssueMarker(sequence, list[i])) {
            count += 1;
        }
    }
    return count;
}

function BFD_scanActiveSequence(rawPayload) {
    var payload;
    var sequence;
    var scan;
    var markersRemoved = 0;
    var markersAdded = 0;
    var createMarkers = true;
    try {
        payload = BFD__parsePayload(rawPayload);
        createMarkers = !(payload && payload.createMarkers === false);
        sequence = BFD__activeSequenceOrNull();
        if (!sequence) {
            return ET_fail('No active sequence.');
        }

        scan = BFD__buildIssues(sequence);

        if (createMarkers) {
            markersRemoved = BFD__clearManagedMarkers(sequence);
            markersAdded = BFD__createIssueMarkers(sequence, scan.issues);
        }

        return ET_ok({
            sequenceName: BFD__trim(sequence.name || 'Active sequence'),
            issueCount: scan.issues.length,
            issues: scan.issues,
            markersAdded: markersAdded,
            markersRemoved: markersRemoved
        });
    } catch (e) {
        return ET_fail('BFD_scanActiveSequence: ' + e.toString());
    }
}

function BFD_jumpToIssue(rawPayload) {
    var payload;
    var sequence;
    var startTicks = '';
    try {
        payload = BFD__parsePayload(rawPayload);
        sequence = BFD__activeSequenceOrNull();
        if (!sequence) {
            return ET_fail('No active sequence.');
        }

        startTicks = BFD__trim(payload && payload.startTicks);
        if (!startTicks) {
            startTicks = BFD__secondsToTicksString(payload && payload.startSec);
        }
        sequence.setPlayerPosition(String(startTicks || '0'));
        return ET_ok({
            jumped: true,
            startTicks: String(startTicks || '0')
        });
    } catch (e) {
        return ET_fail('BFD_jumpToIssue: ' + e.toString());
    }
}
