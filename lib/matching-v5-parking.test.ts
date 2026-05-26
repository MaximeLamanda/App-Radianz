import { describe, expect, it } from "vitest";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";
import {
  collectMatchingV5ParkingFeatures,
  collectParkingsFromMatchingRows,
  isChargingStationPoi,
  parkingDedupKey,
  parseParkingsJson,
  parseV5ParkingEntry,
} from "@/lib/matching-v5-parking";

describe("matching-v5-parking", () => {
  it("parseParkingsJson", () => {
    const raw = [
      {
        osm_parking_type: "w",
        osm_parking_id: 10,
        parking_tag: "amenity",
        parking_value: "parking",
        parking_area_m2: 500,
        parking_parcels_json: [{ section: "AB", numero_norm: "1", intersection_area_m2: 500 }],
        common_parcels_json: [{ section: "AB", numero_norm: "1" }],
        charging_stations_json: [
          { osm_type: "n", osm_id: 7, name: "Borne", poi_type_label: "Borne de recharge", capacity: "2" },
        ],
      },
    ];
    const p = parseParkingsJson(raw);
    expect(p).toHaveLength(1);
    expect(p[0]!.parkingAreaM2).toBe(500);
    expect(p[0]!.parkingSource).toBe("osm");
    expect(p[0]!.chargingStations).toHaveLength(1);
    expect(p[0]!.chargingStations[0]!.capacity).toBe("2");
  });

  it("parkingDedupKey fusionne way et area osmium (r négatif)", () => {
    expect(parkingDedupKey("w", 12345)).toBe("w:12345");
    expect(parkingDedupKey("r", -12345)).toBe("w:12345");
  });

  it("collectParkingsFromMatchingRows dedupes way et r négatif", () => {
    const buildings = JSON.stringify([
      {
        batiment_construction_id: "bc-1",
        parkings_json: [
          { osm_parking_type: "w", osm_parking_id: 99, parking_parcels_json: [], common_parcels_json: [], charging_stations_json: [] },
          { osm_parking_type: "r", osm_parking_id: -99, parking_parcels_json: [], common_parcels_json: [], charging_stations_json: [] },
        ],
      },
    ]);
    const row = { id: "p1", grain: "parcelle", buildingsJson: buildings } as ScoutMatchingV5Row;
    expect(collectParkingsFromMatchingRows([row])).toHaveLength(1);
  });

  it("collectParkingsFromMatchingRows dedupes", () => {
    const buildings = JSON.stringify([
      {
        batiment_construction_id: "w:1",
        parkings_json: [{ osm_parking_type: "w", osm_parking_id: 1, parking_parcels_json: [], common_parcels_json: [], charging_stations_json: [] }],
      },
    ]);
    const row = {
      id: "p1",
      grain: "parcelle",
      buildingsJson: buildings,
    } as ScoutMatchingV5Row;
    const rows = [row, { ...row, id: "p2" }];
    expect(collectParkingsFromMatchingRows(rows)).toHaveLength(1);
  });

  it("collectMatchingV5ParkingFeatures", () => {
    const fc = collectMatchingV5ParkingFeatures([
      {
        id: "p1",
        parkingGeometriesJson: JSON.stringify([
          {
            osm_parking_type: "w",
            osm_parking_id: 5,
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 0],
                ],
              ],
            },
          },
        ]),
      } as ScoutMatchingV5Row,
    ]);
    expect(fc).toHaveLength(1);
    expect(fc[0]!.properties?.osm_parking_id).toBe(5);
    expect(fc[0]!.properties?.parking_source).toBe("osm");
  });

  it("parseV5ParkingEntry enr source", () => {
    const p = parseV5ParkingEntry({
      parking_source: "enr",
      osm_parking_type: "e",
      osm_parking_id: 99,
      parking_tag: "enr",
      parking_value: "park_sup_500",
      parking_parcels_json: [],
      common_parcels_json: [],
      charging_stations_json: [],
    });
    expect(p?.parkingSource).toBe("enr");
  });

  it("isChargingStationPoi", () => {
    expect(isChargingStationPoi({ poiPrimaryValue: "charging_station" })).toBe(true);
    expect(isChargingStationPoi({ typeLabel: "Borne de recharge" })).toBe(true);
    expect(isChargingStationPoi({ poiPrimaryValue: "restaurant" })).toBe(false);
  });

  it("parseV5ParkingEntry rejects invalid id", () => {
    expect(parseV5ParkingEntry({ osm_parking_id: "x" })).toBeNull();
  });
});
