import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, createHostRouteDeps } from "#server.js";
import { defaultHostServerConfig } from "#config/host.js";

const app = () => createApp(createHostRouteDeps(defaultHostServerConfig()));

describe("webrtc signaling relay", () => {
  it("round-trips an offer then an answer keyed by stream id", async () => {
    const a = app();
    const sid = "market-1";

    await request(a).get(`/webrtc/signal/${sid}/offer`).expect(404);

    await request(a)
      .post(`/webrtc/signal/${sid}/offer`)
      .send({ type: "offer", sdp: "v=0...offer" })
      .expect(201);

    const offer = await request(a).get(`/webrtc/signal/${sid}/offer`).expect(200);
    expect(offer.body).toMatchObject({ type: "offer", sdp: "v=0...offer" });

    // Answer cannot precede an offer.
    const orphan = app();
    await request(orphan)
      .post(`/webrtc/signal/${sid}/answer`)
      .send({ type: "answer", sdp: "v=0...answer" })
      .expect(404);

    await request(a)
      .post(`/webrtc/signal/${sid}/answer`)
      .send({ type: "answer", sdp: "v=0...answer" })
      .expect(201);

    const answer = await request(a).get(`/webrtc/signal/${sid}/answer`).expect(200);
    expect(answer.body).toMatchObject({ type: "answer", sdp: "v=0...answer" });

    await request(a).delete(`/webrtc/signal/${sid}`).expect(200);
    await request(a).get(`/webrtc/signal/${sid}/offer`).expect(404);
  });

  it("rejects malformed offers/answers", async () => {
    const a = app();
    await request(a).post("/webrtc/signal/s/offer").send({ sdp: "x" }).expect(400);
    await request(a).post("/webrtc/signal/s/answer").send({ type: "offer", sdp: "x" }).expect(400);
  });
});
