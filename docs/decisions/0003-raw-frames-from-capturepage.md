# 0003. Raw frames from capturePage() rather than the paint event

Date: 2026-10-22
Status: Accepted

## Context

The first renderer encoded every captured frame to PNG in the host and had ffmpeg decode it again. Both steps are pure overhead, and at 4K and 8K they dominate the frame time. Two ways to hand ffmpeg raw pixels instead:

1. Keep calling `webContents.capturePage()` once per frame and take `toBitmap()` instead of `toPNG()`.
2. Subscribe to the offscreen window's `paint` event, which delivers a bitmap every time the compositor produces a frame, and forward those.

## Decision

Option 1. The render loop still draws one frame, waits for the template's render promise and the following animation frame, then captures once and writes the capture's own BGRA buffer to ffmpeg. The PNG path stays available as `--frame-format png` for comparison.

## Reasons

- **Each capture belongs to a known frame.** A paint arrives whenever the compositor has something new: several times during one frame if the template draws in steps or a font finishes loading, and not at all between two identical frames, which is common during hold phases. Matching paints to frame numbers would need counters or a frame-rate throttle, each with its own failure modes. Capturing after the frame's render promise settles has none of that.
- **The bitmap is already in the right shape.** At device scale 1 the capture is exactly the template's size, tightly packed 32-bit BGRA, which is what `-f rawvideo -pixel_format bgra` expects. The renderer checks the byte count every frame and fails with a clear message otherwise.
- **Alpha stays correct in one place.** Captured pixels are premultiplied. The PNG encoder undid that implicitly; the raw path does it in ffmpeg with `unpremultiply=inplace=1` for alpha templates. An end-to-end test renders the lower-third sample through both paths and compares a semi-transparent panel pixel.
- **Smallest change to a verified loop.** The timeout, error and cleanup behavior around the frame call is untouched.

## Costs

- `capturePage()` is a readback per frame. The paint event could in principle reuse the frame the compositor already produced, and with `offscreen.useSharedTexture` avoid a copy entirely. The measurements in `docs/system-design.md` show the raw path is no longer limited by frame transport at the sizes we render, so this is not needed yet.
- Unpremultiplying in ffmpeg adds a filter step and a planar conversion per frame. It is far cheaper than a PNG round trip.
- Raw input tells ffmpeg nothing about its alpha, so the renderer has to: the capture layout is measured with a probe page, and with ffmpeg 8.1 or later the frames are tagged `setparams=alpha_mode=...` first, because those versions otherwise assume straight alpha and premultiply before an unpremultiply step. PNG frames carry this information themselves.

## Revisit if

- Profiling shows `capturePage()` readback, not encoding, as the bottleneck at 4K or 8K, or
- the shared-texture offscreen path becomes necessary to reach the frame rates a render queue needs.
