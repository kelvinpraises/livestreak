import { describe, expect, it } from "vitest";
import { makeFfmpegImageSequenceMp4EncodeArguments } from "#pipeline/publish/encoder/mp4.js";

describe("mp4 image sequence encoder", () => {
  it("builds ffmpeg image2pipe arguments for jpeg input", () => {
    expect(
      makeFfmpegImageSequenceMp4EncodeArguments({
        outputPath: "/tmp/out.mp4",
        width: 640,
        height: 360,
        fps: 24,
        inputFormat: "jpeg"
      })
    ).toEqual([
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-framerate",
      "24",
      "-i",
      "pipe:0",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "/tmp/out.mp4"
    ]);
  });

  it("builds ffmpeg image2pipe arguments for png input", () => {
    const encodeArguments = makeFfmpegImageSequenceMp4EncodeArguments({
      outputPath: "/tmp/out.mp4",
      width: 320,
      height: 180,
      fps: 12,
      inputFormat: "png"
    });

    expect(encodeArguments).toContain("-vcodec");
    expect(encodeArguments[encodeArguments.indexOf("-vcodec") + 1]).toBe("png");
  });
});
