import { describe, expect, it } from "vitest";

import {
  evaluateProspectShareRegisterViewDecision,
  evaluateProspectShareSessionStartDecision,
} from "@/lib/prospect-share-view-eligibility";

describe("evaluateProspectShareSessionStartDecision", () => {
  it("record_session si deja ouvert (relecture KPI)", () => {
    expect(
      evaluateProspectShareSessionStartDecision({
        viewerIp: "203.0.113.2",
        shareLinkCreatorIp: "198.51.100.1",
        pipelineStatus: "ouvert",
      })
    ).toEqual({ action: "record_session" });
  });

  it("skip terminal pour session aussi", () => {
    expect(
      evaluateProspectShareSessionStartDecision({
        viewerIp: "203.0.113.2",
        shareLinkCreatorIp: "198.51.100.1",
        pipelineStatus: "converti",
      })
    ).toEqual({ action: "skip", skipped: "terminal" });
  });
});

describe("evaluateProspectShareRegisterViewDecision", () => {
  it("skip no_ip si viewerIp absent ou vide", () => {
    for (const viewerIp of [null, undefined, "", "   "] as const) {
      expect(evaluateProspectShareRegisterViewDecision({ viewerIp })).toEqual({
        action: "skip",
        skipped: "no_ip",
      });
    }
  });

  it("skip no_creator_ip si IP créateur absente", () => {
    const r = evaluateProspectShareRegisterViewDecision({
      viewerIp: "203.0.113.1",
      shareLinkCreatorIp: "",
      pipelineStatus: "envoye",
    });
    expect(r).toEqual({ action: "skip", skipped: "no_creator_ip" });
  });

  it("skip same_ip si visiteur = créateur", () => {
    const r = evaluateProspectShareRegisterViewDecision({
      viewerIp: "192.0.2.10",
      shareLinkCreatorIp: "192.0.2.10",
      pipelineStatus: "envoye",
    });
    expect(r).toEqual({ action: "skip", skipped: "same_ip" });
  });

  it("skip terminal pour converti", () => {
    const r = evaluateProspectShareRegisterViewDecision({
      viewerIp: "203.0.113.2",
      shareLinkCreatorIp: "198.51.100.1",
      pipelineStatus: "converti",
    });
    expect(r).toEqual({ action: "skip", skipped: "terminal" });
  });

  it("skip terminal pour perdu", () => {
    const r = evaluateProspectShareRegisterViewDecision({
      viewerIp: "203.0.113.2",
      shareLinkCreatorIp: "198.51.100.1",
      pipelineStatus: "perdu",
    });
    expect(r).toEqual({ action: "skip", skipped: "terminal" });
  });

  it("skip already_open si statut deja ouvert", () => {
    const r = evaluateProspectShareRegisterViewDecision({
      viewerIp: "203.0.113.2",
      shareLinkCreatorIp: "198.51.100.1",
      pipelineStatus: "ouvert",
    });
    expect(r).toEqual({ action: "skip", skipped: "already_open" });
  });

  it("update_pipeline_to_open pour envoye avec IPs distinctes", () => {
    const r = evaluateProspectShareRegisterViewDecision({
      viewerIp: "203.0.113.5",
      shareLinkCreatorIp: "198.51.100.9",
      pipelineStatus: "envoye",
    });
    expect(r).toEqual({ action: "update_pipeline_to_open" });
  });

  it("update_pipeline_to_open pour cree (defaut implicite)", () => {
    const r = evaluateProspectShareRegisterViewDecision({
      viewerIp: "203.0.113.5",
      shareLinkCreatorIp: "198.51.100.9",
      pipelineStatus: "cree",
    });
    expect(r).toEqual({ action: "update_pipeline_to_open" });
  });

  it("update pour legacy nouveau (normalise en cree)", () => {
    const r = evaluateProspectShareRegisterViewDecision({
      viewerIp: "203.0.113.5",
      shareLinkCreatorIp: "198.51.100.9",
      pipelineStatus: "nouveau",
    });
    expect(r).toEqual({ action: "update_pipeline_to_open" });
  });
});
