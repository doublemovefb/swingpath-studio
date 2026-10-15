# SwingPath Studio

A free, no-backend golf swing video annotator and *assisted* 2D clubhead tracker. Works on Vercel as a static HTML/CSS/JavaScript site. No subscriptions, API keys, installs, or video uploads to third-party servers.

## Deploy to Vercel

**GitHub:** Create a new repository, upload `index.html`, `styles.css`, `app.js`, and `vercel.json` to the root. In Vercel choose **Add New → Project → Import Git Repository**, and deploy. The project uses the **Other** framework preset, with no build command.

**Vercel CLI:** From this folder, run `npx vercel --prod` (Vercel account/login required).

**Preview locally:** Run `python3 -m http.server 8080` in this folder and open `http://localhost:8080`.

## How to use

1. Record from your camera or upload a 60/120/240 fps golf swing video. Tripod/static camera and good lighting make tracking more reliable.
2. Pause on a frame where the clubhead is clearly visible, preferably just before the part of the swing you want to trace. Click **Mark clubhead**, then click its center on the video.
3. Set the **From** and **To** timestamps (e.g., from 0.5 to 2.0 s). Your initial clubhead mark needs to be inside that range.
4. Click **Analyze swing**. A small local template matcher attempts to follow the clubhead through frames. If it loses the head, pause at bad frames, **Mark clubhead** again as a correction, and rerun. These pins guide tracking.
5. Optionally mark address/top/impact timestamps. Draw a **reference line** and then mark impact to estimate a *2D projected angle*. Use **Calibrate video distance** (two points placed along a known ruler-length in the plane of clubhead motion), enter the real distance in inches, then analyze to get a rough *2D projected speed*.
6. Export a frame with overlays as PNG, path data as CSV, or a rendered annotated clip using the browser's supported video recording format (typically `.webm`, sometimes `.mp4`). Add actual SkyTrak+ club metrics to the shot journal if desired.

## What it can and cannot measure

- This is **semi-automatic 2D video tracking**, not an AI pose estimator. The image-template matcher may fail with blur, low frame rate, occlusions or clutter, especially around impact. Manual correction points are supported.
- Without a ruler calibration, speed is not shown in mph. Even with calibration, **projected video mph** is only a rough 2D estimate, not true clubhead speed. Single-camera perspective and shutter blur can introduce huge error. Manual pins / gaps can also contaminate speed; low-confidence segments are omitted from estimates.
- The projected path angle is **not** the actual 3D in-to-out/out-to-in launch-monitor club path angle, and the site cannot infer face angle, face-to-path or angle of attack from a single ordinary video.
- For **club head speed, club path and face angle**, prefer measured SkyTrak+ data. The journal is for manual entry and stores data only in your own browser's localStorage.
- Videos stay inside the browser. No server endpoint or paid service is used. Record video requires browser camera permission and HTTPS or localhost. Browser support for camera codecs and exporting video varies.
- Chrome/Edge desktop recommended. Long, high-resolution video files may be slow; analyze short windows and use 30 fps sampling first.

## Files

- `index.html`: UI and accessible controls
- `styles.css`: responsive dark studio design
- `app.js`: video loading/camera, frame capture, tracking, canvas overlays, exports, stats and journal
- `vercel.json`: static Vercel deployment configuration
