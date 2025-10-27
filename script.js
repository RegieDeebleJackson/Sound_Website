async function startCamera() {
    try {
        // Request camera access
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const video = document.getElementById('video');
        video.srcObject = stream;
        // Ensure the video is not mirrored (unmirror). Use CSS variable --flip to control horizontal flip.
        try {
            video.style.setProperty('--flip', '1');
        } catch (e) {
            // ignore if not supported
        }
        // Start motion detection once the video has started
        video.addEventListener('playing', () => {
            startMotionDetection(video);
        }, { once: true });
    } catch (error) {
        console.error("Error accessing the camera: ", error);
    }
}

// Start the camera when the document is loaded
document.addEventListener('DOMContentLoaded', startCamera);

// Fullscreen toggle: button + 'f' key
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('fs-btn');
    if (!btn) return;

    async function toggleFullscreen() {
        try {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
            } else {
                await document.exitFullscreen();
            }
        } catch (err) {
            console.warn('Fullscreen toggle failed:', err);
        }
    }

    btn.addEventListener('click', toggleFullscreen);

    // Press 'f' to toggle fullscreen
    window.addEventListener('keydown', (e) => {
        if (e.key === 'f' || e.key === 'F') {
            // avoid triggering when typing into a text field
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
            toggleFullscreen();
        }
    });
});

/* Motion detection: split the frame into 4 quadrants and detect motion per quadrant.
   When motion is detected in a quadrant, add the 'triggered' class to the overlay div for a short duration. */
function startMotionDetection(video) {
    const quadEls = Array.from(document.querySelectorAll('.quadrant'));
    if (quadEls.length !== 4) return;

    // the container element for quadrants (we apply layout classes here)
    const quadsContainer = document.querySelector('.quadrants');
    const LAYOUT_KEY = 'layout_preset';
    
    // available layout presets and their classes
    const LAYOUT_PRESETS = ['quadrants', 'vertical', 'horizontal', 'checkerboard', 'thirds-v', 'thirds-h'];
    let currentLayout = 'quadrants'; // default layout
    
    try {
        const lStored = localStorage.getItem(LAYOUT_KEY);
        if (lStored && LAYOUT_PRESETS.includes(lStored)) {
            currentLayout = lStored;
        }
    } catch (e) {}

    const layoutSelect = document.getElementById('layout-preset');
    if (layoutSelect) {
        // set initial value
        layoutSelect.value = currentLayout;
        
        // handle changes
        layoutSelect.addEventListener('change', (e) => {
            const newLayout = e.target.value;
            if (!LAYOUT_PRESETS.includes(newLayout)) return;
            
            // remove all layout classes
            if (quadsContainer) {
                LAYOUT_PRESETS.forEach(preset => {
                    quadsContainer.classList.remove(preset);
                });
                // add new layout class (skip 'quadrants' as it's the default)
                if (newLayout !== 'quadrants') {
                    quadsContainer.classList.add(newLayout);
                }
            }
            
            // store the choice
            currentLayout = newLayout;
            try { localStorage.setItem(LAYOUT_KEY, newLayout); } catch (err) {}
        });
    }
    
    // apply initial layout class if needed
    if (quadsContainer && currentLayout !== 'quadrants') {
        quadsContainer.classList.add(currentLayout);
    }

    // Downscale for performance
    const PROCESS_WIDTH = 320;

    let pw = PROCESS_WIDTH;
    let ph = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * pw));

    const canvasCurr = document.createElement('canvas');
    const canvasPrev = document.createElement('canvas');
    canvasCurr.width = canvasPrev.width = pw;
    canvasCurr.height = canvasPrev.height = ph;

    const ctxCurr = canvasCurr.getContext('2d');
    const ctxPrev = canvasPrev.getContext('2d');

    let prevImage = null;

    // timestamps for when motion was last seen in each quadrant
    const lastSeen = [0,0,0,0];
    // ms thresholds
    const ACTIVE_TIMEOUT = 800; // ms - how long we consider a quadrant 'active' after its last motion
    const AUDIO_STOP_DELAY = 1000; // ms - when no quadrant is active for this long, stop all audio

    // sampling step (performance)
    const PIXEL_STEP = 4 * 4; // sample every 4th pixel (RGBA => 4) x 4 => step by 16 in data array

    // localStorage keys
    const SENS_KEY = 'motion_sensitivity';
    const FPS_KEY = 'motion_fps';

    // initial values (persisted)
    let motionThreshold = Number(localStorage.getItem(SENS_KEY)) || 20;
    let fps = Number(localStorage.getItem(FPS_KEY)) || 10;
    let intervalId = null;

    // UI elements (if present)
    const sensEl = document.getElementById('sensitivity');
    const sensValEl = document.getElementById('sens-val');
    const fpsEl = document.getElementById('fps');
    const fpsValEl = document.getElementById('fps-val');

    // audio file inputs and runtime audio elements for each quadrant
    const audioInputs = [
        document.getElementById('audio-0'),
        document.getElementById('audio-1'),
        document.getElementById('audio-2'),
        document.getElementById('audio-3'),
    ];
    const audioNameEls = [
        document.getElementById('audio-name-0'),
        document.getElementById('audio-name-1'),
        document.getElementById('audio-name-2'),
        document.getElementById('audio-name-3'),
    ];
    const audioEls = [null, null, null, null];
    const audioUrls = [null, null, null, null];
    // volume controls
    const volEls = [
        document.getElementById('volume-0'),
        document.getElementById('volume-1'),
        document.getElementById('volume-2'),
        document.getElementById('volume-3'),
    ];
    const volValEls = [
        document.getElementById('vol-val-0'),
        document.getElementById('vol-val-1'),
        document.getElementById('vol-val-2'),
        document.getElementById('vol-val-3'),
    ];
    const VOL_KEY = 'audio_volume_q';
    const AUDIO_ENABLED_KEY = 'audio_enabled';
    const STOP_KEY = 'stop_delay_q_';
    const RESTART_KEY = 'audio_restart_on_trigger';
    let audioEnabled = localStorage.getItem(AUDIO_ENABLED_KEY) === '1';
    // restartOnTrigger: when true audio will reset to start when paused; when false audio will pause and resume
    let restartOnTrigger = true;
    try {
        const rStored = localStorage.getItem(RESTART_KEY);
        if (rStored !== null) restartOnTrigger = (rStored === '1');
    } catch (e) {}
    const enableBtn = document.getElementById('enable-audio');
    const restartCheckbox = document.getElementById('restart-audio');
    // mirror control
    const MIRROR_KEY = 'video_mirror';
    const mirrorToggle = document.getElementById('mirror-toggle');
    let mirrorEnabled = false;
    try {
        const mStored = localStorage.getItem(MIRROR_KEY);
        if (mStored !== null) mirrorEnabled = (mStored === '1');
    } catch (e) {}

    // per-quadrant stop delays (ms)
    const stopDelays = [800,800,800,800];

    // apply initial UI values
    if (sensEl) { sensEl.value = motionThreshold; }
    if (sensValEl) { sensValEl.textContent = motionThreshold; }
    if (fpsEl) { fpsEl.value = fps; }
    if (fpsValEl) { fpsValEl.textContent = fps;
    }
    // initialize volume UI values from localStorage or default
    for (let i = 0; i < 4; i++) {
        const vStored = Number(localStorage.getItem(VOL_KEY + i));
        const v = Number.isFinite(vStored) && !isNaN(vStored) && vStored >= 0 ? vStored : 100;
        if (volEls[i]) volEls[i].value = v;
        if (volValEls[i]) volValEls[i].textContent = String(v);

        // load stop delay from storage if present and wire UI elements if available
        try {
            const sStored = Number(localStorage.getItem(STOP_KEY + i));
            if (Number.isFinite(sStored) && !isNaN(sStored) && sStored > 0) stopDelays[i] = sStored;
        } catch (e) {}
        const stopEl = document.getElementById('stop-delay-' + i);
        const stopValEl = document.getElementById('stop-val-' + i);
        if (stopEl) stopEl.value = stopDelays[i];
        if (stopValEl) stopValEl.textContent = String(stopDelays[i]);
        if (stopEl) {
            stopEl.addEventListener('input', (ev) => {
                const val = Number(ev.target.value) || 800;
                stopDelays[i] = val;
                localStorage.setItem(STOP_KEY + i, String(val));
                if (stopValEl) stopValEl.textContent = String(val);
            });
        }
    }
    // update enable button label/state
    if (enableBtn) {
        enableBtn.disabled = !!audioEnabled;
        enableBtn.textContent = audioEnabled ? 'Audio enabled' : 'Enable audio';
    }
    // initialize restart checkbox UI if present
    if (restartCheckbox) {
        restartCheckbox.checked = !!restartOnTrigger;
        restartCheckbox.addEventListener('change', (e) => {
            restartOnTrigger = !!e.target.checked;
            try { localStorage.setItem(RESTART_KEY, restartOnTrigger ? '1' : '0'); } catch (err) {}
        });
    }

    // apply mirror preference and wire UI
    function applyMirror() {
        try {
            const videoEl = document.getElementById('video');
            if (videoEl) {
                videoEl.style.setProperty('--flip', mirrorEnabled ? '-1' : '1');
            }
            if (quadsContainer) {
                // mirror the overlay so visual indicators line up
                quadsContainer.style.transform = mirrorEnabled ? 'scaleX(-1)' : '';
            }
        } catch (e) { /* ignore */ }
    }

    if (mirrorToggle) {
        mirrorToggle.checked = !!mirrorEnabled;
        mirrorToggle.addEventListener('change', (e) => {
            mirrorEnabled = !!e.target.checked;
            try { localStorage.setItem(MIRROR_KEY, mirrorEnabled ? '1' : '0'); } catch (err) {}
            applyMirror();
        });
    }
    // apply initially
    applyMirror();

    // attach UI listeners if present
    if (sensEl) {
        sensEl.addEventListener('input', (e) => {
            motionThreshold = Number(e.target.value);
            localStorage.setItem(SENS_KEY, String(motionThreshold));
            if (sensValEl) sensValEl.textContent = motionThreshold;
        });
    }
    if (fpsEl) {
        fpsEl.addEventListener('input', (e) => {
            const newFps = Number(e.target.value) || 10;
            fps = newFps;
            localStorage.setItem(FPS_KEY, String(fps));
            if (fpsValEl) fpsValEl.textContent = fps;
            restartInterval();
        });
    }

    // enable-audio button: clicking this counts as a user gesture to allow audio playback
    if (enableBtn) {
        enableBtn.addEventListener('click', async () => {
            // try to unlock WebAudio if present and attempt to play/pause each audio to warm it up
            audioEnabled = true;
            localStorage.setItem(AUDIO_ENABLED_KEY, '1');
            enableBtn.disabled = true;
            enableBtn.textContent = 'Audio enabled';
            // attempt to play/pause existing audio elements to satisfy autoplay policies
            for (let a of audioEls) {
                if (a) {
                    try {
                        const p = a.play();
                        if (p && p.catch) await p.catch(() => {});
                        // on warm-up, follow restart preference: if restart enabled, reset to start; otherwise just pause so resume will continue
                        if (restartOnTrigger) { a.pause(); a.currentTime = 0; } else { a.pause(); }
                    } catch (e) {
                        // ignore
                    }
                }
            }
            // try to resume AudioContext if created elsewhere
            try { if (window.AudioContext && window.__audioContext instanceof AudioContext) { await window.__audioContext.resume(); } } catch (e) {}
        });
    }

    // wire audio file inputs
    audioInputs.forEach((inputEl, q) => {
        if (!inputEl) return;
        inputEl.addEventListener('change', (ev) => {
            const file = ev.target.files && ev.target.files[0];
            // stop and cleanup existing audio if present
            if (audioEls[q]) {
                try { audioEls[q].pause(); audioEls[q].currentTime = 0; } catch (e) {}
                audioEls[q] = null;
            }
            if (audioUrls[q]) {
                URL.revokeObjectURL(audioUrls[q]);
                audioUrls[q] = null;
            }
            if (!file) {
                if (audioNameEls[q]) audioNameEls[q].textContent = '';
                return;
            }
            const url = URL.createObjectURL(file);
            audioUrls[q] = url;
            const audio = new Audio(url);
            audio.loop = true; // keep playing while quadrant is active
            audio.preload = 'auto';
            // set initial volume from stored value
            const storedV = Number(localStorage.getItem(VOL_KEY + q));
            const vol = (Number.isFinite(storedV) && !isNaN(storedV)) ? (storedV / 100) : 1.0;
            audio.volume = vol;
            audioEls[q] = audio;
            if (audioNameEls[q]) audioNameEls[q].textContent = file.name;
        });
    });

    // wire volume sliders
    volEls.forEach((vEl, q) => {
        if (!vEl) return;
        vEl.addEventListener('input', (e) => {
            const val = Number(e.target.value) || 0;
            localStorage.setItem(VOL_KEY + q, String(val));
            if (volValEls[q]) volValEls[q].textContent = String(val);
            if (audioEls[q]) audioEls[q].volume = val / 100;
        });
    });

    // manual override state for each quadrant (null = motion control, true = forced on, false = forced off)
    const manualOverrides = [null, null, null, null];

    // mark that motion was seen in quadrant q
    function markSeen(q) {
        if (manualOverrides[q] !== null) return; // skip if manually controlled
        lastSeen[q] = performance.now();
    }

    // toggle manual override for a quadrant
    function toggleQuadrant(q) {
        if (q < 0 || q > 3) return;
        const el = quadEls[q];
        
        // cycle through states: null (motion) -> true (on) -> false (off) -> null (motion)
        if (manualOverrides[q] === null) {
            manualOverrides[q] = true; // force on
            lastSeen[q] = performance.now(); // ensure immediate activation
            if (el) {
                el.classList.remove('manual-off');
                el.classList.add('manual-on');
            }
        } else if (manualOverrides[q] === true) {
            manualOverrides[q] = false; // force off
            lastSeen[q] = 0; // ensure immediate deactivation
            if (el) {
                el.classList.remove('manual-on');
                el.classList.add('manual-off');
            }
        } else {
            manualOverrides[q] = null; // back to motion control
            if (el) {
                el.classList.remove('manual-on', 'manual-off');
            }
        }
    }

    // handle number key presses 1-4 for manual control
    // helper: find quadrant index that contains normalized point (nx,ny in [0..1])
    function getQuadAtNormalizedPoint(nx, ny) {
        const x = nx * window.innerWidth;
        const y = ny * window.innerHeight;
        // first try exact containment
        for (let i = 0; i < quadEls.length; i++) {
            const r = quadEls[i].getBoundingClientRect();
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
        }
        // fallback: choose nearest center
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < quadEls.length; i++) {
            const r = quadEls[i].getBoundingClientRect();
            const cx = (r.left + r.right) / 2;
            const cy = (r.top + r.bottom) / 2;
            const dx = cx - x;
            const dy = cy - y;
            const d = dx*dx + dy*dy;
            if (d < bestDist) { bestDist = d; best = i; }
        }
        return best;
    }

    window.addEventListener('keydown', (e) => {
        // ignore if typing in input/textarea
        if (document.activeElement?.tagName === 'INPUT' || 
            document.activeElement?.tagName === 'TEXTAREA' ||
            document.activeElement?.isContentEditable) return;

        const key = e.key;
        if (key >= '1' && key <= '4') {
            // mapping: 1=top-left,2=top-right,3=bottom-left,4=bottom-right (normalized coords)
            const map = {
                '1': [0.25, 0.25],
                '2': [0.75, 0.25],
                '3': [0.25, 0.75],
                '4': [0.75, 0.75]
            };
            const [nx, ny] = map[key];
            const q = getQuadAtNormalizedPoint(nx, ny);
            toggleQuadrant(q);
        }
    });

    // update quadrant DOM/audio state based on lastSeen timestamps and manual overrides
    function refreshStates() {
        const now = performance.now();
        let anyActive = false;
        for (let q = 0; q < 4; q++) {
            const el = quadEls[q];
            const audio = audioEls[q];
            
            // determine if active based on motion or manual override
            const hasMotionNow = manualOverrides[q] !== null ? 
                manualOverrides[q] : // if override, use that
                (now - lastSeen[q]) < 100; // otherwise check motion
            
            if (el) {
                if (hasMotionNow) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            }

            // Audio follows the same logic but with configurable delay when in motion mode
            const isAudioActive = manualOverrides[q] !== null ?
                manualOverrides[q] : // if override, use that
                (now - lastSeen[q]) < (stopDelays[q] || 800); // otherwise use delay
            
            if (isAudioActive) anyActive = true;

            // manage audio per-quadrant: play while active, stop when inactive
            if (audio) {
                if (isAudioActive && audioEnabled) {
                    // start if not already playing
                    if (audio.paused) {
                        const p = audio.play();
                        if (p && p.catch) p.catch(() => {});
                    }
                } else {
                    // pause; optionally reset to start depending on restartOnTrigger
                    try { if (restartOnTrigger) { audio.pause(); audio.currentTime = 0; } else { audio.pause(); } } catch (e) {}
                }
            }
        }

        // if nothing active for a stretch, ensure all audio is stopped
        if (!anyActive) {
            // find most recent seen across all quadrants
            const lastAny = Math.max(...lastSeen);
            if ((now - lastAny) > AUDIO_STOP_DELAY) {
                for (let q = 0; q < 4; q++) {
                    const audio = audioEls[q];
                    if (audio) { try { if (restartOnTrigger) { audio.pause(); audio.currentTime = 0; } else { audio.pause(); } } catch (e) {} }
                }
            }
        }
    }

    function detectFrame() {
        try {
            ctxCurr.drawImage(video, 0, 0, pw, ph);
        } catch (err) {
            // video not ready or cross-origin issue
            return;
        }

        const curr = ctxCurr.getImageData(0, 0, pw, ph);
        if (prevImage) {
            const counts = [0,0,0,0];
            const sums = [0,0,0,0];

            const wHalf = pw / 2;
            const hHalf = ph / 2;

            const dataCurr = curr.data;
            const dataPrev = prevImage.data;
            for (let i = 0; i < dataCurr.length; i += PIXEL_STEP) {
                const idx = i / 4; // pixel index
                const x = idx % pw;
                const y = Math.floor(idx / pw);

                const rDiff = Math.abs(dataCurr[i] - dataPrev[i]);
                const gDiff = Math.abs(dataCurr[i+1] - dataPrev[i+1]);
                const bDiff = Math.abs(dataCurr[i+2] - dataPrev[i+2]);
                const diff = (rDiff + gDiff + bDiff) / 3;

                let q = (x < wHalf ? 0 : 1) + (y < hHalf ? 0 : 2);
                sums[q] += diff;
                counts[q]++;
            }

            const now = performance.now();
            for (let q = 0; q < 4; q++) {
                if (counts[q] === 0) continue;
                const avg = sums[q] / counts[q];
                if (avg > motionThreshold) {
                    // mark quadrant seen; refreshStates() will manage visual/audio
                    markSeen(q);
                }
            }
        }

        prevImage = curr;
        ctxPrev.putImageData(curr, 0, 0);

        // update quadrant/audio states every frame detection
        try { refreshStates(); } catch (e) { console.warn('refreshStates error', e); }
    }

    function restartInterval() {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
        const delay = Math.max(100, Math.round(1000 / (fps || 10)));
        intervalId = setInterval(detectFrame, delay);
    }

    // start the periodic detection at requested fps
    restartInterval();

    // cleanup when video is paused/ended
    video.addEventListener('pause', () => { if (intervalId) { clearInterval(intervalId); intervalId = null; } });
    video.addEventListener('ended', () => { if (intervalId) { clearInterval(intervalId); intervalId = null; } });
}
