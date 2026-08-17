if (!Array.prototype.indexOf) {
    Array.prototype.indexOf = function(item, from) {
        var len = this.length >>> 0;
        var i = (from < 0) ? Math.max(0, len + from) : (from || 0);
        for (; i < len; i++) {
            if (i in this && this[i] === item) return i;
        }
        return -1;
    };
}

function arrayContains(arr, val) {
    if (!arr) return false;
    for (var k = 0; k < arr.length; k++) {
        if (arr[k] === val) return true;
    }
    return false;
}

#include "easytimeline/main.jsx"

function findItemInBin(name, bin) {
    if (!bin || !bin.children) return null;
    var num = bin.children.numItems;
    var decoded = decodeURI(name);
    var baseName = name;
    var lastDot = name.lastIndexOf(".");
    if (lastDot > 0) baseName = name.substring(0, lastDot);
    var decodedBase = decodeURI(baseName);

    // Search backwards: newest imported items are at the end
    for (var i = num - 1; i >= 0; i--) {
        var item = bin.children[i];
        if (item) {
            if (item.name === name || item.name === decoded || item.name === baseName || item.name === decodedBase) {
                return item;
            }
        }
    }
    return null;
}

function findItemByName(name, item) {
    if (!item) return null;
    
    var decoded = decodeURI(name);
    var baseName = name;
    var lastDot = name.lastIndexOf(".");
    if (lastDot > 0) baseName = name.substring(0, lastDot);
    var decodedBase = decodeURI(baseName);

    if (item.name === name || item.name === decoded) return item;
    if (item.name === baseName || item.name === decodedBase) {
        if (!item.children || item.children.numItems === 0) return item;
    }

    if (item.children && item.children.numItems > 0) {
        for (var i = 0; i < item.children.numItems; i++) {
            var found = findItemByName(name, item.children[i]);
            if (found) return found;
        }
    }
    return null;
}

function importSound(filePath, uiTrackIdx) {
    if (!app.project) {
        return "No project open.";
    }

    var seq = app.project.activeSequence;
    if (!seq) {
        return "No active sequence.";
    }

    var file = new File(filePath);
    if (!file.exists) {
        return "File not found: " + filePath;
    }

    var targetBin = app.project.getInsertionBin();

    // 1. Fast Bin Lookup
    var projectItem = findItemInBin(file.name, targetBin) || findItemByName(file.name, app.project.rootItem);

    // 2. Import if not found
    if (!projectItem) {
        app.project.importFiles([filePath], true, targetBin, false);
        projectItem = findItemInBin(file.name, targetBin) || findItemByName(file.name, app.project.rootItem);
    }

    if (!projectItem) {
        return "Failed to locate imported item in Project Panel.";
    }

    // 3. Fast Target Audio Track Insertion
    var playerPos = seq.getPlayerPosition();
    
    // Determine num audio tracks and default behavior
    var numAudioTracks = seq.audioTracks.numTracks;
    if (numAudioTracks <= 0) {
        return "NoAudioTrackAvailable";
    }

    // uiTrackIdx: 0 means Auto (use last track). 1..N correspond to Track 1..N (human-facing).
    var parsedUi = (typeof uiTrackIdx !== 'undefined' && uiTrackIdx !== null) ? parseInt(uiTrackIdx, 10) : 0;
    if (isNaN(parsedUi)) parsedUi = 0;

    var targetTrackIdx;
    if (parsedUi === 0) {
        // Auto behavior: insert on last audio track
        targetTrackIdx = Math.max(0, numAudioTracks - 1);
    } else {
        // User selected Track X (1-based) -> convert to 0-based index and clamp
        targetTrackIdx = Math.max(0, Math.min(numAudioTracks - 1, parsedUi - 1));
    }

    var trackToUse = seq.audioTracks[targetTrackIdx];
    trackToUse.insertClip(projectItem, playerPos);
    return "SequenceInsertSuccess";
}

function copyFolderRecursively(srcPath, destPath) {
    try {
        var srcFolder = new Folder(srcPath);
        var destFolder = new Folder(destPath);
        if (!srcFolder.exists) return "Source folder does not exist.";
        if (!destFolder.exists) destFolder.create();

        var targetFolder = new Folder(destFolder.fsName + "/" + srcFolder.name);
        if (!targetFolder.exists) {
            targetFolder.create();
        }

        var files = srcFolder.getFiles();
        if (!files) return "Could not read files.";

        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (f.name.indexOf(".") === 0) continue;

            if (f instanceof Folder) {
                copyFolderRecursively(f.fsName, targetFolder.fsName);
            } else if (f instanceof File) {
                var nameLower = f.name.toLowerCase();
                if (nameLower.indexOf(".mp3") > 0 || nameLower.indexOf(".wav") > 0) {
                    f.copy(targetFolder.fsName + "/" + f.name);
                }
            }
        }
        return "Success";
    } catch(e) {
        return "Copy Error: " + e.toString();
    }
}

function triggerAutoSync() {
    try {
        if (!app.project) return "No project open";
        var seq = app.project.activeSequence;
        if (!seq) return "Vui lòng chọn 1 Timeline (Sequence).";
        
        app.executeConsoleCommand("Con.executeMenuCommand Synchronize");
        return "SyncSuccess";
    } catch(e) {
        return e.toString();
    }
}

function getSyncTasks() {
    try {
        if (!app.project) return '{"error": "Không có project được mở"}';
        var seq = app.project.activeSequence;
        if (!seq) return '{"error": "Không có Timeline nào đang hoạt động"}';
        
        var sel = seq.getSelection();
        if (!sel || sel.length < 2) {
            return '{"error": "Bạn cần phải bôi đen ít nhất 2 clip (gồm Video và Audio rời) để đồng bộ!"}';
        }
        
        var videoPaths = [];
        var audioPaths = [];
        
        for (var i = 0; i < sel.length; i++) {
            if (!sel[i].projectItem) continue;
            var path = sel[i].projectItem.getMediaPath();
            if (!path) continue;
            
            if (sel[i].mediaType === "Video") {
                if (!arrayContains(videoPaths, path)) videoPaths.push(path);
            } else if (sel[i].mediaType === "Audio") {
                if (!arrayContains(audioPaths, path)) audioPaths.push(path);
            }
        }
        
        var pureAudioPaths = [];
        for (var j = 0; j < audioPaths.length; j++) {
            if (!arrayContains(videoPaths, audioPaths[j])) {
                pureAudioPaths.push(audioPaths[j]);
            }
        }

        if (videoPaths.length === 0) {
            return '{"error": "Không tìm thấy Video nào trong vùng chọn làm mỏ neo."}';
        }
        if (pureAudioPaths.length === 0) {
            return '{"error": "Không tìm thấy file Âm thanh rời nào."}';
        }
        
        return JSON.stringify({ 
            success: true, 
            refs: videoPaths, 
            tgts: pureAudioPaths 
        });
    } catch(e) {
        return JSON.stringify({"error": "Lỗi ExtendScript: " + e.toString()});
    }
}

function applyOffsetToClips(matchDataStr) {
    try {
        var matchObj = JSON.parse(matchDataStr);
        var tgtPathStr = matchObj.tgt_path;
        var refPathStr = matchObj.ref_path;
        var offsetSeconds = parseFloat(matchObj.offset_sec);
        
        if (isNaN(offsetSeconds)) return '{"error": "Dữ liệu độ dời thời gian không hợp lệ."}';
        
        var seq = app.project.activeSequence;
        var sel = seq.getSelection();
        if (!sel || sel.length < 2) return '{"error": "Vùng chọn đã bị hủy."}';
        
        var refClip = null;
        
        for (var i = 0; i < sel.length; i++) {
            if (sel[i].projectItem && sel[i].projectItem.getMediaPath() === refPathStr) {
                if (!refClip || parseFloat(sel[i].inPoint.seconds) < parseFloat(refClip.inPoint.seconds)) {
                   refClip = sel[i];
                }
            }
        }
        if (!refClip) return '{"error": "Không tìm thấy clip gốc làm mỏ neo trên timeline."}';
        
        var refStart = parseFloat(refClip.start.seconds);
        var refIn = parseFloat(refClip.inPoint.seconds);
        
        var count = 0;
        for (var k = 0; k < sel.length; k++) {
            var clip = sel[k];
            if (clip.projectItem && clip.projectItem.getMediaPath() === tgtPathStr) {
                var tgtStart = parseFloat(clip.start.seconds);
                var tgtIn = parseFloat(clip.inPoint.seconds);
                var targetAbsoluteStart = refStart - refIn + offsetSeconds + tgtIn;
                
                if (targetAbsoluteStart < 0) {
                    return '{"error": "Khoảng cách vượt mốc 0:00 của Audio. Hãy kéo Video sang phải một chút!"}';
                }
                
                var delta = targetAbsoluteStart - tgtStart;
                if (Math.abs(delta) > 0.001) {
                     clip.move(delta);
                     count++;
                }
            }
        }
        
        return JSON.stringify({ "success": true, "count": count });
    } catch(e) {
        return JSON.stringify({ "error": e.toString() });
    }
}

var MOTION_CTX = {};

function applyMotionPreset_Step1(presetPath) {
    try {
        if (!app.project) return "No project open.";
        
        var file = new File(presetPath);
        if (!file.exists) return "Preset file not found.";
        
        var nameLower = file.name.toLowerCase();
        
        if (nameLower.indexOf('.mogrt') > 0) {
            var seq = app.project.activeSequence;
            if (!seq) return "Vui lòng mở Sequence trước.";
            var time = seq.getPlayerPosition();
            var success = seq.importMGT(presetPath, time.ticks, seq.videoTracks.numTracks > 0 ? seq.videoTracks.numTracks - 1 : 0, 0);
            return success ? "DONE_MOGRT" : "FAILED_MOGRT";
        } 
        else if (nameLower.indexOf('.prproj') > 0) {
            var activeSeq = app.project.activeSequence;
            if (!activeSeq) return "Vui lòng mở Sequence trước.";

            var prevSeqIDs = {};
            for (var i = 0; i < app.project.sequences.numSequences; i++) {
                prevSeqIDs[app.project.sequences[i].sequenceID] = true;
            }

            app.project.importFiles([presetPath], true, app.project.rootItem, false);

            var insertedSeq = null;
            for (var j = 0; j < app.project.sequences.numSequences; j++) {
                if (!prevSeqIDs[app.project.sequences[j].sequenceID]) {
                    insertedSeq = app.project.sequences[j];
                    break;
                }
            }

            if (!insertedSeq) return "Lỗi: Không tìm thấy Sequence nhúng từ Preset.";

            MOTION_CTX.activeSeqId = activeSeq.sequenceID;
            MOTION_CTX.insertedSeqId = insertedSeq.sequenceID;
            
            insertedSeq.projectItem.name = file.name + "_TESU_IMPORTED";

            app.project.openSequence(insertedSeq.sequenceID);

            var clipsToSelect = [];
            for (var v = 0; v < insertedSeq.videoTracks.numTracks; v++) {
                var track = insertedSeq.videoTracks[v];
                for (var c = 0; c < track.clips.numItems; c++) {
                    clipsToSelect.push(track.clips[c]);
                }
            }
            for (var a = 0; a < insertedSeq.audioTracks.numTracks; a++) {
                var aTrack = insertedSeq.audioTracks[a];
                for (var ac = 0; ac < aTrack.clips.numItems; ac++) {
                    clipsToSelect.push(aTrack.clips[ac]);
                }
            }
            insertedSeq.setSelection(clipsToSelect);
            
            return "READY_FOR_COPY";
        }
        return "UNSUPPORTED";
    } catch(e) {
        return "Exception: " + e.toString();
    }
}

function applyMotionPreset_Step2() {
    try {
        if (!MOTION_CTX.activeSeqId) return "Lỗi: Không tìm thấy ID Sequence gốc.";
        app.project.openSequence(MOTION_CTX.activeSeqId);
        return "READY_FOR_PASTE";
    } catch(e) {
        return "Exception: " + e.toString();
    }
}
