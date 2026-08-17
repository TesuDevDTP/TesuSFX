function Imp_importImagesToTimeline(filePathsJSON, duration, gap, operationId) {
    try {
        // Check if project exists
        if (!app.project) {
            return ET_fail("No project open");
        }
        
        // Check if there's an active sequence
        var sequence = app.project.activeSequence;
        if (!sequence) {
            return ET_fail("No active sequence. Please create or open a sequence first.");
        }
        
        // Parse the file paths
        var filePaths = JSON.parse(filePathsJSON);
        
        if (!filePaths || filePaths.length === 0) {
            return ET_fail("No files provided");
        }
        
        // Get count of items before import
        var itemsBeforeImport = app.project.rootItem.children.numItems;
        
        // Import all files at once to project
        var success = app.project.importFiles(filePaths, true, app.project.rootItem, false);
        
        if (!success) {
            return ET_fail("Failed to import files");
        }
        
        // Get the newly imported items
        var projectItems = app.project.rootItem.children;
        var importedItems = [];
        
        for (var i = itemsBeforeImport; i < projectItems.numItems; i++) {
            importedItems.push(projectItems[i]);
        }
        
        if (importedItems.length === 0) {
            return ET_fail("No items were imported");
        }
        
        // Get the current playhead position
        var insertTime = sequence.getPlayerPosition().seconds;
        
        // Use provided duration or default to 5 seconds
        var clipDuration = duration || 5;
        var gapDuration = gap || 0;
        
        // Calculate approximate total duration needed for space checking
        // We'll estimate by assuming worst case (all items use custom duration)
        var totalDuration = (clipDuration + gapDuration) * importedItems.length;
        var endTime = insertTime + totalDuration;
        
        // Check if any items have audio (check before track searching)
        var hasAnyAudio = false;
        for (var checkAudio = 0; checkAudio < importedItems.length; checkAudio++) {
            try {
                if (importedItems[checkAudio].type == 1) { // ProjectItemType.CLIP
                    // Assume clips may have audio unless proven otherwise
                    hasAnyAudio = true;
                    break;
                }
            } catch (e) {
                // If we can't check, assume it might have audio to be safe
                hasAnyAudio = true;
                break;
            }
        }
        
        // Find a video track with enough empty space
        // If items have audio, also check that the corresponding audio track is empty
        var videoTrack = null;
        var audioTrack = null;
        var trackIndex = -1;
        var foundEmptyTrack = false;
        
        // Check existing tracks for empty space in the required range
        for (var t = 0; t < sequence.videoTracks.numTracks; t++) {
            var track = sequence.videoTracks[t];
            var videoHasSpace = true;
            var audioHasSpace = true;
            
            // Check if any clip on this video track overlaps with our needed range
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                var clipStart = clip.start.seconds;
                var clipEnd = clip.end.seconds;
                
                // Check if this clip overlaps with our range [insertTime, endTime]
                if ((clipStart < endTime && clipEnd > insertTime)) {
                    videoHasSpace = false;
                    break;
                }
            }
            
            // If video track has space and items might have audio, check the corresponding audio track
            if (videoHasSpace && hasAnyAudio) {
                // Make sure audio track exists at this index
                if (t < sequence.audioTracks.numTracks) {
                    var testAudioTrack = sequence.audioTracks[t];
                    
                    // Check if any clip on this audio track overlaps with our needed range
                    for (var ac = 0; ac < testAudioTrack.clips.numItems; ac++) {
                        var audioClip = testAudioTrack.clips[ac];
                        var audioClipStart = audioClip.start.seconds;
                        var audioClipEnd = audioClip.end.seconds;
                        
                        // Check if this audio clip overlaps with our range
                        if ((audioClipStart < endTime && audioClipEnd > insertTime)) {
                            audioHasSpace = false;
                            break;
                        }
                    }
                } else {
                    // Audio track doesn't exist at this index, we'll need to create it
                    audioHasSpace = true;
                }
            }
            
            // Both video and audio tracks must have space
            if (videoHasSpace && audioHasSpace) {
                videoTrack = track;
                trackIndex = t;
                foundEmptyTrack = true;
                break;
            }
        }
        
        // If no track pair has enough space, create new tracks
        if (!foundEmptyTrack) {
            sequence.videoTracks.add();
            videoTrack = sequence.videoTracks[sequence.videoTracks.numTracks - 1];
            trackIndex = sequence.videoTracks.numTracks - 1;
            
            // If items have audio, ensure we have matching audio track
            if (hasAnyAudio) {
                // Create audio tracks to match video track count
                while (sequence.audioTracks.numTracks < sequence.videoTracks.numTracks) {
                    sequence.audioTracks.add();
                }
            }
        }
        
        // Get the audio track at the same index
        if (trackIndex >= 0 && trackIndex < sequence.audioTracks.numTracks) {
            audioTrack = sequence.audioTracks[trackIndex];
        } else if (trackIndex >= 0) {
            // Create audio track if it doesn't exist
            while (sequence.audioTracks.numTracks <= trackIndex) {
                sequence.audioTracks.add();
            }
            audioTrack = sequence.audioTracks[trackIndex];
        }
        
        // Add each imported item to the timeline sequentially
        var currentInsertTime = insertTime;
        
        for (var j = 0; j < importedItems.length; j++) {
            ET__throwIfOperationCancelled(operationId, "Media import");
            var item = importedItems[j];
            
            // Determine if this is audio-only, video-only, or both
            var isAudioOnly = item.hasAudio && !item.hasVideo;
            var targetTrack = null;
            var insertedClip = null;
            
            if (isAudioOnly) {
                // Insert into audio track
                if (audioTrack) {
                    audioTrack.insertClip(item, currentInsertTime);
                    
                    // Get the inserted audio clip
                    if (audioTrack.clips.numItems > 0) {
                        insertedClip = audioTrack.clips[audioTrack.clips.numItems - 1];
                    }
                }
            } else {
                // Insert into video track (handles images and videos with/without audio)
                videoTrack.insertClip(item, currentInsertTime);
                
                // Get the inserted clip
                if (videoTrack.clips.numItems > 0) {
                    insertedClip = videoTrack.clips[videoTrack.clips.numItems - 1];
                }
            }
            
            // Calculate next position based on clip type
            if (insertedClip) {
                // Check if this is a still image (needs custom duration)
                var isStillImage = false;
                try {
                    var name = item.name.toLowerCase();
                    if (name.match(/\.(jpg|jpeg|png|gif|bmp|tif|tiff|psd)$/)) {
                        isStillImage = true;
                    }
                } catch (e) {
                    isStillImage = false;
                }
                
                // Only apply custom duration to still images
                if (isStillImage) {
                    insertedClip.end = insertedClip.start.seconds + clipDuration;
                    currentInsertTime = insertedClip.end.seconds + gapDuration;
                } else {
                    // For video/audio, use native duration and add gap
                    currentInsertTime = insertedClip.end.seconds + gapDuration;
                }
            } else {
                // Fallback if we couldn't get the clip
                currentInsertTime += clipDuration + gapDuration;
            }
        }
        
        return ET_ok(true);
        
    } catch (e) {
        return ET_fail(e.toString());
    }
}

// Import Audio-Only Files to Timeline
function Imp_importAudioToTimeline(filePathsJSON, gap) {
    try {
        // Check if project exists
        if (!app.project) {
            return ET_fail("No project open");
        }
        
        // Check if there's an active sequence
        var sequence = app.project.activeSequence;
        if (!sequence) {
            return ET_fail("No active sequence. Please create or open a sequence first.");
        }
        
        // Parse the file paths
        var filePaths = JSON.parse(filePathsJSON);
        
        if (!filePaths || filePaths.length === 0) {
            return ET_fail("No files provided");
        }
        
        // Get count of items before import
        var itemsBeforeImport = app.project.rootItem.children.numItems;
        
        // Import all files at once to project
        var success = app.project.importFiles(filePaths, true, app.project.rootItem, false);
        
        if (!success) {
            return ET_fail("Failed to import files");
        }
        
        // Get the newly imported items
        var projectItems = app.project.rootItem.children;
        var importedItems = [];
        
        for (var i = itemsBeforeImport; i < projectItems.numItems; i++) {
            importedItems.push(projectItems[i]);
        }
        
        if (importedItems.length === 0) {
            return ET_fail("No items were imported");
        }
        
        // Get the current playhead position
        var insertTime = sequence.getPlayerPosition().seconds;
        var gapDuration = gap || 0;
        
        // Find first empty audio track
        var audioTrack = null;
        var foundEmptyTrack = false;
        
        for (var t = 0; t < sequence.audioTracks.numTracks; t++) {
            if (sequence.audioTracks[t].clips.numItems === 0) {
                audioTrack = sequence.audioTracks[t];
                foundEmptyTrack = true;
                break;
            }
        }
        
        // If no empty track found, create one
        if (!foundEmptyTrack) {
            sequence.audioTracks.add();
            audioTrack = sequence.audioTracks[sequence.audioTracks.numTracks - 1];
        }
        
        // Add each audio file to the timeline sequentially
        var currentInsertTime = insertTime;
        
        for (var j = 0; j < importedItems.length; j++) {
            var item = importedItems[j];
            
            // Insert the clip at the calculated time
            audioTrack.insertClip(item, currentInsertTime);
            
            // Get the inserted clip and calculate next position
            if (audioTrack.clips.numItems > 0) {
                var insertedClip = audioTrack.clips[audioTrack.clips.numItems - 1];
                // Use native audio duration and add gap
                currentInsertTime = insertedClip.end.seconds + gapDuration;
            }
        }
        
        return ET_ok(true);
        
    } catch (e) {
        return ET_fail(e.toString());
    }
}

// Import Audio with Advanced Repetition Controls
// This function imports audio files with group-based repetition logic
function Imp_importAudioToTimelineAdvanced(filePathsJSON, gap, groupSize, repetitionsJSON) {
    try {
        // Check if project exists
        if (!app.project) {
            return ET_fail("No project open");
        }
        
        // Check if there's an active sequence
        var sequence = app.project.activeSequence;
        if (!sequence) {
            return ET_fail("No active sequence. Please create or open a sequence first.");
        }
        
        // Parse the file paths and repetitions
        var filePaths = JSON.parse(filePathsJSON);
        var repetitions = JSON.parse(repetitionsJSON);
        
        if (!filePaths || filePaths.length === 0) {
            return ET_fail("No files provided");
        }
        
        if (!repetitions || repetitions.length === 0) {
            return ET_fail("No repetition values provided");
        }
        
        // Get count of items before import
        var itemsBeforeImport = app.project.rootItem.children.numItems;
        
        // Import all files at once to project
        var success = app.project.importFiles(filePaths, true, app.project.rootItem, false);
        
        if (!success) {
            return ET_fail("Failed to import files");
        }
        
        // Get the newly imported items
        var projectItems = app.project.rootItem.children;
        var importedItems = [];
        
        for (var i = itemsBeforeImport; i < projectItems.numItems; i++) {
            importedItems.push(projectItems[i]);
        }
        
        if (importedItems.length === 0) {
            return ET_fail("No items were imported");
        }
        
        // Get the current playhead position
        var insertTime = sequence.getPlayerPosition().seconds;
        var gapDuration = gap || 0;
        
        // Find first empty audio track
        var audioTrack = null;
        var foundEmptyTrack = false;
        
        for (var t = 0; t < sequence.audioTracks.numTracks; t++) {
            if (sequence.audioTracks[t].clips.numItems === 0) {
                audioTrack = sequence.audioTracks[t];
                foundEmptyTrack = true;
                break;
            }
        }
        
        // If no empty track found, create one
        if (!foundEmptyTrack) {
            sequence.audioTracks.add();
            audioTrack = sequence.audioTracks[sequence.audioTracks.numTracks - 1];
        }
        
        // Process audio files with repetition logic
        var currentInsertTime = insertTime;
        var audioIndex = 0;
        
        // Loop through all audio files
        while (audioIndex < importedItems.length) {
            // Process one group
            for (var positionInGroup = 0; positionInGroup < groupSize && audioIndex < importedItems.length; positionInGroup++) {
                var item = importedItems[audioIndex];
                
                // Get repetition count for this position in the group
                var repeatCount = repetitions[positionInGroup] || 1;
                
                // Insert the audio file repeatCount times
                for (var rep = 0; rep < repeatCount; rep++) {
                    audioTrack.insertClip(item, currentInsertTime);
                    
                    // Get the inserted clip and calculate next position
                    if (audioTrack.clips.numItems > 0) {
                        var insertedClip = audioTrack.clips[audioTrack.clips.numItems - 1];
                        // Use native audio duration and add gap
                        currentInsertTime = insertedClip.end.seconds + gapDuration;
                    }
                }
                
                // Move to next audio file
                audioIndex++;
            }
        }
        
        return ET_ok(true);
        
    } catch (e) {
        return ET_fail(e.toString());
    }
}

// Import Images with Audio Sync
// This function matches image durations to audio clips already on the timeline
function Imp_importImagesWithAudioSync(filePathsJSON, gap) {
    try {
        // Check if project exists
        if (!app.project) {
            return ET_fail("No project open");
        }
        
        // Check if there's an active sequence
        var sequence = app.project.activeSequence;
        if (!sequence) {
            return ET_fail("No active sequence. Please create or open a sequence first.");
        }
        
        // Parse the file paths
        var filePaths = JSON.parse(filePathsJSON);
        
        if (!filePaths || filePaths.length === 0) {
            return ET_fail("No files provided");
        }
        
        // Get the current playhead position
        var insertTime = sequence.getPlayerPosition().seconds;
        
        // Find audio clips starting from the current position
        var audioClips = [];
        
        // Search through all audio tracks for clips at or after the insert time
        for (var t = 0; t < sequence.audioTracks.numTracks; t++) {
            var track = sequence.audioTracks[t];
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                if (clip.start.seconds >= insertTime) {
                    audioClips.push({
                        startTime: clip.start.seconds,
                        duration: clip.duration.seconds,
                        trackIndex: t
                    });
                }
            }
        }
        
        // Sort clips by start time
        audioClips.sort(function(a, b) {
            return a.startTime - b.startTime;
        });
        
        if (audioClips.length === 0) {
            return ET_fail("No audio clips found on timeline from current position");
        }
        
        if (filePaths.length > audioClips.length) {
            return ET_fail("More images (" + filePaths.length + ") than audio clips (" + audioClips.length + "). Only " + audioClips.length + " will be imported.");
        }
        
        // Import all image files
        var itemsBeforeImport = app.project.rootItem.children.numItems;
        var success = app.project.importFiles(filePaths, true, app.project.rootItem, false);
        
        if (!success) {
            return ET_fail("Failed to import files");
        }
        
        // Get the newly imported items
        var projectItems = app.project.rootItem.children;
        var importedItems = [];
        
        for (var i = itemsBeforeImport; i < projectItems.numItems; i++) {
            importedItems.push(projectItems[i]);
        }
        
        if (importedItems.length === 0) {
            return ET_fail("No items were imported");
        }
        
        var gapDuration = gap || 0;
        
        // Find or create video track
        var videoTrack = null;
        var foundEmptyTrack = false;
        
        // Check existing tracks for empty space
        for (var t = 0; t < sequence.videoTracks.numTracks; t++) {
            var track = sequence.videoTracks[t];
            var trackHasSpace = true;
            
            // Check if this track has any clips that would interfere
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                var clipStart = clip.start.seconds;
                var clipEnd = clip.end.seconds;
                
                // Check against all our planned insert times
                for (var checkIdx = 0; checkIdx < Math.min(importedItems.length, audioClips.length); checkIdx++) {
                    var plannedStart = audioClips[checkIdx].startTime;
                    var plannedDuration = audioClips[checkIdx].duration + gapDuration;
                    var plannedEnd = plannedStart + plannedDuration;
                    
                    if ((clipStart < plannedEnd && clipEnd > plannedStart)) {
                        trackHasSpace = false;
                        break;
                    }
                }
                
                if (!trackHasSpace) break;
            }
            
            if (trackHasSpace) {
                videoTrack = track;
                foundEmptyTrack = true;
                break;
            }
        }
        
        // If no empty track found, create one
        if (!foundEmptyTrack) {
            sequence.videoTracks.add();
            videoTrack = sequence.videoTracks[sequence.videoTracks.numTracks - 1];
        }
        
        // Import each image with duration matching its corresponding audio clip
        for (var j = 0; j < importedItems.length && j < audioClips.length; j++) {
            var item = importedItems[j];
            var audioClip = audioClips[j];
            
            // Calculate image duration = audio duration + gap
            var imageDuration = audioClip.duration + gapDuration;
            
            // Insert the clip at the audio's start position
            videoTrack.insertClip(item, audioClip.startTime);
            
            // Set the image duration to match audio + gap
            if (videoTrack.clips.numItems > 0) {
                var insertedClip = videoTrack.clips[videoTrack.clips.numItems - 1];
                
                // For images, we need to set the duration
                if (item.type == 2) { // ProjectItemType.FILE (still image)
                    insertedClip.end = insertedClip.start.seconds + imageDuration;
                }
            }
        }
        
        return ET_ok(true);
        
    } catch (e) {
        return ET_fail(e.toString());
    }
}
