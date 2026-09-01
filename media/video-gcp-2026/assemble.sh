#!/bin/bash
# assemble.sh — builds the HelixCTW Google Cloud TestWired video.
#
# HOW IT WORKS (for John):
#   STEP 1  Render each scene to an exact-duration segment:
#             setpts=N*PTS   = slow the footage down N× (no audio, so safe)
#             tpad stop_mode=clone = freeze the last frame to fill remaining time
#             -t <secs>      = cut the segment to its exact planned length
#   STEP 2  Concat all segments into one silent 1080p video track.
#   STEP 3  Lay each Charon narration clip at its scene's start (adelay),
#           mix them into one voice track, loudness-normalize to -16 LUFS.
#   STEP 4  Master A: video + voice only (clean master for future remixes).
#   STEP 5  Master B: add the Suno theme song as a quiet bed. sidechaincompress
#           uses the VOICE as the key: whenever Charon speaks (or the song
#           swells), the music is pushed down automatically — exactly the
#           "as the song gets louder, lower it under the demo" behavior.
set -e
cd /tmp/helixctw-gcp-video-capture
SLIDES=/home/js/DIDzMonolith/HelixCTW-Google-Cloud-Platform/media/video-gcp-2026/slides
SONG='/home/js/DIDzMonolith/MidnightHelixCTW/media/sound/HelixCTW-suno song-1.mp3'
OUTDIR=/home/js/DIDzMonolith/HelixCTW-Google-Cloud-Platform/media/videos
mkdir -p seg "$OUTDIR"

seg () { # seg <in.mp4> <speed-multiplier> <target-secs> <out>
  ffmpeg -y -v error -i "$1" -filter_complex \
    "[0:v]setpts=$2*PTS,tpad=stop=-1:stop_mode=clone,scale=1920:1080,fps=30,format=yuv420p[v]" \
    -map "[v]" -t "$3" -c:v libx264 -crf 18 -preset fast "seg/$4.mp4"
}
still () { # still <in.png> <target-secs> <out>
  ffmpeg -y -v error -loop 1 -i "$1" -vf "scale=1920:1080,fps=30,format=yuv420p" \
    -t "$2" -c:v libx264 -crf 18 -preset fast "seg/$3.mp4"
}

# STEP 1 — planned durations sum to 178.5 s (2:58.5)
seg   mp4/s01-hero.mp4      1.6 14.5 01-hero
still "$SLIDES/gcp-terraform-slide.png" 26.0 02-terraform
seg   mp4/s02-providers.mp4 1.9 12.5 03-providers
seg   mp4/s03-gate.mp4      1.7 12.5 04-gate
seg   mp4/s04-cp1.mp4       1.6 14.2 05-cp1
seg   mp4/s05-cp2.mp4       1.5 12.4 06-cp2
seg   mp4/s06-cp3.mp4       1.7 14.4 07-cp3
seg   mp4/s07-cp4.mp4       1.7 17.8 08-cp4
seg   mp4/s08-cp5.mp4       1.6 16.1 09-cp5
seg   mp4/s09-cp6.mp4       1.0  8.0 10-cp6
seg   mp4/s10-cp7.mp4       1.0  8.2 11-cp7
seg   mp4/s11-receipt.mp4   1.2  9.6 12-receipt
still "$SLIDES/gcp-midnight-contact-slide.png" 12.3 13-endcard

# STEP 2 — concat the video track
for n in 01-hero 02-terraform 03-providers 04-gate 05-cp1 06-cp2 07-cp3 \
         08-cp4 09-cp5 10-cp6 11-cp7 12-receipt 13-endcard; do
  echo "file 'seg/$n.mp4'"
done > concat.txt
ffmpeg -y -v error -f concat -safe 0 -i concat.txt -c copy video-track.mp4

# STEP 3 — voice track. Scene start offsets (ms), each +300 ms breathing room:
#   hero 0 | terraform 14500 | providers 40500 | cp1 65500 | cp2 79700
#   cp3 92100 | cp4 106500 | cp5 124300 | cp6+7 140400 | receipt 156600
ffmpeg -y -v error \
  -f s16le -ar 24000 -ac 1 -i n01.pcm -f s16le -ar 24000 -ac 1 -i n02.pcm \
  -f s16le -ar 24000 -ac 1 -i n03.pcm -f s16le -ar 24000 -ac 1 -i n04.pcm \
  -f s16le -ar 24000 -ac 1 -i n05.pcm -f s16le -ar 24000 -ac 1 -i n06.pcm \
  -f s16le -ar 24000 -ac 1 -i n07.pcm -f s16le -ar 24000 -ac 1 -i n08.pcm \
  -f s16le -ar 24000 -ac 1 -i n09.pcm -f s16le -ar 24000 -ac 1 -i n10.pcm \
  -filter_complex "\
    [0]aresample=48000,adelay=400|400[a0];\
    [1]aresample=48000,adelay=14800|14800[a1];\
    [2]aresample=48000,adelay=40800|40800[a2];\
    [3]aresample=48000,adelay=65800|65800[a3];\
    [4]aresample=48000,adelay=80000|80000[a4];\
    [5]aresample=48000,adelay=92400|92400[a5];\
    [6]aresample=48000,adelay=106800|106800[a6];\
    [7]aresample=48000,adelay=124600|124600[a7];\
    [8]aresample=48000,adelay=140700|140700[a8];\
    [9]aresample=48000,adelay=156900|156900[a9];\
    [a0][a1][a2][a3][a4][a5][a6][a7][a8][a9]amix=inputs=10:normalize=0,\
    loudnorm=I=-16:TP=-1.5:LRA=11,apad[voice]" \
  -map "[voice]" -t 178.5 -c:a aac -b:a 192k voice-track.m4a

# STEP 4 — Master A: voice only
ffmpeg -y -v error -i video-track.mp4 -i voice-track.m4a \
  -map 0:v -map 1:a -c:v copy -c:a copy -movflags +faststart \
  "$OUTDIR/HelixCTW_GoogleCloud_TestWired_2026_VoiceOnly.mp4"

# STEP 5 — Master B: add the Suno theme as a ducked quiet bed
#   volume=0.18       = the song sits well under the narration by default
#   sidechaincompress = the VOICE is the key signal; when it plays, the music
#                       is compressed a further ~12 dB (nice and quiet), and
#                       louder song passages are pushed down hardest
#   afade in/out      = gentle 2.5 s entrance, 3.5 s tail under the end card
ffmpeg -y -v error -i video-track.mp4 -i voice-track.m4a -i "$SONG" \
  -filter_complex "\
    [2:a]aresample=48000,volume=0.18,afade=t=in:st=0:d=2.5,afade=t=out:st=175:d=3.5[bed];\
    [1:a]asplit=2[voiceMix][voiceKey];\
    [bed][voiceKey]sidechaincompress=threshold=0.02:ratio=8:attack=40:release=900[ducked];\
    [voiceMix][ducked]amix=inputs=2:normalize=0,alimiter=limit=0.95[mix]" \
  -map 0:v -map "[mix]" -t 178.5 -c:v copy -c:a aac -b:a 192k -movflags +faststart \
  "$OUTDIR/HelixCTW_GoogleCloud_TestWired_2026.mp4"

echo "Done:"
ls -la "$OUTDIR"
