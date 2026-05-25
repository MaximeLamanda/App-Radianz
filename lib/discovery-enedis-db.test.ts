import { describe, expect, it } from "vitest";
import { buildEnedisSitesQuery } from "./discovery-enedis-db";
import { DISCOVERY_ENEDIS_MWH_SLIDER_MAX } from "./discovery-enedis-layer";

describe("buildEnedisSitesQuery", () => {
  it("filtre bbox, année et MWh", () => {
    const { sql, params } = buildEnedisSitesQuery({
      minLng: -1,
      minLat: 44,
      maxLng: 0,
      maxLat: 45,
      annee: 2024,
      mwhMin: 10,
      mwhMax: 500,
      limit: 300,
    });
    expect(sql).toContain("ST_Intersects");
    expect(sql).toContain("geocode_status = 'ok'");
    expect(sql).toContain("mwh >=");
    expect(sql).toContain("mwh <=");
    expect(params[0]).toBe(2024);
    expect(params).toContain(10);
    expect(params).toContain(500);
  });

  it("borne haute ouverte au plafond slider", () => {
    const { sql } = buildEnedisSitesQuery({
      minLng: -1,
      minLat: 44,
      maxLng: 0,
      maxLat: 45,
      annee: 2024,
      mwhMin: 0,
      mwhMax: DISCOVERY_ENEDIS_MWH_SLIDER_MAX,
      limit: 100,
    });
    expect(sql).not.toContain("mwh <=");
  });
});
