# Painted forest: the scripts behind the Hero video

Not part of the website (this branch isn't published). Kept so the video can be re-made, for example at full size.

- `paint7.py` makes the 20-second video of the forest photo being painted: a thin lay-in, the sky, the trunks,
  then the rest of the scene (big strokes first), the fern's edges dry-brushed, and sunlit highlights last.
  `STILL=1 python3 paint7.py` writes only the last frame (`still7.jpg`); without it, it writes 600 frames to `vf13/`.
  Encode: `ffmpeg -framerate 30 -i vf13/%04d.jpg -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart out.mp4`
- `trunks.py` made `trunkmask.png` from the trunk outlines traced in `outlines.json`.
- `forest-1536.jpg` is the photo it paints. `brushes/` are real oil-brush stamps (CC0, from the Stylized Neural Painting project).
- On the site at the time: `med/painted-forest-v8.mp4` (and `med/jpg/painted-forest-v8-end.jpg`, its last frame).

Full size: every stroke is planned at 1536 wide with fixed random seeds, so the plan is the same on every run.
To render at 3840, scale every stroke's position and size by 2.5 (and the masks and textures with them),
rather than re-planning on the bigger photo, which would give a different painting. Then make the 2560 and 1536
copies by shrinking the 3840 video.

`paint7_full.py` does this. It runs `paint7.py`'s planning unchanged (so the strokes are identical), then renders
them 2.5 times bigger, with the masks and canvas texture enlarged to match and `forest-3840.jpg` (the same photo,
same framing, as `med/jpg/forest-3840.jpg` on the site) under the paint. Each stroke keeps its brush and flips, but
uses the full-resolution copy of the stamp where the bigger stroke needs it, so the bristle marks stay sharp.
`STILL=1 python3 paint7_full.py` writes `still7-3840.jpg`; without it, 600 frames to `vf13-3840/`
(`FROM=` and `TO=` render part of the run, e.g. one half on each processor core). Then:

    ffmpeg -framerate 30 -i vf13-3840/%04d.jpg -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart painted-forest-v8-3840.mp4
    ffmpeg -i painted-forest-v8-3840.mp4 -vf scale=2560:1920:flags=lanczos -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart painted-forest-v8-2560.mp4
    ffmpeg -i painted-forest-v8-3840.mp4 -vf scale=1536:1152:flags=lanczos -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart painted-forest-v8-1536.mp4

## Version 9 (11 Nov 2026): shorter, one sweep

`paint8.py` uses paint7's strokes unchanged (13,829 of them) with new timing: 11.6 seconds instead of 20. Rather
than painting in passes one after another (lay-in, sky, trunks, then the rest four times, big brushes to small),
one front crosses the picture once from the top left to the bottom right, every layer following it, each finer
brush a little further behind (LAG). Several strokes are in progress in each frame. The finished painting has the
same strokes, but where they overlap, which lies on top differs a little, as it already did between paint7's still
and its video. Test stills at 1536 take about half a minute:

    S=1 STILLS=2,4,6,8,12 python3 paint8.py          # pf8-<seconds>.jpg

Full size (3840 x 2880, 349 frames in vf8-3840/): about 4 minutes per half. One half at a time: two at once ran out
of memory on a machine with 7 gigabytes.

    FROM=0 TO=200 python3 paint8.py && FROM=200 python3 paint8.py
    ffmpeg -framerate 30 -i vf8-3840/%04d.jpg -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart painted-forest-v9-3840x2880.mp4
    ffmpeg -i painted-forest-v9-3840x2880.mp4 -vf scale=2560:1920:flags=lanczos -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart painted-forest-v9-2560x1920.mp4
    ffmpeg -i painted-forest-v9-3840x2880.mp4 -vf scale=1536:1152:flags=lanczos -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart painted-forest-v9-1536x1152.mp4

Sizes: 11.3, 5.3 and 2.4 megabytes. Uploaded through the editor's Library as one video item (its three versions).
