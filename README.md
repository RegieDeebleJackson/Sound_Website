# Interactive Quadrant Video

A web application that divides webcam feed into interactive quadrants with motion detection and audio triggers.

## Features

- Motion-activated video quadrants
- Per-quadrant audio playback
- Multiple layout presets (quadrants, vertical stripes, horizontal stripes, etc.)
- Manual control with number keys (1-4)
- Adjustable sensitivity and FPS
- Per-quadrant audio stop delay
- Audio pause/resume or restart modes
- Settings automatically saved in browser

## Usage

1. Allow camera access when prompted
2. Click "Enable audio" to enable audio playback
3. Load audio files for each quadrant using the file inputs
4. Adjust settings as needed:
   - Sensitivity: motion detection threshold
   - FPS: frame processing rate
   - Layout mode: choose from various quadrant arrangements
   - Audio stop delay: how long audio plays after motion stops
   - Volume: per-quadrant volume control
   
### Manual Control
- Press keys 1-4 to manually toggle quadrants:
  - First press: Force quadrant ON
  - Second press: Force quadrant OFF
  - Third press: Return to motion control
- Green dot indicates manually ON
- Red dot indicates manually OFF
- No dot means motion-controlled

## Local Development

Run a local server (e.g., using Python):
```bash
python3 -m http.server 8000
```
Then visit http://localhost:8000 in your browser.

## Browser Support

Requires a modern browser with support for:
- `getUserMedia` (webcam access)
- Web Audio API
- CSS Grid
- Local Storage
