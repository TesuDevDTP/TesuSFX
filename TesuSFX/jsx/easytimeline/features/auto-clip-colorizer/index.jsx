var ACC__LABEL_NAMES = [
    'Violet',
    'Iris',
    'Caribbean',
    'Lavender',
    'Cerulean',
    'Forest',
    'Rose',
    'Mango',
    'Purple',
    'Blue',
    'Teal',
    'Magenta',
    'Tan',
    'Green',
    'Brown',
    'Yellow'
];

var ACC__LABEL_COLORS = [
    '#5B22D0',
    '#116A98',
    '#58861E',
    '#871CA5',
    '#176D79',
    '#5B6E00',
    '#B00C55',
    '#A85107',
    '#801AD2',
    '#3347BC',
    '#0D6F64',
    '#A31577',
    '#8A7259',
    '#17702B',
    '#845B08',
    '#8D7D1D'
];

var ACC__LABEL_COMMAND_ID_BASE = 13124;
var ACC__DEFAULT_LABEL_ID = 0;
var ACC__TIMELINE_APPLY_CACHE = {};
var ACC__PENDING_SCANS = {};
var ACC__SEQUENCE_TRACKERS = {};
var ACC__LOG_DIR_NAME = 'EasyTimeline/Logs';
var ACC__LOG_FILE_NAME = 'auto-clip-colorizer.log';
var ACC__LOG_MAX_BYTES = 1024 * 1024;

var ACC__IMAGE_EXTS = {
    '.png': 1, '.jpg': 1, '.jpeg': 1, '.psd': 1, '.tif': 1, '.tiff': 1,
    '.bmp': 1, '.gif': 1, '.webp': 1, '.exr': 1, '.dpx': 1, '.tga': 1,
    '.heic': 1, '.heif': 1, '.svg': 1
};

var ACC__AUDIO_EXTS = {
    '.wav': 1, '.mp3': 1, '.aac': 1, '.m4a': 1, '.aif': 1, '.aiff': 1,
    '.flac': 1, '.ogg': 1, '.wma': 1, '.caf': 1
};

var ACC__VIDEO_EXTS = {
    '.mp4': 1, '.mov': 1, '.mxf': 1, '.avi': 1, '.mkv': 1, '.webm': 1,
    '.mpeg': 1, '.mpg': 1, '.m4v': 1, '.wmv': 1, '.flv': 1, '.ts': 1,
    '.mts': 1, '.m2ts': 1, '.3gp': 1, '.r3d': 1, '.braw': 1, '.ari': 1,
    '.mp2': 1
};

function ACC__parsePayload(raw) {
    if (typeof raw === 'string') {
        if (!raw.length) return {};
        return JSON.parse(raw);
    }
    return raw || {};
}

function ACC__trim(value) {
    return String(value || '').replace(/^\s+|\s+$/g, '');
}

function ACC__isoNow() {
    try {
        return (new Date()).toISOString();
    } catch (_eDate) {}
    return '';
}

function ACC__logFile() {
    var root = null;
    var dir = null;
    var file = null;
    try {
        root = Folder.userData;
        if (!root) return null;
        dir = new Folder(root.fsName + '/' + ACC__LOG_DIR_NAME);
        if (!dir.exists) dir.create();
        file = new File(dir.fsName + '/' + ACC__LOG_FILE_NAME);
        return file;
    } catch (_eFile) {}
    return null;
}

function ACC__appendLog(line) {
    var file = ACC__logFile();
    var text = '[' + ACC__isoNow() + '] ' + String(line || '');
    try {
        if (!file) return;
        if (file.exists && file.length > ACC__LOG_MAX_BYTES) {
            try { file.remove(); } catch (_eRemove) {}
        }
        file.encoding = 'UTF-8';
        file.lineFeed = 'Unix';
        if (file.open('a')) {
            file.writeln(text);
            file.close();
        }
    } catch (_eWrite) {
        try { if (file && file.opened) file.close(); } catch (_eClose) {}
    }
}

function ACC__logJson(label, payload) {
    var text = '';
    try {
        text = JSON.stringify(payload);
    } catch (_eJson) {
        text = String(payload || '');
    }
    ACC__appendLog(String(label || '') + ': ' + text);
}

function ACC__normalizeColor(value, fallback) {
    var out = ACC__trim(value || '');
    if (!out) out = String(fallback || '');
    if (!out) return '#2dde73';
    if (out.charAt(0) !== '#') out = '#' + out;
    return out;
}

function ACC__labelPalette() {
    var out = [];
    var i;
    var labelNameKey = 'BE.Prefs.LabelNames.';
    var labelColorKey = 'BE.Prefs.LabelColors.';
    var nameValue = '';
    var colorValue = '';

    for (i = 0; i < ACC__LABEL_NAMES.length; i += 1) {
        nameValue = '';
        colorValue = '';
        try {
            if (app.properties && typeof app.properties.getProperty === 'function') {
                nameValue = String(app.properties.getProperty(labelNameKey + i) || '');
                colorValue = String(app.properties.getProperty(labelColorKey + i) || '');
            }
        } catch (_eProps) {}
        out.push({
            id: i,
            name: ACC__trim(nameValue || ACC__LABEL_NAMES[i]),
            color: ACC__normalizeColor(colorValue, ACC__LABEL_COLORS[i])
        });
    }
    return out;
}

function ACC__activeSequenceOrNull() {
    try {
        if (app.project && app.project.activeSequence) return app.project.activeSequence;
    } catch (_e) {}
    return null;
}

function ACC__sequenceCacheKey(seq) {
    var seqId = '';
    try { seqId = String(seq && seq.sequenceID ? seq.sequenceID : ''); } catch (_eSeqId) {}
    if (!seqId) {
        try { seqId = String(seq && seq.name ? seq.name : ''); } catch (_eSeqName) {}
    }
    return seqId || '__active_sequence__';
}

function ACC__hashPush(hash, text) {
    var value = String(text || '');
    var i;
    var code = 0;
    for (i = 0; i < value.length; i += 1) {
        code = value.charCodeAt(i);
        hash = ((hash * 33) + code) % 2147483647;
    }
    return hash;
}

function ACC__normalizeAssetType(value) {
    var wanted = ACC__trim(value).toLowerCase();
    if (wanted === 'video' || wanted === 'image' || wanted === 'audio' || wanted === 'sequence' || wanted === 'mogrt' || wanted === 'graphic' || wanted === 'other') {
        return wanted;
    }
    return '';
}

function ACC__normalizeExtensions(value) {
    var raw = ACC__trim(value);
    var out = {};
    var count = 0;
    var parts;
    var i;
    var ext = '';
    if (!raw) return { map: out, count: 0 };
    parts = raw.split(/[\s,;]+/);
    for (i = 0; i < parts.length; i += 1) {
        ext = ACC__trim(parts[i]).toLowerCase();
        if (!ext) continue;
        if (ext.charAt(0) !== '.') ext = '.' + ext;
        if (out[ext]) continue;
        out[ext] = 1;
        count += 1;
    }
    return { map: out, count: count };
}

function ACC__normalizeRule(raw, index) {
    var extInfo = ACC__normalizeExtensions(raw && raw.extensionFilter);
    var labelId = parseInt(raw && raw.labelId, 10);
    if (!isFinite(labelId) || labelId < 0 || labelId >= ACC__LABEL_NAMES.length) labelId = ACC__DEFAULT_LABEL_ID;
    return {
        id: ACC__trim(raw && raw.id) || ('acc_rule_' + String(index)),
        name: ACC__trim(raw && raw.name) || ('Rule ' + String(index + 1)),
        assetType: ACC__normalizeAssetType(raw && raw.assetType),
        extensionMap: extInfo.map,
        extensionCount: extInfo.count,
        labelId: labelId,
        apply: !!(raw && (raw.apply || raw.reapplyDifferent))
    };
}

function ACC__normalizeRules(rawRules) {
    var list = rawRules instanceof Array ? rawRules : [];
    var out = [];
    var i;
    var rule;
    for (i = 0; i < list.length; i += 1) {
        rule = ACC__normalizeRule(list[i], i);
        if (!rule.assetType) continue;
        out.push(rule);
    }
    return out;
}

function ACC__normalizeOptions(raw) {
    return {
        excludeLockedTracks: raw && raw.excludeLockedTracks !== false,
        forceAssetType: ACC__normalizeAssetType(raw && raw.forceAssetType),
        initialMonitorCatchup: !!(raw && raw.initialMonitorCatchup)
    };
}

function ACC__shouldInspectTrackPass(forceAssetType, trackType) {
    var wanted = ACC__normalizeAssetType(forceAssetType);
    if (!wanted) return true;
    if (wanted === 'audio') return trackType === 'audio';
    if (wanted === 'image' || wanted === 'mogrt' || wanted === 'graphic' || wanted === 'other') return trackType === 'video';
    return true;
}

function ACC__buildSequenceMonitorState(seq, options) {
    var index = ACC__buildSequenceIndex(seq, options);
    return {
        status: index.status,
        sequenceName: index.sequenceName,
        sequenceId: index.sequenceId,
        clipCount: index.clipCount,
        skippedLockedClips: index.skippedLockedClips,
        signature: index.signature
    };
}

function ACC__buildSequenceIndex(seq, options) {
    var result = {
        status: 'no-sequence',
        sequenceName: '',
        sequenceId: '',
        clipCount: 0,
        skippedLockedClips: 0,
        signature: '',
        items: {}
    };
    var pass;
    var tracks;
    var trackType;
    var trackIndex;
    var track;
    var clipIndex;
    var clip;
    var hash = 5381;
    var key = '';
    if (!seq) return result;

    result.status = 'ok';
    result.sequenceName = ACC__trim(seq.name || '');
    result.sequenceId = ACC__sequenceCacheKey(seq);
    hash = ACC__hashPush(hash, result.sequenceId);

    for (pass = 0; pass < 2; pass += 1) {
        tracks = pass === 0 ? seq.videoTracks : seq.audioTracks;
        trackType = pass === 0 ? 'video' : 'audio';
        if (!ACC__shouldInspectTrackPass(options && options.forceAssetType, trackType)) {
            continue;
        }
        hash = ACC__hashPush(hash, trackType + ':' + String(tracks.numTracks || 0));
        for (trackIndex = 0; trackIndex < tracks.numTracks; trackIndex += 1) {
            track = tracks[trackIndex];
            if (options.excludeLockedTracks && ACC__trackLocked(track)) {
                result.skippedLockedClips += track.clips.numItems;
                hash = ACC__hashPush(hash, trackType + ':' + String(trackIndex) + ':locked:' + String(track.clips.numItems));
                continue;
            }
            hash = ACC__hashPush(hash, trackType + ':' + String(trackIndex) + ':' + String(track.clips.numItems));
            for (clipIndex = 0; clipIndex < track.clips.numItems; clipIndex += 1) {
                clip = track.clips[clipIndex];
                if (!clip) continue;
                result.clipCount += 1;
                key = ACC__timelineItemStableKey(clip, trackType, trackIndex, clipIndex);
                result.items[key] = {
                    key: key,
                    clip: clip,
                    trackType: trackType,
                    trackIndex: trackIndex,
                    clipIndex: clipIndex
                };
                hash = ACC__hashPush(hash, key);
            }
        }
    }

    result.signature = result.sequenceId + ':' + String(result.clipCount) + ':' + String(hash);
    return result;
}

function ACC__collectScanState(seq, rules, options) {
    var result = {
        sequenceName: '',
        sequenceId: '',
        clipCount: 0,
        checked: 0,
        matched: 0,
        projectItemManaged: 0,
        skippedLockedClips: 0,
        signature: '',
        groups: {}
    };
    var pass;
    var tracks;
    var trackType;
    var trackIndex;
    var track;
    var clipIndex;
    var clip;
    var info;
    var ruleIndex;
    var matchedRule = null;
    var cachedState = null;
    var applyDecision = null;
    var hash = 5381;
    var key = '';

    if (!seq) return result;

    result.sequenceName = ACC__trim(seq.name || '');
    result.sequenceId = ACC__sequenceCacheKey(seq);
    hash = ACC__hashPush(hash, result.sequenceId);

    for (pass = 0; pass < 2; pass += 1) {
        tracks = pass === 0 ? seq.videoTracks : seq.audioTracks;
        trackType = pass === 0 ? 'video' : 'audio';
        if (!ACC__shouldInspectTrackPass(options && options.forceAssetType, trackType)) {
            continue;
        }
        hash = ACC__hashPush(hash, trackType + ':' + String(tracks.numTracks || 0));
        for (trackIndex = 0; trackIndex < tracks.numTracks; trackIndex += 1) {
            track = tracks[trackIndex];
            if (options.excludeLockedTracks && ACC__trackLocked(track)) {
                result.skippedLockedClips += track.clips.numItems;
                hash = ACC__hashPush(hash, trackType + ':' + String(trackIndex) + ':locked:' + String(track.clips.numItems));
                continue;
            }
            hash = ACC__hashPush(hash, trackType + ':' + String(trackIndex) + ':' + String(track.clips.numItems));
            for (clipIndex = 0; clipIndex < track.clips.numItems; clipIndex += 1) {
                clip = track.clips[clipIndex];
                if (!clip) continue;
                info = ACC__clipInfo(clip, trackType, trackIndex, clipIndex);
                result.clipCount += 1;
                result.checked += 1;
                key = [
                    trackType,
                    String(trackIndex),
                    ACC__trackItemNodeId(clip),
                    ACC__projectItemNodeId(clip && clip.projectItem),
                    ACC__ticksString(clip && clip.start),
                    ACC__ticksString(clip && clip.end)
                ].join('|');
                hash = ACC__hashPush(hash, key);
                matchedRule = null;
                for (ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
                    if (ACC__ruleMatches(rules[ruleIndex], info)) {
                        matchedRule = rules[ruleIndex];
                        break;
                    }
                }
                if (!matchedRule) continue;
                result.matched += 1;
                cachedState = ACC__getCachedApplyState(seq, info);
                if (cachedState && cachedState.mode === 'projectItem' && cachedState.labelId === matchedRule.labelId) {
                    result.projectItemManaged += 1;
                }
                applyDecision = ACC__evaluateApplyDecision(seq, matchedRule, info);
                ACC__logJson('Matched clip decision', {
                    key: String(info && info.key ? info.key : ''),
                    ruleLabelId: matchedRule.labelId,
                    ruleLabelName: ACC__LABEL_NAMES[matchedRule.labelId] || ('Label ' + String(matchedRule.labelId + 1)),
                    currentLabelId: info && info.currentLabelId !== undefined ? info.currentLabelId : -1,
                    observedProjectItemLabelId: info && info.observedProjectItemLabelId !== undefined ? info.observedProjectItemLabelId : -1,
                    labelReadMode: String(info && info.labelReadMode ? info.labelReadMode : 'projectItem'),
                    cachedState: applyDecision.cachedState,
                    apply: !!applyDecision.apply,
                    reason: String(applyDecision.reason || ''),
                    clip: ACC__describeClipInfo(info)
                });
                if (options && options.initialMonitorCatchup && !ACC__shouldApplyOnMonitorStart(seq, matchedRule, info)) continue;
                if (!applyDecision.apply) continue;
                if (!result.groups[matchedRule.labelId]) result.groups[matchedRule.labelId] = [];
                result.groups[matchedRule.labelId].push(info);
            }
        }
    }

    result.signature = result.sequenceId + ':' + String(result.clipCount) + ':' + String(hash);
    return result;
}

function ACC__trackLocked(track) {
    try { if (track && typeof track.isLocked === 'function') return !!track.isLocked(); } catch (_e) {}
    return false;
}

function ACC__projectItemNodeId(projectItem) {
    try {
        if (projectItem && projectItem.nodeId !== undefined && projectItem.nodeId !== null) return String(projectItem.nodeId);
    } catch (_e) {}
    return '';
}

function ACC__trackItemNodeId(clip) {
    try {
        if (clip && clip.nodeId !== undefined && clip.nodeId !== null) return String(clip.nodeId);
    } catch (_e) {}
    return '';
}

function ACC__timelineItemStableKey(clip, trackType, trackIndex, clipIndex) {
    var trackItemId = ACC__trackItemNodeId(clip);
    if (trackItemId) return String(trackType || '') + '::ti::' + trackItemId;
    return [
        String(trackType || ''),
        String(trackIndex),
        ACC__projectItemNodeId(clip && clip.projectItem),
        ACC__ticksString(clip && clip.start),
        ACC__ticksString(clip && clip.end),
        String(clipIndex)
    ].join('|');
}

function ACC__ticksString(timeObj) {
    try {
        if (timeObj && timeObj.ticks !== undefined && timeObj.ticks !== null) return String(timeObj.ticks);
    } catch (_e) {}
    return '0';
}

function ACC__projectItemMediaPath(projectItem) {
    try {
        if (projectItem && typeof projectItem.getMediaPath === 'function') return String(projectItem.getMediaPath() || '');
    } catch (_e) {}
    return '';
}

function ACC__projectItemIsSequence(projectItem) {
    var nodeId = '';
    var i;
    try {
        if (projectItem && typeof projectItem.isSequence === 'function') {
            return !!projectItem.isSequence();
        }
    } catch (_eDirect) {}
    nodeId = ACC__projectItemNodeId(projectItem);
    if (!nodeId) return false;
    try {
        if (app.project && app.project.sequences && app.project.sequences.numSequences) {
            for (i = 0; i < app.project.sequences.numSequences; i += 1) {
                if (!app.project.sequences[i] || !app.project.sequences[i].projectItem) continue;
                if (String(app.project.sequences[i].projectItem.nodeId || '') === nodeId) {
                    return true;
                }
            }
        }
    } catch (_eScan) {}
    return false;
}

function ACC__extensionFromPath(pathValue) {
    var path = ACC__trim(pathValue).toLowerCase();
    var dotIndex = -1;
    if (!path) return '';
    dotIndex = path.lastIndexOf('.');
    if (dotIndex < 0) return '';
    return path.slice(dotIndex);
}

function ACC__captureSelection(seq) {
    var out = [];
    var selection = null;
    var i;
    var len = 0;
    try {
        selection = seq.getSelection();
        len = (selection && typeof selection.length === 'number') ? selection.length : ((selection && typeof selection.numItems === 'number') ? selection.numItems : 0);
        for (i = 0; i < len; i += 1) {
            if (selection[i]) out.push(selection[i]);
        }
    } catch (_eSel) {}
    return out;
}

function ACC__setTrackItemSelected(clip, selected, refresh) {
    try {
        if (clip && typeof clip.setSelected === 'function') {
            clip.setSelected(selected ? 1 : 0, refresh ? 1 : 0);
            return true;
        }
    } catch (_eSet) {}
    return false;
}

function ACC__clearSelection(seq) {
    var selection = [];
    var i;
    try {
        selection = ACC__captureSelection(seq);
        for (i = 0; i < selection.length; i += 1) {
            ACC__setTrackItemSelected(selection[i], false, i === selection.length - 1);
        }
    } catch (_eClear) {}
    try {
        if (seq && typeof seq.setSelection === 'function') {
            seq.setSelection([]);
        }
    } catch (_eSet) {}
}

function ACC__setSelection(seq, clips) {
    var list = clips instanceof Array ? clips : [];
    var i;
    ACC__clearSelection(seq);
    for (i = 0; i < list.length; i += 1) {
        ACC__setTrackItemSelected(list[i], true, i === list.length - 1);
    }
    try {
        if (seq && typeof seq.setSelection === 'function') {
            seq.setSelection(list);
        }
    } catch (_eSet) {}
}

function ACC__clipAssetType(clip, trackType) {
    var mediaPath = '';
    var extension = '';
    var mediaType = '';
    var projectItem = clip && clip.projectItem ? clip.projectItem : null;

    if (ACC__projectItemIsSequence(projectItem)) {
        return 'sequence';
    }

    try {
        if (clip && typeof clip.getMGTComponent === 'function' && clip.getMGTComponent()) {
            return 'mogrt';
        }
    } catch (_eMogrt) {}

    try { mediaType = String(clip && clip.mediaType || '').toLowerCase(); } catch (_eMediaType) {}
    mediaPath = ACC__projectItemMediaPath(projectItem);
    extension = ACC__extensionFromPath(mediaPath);
    if (extension && ACC__VIDEO_EXTS[extension]) return 'video';
    if (extension && ACC__IMAGE_EXTS[extension]) return 'image';
    if (extension && ACC__AUDIO_EXTS[extension]) return 'audio';
    if (mediaType === 'video') return 'video';
    if (trackType === 'audio' || mediaType === 'audio') return 'audio';
    if (mediaPath) return 'video';
    if (trackType === 'video' || mediaType === 'video') return 'other';
    return 'other';
}

function ACC__clipCurrentLabelId(clip) {
    // This is the source project-item label, not a verified timeline track-item
    // label. Keep it for diagnostics, but do not treat it as authoritative.
    try {
        if (clip && clip.projectItem && typeof clip.projectItem.getColorLabel === 'function') {
            var labelId = parseInt(clip.projectItem.getColorLabel(), 10);
            if (isFinite(labelId)) return labelId;
        }
    } catch (_e) {}
    return -1;
}

function ACC__clipInfo(clip, trackType, trackIndex, clipIndex) {
    var projectItem = clip && clip.projectItem ? clip.projectItem : null;
    var mediaPath = ACC__projectItemMediaPath(projectItem);
    var observedProjectItemLabelId = ACC__clipCurrentLabelId(clip);
    return {
        clip: clip,
        key: ACC__timelineItemStableKey(clip, trackType, trackIndex, clipIndex),
        assetType: ACC__clipAssetType(clip, trackType),
        extension: ACC__extensionFromPath(mediaPath),
        currentLabelId: observedProjectItemLabelId,
        observedProjectItemLabelId: observedProjectItemLabelId,
        labelReadMode: 'projectItem'
    };
}

function ACC__describeClipInfo(info) {
    return {
        key: String(info && info.key ? info.key : ''),
        assetType: String(info && info.assetType ? info.assetType : ''),
        extension: String(info && info.extension ? info.extension : ''),
        currentLabelId: info && info.currentLabelId !== undefined ? info.currentLabelId : -1,
        observedProjectItemLabelId: info && info.observedProjectItemLabelId !== undefined ? info.observedProjectItemLabelId : (info && info.currentLabelId !== undefined ? info.currentLabelId : -1),
        labelReadMode: String(info && info.labelReadMode ? info.labelReadMode : 'projectItem'),
        projectItemNodeId: ACC__projectItemNodeId(info && info.clip ? info.clip.projectItem : null),
        trackItemNodeId: ACC__trackItemNodeId(info && info.clip ? info.clip : null),
        mediaPath: ACC__projectItemMediaPath(info && info.clip ? info.clip.projectItem : null),
        clipName: ACC__trim(info && info.clip && info.clip.projectItem ? info.clip.projectItem.name : '')
    };
}

function ACC__describeCachedApplyState(seq, info) {
    var cached = ACC__getCachedApplyState(seq, info);
    if (!cached) return null;
    return {
        labelId: parseInt(cached.labelId, 10),
        mode: String(cached.mode || ''),
        verified: cached.verified === false ? false : true,
        platform: ACC__trim(cached.platform || ''),
        route: ACC__trim(cached.route || '')
    };
}

function ACC__describeClipState(seq, info) {
    var out = ACC__describeClipInfo(info);
    out.cachedState = ACC__describeCachedApplyState(seq, info);
    return out;
}

function ACC__describeClipStates(seq, infos, limit) {
    var list = infos instanceof Array ? infos : [];
    var maxCount = parseInt(limit, 10);
    var out = [];
    var i;
    if (!isFinite(maxCount) || maxCount < 1) maxCount = 3;
    for (i = 0; i < list.length && i < maxCount; i += 1) {
        out.push(ACC__describeClipState(seq, list[i]));
    }
    return out;
}

function ACC__clipCacheKey(seq, info) {
    return ACC__sequenceCacheKey(seq) + '::' + String(info && info.key ? info.key : '');
}

function ACC__getCachedApplyState(seq, info) {
    var key = ACC__clipCacheKey(seq, info);
    if (!key || !ACC__TIMELINE_APPLY_CACHE[key]) return null;
    return ACC__TIMELINE_APPLY_CACHE[key];
}

function ACC__clearCachedApplyState(seq, infos) {
    var list = infos instanceof Array ? infos : [];
    var i;
    var info;
    var key = '';
    for (i = 0; i < list.length; i += 1) {
        info = list[i];
        key = ACC__clipCacheKey(seq, info);
        if (!key || !ACC__TIMELINE_APPLY_CACHE[key]) continue;
        delete ACC__TIMELINE_APPLY_CACHE[key];
    }
}

function ACC__setCachedApplyState(seq, infos, labelId, mode, details) {
    var list = infos instanceof Array ? infos : [];
    var meta = details && typeof details === 'object' ? details : {};
    var i;
    var info;
    var key = '';
    for (i = 0; i < list.length; i += 1) {
        info = list[i];
        key = ACC__clipCacheKey(seq, info);
        if (!key) continue;
        ACC__TIMELINE_APPLY_CACHE[key] = {
            labelId: labelId,
            mode: String(mode || ''),
            verified: meta.verified === false ? false : true,
            platform: ACC__trim(meta.platform || ''),
            route: ACC__trim(meta.route || '')
        };
    }
}

function ACC__normalizeVerificationText(value) {
    return ACC__trim(value)
        .replace(/&/g, '')
        .replace(/\u2026/g, '...')
        .replace(/\(\s*&?[^)]*\)/g, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function ACC__isVerifiedTimelineApply(mode, debugPayload) {
    var normalizedMode = ACC__trim(mode || '');
    var debugInfo = debugPayload && typeof debugPayload === 'object' ? debugPayload : {};
    var platform = ACC__trim(debugInfo.platform || '');
    var helper = debugInfo.helper && typeof debugInfo.helper === 'object' ? debugInfo.helper : {};
    var route = ACC__trim(helper.route || debugInfo.route || '');
    var requestedLabel = ACC__normalizeVerificationText(helper.requestedLabel || debugInfo.label || '');
    var clickedLabel = ACC__normalizeVerificationText(helper.clickedLabel || '');
    var matchedTopMenu = ACC__trim(helper.matchedTopMenu || '');
    var matchedSubMenu = ACC__trim(helper.matchedSubMenu || '');

    if (normalizedMode === 'native-menu' && platform === 'darwin') {
        if (route === 'applecript-menu-mac') {
            if (!requestedLabel || !clickedLabel || requestedLabel !== clickedLabel) {
                return false;
            }
            if (!matchedTopMenu || !matchedSubMenu) {
                return false;
            }
            return true;
        }
        if (route === 'menu-helper-mac-index') {
            return true;
        }
        return false;
    }
    if (route === 'legacy-menu-helper-mac') {
        return false;
    }
    return true;
}

function ACC__pendingScanId() {
    return 'acc_scan_' + String((new Date()).getTime()) + '_' + String(Math.floor(Math.random() * 100000));
}

function ACC__queuePendingScan(seq, groups) {
    var scanId = ACC__pendingScanId();
    var storedGroups = {};
    var summaries = [];
    var key;
    var labelId;
    for (key in groups) {
        if (!Object.prototype.hasOwnProperty.call(groups, key)) continue;
        labelId = parseInt(key, 10);
        if (!isFinite(labelId)) continue;
        storedGroups[String(labelId)] = groups[key] || [];
        summaries.push({
            labelId: labelId,
            label: ACC__LABEL_NAMES[labelId] || ('Label ' + String(labelId + 1)),
            color: ACC__LABEL_COLORS[labelId] || '#2dde73',
            count: (groups[key] && groups[key].length) ? groups[key].length : 0
        });
    }
    ACC__PENDING_SCANS[scanId] = {
        seq: seq,
        originalSelection: ACC__captureSelection(seq),
        groups: storedGroups
    };
    return {
        scanId: scanId,
        groups: summaries
    };
}

function ACC__sequenceTracker(sequenceId) {
    var key = ACC__trim(sequenceId) || '__active_sequence__';
    if (!ACC__SEQUENCE_TRACKERS[key]) {
        ACC__SEQUENCE_TRACKERS[key] = {
            signature: '',
            knownItems: {}
        };
    }
    return ACC__SEQUENCE_TRACKERS[key];
}

function ACC__defaultTrackerItemState() {
    return {
        managed: false,
        labelId: -1
    };
}

function ACC__setTrackerKnownItems(tracker, items) {
    var next = {};
    var key;
    if (!tracker) return;
    for (key in items) {
        if (!Object.prototype.hasOwnProperty.call(items, key)) continue;
        next[key] = tracker.knownItems && tracker.knownItems[key]
            ? tracker.knownItems[key]
            : ACC__defaultTrackerItemState();
    }
    tracker.knownItems = next;
}

function ACC__markTrackerInfos(seq, infos, labelId, managed) {
    var tracker = ACC__sequenceTracker(ACC__sequenceCacheKey(seq));
    var list = infos instanceof Array ? infos : [];
    var i;
    var info;
    var key = '';
    if (!tracker) return;
    for (i = 0; i < list.length; i += 1) {
        info = list[i];
        key = String(info && info.key ? info.key : '');
        if (!key) continue;
        if (!tracker.knownItems[key]) tracker.knownItems[key] = ACC__defaultTrackerItemState();
        tracker.knownItems[key].managed = !!managed;
        tracker.knownItems[key].labelId = managed ? labelId : -1;
    }
}

function ACC__getPendingScan(scanId) {
    var key = ACC__trim(scanId);
    if (!key || !ACC__PENDING_SCANS[key]) return null;
    return ACC__PENDING_SCANS[key];
}

function ACC__restorePendingSelection(scan) {
    if (!scan || !scan.seq) return;
    ACC__clearSelection(scan.seq);
    ACC__setSelection(scan.seq, scan.originalSelection || []);
}

function ACC__ruleMatches(rule, info) {
    if (!rule || !info) return false;
    if (rule.assetType && info.assetType !== rule.assetType) return false;
    if (rule.extensionCount > 0 && (!info.extension || !rule.extensionMap[info.extension])) return false;
    return true;
}

function ACC__evaluateApplyDecision(seq, rule, info) {
    var cached = ACC__getCachedApplyState(seq, info);
    var decision = {
        apply: false,
        reason: '',
        cachedState: cached ? {
            labelId: parseInt(cached.labelId, 10),
            mode: String(cached.mode || '')
        } : null,
        currentLabelId: info && info.currentLabelId !== undefined ? info.currentLabelId : -1,
        ruleLabelId: rule && rule.labelId !== undefined ? parseInt(rule.labelId, 10) : -1
    };
    if (!rule || !info) {
        decision.reason = 'missing-rule-or-info';
        return decision;
    }
    if (!rule.apply) {
        decision.reason = 'rule-apply-disabled';
        return decision;
    }
    if (cached && cached.mode === 'timeline') {
        if (cached.labelId === rule.labelId) {
            decision.reason = 'cached-timeline-same-label';
            return decision;
        }
        if (cached.labelId >= 0 && cached.labelId !== rule.labelId) {
            decision.apply = true;
            decision.reason = 'cached-timeline-different-label';
            return decision;
        }
    }
    if (cached && cached.mode === 'projectItem') {
        decision.apply = true;
        decision.reason = cached.labelId === rule.labelId ? 'cached-project-item-unverified-same-label' : 'cached-project-item-unverified-different-label';
        return decision;
    }
    decision.apply = true;
    if (info.currentLabelId === rule.labelId) {
        decision.reason = 'project-item-label-same-unverified';
    } else if (info.currentLabelId >= 0) {
        decision.reason = 'project-item-label-different-unverified';
    } else {
        decision.reason = 'project-item-label-unknown';
    }
    return decision;
}

function ACC__shouldApply(seq, rule, info) {
    return ACC__evaluateApplyDecision(seq, rule, info).apply;
}

function ACC__shouldApplyOnMonitorStart(seq, rule, info) {
    var cached = ACC__getCachedApplyState(seq, info);
    var cachedLabelId = -1;
    if (!rule || !info) return false;
    if (!rule.apply) return false;
    if (cached) {
        cachedLabelId = parseInt(cached.labelId, 10);
        if (cached.mode === 'timeline') {
            if (cachedLabelId === rule.labelId) return false;
            if (cachedLabelId >= 0 && cachedLabelId !== rule.labelId) return true;
        }
        if (cached.mode === 'projectItem') return true;
    }
    return true;
}

function ACC__fallbackProjectItemLabel(infos, labelId) {
    var count = 0;
    var seen = {};
    var i;
    var info;
    var item;
    var itemKey = '';
    for (i = 0; i < infos.length; i += 1) {
        info = infos[i];
        item = info && info.clip ? info.clip.projectItem : null;
        if (!item || typeof item.setColorLabel !== 'function') continue;
        itemKey = ACC__projectItemNodeId(item) || info.key;
        if (seen[itemKey]) continue;
        seen[itemKey] = 1;
        try {
            item.setColorLabel(labelId);
            count += 1;
        } catch (_eSet) {}
    }
    return count;
}

function ACC__applyLabelIndividually(seq, infos, labelId) {
    var list = infos instanceof Array ? infos : [];
    var i;
    var info;
    var appliedInfos = [];
    var failedInfos = [];
    for (i = 0; i < list.length; i += 1) {
        info = list[i];
        if (!info || !info.clip) continue;
        ACC__setSelection(seq, [info.clip]);
        try {
            app.executeCommand(ACC__LABEL_COMMAND_ID_BASE + labelId);
            ACC__appendLog('Single timeline label apply succeeded for "' + ACC__LABEL_NAMES[labelId] + '" on clip ' + String(info.key || ''));
            appliedInfos.push(info);
        } catch (_eApplySingle) {
            ACC__appendLog('Single timeline label apply failed for "' + ACC__LABEL_NAMES[labelId] + '" on clip ' + String(info.key || '') + ': ' + _eApplySingle.toString());
            ACC__logJson('Failed clip detail', ACC__describeClipInfo(info));
            failedInfos.push(info);
        }
    }
    if (appliedInfos.length) {
        ACC__setCachedApplyState(seq, appliedInfos, labelId, 'timeline');
        ACC__markTrackerInfos(seq, appliedInfos, labelId, true);
    }
    return {
        appliedCount: appliedInfos.length,
        appliedInfos: appliedInfos,
        failedInfos: failedInfos
    };
}

function ACC__applyLabelGroups(seq, groups) {
    var originalSelection = ACC__captureSelection(seq);
    var labelIds = [];
    var key;
    var li;
    var labelId;
    var infos;
    var clips;
    var i;
    var appliedCount = 0;
    var warnings = [];

    for (key in groups) {
        if (Object.prototype.hasOwnProperty.call(groups, key)) {
            labelIds.push(parseInt(key, 10));
        }
    }

    try {
        for (li = 0; li < labelIds.length; li += 1) {
            labelId = labelIds[li];
            infos = groups[labelId] || [];
            clips = [];
            for (i = 0; i < infos.length; i += 1) {
                if (infos[i] && infos[i].clip) clips.push(infos[i].clip);
            }
            if (!clips.length) continue;
            ACC__appendLog('Applying label group "' + ACC__LABEL_NAMES[labelId] + '" to ' + String(clips.length) + ' clip(s).');
            for (i = 0; i < infos.length; i += 1) {
                ACC__logJson('Label group clip', ACC__describeClipInfo(infos[i]));
            }
                ACC__setSelection(seq, clips);
                try {
                    app.executeCommand(ACC__LABEL_COMMAND_ID_BASE + labelId);
                    ACC__setCachedApplyState(seq, infos, labelId, 'timeline');
                    ACC__markTrackerInfos(seq, infos, labelId, true);
                    appliedCount += infos.length;
                    ACC__appendLog('Group timeline label apply succeeded for "' + ACC__LABEL_NAMES[labelId] + '".');
                } catch (eApply) {
                    var fallbackCount = 0;
                    var singleResult = null;
                var failedInfos = infos;
                ACC__appendLog('Group timeline label apply failed for "' + ACC__LABEL_NAMES[labelId] + '": ' + eApply.toString());
                try {
                    ACC__setSelection(seq, clips);
                    app.executeCommand(ACC__LABEL_COMMAND_ID_BASE + labelId);
                    ACC__setCachedApplyState(seq, infos, labelId, 'timeline');
                    ACC__markTrackerInfos(seq, infos, labelId, true);
                    appliedCount += infos.length;
                    ACC__appendLog('Group timeline label retry succeeded for "' + ACC__LABEL_NAMES[labelId] + '".');
                    continue;
                } catch (_eRetryApply) {
                    ACC__appendLog('Group timeline label retry failed for "' + ACC__LABEL_NAMES[labelId] + '": ' + _eRetryApply.toString());
                }
                singleResult = ACC__applyLabelIndividually(seq, infos, labelId);
                appliedCount += singleResult.appliedCount;
                failedInfos = singleResult.failedInfos;
                fallbackCount = ACC__fallbackProjectItemLabel(failedInfos, labelId);
                if (fallbackCount > 0) {
                    ACC__setCachedApplyState(seq, failedInfos, labelId, 'projectItem');
                    ACC__markTrackerInfos(seq, failedInfos, labelId, true);
                    appliedCount += fallbackCount;
                    ACC__appendLog('Project-item fallback applied for "' + ACC__LABEL_NAMES[labelId] + '" to ' + String(fallbackCount) + ' item(s).');
                    warnings.push('Timeline label command failed for "' + ACC__LABEL_NAMES[labelId] + '". Fell back to project-item label updates for ' + fallbackCount + ' item(s).');
                } else {
                    ACC__appendLog('All label apply paths failed for "' + ACC__LABEL_NAMES[labelId] + '".');
                    warnings.push('Could not apply label "' + ACC__LABEL_NAMES[labelId] + '": ' + eApply.toString());
                }
            }
        }
    } finally {
        ACC__clearSelection(seq);
        ACC__setSelection(seq, originalSelection);
    }

    return {
        appliedCount: appliedCount,
        warnings: warnings
    };
}

function ACC_preparePendingGroupApply(rawPayload) {
    return ET_wrap(function () {
        var payload = ACC__parsePayload(rawPayload);
        var scan = ACC__getPendingScan(payload && payload.scanId);
        var labelId = parseInt(payload && payload.labelId, 10);
        var infos;
        var clips = [];
        var i;
        if (!scan || !scan.seq) throw new Error('Pending scan not found.');
        if (!isFinite(labelId)) throw new Error('Label id is required.');
        infos = scan.groups[String(labelId)] || [];
        if (!infos.length) throw new Error('Pending label group is empty.');
        for (i = 0; i < infos.length; i += 1) {
            if (infos[i] && infos[i].clip) clips.push(infos[i].clip);
        }
        if (!clips.length) throw new Error('No clips available for pending label group.');
        ACC__setSelection(scan.seq, clips);
        ACC__appendLog('Prepared pending client apply for "' + (ACC__LABEL_NAMES[labelId] || ('Label ' + String(labelId + 1))) + '" on ' + String(clips.length) + ' clip(s).');
        ACC__logJson('Pending group prepared', {
            scanId: ACC__trim(payload && payload.scanId),
            labelId: labelId,
            label: ACC__LABEL_NAMES[labelId] || ('Label ' + String(labelId + 1)),
            count: clips.length,
            samples: ACC__describeClipStates(scan.seq, infos, 3)
        });
        return {
            labelId: labelId,
            label: ACC__LABEL_NAMES[labelId] || ('Label ' + String(labelId + 1)),
            color: ACC__LABEL_COLORS[labelId] || '#2dde73',
            count: clips.length,
            subMenu: {
                selected: 'lb' + String(labelId),
                label: ACC__LABEL_NAMES[labelId] || ('Label ' + String(labelId + 1)),
                labelid: labelId,
                labelId: labelId,
                color: ACC__LABEL_COLORS[labelId] || '#2dde73'
            }
        };
    });
}

function ACC_completePendingGroupApply(rawPayload) {
    return ET_wrap(function () {
        var payload = ACC__parsePayload(rawPayload);
        var scan = ACC__getPendingScan(payload && payload.scanId);
        var labelId = parseInt(payload && payload.labelId, 10);
        var success = !!(payload && payload.success);
        var mode = ACC__trim(payload && payload.mode);
        var reportedAppliedCount = parseInt(payload && payload.appliedCount, 10);
        var warningText = ACC__trim(payload && payload.warning);
        var debugPayload = payload && payload.debug ? payload.debug : null;
        var timelineVerified = false;
        var debugPlatform = ACC__trim(debugPayload && debugPayload.platform ? debugPayload.platform : '');
        var debugHelperRoute = ACC__trim(debugPayload && debugPayload.helper && debugPayload.helper.route ? debugPayload.helper.route : '');
        var infos;
        var fallbackCount = 0;
        if (!scan || !scan.seq) throw new Error('Pending scan not found.');
        if (!isFinite(labelId)) throw new Error('Label id is required.');
        infos = scan.groups[String(labelId)] || [];
        delete scan.groups[String(labelId)];
        ACC__logJson('Client label apply finalize payload', {
            scanId: ACC__trim(payload && payload.scanId),
            labelId: labelId,
            label: ACC__LABEL_NAMES[labelId] || ('Label ' + String(labelId + 1)),
            success: success,
            mode: mode,
            reportedAppliedCount: reportedAppliedCount,
            warning: warningText,
            debug: debugPayload,
            samplesBeforeFinalize: ACC__describeClipStates(scan.seq, infos, 3)
        });
        timelineVerified = ACC__isVerifiedTimelineApply(mode, debugPayload);
        if (success && mode !== 'projectItem') {
            if (!timelineVerified) {
                ACC__clearCachedApplyState(scan.seq, infos);
                ACC__appendLog('Client label apply returned success for "' + (ACC__LABEL_NAMES[labelId] || ('Label ' + String(labelId + 1))) + '" in unverified timeline mode "' + (mode || 'timeline') + '" on platform "' + (debugPlatform || 'unknown') + '". Cache was not updated.');
                ACC__logJson('Client label apply finalize result', {
                    outcome: 'timeline-unverified',
                    scanId: ACC__trim(payload && payload.scanId),
                    labelId: labelId,
                    appliedCount: 0,
                    warning: warningText || '',
                    platform: debugPlatform,
                    route: debugHelperRoute,
                    samplesAfterFinalize: ACC__describeClipStates(scan.seq, infos, 3)
                });
                return {
                    appliedCount: 0,
                    warning: warningText || ('Timeline label execution for "' + (ACC__LABEL_NAMES[labelId] || ('Label ' + String(labelId + 1))) + '" could not be verified on this platform, so EasyTimeline did not cache it as colorized.')
                };
            }
            if (!isFinite(reportedAppliedCount) || reportedAppliedCount < 0) {
                reportedAppliedCount = infos.length;
            }
            ACC__setCachedApplyState(scan.seq, infos, labelId, 'timeline', {
                verified: true,
                platform: debugPlatform,
                route: debugHelperRoute
            });
            ACC__markTrackerInfos(scan.seq, infos, labelId, true);
            ACC__appendLog('Client label apply succeeded for "' + (ACC__LABEL_NAMES[labelId] || ('Label ' + String(labelId + 1))) + '" on ' + String(reportedAppliedCount) + ' clip(s) using mode "' + (mode || 'timeline') + '".');
            ACC__logJson('Client label apply finalize result', {
                outcome: 'timeline',
                scanId: ACC__trim(payload && payload.scanId),
                labelId: labelId,
                appliedCount: reportedAppliedCount,
                warning: warningText || '',
                samplesAfterFinalize: ACC__describeClipStates(scan.seq, infos, 3)
            });
            return {
                appliedCount: reportedAppliedCount,
                warning: warningText || ''
            };
        }
        if (mode === 'projectItem') {
            if (!isFinite(reportedAppliedCount) || reportedAppliedCount < 0) {
                reportedAppliedCount = 0;
            }
            if (reportedAppliedCount < 1) {
                reportedAppliedCount = ACC__fallbackProjectItemLabel(infos, labelId);
            }
            if (reportedAppliedCount > 0) {
                ACC__setCachedApplyState(scan.seq, infos, labelId, 'projectItem', {
                    verified: false,
                    platform: debugPlatform,
                    route: debugHelperRoute
                });
                ACC__markTrackerInfos(scan.seq, infos, labelId, true);
                ACC__appendLog('Client label apply completed in project-item mode for "' + (ACC__LABEL_NAMES[labelId] || ('Label ' + String(labelId + 1))) + '" on ' + String(reportedAppliedCount) + ' item(s).');
                ACC__logJson('Client label apply finalize result', {
                    outcome: 'projectItem',
                    scanId: ACC__trim(payload && payload.scanId),
                    labelId: labelId,
                    appliedCount: reportedAppliedCount,
                    warning: warningText || '',
                    samplesAfterFinalize: ACC__describeClipStates(scan.seq, infos, 3)
                });
                return {
                    appliedCount: reportedAppliedCount,
                    warning: warningText || ('Premiere did not expose a timeline label command for "' + (ACC__LABEL_NAMES[labelId] || ('Label ' + String(labelId + 1))) + '". EasyTimeline updated the source project items instead.')
                };
            }
        }
        fallbackCount = ACC__fallbackProjectItemLabel(infos, labelId);
        if (fallbackCount > 0) {
            ACC__setCachedApplyState(scan.seq, infos, labelId, 'projectItem', {
                verified: false,
                platform: debugPlatform,
                route: debugHelperRoute
            });
            ACC__markTrackerInfos(scan.seq, infos, labelId, true);
            ACC__appendLog('Client label apply failed for "' + (ACC__LABEL_NAMES[labelId] || ('Label ' + String(labelId + 1))) + '". Project-item fallback touched ' + String(fallbackCount) + ' item(s).');
            ACC__logJson('Client label apply finalize result', {
                outcome: 'projectItem-fallback',
                scanId: ACC__trim(payload && payload.scanId),
                labelId: labelId,
                appliedCount: fallbackCount,
                warning: warningText || '',
                samplesAfterFinalize: ACC__describeClipStates(scan.seq, infos, 3)
            });
            return {
                appliedCount: fallbackCount,
                warning: 'Timeline label command failed for "' + (ACC__LABEL_NAMES[labelId] || ('Label ' + String(labelId + 1))) + '". Fell back to project-item label updates for ' + String(fallbackCount) + ' item(s).'
            };
        }
        ACC__appendLog('Client label apply failed for "' + (ACC__LABEL_NAMES[labelId] || ('Label ' + String(labelId + 1))) + '" with no fallback changes.');
        ACC__logJson('Client label apply finalize result', {
            outcome: 'failed',
            scanId: ACC__trim(payload && payload.scanId),
            labelId: labelId,
            appliedCount: 0,
            warning: warningText || '',
            samplesAfterFinalize: ACC__describeClipStates(scan.seq, infos, 3)
        });
        return {
            appliedCount: 0,
            warning: 'Could not apply label "' + (ACC__LABEL_NAMES[labelId] || ('Label ' + String(labelId + 1))) + '".'
        };
    });
}

function ACC_disposePendingScan(rawPayload) {
    return ET_wrap(function () {
        var payload = ACC__parsePayload(rawPayload);
        var scanId = ACC__trim(payload && payload.scanId);
        var scan = ACC__getPendingScan(scanId);
        if (scan) {
            ACC__restorePendingSelection(scan);
            delete ACC__PENDING_SCANS[scanId];
            ACC__appendLog('Disposed pending scan ' + scanId + '.');
        }
        return true;
    });
}

function ACC_getBootstrap() {
    return ET_wrap(function () {
        return {
            labels: ACC__labelPalette(),
            defaultLabelId: ACC__DEFAULT_LABEL_ID
        };
    });
}

function ACC_getMonitorState(rawPayload) {
    return ET_wrap(function () {
        var payload = ACC__parsePayload(rawPayload);
        var options = ACC__normalizeOptions(payload && payload.options);
        var seq = ACC__activeSequenceOrNull();
        return ACC__buildSequenceMonitorState(seq, options);
    });
}

function ACC_monitorAndMaybeApply(rawPayload) {
    return ET_wrap(function () {
        var payload = ACC__parsePayload(rawPayload);
        var rules = ACC__normalizeRules(payload && payload.rules);
        var options = ACC__normalizeOptions(payload && payload.options);
        var seq = ACC__activeSequenceOrNull();
        var result = {
            status: 'idle',
            message: '',
            sequenceName: '',
            sequenceId: '',
            checked: 0,
            matched: 0,
            colorized: 0,
            skippedLockedClips: 0,
            warnings: [],
            labels: ACC__labelPalette(),
            defaultLabelId: ACC__DEFAULT_LABEL_ID,
            signature: ''
        };
        var index;
        var tracker;
        var knownItems = null;
        var currentItems = null;
        var key = '';
        var entry = null;
        var trackerInfo = null;
        var candidates = [];
        var groups = {};
        var info = null;
        var matchedRule = null;
        var ruleIndex = 0;
        var pending = null;
        var applyResult = null;

        if (!seq) {
            result.status = 'no-sequence';
            result.message = 'No active sequence';
            return result;
        }

        if (!rules.length) {
            result.status = 'no-rules';
            result.message = 'No rules configured';
            return result;
        }

        index = ACC__buildSequenceIndex(seq, options);
        result.sequenceName = index.sequenceName;
        result.sequenceId = index.sequenceId;
        result.skippedLockedClips = index.skippedLockedClips;
        result.signature = index.signature;
        tracker = ACC__sequenceTracker(index.sequenceId);

        if (!tracker.signature) {
            ACC__setTrackerKnownItems(tracker, index.items);
            tracker.signature = index.signature;
            result.status = 'primed';
            result.message = 'Tracker primed';
            ACC__appendLog('Auto Clip Colorizer monitor primed for sequence "' + result.sequenceName + '" with ' + String(index.clipCount) + ' known item(s).');
            return result;
        }

        if (tracker.signature === index.signature) {
            result.status = 'unchanged';
            result.message = 'No timeline changes';
            return result;
        }

        ACC__appendLog('--- Auto Clip Colorizer monitor-triggered scan start ---');
        ACC__logJson('Monitor scan context', {
            sequenceName: result.sequenceName,
            sequenceId: result.sequenceId,
            signature: result.signature,
            previousSignature: tracker.signature,
            excludeLockedTracks: options.excludeLockedTracks
        });

        knownItems = tracker.knownItems || {};
        currentItems = index.items || {};
        for (key in currentItems) {
            if (!Object.prototype.hasOwnProperty.call(currentItems, key)) continue;
            entry = currentItems[key];
            info = ACC__clipInfo(entry.clip, entry.trackType, entry.trackIndex, entry.clipIndex);
            matchedRule = null;
            for (ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
                if (ACC__ruleMatches(rules[ruleIndex], info)) {
                    matchedRule = rules[ruleIndex];
                    break;
                }
            }
            trackerInfo = knownItems[key];
            if (!trackerInfo) {
                candidates.push({
                    info: info,
                    rule: matchedRule,
                    reason: 'new'
                });
                continue;
            }
            if (trackerInfo.managed && matchedRule && parseInt(trackerInfo.labelId, 10) !== matchedRule.labelId) {
                candidates.push({
                    info: info,
                    rule: matchedRule,
                    reason: 'label-change'
                });
            }
        }

        ACC__setTrackerKnownItems(tracker, currentItems);
        tracker.signature = index.signature;
        result.checked = candidates.length;

        if (!candidates.length) {
            result.status = 'unchanged';
            result.message = 'No new timeline items';
            ACC__appendLog('Monitor change detected but no new or changed managed timeline items required processing.');
            ACC__appendLog('--- Auto Clip Colorizer monitor-triggered scan end ---');
            return result;
        }

        for (key = 0; key < candidates.length; key += 1) {
            info = candidates[key].info;
            matchedRule = candidates[key].rule;
            if (!matchedRule) continue;
            result.matched += 1;
            if (!ACC__shouldApply(seq, matchedRule, info)) continue;
            if (!groups[matchedRule.labelId]) groups[matchedRule.labelId] = [];
            groups[matchedRule.labelId].push(info);
        }

        entry = null;
        for (key in groups) {
            if (Object.prototype.hasOwnProperty.call(groups, key)) {
                entry = groups[key];
                break;
            }
        }
        if (!entry || !entry.length) {
            result.status = 'unchanged';
            result.message = 'No new matching timeline items';
            ACC__appendLog('Monitor change detected, but no candidate items required recolorization.');
            ACC__appendLog('--- Auto Clip Colorizer monitor-triggered scan end ---');
            return result;
        }

        if (typeof app.executeCommand !== 'function') {
            pending = ACC__queuePendingScan(seq, groups);
            result.pendingScanId = pending.scanId;
            result.pendingGroups = pending.groups;
            result.clientApplyRequired = true;
            result.status = 'ok';
            result.message = 'Scan complete';
            ACC__logJson('Monitor scan result', {
                checked: result.checked,
                matched: result.matched,
                colorized: 0,
                skippedLockedClips: result.skippedLockedClips,
                pendingScanId: result.pendingScanId,
                pendingGroups: result.pendingGroups
            });
            ACC__appendLog('--- Auto Clip Colorizer monitor-triggered scan end ---');
            return result;
        }

        applyResult = ACC__applyLabelGroups(seq, groups);
        result.colorized = applyResult.appliedCount;
        result.warnings = applyResult.warnings || [];
        result.status = 'ok';
        result.message = 'Scan complete';
        ACC__logJson('Monitor scan result', {
            checked: result.checked,
            matched: result.matched,
            colorized: result.colorized,
            skippedLockedClips: result.skippedLockedClips,
            warnings: result.warnings
        });
        ACC__appendLog('--- Auto Clip Colorizer monitor-triggered scan end ---');
        return result;
    });
}

function ACC_scanAndApply(rawPayload) {
    return ET_wrap(function () {
        var payload = ACC__parsePayload(rawPayload);
        var rules = ACC__normalizeRules(payload && payload.rules);
        var options = ACC__normalizeOptions(payload && payload.options);
        var seq = ACC__activeSequenceOrNull();
        var result = {
            status: 'idle',
            message: '',
            sequenceName: '',
            sequenceId: '',
            checked: 0,
            matched: 0,
            colorized: 0,
            projectItemManaged: 0,
            skippedLockedClips: 0,
            warnings: [],
            labels: ACC__labelPalette(),
            defaultLabelId: ACC__DEFAULT_LABEL_ID
        };
        var scanState;
        var applyResult;
        var tracker;
        var currentIndex;

        if (!seq) {
            ACC__appendLog('Scan aborted: no active sequence.');
            result.status = 'no-sequence';
            result.message = 'No active sequence';
            return result;
        }

        result.sequenceName = ACC__trim(seq.name || '');
        try { result.sequenceId = String(seq.sequenceID || ''); } catch (_eSeqId) {}
        ACC__appendLog('--- Auto Clip Colorizer scan start ---');
        ACC__logJson('Scan context', {
            sequenceName: result.sequenceName,
            sequenceId: result.sequenceId,
            reason: payload && payload.options ? payload.options.reason : '',
            enabled: payload && payload.options ? !!payload.options.enabled : false,
            autoMonitor: payload && payload.options ? !!payload.options.autoMonitor : false,
            excludeLockedTracks: options.excludeLockedTracks,
            forceAssetType: options.forceAssetType,
            initialMonitorCatchup: options.initialMonitorCatchup
        });
        ACC__logJson('Rules', rules);

        if (!rules.length) {
            ACC__appendLog('Scan aborted: no rules configured.');
            result.status = 'no-rules';
            result.message = 'No rules configured';
            return result;
        }

        scanState = ACC__collectScanState(seq, rules, options);
        currentIndex = ACC__buildSequenceIndex(seq, {
            excludeLockedTracks: options.excludeLockedTracks,
            forceAssetType: ''
        });
        tracker = ACC__sequenceTracker(scanState.sequenceId);
        ACC__setTrackerKnownItems(tracker, currentIndex.items);
        tracker.signature = scanState.signature;
        result.sequenceName = scanState.sequenceName;
        result.sequenceId = scanState.sequenceId;
        result.checked = scanState.checked;
        result.matched = scanState.matched;
        result.projectItemManaged = scanState.projectItemManaged;
        result.skippedLockedClips = scanState.skippedLockedClips;
        if (scanState.projectItemManaged > 0) {
            result.warnings.push('Some matching clips were previously updated via source project-item labels, not verified timeline clip labels. Timeline colors only mirror source labels when "Show Source Clip Name and Label" is enabled.');
        }

        if (typeof app.executeCommand !== 'function') {
            var pending = ACC__queuePendingScan(seq, scanState.groups);
            result.pendingScanId = pending.scanId;
            result.pendingGroups = pending.groups;
            result.clientApplyRequired = true;
            result.status = 'ok';
            result.message = 'Scan complete';
            ACC__logJson('Scan result', {
                checked: result.checked,
                matched: result.matched,
                colorized: 0,
                skippedLockedClips: result.skippedLockedClips,
                pendingScanId: result.pendingScanId,
                pendingGroups: result.pendingGroups
            });
            ACC__appendLog('--- Auto Clip Colorizer scan end ---');
            return result;
        }

        applyResult = ACC__applyLabelGroups(seq, scanState.groups);
        result.colorized = applyResult.appliedCount;
        result.warnings = applyResult.warnings || [];
        result.status = 'ok';
        result.message = 'Scan complete';
        ACC__logJson('Scan result', {
            checked: result.checked,
            matched: result.matched,
            colorized: result.colorized,
            skippedLockedClips: result.skippedLockedClips,
            warnings: result.warnings
        });
        ACC__appendLog('--- Auto Clip Colorizer scan end ---');
        return result;
    });
}
