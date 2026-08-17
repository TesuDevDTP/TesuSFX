function Utils_getImageDimensions(filePath) {
    try {
        var file = new File(filePath);
        if (!file.exists) {
            return null;
        }
        
        file.encoding = "BINARY";
        if (!file.open("r")) {
            return null;
        }
        
        var fileName = file.name.toLowerCase();
        var width = 0;
        var height = 0;
        
        // JPEG file format
        if (fileName.indexOf(".jpg") !== -1 || fileName.indexOf(".jpeg") !== -1) {
            // Read JPEG signature (0xFF 0xD8)
            var b1 = file.read(1);
            var b2 = file.read(1);
            
            if (b1.charCodeAt(0) === 0xFF && b2.charCodeAt(0) === 0xD8) {
                var maxIterations = 1000; // Safety limit
                var iteration = 0;
                
                // Scan for SOF (Start of Frame) marker
                while (!file.eof && iteration < maxIterations) {
                    iteration++;
                    
                    // Find next marker (starts with 0xFF)
                    var marker = file.read(1);
                    if (marker.charCodeAt(0) !== 0xFF) {
                        continue;
                    }
                    
                    // Skip any padding 0xFF bytes
                    var markerType = file.read(1);
                    while (markerType.charCodeAt(0) === 0xFF && !file.eof) {
                        markerType = file.read(1);
                    }
                    
                    var markerCode = markerType.charCodeAt(0);
                    
                    // Check for SOF markers (0xC0-0xCF, except 0xC4, 0xC8, 0xCC)
                    if ((markerCode >= 0xC0 && markerCode <= 0xC3) || 
                        (markerCode >= 0xC5 && markerCode <= 0xC7) || 
                        (markerCode >= 0xC9 && markerCode <= 0xCB) || 
                        (markerCode >= 0xCD && markerCode <= 0xCF)) {
                        
                        // Found SOF marker - read dimensions
                        // Skip segment length (2 bytes)
                        file.read(2);
                        
                        // Skip precision (1 byte)
                        file.read(1);
                        
                        // Read height (2 bytes, big-endian)
                        var h1 = file.read(1);
                        var h2 = file.read(1);
                        height = (h1.charCodeAt(0) << 8) | h2.charCodeAt(0);
                        
                        // Read width (2 bytes, big-endian)
                        var w1 = file.read(1);
                        var w2 = file.read(1);
                        width = (w1.charCodeAt(0) << 8) | w2.charCodeAt(0);
                        
                        break;
                    } else if (markerCode === 0xD8 || markerCode === 0xD9) {
                        // SOI or EOI - skip
                        continue;
                    } else if (markerCode === 0x00 || markerCode === 0x01 || (markerCode >= 0xD0 && markerCode <= 0xD7)) {
                        // Markers with no data - skip
                        continue;
                    } else {
                        // Other markers - skip segment
                        var len1 = file.read(1);
                        var len2 = file.read(1);
                        if (len1 === null || len2 === null) break;
                        var segmentLength = (len1.charCodeAt(0) << 8) | len2.charCodeAt(0);
                        // Skip the rest of the segment (length includes the 2 length bytes)
                        if (segmentLength > 2) {
                            file.seek(file.tell() + segmentLength - 2);
                        }
                    }
                }
            }
        }
        // PNG file format
        else if (fileName.indexOf(".png") !== -1) {
            // PNG signature: 137 80 78 71 13 10 26 10 (8 bytes)
            // Then IHDR chunk header: length (4 bytes) + "IHDR" (4 bytes)
            // Then width (4 bytes) + height (4 bytes)
            
            // Skip PNG signature (8 bytes)
            file.read(8);
            
            // Read IHDR chunk length (4 bytes, big-endian)
            file.read(4);
            
            // Read chunk type (should be "IHDR")
            var chunkType = file.read(4);
            
            if (chunkType === "IHDR") {
                // Read width (4 bytes, big-endian)
                var w1 = file.read(1);
                var w2 = file.read(1);
                var w3 = file.read(1);
                var w4 = file.read(1);
                width = (w1.charCodeAt(0) << 24) | (w2.charCodeAt(0) << 16) | (w3.charCodeAt(0) << 8) | w4.charCodeAt(0);
                
                // Read height (4 bytes, big-endian)
                var h1 = file.read(1);
                var h2 = file.read(1);
                var h3 = file.read(1);
                var h4 = file.read(1);
                height = (h1.charCodeAt(0) << 24) | (h2.charCodeAt(0) << 16) | (h3.charCodeAt(0) << 8) | h4.charCodeAt(0);
            }
        }
        
        file.close();
        
        if (width > 0 && height > 0) {
            return { width: width, height: height };
        }
        
        return null;
        
    } catch (e) {
        try {
            if (file && file.exists) file.close();
        } catch (e2) {}
        return null;
    }
}

function Utils_getVideoTrackNames() {
    try {
        if (!app.project || !app.project.activeSequence) {
            return ET_fail("No active sequence");
        }

        var seq = app.project.activeSequence;
        var result = [];
        for (var i = 0; i < seq.videoTracks.numTracks; i++) {
            result.push({
                index: i,
                name: seq.videoTracks[i].name || ("V" + (i + 1))
            });
        }

        return ET_ok(result);
    } catch (e) {
        return ET_fail(e.toString());
    }
}
