window.addEventListener('error', function(e) {
    console.error("JS Error:", e.message, "at", e.filename, ":", e.lineno);
});

const csInterface = (typeof window !== 'undefined' && typeof CSInterface !== 'undefined') ? new CSInterface() : null;
let extensionPath = '';
let hasCepHost = false;

try {
    hasCepHost = !!(typeof window !== 'undefined' && (window.cep || (csInterface && typeof csInterface.getHostEnvironment === 'function' && csInterface.getHostEnvironment())));
    if (csInterface && typeof SystemPath !== 'undefined' && typeof csInterface.getSystemPath === 'function' && hasCepHost) {
        extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
    }

} catch (e) {
    hasCepHost = false;
    extensionPath = '';
}

function showUiToast(message, type) {
    let host = document.getElementById('uiToastHost');
    const appContainer = document.getElementById('app') || document.body;
    const footer = document.querySelector('.sidebar-footer');

    if (!host) {
        host = document.createElement('div');
        host.id = 'uiToastHost';
        host.className = 'ui-toast-host';
        appContainer.appendChild(host);
    }

    if (footer && appContainer) {
        const appRect = appContainer.getBoundingClientRect();
        const footerRect = footer.getBoundingClientRect();
        const left = footerRect.left - appRect.left;
        host.style.left = Math.max(0, left) + 'px';
        host.style.bottom = '88px';
        host.style.width = footerRect.width + 'px';
        host.style.transform = 'translateX(0)';
    } else {
        host.style.left = '50%';
        host.style.bottom = '88px';
        host.style.width = '240px';
        host.style.transform = 'translateX(-50%)';
    }

    const toast = document.createElement('div');
    toast.className = 'ui-toast ' + (type === 'error' ? 'error' : 'success');

    const icon = document.createElement('i');
    icon.className = 'fa-solid ' + (type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check');

    const text = document.createElement('div');
    text.className = 'ui-toast-text';
    text.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ui-toast-close';
    closeBtn.innerHTML = '&times;';

    function removeToast() {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 260);
    }

    closeBtn.addEventListener('click', removeToast);

    toast.appendChild(icon);
    toast.appendChild(text);
    toast.appendChild(closeBtn);
    host.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(removeToast, type === 'error' ? 4200 : 3000);
}

function hideSplashScreen() {
    const splash = document.getElementById('splashScreen');
    if (!splash) return;
    splash.classList.add('hidden');
}

// Global State
let allSounds = [];
let currentSounds = [];
let folderStructure = {};
let savedFavs = [];
let showingFavorites = false;
let previousCategory = null;
let currentLibraryMode = 'sfx';
let lastVolumeLevel = 0.5;
let isAudioMuted = false;
let isLibraryLoading = false;
let pendingLibraryReload = null;
let activeRenderToken = 0;
let activeRenderFrameId = null;
let searchInputDebounceTimer = null;

function cancelSearchDebounce() {
    if (searchInputDebounceTimer) {
        clearTimeout(searchInputDebounceTimer);
        searchInputDebounceTimer = null;
    }
}

function normalizeFavoritePath(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\\/g, '/').replace(/\/+/g, '/').trim().toLowerCase();
}

function hasFavoritePath(pathValue) {
    if (!pathValue) return false;
    const key = normalizeFavoritePath(pathValue);
    return savedFavs.some(saved => normalizeFavoritePath(saved) === key);
}

function addFavoritePath(pathValue) {
    if (!pathValue) return;
    const key = normalizeFavoritePath(pathValue);
    if (!key || savedFavs.some(saved => normalizeFavoritePath(saved) === key)) return;
    savedFavs.push(pathValue.replace(/\\/g, '/'));
}

function removeFavoritePath(pathValue) {
    if (!pathValue) return;
    const key = normalizeFavoritePath(pathValue);
    savedFavs = savedFavs.filter(saved => normalizeFavoritePath(saved) !== key);
}

function syncFavoriteFlagsFromStorage() {
    const applyState = (list) => {
        if (!Array.isArray(list)) return;
        list.forEach(sound => {
            if (!sound || !sound.path) return;
            sound.fav = hasFavoritePath(sound.path);
        });
    };

    applyState(allSounds);
    applyState(currentSounds);

    Object.keys(folderStructure).forEach(category => {
        const group = folderStructure[category];
        if (!group) return;
        applyState(group.sounds);
        Object.keys(group.subdirs || {}).forEach(sub => {
            applyState(group.subdirs[sub].sounds);
        });
    });
}

const libraryCache = {
    sfx: null,
    music: null
};

const globalAudioPlayer = new Audio();
let hoverPlayTimer = null;

function playHoverPreview(filePath) {
    stopHoverPreview();
    hoverPlayTimer = setTimeout(() => {
        try {
            globalAudioPlayer.src = "file://" + encodeURI(filePath.replace(/\\/g, '/'));
            globalAudioPlayer.volume = 0.5;
            const playPromise = globalAudioPlayer.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {});
            }
        } catch (e) {}
    }, 120);
}

function stopHoverPreview() {
    if (hoverPlayTimer) {
        clearTimeout(hoverPlayTimer);
        hoverPlayTimer = null;
    }
    if (!globalAudioPlayer.paused || globalAudioPlayer.src) {
        try {
            globalAudioPlayer.pause();
            globalAudioPlayer.removeAttribute('src');
            globalAudioPlayer.load();
        } catch (e) {}
    }
}

// Helpers
function joinPath(p1, p2) {
    return p1.endsWith('/') ? p1 + p2 : p1 + '/' + p2;
}

function getExt(filename) {
    const idx = filename.lastIndexOf('.');
    return idx !== -1 ? filename.substring(idx) : '';
}

function getBase(filename) {
    const idx = filename.lastIndexOf('.');
    return idx !== -1 ? filename.substring(0, idx) : filename;
}

const SUPPORTED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.aiff', '.aif', '.flac', '.m4a', '.aac', '.ogg'];

function isSupportedAudioFile(filename) {
    return SUPPORTED_AUDIO_EXTENSIONS.indexOf((getExt(filename) || '').toLowerCase()) !== -1;
}

function copySelectedFilesIntoLibrary(filePaths) {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return;

    const fs = require('fs');
    const path = require('path');
    const targetRoot = resolveSelectedImportTarget();

    if (!fs.existsSync(targetRoot)) {
        fs.mkdirSync(targetRoot, { recursive: true });
    }

    let copiedCount = 0;
    filePaths.forEach(filePath => {
        if (!filePath) return;
        const name = path.basename(filePath);
        if (!isSupportedAudioFile(name)) return;

        const dest = path.join(targetRoot, name);
        fs.copyFileSync(filePath, dest);
        copiedCount++;
    });

    if (copiedCount > 0) {
        const selectedFolder = getSelectedFolderInfo();
        if (selectedFolder.category || selectedFolder.subfolder) {
            window.__tesuPendingSelection = {
                category: selectedFolder.category,
                subfolder: selectedFolder.subfolder
            };
        }

        showUiToast('Đã hoàn tất import!', 'success');
        if (typeof window !== 'undefined' && typeof window.__tesuReloadLibrary === 'function') {
            window.__tesuReloadLibrary(true);
        }
    } else {
        showUiToast('Không có file âm thanh hợp lệ được chọn.', 'error');
    }
}

function openAudioFilePicker() {
    if (!window.cep || !window.cep.fs) return;

    const result = window.cep.fs.showOpenDialog(true, false, 'Chọn file âm thanh', '', [
        'mp3', 'wav', 'aiff', 'aif', 'flac', 'm4a', 'aac', 'ogg'
    ]);

    if (result.err === window.cep.fs.NO_ERROR && Array.isArray(result.data) && result.data.length > 0) {
        copySelectedFilesIntoLibrary(result.data);
    }
}

function naturalCompareStrings(a, b) {
    const left = (a || '').toString();
    const right = (b || '').toString();
    const leftParts = left.match(/\d+|\D+/g) || [left];
    const rightParts = right.match(/\d+|\D+/g) || [right];
    const maxLength = Math.max(leftParts.length, rightParts.length);

    for (let i = 0; i < maxLength; i++) {
        const leftPart = leftParts[i] || '';
        const rightPart = rightParts[i] || '';

        const leftIsNum = /^\d+$/.test(leftPart);
        const rightIsNum = /^\d+$/.test(rightPart);

        if (leftIsNum && rightIsNum) {
            const diff = Number(leftPart) - Number(rightPart);
            if (diff !== 0) return diff;
            continue;
        }

        if (leftIsNum !== rightIsNum) {
            return leftIsNum ? -1 : 1;
        }

        const diff = leftPart.localeCompare(rightPart, undefined, { numeric: true, sensitivity: 'base' });
        if (diff !== 0) return diff;
    }

    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function sortByNaturalName(items) {
    if (!Array.isArray(items)) return items;
    return items.slice().sort((a, b) => naturalCompareStrings(a && a.name ? a.name : a, b && b.name ? b.name : b));
}

function applyNaturalSortToCollections() {
    allSounds = sortByNaturalName(allSounds);

    Object.keys(folderStructure).forEach(category => {
        const categoryData = folderStructure[category];
        if (categoryData && Array.isArray(categoryData.sounds)) {
            categoryData.sounds = sortByNaturalName(categoryData.sounds);
        }
        if (categoryData && categoryData.subdirs) {
            Object.keys(categoryData.subdirs).forEach(sub => {
                if (Array.isArray(categoryData.subdirs[sub].sounds)) {
                    categoryData.subdirs[sub].sounds = sortByNaturalName(categoryData.subdirs[sub].sounds);
                }
            });
        }
    });
}

function updateVolumeButtonState() {
    const volumeBtn = document.getElementById('volumeBtn');
    if (!volumeBtn) return;

    const icon = volumeBtn.querySelector('i');
    if (!icon) return;

    if (isAudioMuted) {
        icon.className = 'fa-solid fa-volume-xmark';
        volumeBtn.title = 'Âm Thanh Đã Tắt';
        volumeBtn.setAttribute('aria-label', 'Unmute audio');
        volumeBtn.classList.add('muted');
        volumeBtn.classList.remove('unmuted');
    } else {
        icon.className = 'fa-solid fa-volume-high';
        volumeBtn.title = 'Âm Lượng';
        volumeBtn.setAttribute('aria-label', 'Mute audio');
        volumeBtn.classList.add('unmuted');
        volumeBtn.classList.remove('muted');
    }
}

function getSelectedFolderInfo() {
    const selected = document.querySelector('.folder-item.selected');
    if (!selected) return { category: null, subfolder: null };

    const nameEl = selected.querySelector('.folder-name');
    const selectedName = nameEl ? nameEl.textContent.trim() : '';
    const parentGroup = selected.closest('.folder-group');
    const parentNameEl = parentGroup ? parentGroup.querySelector('.folder-item.parent .folder-name') : null;
    const parentName = parentNameEl ? parentNameEl.textContent.trim() : null;

    const isChild = selected.classList.contains('child');
    return {
        category: isChild ? parentName : selectedName,
        subfolder: isChild ? selectedName : null
    };
}

function getSelectedFolderName() {
    const selectedInfo = getSelectedFolderInfo();
    return selectedInfo.subfolder || selectedInfo.category || null;
}

function getCurrentLibraryRoot() {
    return currentLibraryMode === 'music'
        ? joinPath(extensionPath, 'Music')
        : joinPath(extensionPath, 'SoundFX');
}

function resolveSelectedImportTarget() {
    const path = require('path');
    const selectedInfo = getSelectedFolderInfo();
    const rootBase = getCurrentLibraryRoot();

    if (selectedInfo.subfolder && selectedInfo.category) {
        return path.join(rootBase, selectedInfo.category, selectedInfo.subfolder);
    }

    if (selectedInfo.category) {
        return path.join(rootBase, selectedInfo.category);
    }

    return rootBase;
}

function selectFolderByName(categoryName, subfolderName = null) {
    if (!categoryName || !folderStructure || !folderStructure[categoryName]) {
        return false;
    }

    const allFolderItems = document.querySelectorAll('.folder-item');
    let matched = false;

    allFolderItems.forEach(item => {
        const nameEl = item.querySelector('.folder-name');
        const itemName = nameEl ? nameEl.textContent.trim() : '';
        const isParentMatch = item.classList.contains('parent') && itemName === categoryName && !subfolderName;
        const isChildMatch = item.classList.contains('child') && subfolderName && itemName === subfolderName;
        const shouldSelect = isParentMatch || isChildMatch;

        item.classList.toggle('selected', shouldSelect);
        if (shouldSelect) matched = true;
    });

    if (subfolderName && folderStructure[categoryName] && folderStructure[categoryName].subdirs[subfolderName]) {
        previousCategory = subfolderName;
        currentSounds = folderStructure[categoryName].subdirs[subfolderName].sounds || [];

        document.querySelectorAll('.folder-group').forEach(group => {
            const parentItem = group.querySelector('.folder-item.parent');
            const parentNameEl = parentItem ? parentItem.querySelector('.folder-name') : null;
            const groupName = parentNameEl ? parentNameEl.textContent.trim() : '';
            const childPanel = group.querySelector('.folder-children');
            const shouldExpand = groupName === categoryName;
            group.classList.toggle('expanded', shouldExpand);
            if (childPanel) childPanel.style.display = shouldExpand ? 'block' : 'none';
            if (parentItem) {
                const toggleIcon = parentItem.querySelector('.folder-toggle');
                if (toggleIcon) {
                    toggleIcon.classList.toggle('fa-chevron-down', shouldExpand);
                    toggleIcon.classList.toggle('fa-chevron-right', !shouldExpand);
                }
            }
        });
    } else {
        previousCategory = categoryName;
        const categoryData = folderStructure[categoryName];
        const allGroupSounds = [...(categoryData.sounds || [])];
        Object.keys(categoryData.subdirs || {}).forEach(sub => {
            allGroupSounds.push(...(categoryData.subdirs[sub].sounds || []));
        });
        currentSounds = allGroupSounds;
    }

    renderItems(currentSounds);
    return matched;
}

function restorePreviousCategory() {
    if (!previousCategory) {
        return;
    }

    document.querySelectorAll('.folder-item').forEach(el => {
        const nameEl = el.querySelector('.folder-name');
        const matches = nameEl && nameEl.textContent.trim() === previousCategory;
        el.classList.toggle('selected', !!matches);
    });

    let targetSounds = currentSounds;
    const rootCategory = folderStructure[previousCategory];
    if (rootCategory) {
        targetSounds = [...rootCategory.sounds || []];
        Object.keys(rootCategory.subdirs || {}).forEach(sub => {
            targetSounds = targetSounds.concat(rootCategory.subdirs[sub].sounds || []);
        });
    } else {
        Object.keys(folderStructure).some(category => {
            const subdirs = folderStructure[category].subdirs || {};
            if (subdirs[previousCategory]) {
                targetSounds = subdirs[previousCategory].sounds || [];
                return true;
            }
            return false;
        });
    }

    currentSounds = targetSounds;
    renderItems(currentSounds);
}

function exitFavoriteFilterMode() {
    showingFavorites = false;
    const favFilterBtn = document.getElementById('favFilterBtn');
    if (favFilterBtn) favFilterBtn.classList.remove('active');
    cancelSearchDebounce();

    const fallbackCategory = previousCategory || getSelectedFolderName() || Object.keys(folderStructure)[0];
    if (!fallbackCategory) {
        currentSounds = [];
        renderItems([]);
        return;
    }

    previousCategory = fallbackCategory;
    document.querySelectorAll('.folder-item').forEach(el => {
        const nameEl = el.querySelector('.folder-name');
        const matches = nameEl && nameEl.textContent.trim() === previousCategory;
        el.classList.toggle('selected', !!matches);
    });

    let targetSounds = currentSounds;
    const rootCategory = folderStructure[previousCategory];
    if (rootCategory) {
        targetSounds = [...(rootCategory.sounds || [])];
        Object.keys(rootCategory.subdirs || {}).forEach(sub => {
            targetSounds = targetSounds.concat(rootCategory.subdirs[sub].sounds || []);
        });
    } else {
        Object.keys(folderStructure).some(category => {
            const subdirs = folderStructure[category].subdirs || {};
            if (subdirs[previousCategory]) {
                targetSounds = subdirs[previousCategory].sounds || [];
                return true;
            }
            return false;
        });
    }

    currentSounds = targetSounds;
    syncFavoriteFlagsFromStorage();
    renderItems(currentSounds);
}

// Debounce Utility
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function refreshCurrentListView() {
    if (showingFavorites) {
        const favorites = allSounds.filter(sound => sound && sound.fav);
        renderItems(favorites);
        return;
    }

    renderItems(currentSounds);
}

document.addEventListener('DOMContentLoaded', () => {
    if (!hasCepHost) {
        const itemList = document.getElementById('itemList');
        const folderList = document.getElementById('folderList');
        if (itemList) itemList.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#8c98a8;font-size:12px;">Preview mode: CEP host unavailable</div>';
        if (folderList) folderList.innerHTML = '<div style="padding:16px;color:#8c98a8;font-size:12px;">Không thể đọc thư mục trong môi trường thử nghiệm ngoài Premiere.</div>';
        hideSplashScreen();
        return;
    }

    const renderCurrentList = refreshCurrentListView;

    const volumeBtn = document.getElementById('volumeBtn');
    if (volumeBtn) {
        volumeBtn.addEventListener('click', () => {
            isAudioMuted = !isAudioMuted;
            if (isAudioMuted) {
                lastVolumeLevel = globalAudioPlayer.volume || lastVolumeLevel;
                globalAudioPlayer.muted = true;
                globalAudioPlayer.volume = 0;
            } else {
                globalAudioPlayer.muted = false;
                globalAudioPlayer.volume = lastVolumeLevel > 0 ? lastVolumeLevel : 0.5;
            }
            updateVolumeButtonState();
        });
    }

    if (globalAudioPlayer) {
        globalAudioPlayer.volume = lastVolumeLevel;
        globalAudioPlayer.muted = false;
    }
    updateVolumeButtonState();

    // Settings modal click handling
    const infoModal = document.getElementById('infoModal');
    document.querySelectorAll('.settings-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (infoModal) infoModal.classList.remove('hidden');
        });
    });

    if (infoModal) {
        infoModal.addEventListener('click', (event) => {
            if (event.target === infoModal) {
                infoModal.classList.add('hidden');
            }
        });

        window.addEventListener('keydown', (event) => {
            const isEscape = event.key === 'Escape' || event.key === 'Esc';
            if (isEscape && !infoModal.classList.contains('hidden')) {
                infoModal.classList.add('hidden');
            }
        });
    }

    const basePaths = {
        sfx: joinPath(extensionPath, 'SoundFX'),
        music: joinPath(extensionPath, 'Music')
    };

    function resolveLibraryRootPath(mode) {
        const preferred = basePaths[mode] || joinPath(extensionPath, mode === 'music' ? 'Music' : 'SoundFX');
        const legacy = joinPath(extensionPath, mode === 'music' ? 'music' : 'sfx');

        const preferredStat = window.cep.fs.stat(preferred);
        if (preferredStat.err === window.cep.fs.NO_ERROR && preferredStat.data.isDirectory()) {
            return preferred;
        }

        const legacyStat = window.cep.fs.stat(legacy);
        if (legacyStat.err === window.cep.fs.NO_ERROR && legacyStat.data.isDirectory()) {
            return legacy;
        }

        return preferred;
    }

    // Load Favorites from LocalStorage
    try {
        const stored = localStorage.getItem('favSounds');
        const parsed = stored ? JSON.parse(stored) : [];
        if (!Array.isArray(parsed)) {
            savedFavs = [];
        } else {
            savedFavs = parsed
                .filter(v => typeof v === 'string' && v.trim())
                .map(v => v.replace(/\\/g, '/'));
        }
        allSounds.forEach(sound => {
            sound.fav = hasFavoritePath(sound.path);
        });
    } catch (e) {
        console.error("Failed to load favorites", e);
        savedFavs = [];
        allSounds.forEach(sound => {
            sound.fav = false;
        });
    }

    // Fast Reload Library with In-Memory Caching
    function applyPendingFolderSelection() {
        const pending = window.__tesuPendingSelection;
        if (!pending || !pending.category) {
            return;
        }

        window.__tesuPendingSelection = null;
        selectFolderByName(pending.category, pending.subfolder || null);
    }

    function reloadLibrary(forceRefresh = false) {
        if (isLibraryLoading) {
            pendingLibraryReload = {
                forceRefresh: pendingLibraryReload ? pendingLibraryReload.forceRefresh || forceRefresh : forceRefresh
            };
            return;
        }
        isLibraryLoading = true;
        stopHoverPreview();

        try {
            const pendingSelection = window.__tesuPendingSelection || null;

            if (!forceRefresh && libraryCache[currentLibraryMode]) {
                allSounds = libraryCache[currentLibraryMode].allSounds;
                folderStructure = libraryCache[currentLibraryMode].folderStructure;
                allSounds.forEach(sound => {
                    sound.fav = hasFavoritePath(sound.path);
                });
                applyNaturalSortToCollections();
                renderSidebar(folderStructure);
                if (pendingSelection && pendingSelection.category) {
                    applyPendingFolderSelection();
                } else {
                    showFirstCategory();
                }
                return;
            }

            const targetPath = resolveLibraryRootPath(currentLibraryMode);
            let statResult = window.cep.fs.stat(targetPath);

            if (statResult.err !== window.cep.fs.NO_ERROR) {
                window.cep.fs.makedir(targetPath);
                statResult = window.cep.fs.stat(targetPath);
            }

            if (statResult.err === window.cep.fs.NO_ERROR && statResult.data.isDirectory()) {
                allSounds = [];
                folderStructure = {};
                scanFolderCEP(targetPath);
                allSounds.forEach(sound => {
                    sound.fav = hasFavoritePath(sound.path);
                });
                applyNaturalSortToCollections();

                libraryCache[currentLibraryMode] = {
                    allSounds: [...allSounds],
                    folderStructure: JSON.parse(JSON.stringify(folderStructure))
                };

                renderSidebar(folderStructure);
                if (pendingSelection && pendingSelection.category) {
                    applyPendingFolderSelection();
                } else {
                    showFirstCategory();
                }
            }
        } finally {
            isLibraryLoading = false;
            if (pendingLibraryReload) {
                const queuedReload = pendingLibraryReload;
                pendingLibraryReload = null;
                requestAnimationFrame(() => reloadLibrary(queuedReload.forceRefresh));
            }
        }
    }

    function showFirstCategory() {
        showingFavorites = false;
        const favFilterBtn = document.getElementById('favFilterBtn');
        if (favFilterBtn) favFilterBtn.classList.remove('active');
        if (favFilterBtn) favFilterBtn.style.color = '';
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
        cancelSearchDebounce();

        const categoryNames = Object.keys(folderStructure || {});
        const firstCategory = categoryNames.find(name => name !== 'Everything') || categoryNames[0];
        if (firstCategory) {
            previousCategory = firstCategory;
            const categoryData = folderStructure[firstCategory] || { sounds: [], subdirs: {} };
            currentSounds = [...(categoryData.sounds || [])];
            Object.keys(categoryData.subdirs || {}).forEach(sub => {
                currentSounds = currentSounds.concat(categoryData.subdirs[sub].sounds || []);
            });
            renderItems(currentSounds);

            document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('selected'));
            const firstGroup = Array.from(document.querySelectorAll('.folder-item.parent')).find(el => {
                const nameEl = el.querySelector('.folder-name');
                return nameEl && nameEl.textContent.trim() === firstCategory;
            });
            if (firstGroup) firstGroup.classList.add('selected');
        } else {
            previousCategory = null;
            currentSounds = [];
            renderItems([]);
        }
    }

    const splashMinDisplayMs = 500;
    const splashStartTime = Date.now();
    requestAnimationFrame(() => {
        reloadLibrary();
        const elapsed = Date.now() - splashStartTime;
        const remaining = Math.max(0, splashMinDisplayMs - elapsed);
        setTimeout(hideSplashScreen, remaining);
    });

    // Navigation Tabs
    const sidebarEl = document.getElementById('sidebar');
    const mainContentEl = document.getElementById('mainContent');
    const sfxBtn = document.getElementById('sfxTabBtn');
    const musicBtn = document.getElementById('musicTabBtn');
    const libraryTabButtons = [sfxBtn, musicBtn].filter(Boolean);

    function setActiveTab(activeEl) {
        libraryTabButtons.forEach(btn => btn.classList.remove('active'));
        if (activeEl) activeEl.classList.add('active');
    }

    function showAudioLibrary() {
        if (sidebarEl) sidebarEl.style.display = '';
        if (mainContentEl) mainContentEl.style.display = '';
    }

    function switchLibrary(mode, activeEl) {
        setActiveTab(activeEl);
        showAudioLibrary();
        currentLibraryMode = mode;
        reloadLibrary();
    }

    if (sfxBtn) {
        sfxBtn.addEventListener('click', (e) => {
            switchLibrary('sfx', e.currentTarget);
        });
    }

    if (musicBtn) {
        musicBtn.addEventListener('click', (e) => {
            switchLibrary('music', e.currentTarget);
        });
    }

    // Debounced Search Functionality (120ms delay)
    const searchInput = document.getElementById('searchInput');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase().trim();
            cancelSearchDebounce();
            searchInputDebounceTimer = setTimeout(() => {
                searchInputDebounceTimer = null;
                const baseList = showingFavorites ? allSounds.filter(s => s.fav) : currentSounds;
                if (!term) {
                    renderItems(baseList);
                    return;
                }
                const targetSearchList = showingFavorites ? baseList : allSounds;
                const filtered = targetSearchList.filter(sound => (sound._searchName || sound.name.toLowerCase()).includes(term));
                renderItems(filtered);
            }, 120);
        });
    }

    // Favorite Filter Button
    const favFilterBtn = document.getElementById('favFilterBtn');
    if (favFilterBtn) {
        favFilterBtn.addEventListener('click', () => {
            const selectedFolderName = getSelectedFolderName();

            if (!showingFavorites) {
                cancelSearchDebounce();
                previousCategory = selectedFolderName || previousCategory || 'default';
                showingFavorites = true;
                favFilterBtn.classList.add('active');
                document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('selected'));
                syncFavoriteFlagsFromStorage();
                renderCurrentList();
            } else {
                exitFavoriteFilterMode();
            }

            if (searchInput) searchInput.value = '';
        });
    }

    // Add Folder / File Functionality
    const addFolderBtn = document.getElementById('addFolderBtn');
    if (addFolderBtn) {
        addFolderBtn.addEventListener('click', () => {
            const folderPickerTitle = currentLibraryMode === 'music'
                ? 'Chọn thư mục mới chứa nhạc'
                : 'Chọn thư mục mới chứa âm thanh SFX';
            const result = window.cep.fs.showOpenDialog(false, true, folderPickerTitle, "", []);
            if (result.err === window.cep.fs.NO_ERROR && result.data.length > 0) {
                const selectedDir = result.data[0];
                const originalText = addFolderBtn.innerHTML;
                addFolderBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang chép...';

                setTimeout(() => {
                    try {
                        const fs = require('fs');
                        const path = require('path');
                        const selectedFolder = getSelectedFolderInfo();
                        const destinationBase = resolveSelectedImportTarget();
                        let folderName = path.basename(selectedDir);
                        if (!folderName) folderName = selectedDir.split(/[\\/]/).pop();
                        let destTarget = path.join(destinationBase, folderName);

                        const resolvedSource = path.resolve(selectedDir);
                        const resolvedTarget = path.resolve(destTarget);
                        if (resolvedSource === resolvedTarget) {
                            let index = 1;
                            destTarget = path.join(destinationBase, folderName + '_imported');
                            while (fs.existsSync(path.resolve(destTarget))) {
                                destTarget = path.join(destinationBase, folderName + '_imported_' + index);
                                index += 1;
                            }
                        } else {
                            let index = 1;
                            while (fs.existsSync(path.resolve(destTarget))) {
                                destTarget = path.join(destinationBase, folderName + '_' + index);
                                index += 1;
                            }
                        }

                        function copyFolderSyncNode(from, to) {
                            if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
                            fs.readdirSync(from).forEach(element => {
                                if (element.startsWith('.')) return;
                                const fromPath = path.join(from, element);
                                const toPath = path.join(to, element);
                                const stat = fs.lstatSync(fromPath);
                                if (stat.isFile()) {
                                    if (isSupportedAudioFile(element)) {
                                        fs.copyFileSync(fromPath, toPath);
                                    }
                                } else if (stat.isDirectory()) {
                                    if (path.resolve(fromPath) === path.resolve(toPath)) return;
                                    copyFolderSyncNode(fromPath, toPath);
                                }
                            });
                        }

                        copyFolderSyncNode(selectedDir, destTarget);
                        if (selectedFolder.category || selectedFolder.subfolder) {
                            window.__tesuPendingSelection = {
                                category: selectedFolder.category,
                                subfolder: selectedFolder.subfolder
                            };
                        }
                        addFolderBtn.innerHTML = originalText;
                        showUiToast("Đã hoàn tất import!", "success");
                        reloadLibrary(true);
                    } catch(e) {
                        addFolderBtn.innerHTML = originalText;
                        showUiToast("Lỗi chép file thư mục: " + e.message, "error");
                    }
                }, 50);
            }
        });
    }

    const addFileBtn = document.getElementById('addFileBtn');
    if (addFileBtn) {
        addFileBtn.addEventListener('click', () => {
            openAudioFilePicker();
        });
    }

    window.__tesuReloadLibrary = reloadLibrary;
    window.__tesuShowFirstCategory = showFirstCategory;

});

// Fast Scanning CEP
function scanFolderCEP(dirPath) {
    const result = window.cep.fs.readdir(dirPath);
    if (result.err !== window.cep.fs.NO_ERROR) return;

    const items = result.data;
    items.forEach(item => {
        if (item.startsWith('.')) return;
        const fullPath = joinPath(dirPath, item);
        const stats = window.cep.fs.stat(fullPath);
        if (stats.err !== window.cep.fs.NO_ERROR) return;

        if (stats.data.isDirectory()) {
            folderStructure[item] = { subdirs: {}, sounds: [] };
            const subResult = window.cep.fs.readdir(fullPath);
            if (subResult.err === window.cep.fs.NO_ERROR) {
                const subItems = subResult.data;
                
                subItems.forEach(subItem => {
                    if (subItem.startsWith('.')) return;
                    const subPath = joinPath(fullPath, subItem);
                    const subStats = window.cep.fs.stat(subPath);
                    if (subStats.err !== window.cep.fs.NO_ERROR) return;

                    if (subStats.data.isDirectory()) {
                        folderStructure[item].subdirs[subItem] = { sounds: [] };
                        readFilesIntoArrCEP(subPath, folderStructure[item].subdirs[subItem].sounds, item);
                    } else {
                        addSoundToFileListFast(subItem, subPath, item, folderStructure[item].sounds);
                    }
                });
            }
        } else {
            if (!folderStructure['Everything']) folderStructure['Everything'] = { subdirs: {}, sounds: [] };
            addSoundToFileListFast(item, fullPath, 'Everything', folderStructure['Everything'].sounds);
        }
    });
}

function readFilesIntoArrCEP(dirPath, arr, rootCategory) {
    const result = window.cep.fs.readdir(dirPath);
    if (result.err !== window.cep.fs.NO_ERROR) return;
    const subItems = result.data;

    subItems.forEach(item => {
        if (item.startsWith('.')) return;
        const fullPath = joinPath(dirPath, item);
        const stats = window.cep.fs.stat(fullPath);
        if (stats.err === window.cep.fs.NO_ERROR) {
            if (stats.data.isDirectory()) {
                readFilesIntoArrCEP(fullPath, arr, rootCategory);
            } else {
                addSoundToFileListFast(item, fullPath, rootCategory, arr);
            }
        }
    });
}

function addSoundToFileListFast(filename, fullPath, category, arr) {
    if (isSupportedAudioFile(filename)) {
        const ext = getExt(filename);
        const name = getBase(filename);
        const sound = {
            name: name,
            _searchName: name.toLowerCase(),
            type: ext.substring(1).toLowerCase(),
            path: fullPath,
            category: category,
            fav: hasFavoritePath(fullPath)
        };
        arr.push(sound);
        allSounds.push(sound);
    }
}

function renderSidebar(structure) {
    const listContainer = document.getElementById('folderList');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    Object.keys(structure).forEach(category => {
        const categoryData = structure[category];
        const subdirs = Object.keys(categoryData.subdirs || {});
        const hasSubdirs = subdirs.length > 0;
        
        const groupDiv = document.createElement('div');
        groupDiv.className = 'folder-group';
        
        const parentDiv = document.createElement('div');
        parentDiv.className = 'folder-item parent ' + (hasSubdirs ? '' : 'leaf');
        parentDiv.innerHTML = `
            <i class="fa-solid ${hasSubdirs ? 'fa-chevron-right' : 'fa-folder'} folder-toggle"></i>
            <span class="folder-name">${category}</span>
        `;
        
        const childrenDiv = document.createElement('div');
        childrenDiv.className = 'folder-children';
        childrenDiv.style.display = 'none';

        parentDiv.addEventListener('click', () => {
            showingFavorites = false;
            previousCategory = category;
            const favFilterBtn = document.getElementById('favFilterBtn');
            if (favFilterBtn) favFilterBtn.style.color = '';

            document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('selected'));
            parentDiv.classList.add('selected');
            
            let allGroupSounds = [...categoryData.sounds];
            subdirs.forEach(sub => {
                allGroupSounds = allGroupSounds.concat(categoryData.subdirs[sub].sounds);
            });
            currentSounds = allGroupSounds;

            renderItems(currentSounds);
            
            const sInput = document.getElementById('searchInput');
            if (sInput) sInput.value = '';

            if (hasSubdirs) {
                groupDiv.classList.toggle('expanded');
                const toggleIcon = parentDiv.querySelector('.folder-toggle');
                if (groupDiv.classList.contains('expanded')) {
                    childrenDiv.style.display = 'block';
                    toggleIcon.classList.remove('fa-chevron-right');
                    toggleIcon.classList.add('fa-chevron-down');
                } else {
                    childrenDiv.style.display = 'none';
                    toggleIcon.classList.remove('fa-chevron-down');
                    toggleIcon.classList.add('fa-chevron-right');
                }
            }
        });

        if (hasSubdirs) {
            subdirs.forEach(sub => {
                const childDiv = document.createElement('div');
                childDiv.className = 'folder-item child leaf';
                childDiv.innerHTML = `
                    <i class="fa-solid fa-folder folder-toggle"></i>
                    <span class="folder-name">${sub}</span>
                `;
                childDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showingFavorites = false;
                    previousCategory = sub;
                    const favFilterBtn = document.getElementById('favFilterBtn');
                    if (favFilterBtn) favFilterBtn.style.color = '';

                    document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('selected'));
                    childDiv.classList.add('selected');
                    
                    currentSounds = categoryData.subdirs[sub].sounds;

                    renderItems(currentSounds);

                    const sInput = document.getElementById('searchInput');
                    if (sInput) sInput.value = '';
                });
                childrenDiv.appendChild(childDiv);
            });
        }
        
        groupDiv.appendChild(parentDiv);
        groupDiv.appendChild(childrenDiv);
        listContainer.appendChild(groupDiv);
    });
}

function renderItems(items) {
    stopHoverPreview();
    const listContainer = document.getElementById('itemList');
    if (!listContainer) return;
    if (activeRenderFrameId !== null) {
        cancelAnimationFrame(activeRenderFrameId);
        activeRenderFrameId = null;
    }
    activeRenderToken += 1;
    const renderToken = activeRenderToken;
    listContainer.innerHTML = ''; 

    if (!items || items.length === 0) {
        const isFavEmpty = !!showingFavorites;
        const hasFolders = Object.keys(folderStructure).length > 0;
        const modeLabel = currentLibraryMode === 'music' ? 'Music' : 'SoundFX';
        const title = isFavEmpty ? 'Chưa có file nào được yêu thích.' : hasFolders ? 'Chưa có file nào.' : 'Chưa có thư mục nào.';
        const message = isFavEmpty
            ? 'Bạn chưa lưu mục âm thanh nào vào danh sách yêu thích. Nhấn ngôi sao trên file để lưu lại.'
            : hasFolders
                ? currentLibraryMode === 'music'
                    ? 'Thư mục âm nhạc hiện đang trống. Hãy thêm file vào để bắt đầu.'
                    : 'Thư mục âm thanh hiện đang trống. Hãy thêm file vào để bắt đầu.'
                : currentLibraryMode === 'music'
                    ? 'Thư mục âm nhạc hiện đang trống. Hãy thêm thư mục vào để bắt đầu.'
                    : 'Thư mục âm thanh hiện đang trống. Hãy thêm thư mục vào để bắt đầu.';

        const actionMarkup = isFavEmpty
            ? `
                <div class="empty-state-actions">
                    <button type="button" class="empty-state-btn primary" data-empty-action="explore">Khám Phá</button>
                </div>
            `
            : hasFolders
                ? `
                    <div class="empty-state-actions">
                        <button type="button" class="empty-state-btn primary" data-empty-action="add-file">Thêm File</button>
                    </div>
                `
                : `
                    <div class="empty-state-actions">
                        <button type="button" class="empty-state-btn primary" data-empty-action="add-folder">Thêm Thư Mục</button>
                    </div>
                `;

        listContainer.innerHTML = `
            <div class="empty-library-state ${currentLibraryMode === 'music' ? 'music' : 'soundfx'}">
                <div class="empty-state-badge">${modeLabel}</div>
                <div class="empty-state-icon">
                    <i class="fa-solid ${currentLibraryMode === 'music' ? 'fa-music' : 'fa-wave-square'}"></i>
                </div>
                <h3>${title}</h3>
                <p>${message}</p>
                ${actionMarkup}
            </div>
        `;

        const exploreBtn = listContainer.querySelector('[data-empty-action="explore"]');
        if (exploreBtn) {
            exploreBtn.addEventListener('click', () => {
                showingFavorites = false;
                const favFilterBtn = document.getElementById('favFilterBtn');
                if (favFilterBtn) favFilterBtn.classList.remove('active');
                cancelSearchDebounce();
                if (typeof window !== 'undefined' && typeof window.__tesuShowFirstCategory === 'function') {
                    window.__tesuShowFirstCategory();
                }
            });
        }

        const addFolderBtnEmpty = listContainer.querySelector('[data-empty-action="add-folder"]');
        if (addFolderBtnEmpty) {
            addFolderBtnEmpty.addEventListener('click', () => {
                const folderTrigger = document.querySelector('.add-folder-btn');
                if (folderTrigger) folderTrigger.click();
            });
        }

        const addFileBtnEmpty = listContainer.querySelector('[data-empty-action="add-file"]');
        if (addFileBtnEmpty) {
            addFileBtnEmpty.addEventListener('click', () => {
                openAudioFilePicker();
            });
        }
        return;
    }

    let chunkSize = 40;
    let index = 0;

    function renderChunk() {
        if (renderToken !== activeRenderToken) {
            return;
        }
        let fragment = document.createDocumentFragment();
        let end = Math.min(index + chunkSize, items.length);

        for (let i = index; i < end; i++) {
            const sound = items[i];
            const itemDiv = document.createElement('div');
            itemDiv.className = 'sound-item';
            
            itemDiv.innerHTML = `
                <div class="sound-fav">
                    <i class="fa-solid fa-star sound-fav-icon ${sound.fav ? 'active' : ''}"></i>
                </div>
                <div class="sound-icon-wrapper">
                    <svg width="40" height="24" viewBox="0 0 40 24" fill="none" class="main-icon-svg" xmlns="http://www.w3.org/2000/svg" style="transition: opacity 0.15s ease, transform 0.15s ease; opacity: 0.6;">
                        <rect x="0" y="8" width="3" height="8" rx="1.5" fill="currentColor"/>
                        <rect x="5" y="4" width="3" height="16" rx="1.5" fill="currentColor"/>
                        <rect x="10" y="0" width="3" height="24" rx="1.5" fill="currentColor"/>
                        <rect x="15" y="5" width="3" height="14" rx="1.5" fill="currentColor"/>
                        <rect x="20" y="9" width="3" height="6" rx="1.5" fill="currentColor"/>
                        <rect x="25" y="2" width="3" height="20" rx="1.5" fill="currentColor"/>
                        <rect x="30" y="6" width="3" height="12" rx="1.5" fill="currentColor"/>
                        <rect x="35" y="10" width="3" height="4" rx="1.5" fill="currentColor"/>
                    </svg>
                    <i class="fa-solid fa-circle-play play-overlay"></i>
                </div>
                <div class="sound-name-wrap">
                    <div class="sound-name" title="${sound.name}">${sound.name}</div>
                </div>
                <div class="sound-type">${sound.type}</div>
            `;

            const iconEl = itemDiv.querySelector('.main-icon-svg');

            itemDiv.addEventListener('dblclick', () => {
                stopHoverPreview();
                importSoundToPremiere(sound.path);
            });

            itemDiv.addEventListener('mouseenter', () => {
                if (iconEl) {
                    iconEl.style.opacity = '0';
                    iconEl.style.transform = 'scale(0.5)';
                }
                playHoverPreview(sound.path);
            });

            itemDiv.addEventListener('mouseleave', () => {
                if (iconEl) {
                    iconEl.style.opacity = '0.6';
                    iconEl.style.transform = 'scale(1)';
                }
                stopHoverPreview();
            });

            const favIcon = itemDiv.querySelector('.sound-fav-icon');
            if (favIcon) {
                favIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    sound.fav = !sound.fav;
                    favIcon.classList.toggle('active');

                    if (sound.fav) {
                        addFavoritePath(sound.path);
                    } else {
                        removeFavoritePath(sound.path);
                    }
                    localStorage.setItem('favSounds', JSON.stringify(savedFavs));
                    syncFavoriteFlagsFromStorage();

                    if (showingFavorites) {
                        refreshCurrentListView();
                        return;
                    }
                });
            }

            fragment.appendChild(itemDiv);
        }
        
        listContainer.appendChild(fragment);
        index = end;

        if (index < items.length) {
            activeRenderFrameId = requestAnimationFrame(renderChunk);
        } else {
            activeRenderFrameId = null;
        }
    }
    
    renderChunk();
}

function importSoundToPremiere(absoluteFilePath) {
    const safePath = absoluteFilePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    // Read selected track from UI. 0 = Auto (last track), 1..N = Track 1..N
    const trackSelect = document.getElementById('trackSelect');
    const selectedTrack = trackSelect ? parseInt(trackSelect.value, 10) : 0;
    // Pass selectedTrack as second argument to importSound so ExtendScript can honor it
    csInterface.evalScript('importSound("' + safePath + '", ' + (isNaN(selectedTrack) ? 0 : selectedTrack) + ')', function(result) {
        if (result !== 'SequenceInsertSuccess' && result !== 'Success') {
            console.error("Insert Sound Error:", result);
        }
    });
}

// --- Custom Select Proxy Wiring ---
// Mirror native #trackSelect into the styled proxy (#trackSelectProxy)
// This preserves existing behavior (scripts read native select.value) while providing a consistent UI.
document.addEventListener('DOMContentLoaded', function () {
    try {
        const nativeSelect = document.getElementById('trackSelect');
        const proxyRoot = document.getElementById('trackSelectProxy');
        if (!nativeSelect || !proxyRoot) return;

        // Build display and dropdown if not present
        let display = proxyRoot.querySelector('.custom-select-display');
        if (!display) {
            display = document.createElement('div');
            display.className = 'custom-select-display';
            const label = document.createElement('div');
            label.className = 'custom-select-label';
            display.appendChild(label);
            proxyRoot.appendChild(display);
        }
        let dropdown = proxyRoot.querySelector('.custom-select-dropdown');
        if (!dropdown) {
            dropdown = document.createElement('div');
            dropdown.className = 'custom-select-dropdown';
            proxyRoot.appendChild(dropdown);
        }

        const labelEl = display.querySelector('.custom-select-label');

        function populateOptions() {
            dropdown.innerHTML = '';
            const options = Array.from(nativeSelect.options);
            options.forEach(function (opt) {
                const optDiv = document.createElement('div');
                optDiv.className = 'custom-select-option';
                // Keep the display concise and consistent with the requested track naming.
                let displayText = opt.textContent || opt.innerText || opt.value;
                if (opt.value === '0') displayText = 'Track Cuối';
                else if (displayText.startsWith('Track ')) {
                    displayText = displayText.replace(/^Track\s+.*?\s+/, 'Track ');
                    if (displayText === 'Track Âm Thanh') displayText = 'Track';
                }
                optDiv.textContent = displayText;
                optDiv.dataset.value = opt.value;
                if (opt.selected) optDiv.classList.add('active');
                optDiv.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    nativeSelect.value = optDiv.dataset.value;
                    // Trigger change so existing code relying on native select catches it
                    nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    // Update display
                    labelEl.textContent = optDiv.textContent;
                    // Close dropdown
                    dropdown.classList.remove('open');
                });
                dropdown.appendChild(optDiv);
            });

            // Set initial display text (transform value 0 to Track Cuối)
            const sel = nativeSelect.options[nativeSelect.selectedIndex];
            if (sel) {
                let displayText = sel.textContent || sel.innerText || sel.value;
                if (sel.value === '0') displayText = 'Track Cuối';
                else if (displayText.startsWith('Track ')) {
                    displayText = displayText.replace(/^Track\s+.*?\s+/, 'Track ');
                    if (displayText === 'Track Âm Thanh') displayText = 'Track';
                }
                labelEl.textContent = displayText;
            } else {
                labelEl.textContent = '';
            }
        }

        // Toggle dropdown open when clicking display
        display.addEventListener('click', function (e) {
            e.stopPropagation();
            dropdown.classList.toggle('open');
        });

        // Close when clicking outside
        document.addEventListener('click', function (e) {
            if (!proxyRoot.contains(e.target)) {
                dropdown.classList.remove('open');
            }
        });

        // Sync when native select changes programmatically or via keyboard
        nativeSelect.addEventListener('change', function () {
            const sel = nativeSelect.options[nativeSelect.selectedIndex];
            let displayText = sel ? (sel.textContent || sel.innerText || sel.value) : '';
            if (sel && sel.value === '0') displayText = 'Track Cuối';
            else if (displayText.startsWith('Track ')) {
                displayText = displayText.replace(/^Track\s+.*?\s+/, 'Track ');
                if (displayText === 'Track Âm Thanh') displayText = 'Track';
            }
            labelEl.textContent = displayText;
            // Update active class in dropdown
            Array.from(dropdown.children).forEach(function (child) {
                child.classList.toggle('active', child.dataset.value === nativeSelect.value);
            });
            // Close dropdown on change
            dropdown.classList.remove('open');
        });

        // Initialize
        populateOptions();

        // Observe mutations to native select (in case options are changed dynamically)
        const mo = new MutationObserver(function () { populateOptions(); });
        mo.observe(nativeSelect, { childList: true, subtree: true });
    } catch (err) {
        console.error('Proxy select wiring failed:', err);
    }
});

// Open external links from modal safely in default browser (CEP can fail with direct mailto href)
document.addEventListener('DOMContentLoaded', function () {
    const links = document.querySelectorAll('.external-link[data-url]');
    links.forEach(function (link) {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const url = link.getAttribute('data-url');
            if (!url) return;
            if (csInterface && typeof csInterface.openURLInDefaultBrowser === 'function') {
                csInterface.openURLInDefaultBrowser(url);
            } else {
                window.open(url, '_blank');
            }
        });
    });
});
