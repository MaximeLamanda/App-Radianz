import { describe, expect, it } from "vitest";

import {
  APOLLO_PEOPLE_PER_PAGE,
  APOLLO_TARGET_SENIORITIES,
  APOLLO_TARGET_TITLES,
  buildApolloSearchBody,
  extractDomainFromWebsite,
  mergeProspectContacts,
  parseApolloPerson,
  prospectContactDedupeKey,
} from "./apollo-people-search";
import type { ProspectContact } from "@/types";

describe("extractDomainFromWebsite", () => {
  it("extrait le domaine depuis une URL https avec www et chemin", () => {
    expect(extractDomainFromWebsite("https://www.acme-corp.fr/contact?id=42#top")).toBe("acme-corp.fr");
  });

  it("extrait le domaine depuis une URL http nue", () => {
    expect(extractDomainFromWebsite("http://acme.com")).toBe("acme.com");
  });

  it("ajoute https implicite quand le schéma manque", () => {
    expect(extractDomainFromWebsite("www.acme.fr/page")).toBe("acme.fr");
  });

  it("gère un port et un chemin", () => {
    expect(extractDomainFromWebsite("https://api.acme.fr:8443/v1")).toBe("api.acme.fr");
  });

  it("retourne null pour une chaîne vide ou whitespace", () => {
    expect(extractDomainFromWebsite("")).toBeNull();
    expect(extractDomainFromWebsite("   ")).toBeNull();
  });

  it("retourne null pour null/undefined", () => {
    expect(extractDomainFromWebsite(null)).toBeNull();
    expect(extractDomainFromWebsite(undefined)).toBeNull();
  });

  it("retourne null pour une chaîne sans point", () => {
    expect(extractDomainFromWebsite("localhost")).toBeNull();
    expect(extractDomainFromWebsite("just-a-word")).toBeNull();
  });

  it("normalise en minuscules et supprime le www. final ", () => {
    expect(extractDomainFromWebsite("HTTPS://WWW.AcMe.FR/")).toBe("acme.fr");
  });

  it("rejette les chaînes contenant des espaces", () => {
    expect(extractDomainFromWebsite("acme corp.fr")).toBeNull();
  });

  it("conserve un sous-domaine non-www", () => {
    expect(extractDomainFromWebsite("https://shop.acme.fr/")).toBe("shop.acme.fr");
  });
});

describe("buildApolloSearchBody", () => {
  it("construit un body conforme avec domaine, séniorités et titles", () => {
    const body = buildApolloSearchBody({ domain: "acme.fr" });
    expect(body).toMatchObject({
      q_organization_domains: "acme.fr",
      page: 1,
      per_page: APOLLO_PEOPLE_PER_PAGE,
    });
    expect(body.person_seniorities).toEqual([...APOLLO_TARGET_SENIORITIES]);
    expect(body.person_titles).toEqual([...APOLLO_TARGET_TITLES]);
  });

  it("borne perPage entre 1 et la limite Apollo", () => {
    expect((buildApolloSearchBody({ domain: "a.fr", perPage: 0 }) as { per_page: number }).per_page).toBe(1);
    expect((buildApolloSearchBody({ domain: "a.fr", perPage: 999 }) as { per_page: number }).per_page).toBe(
      APOLLO_PEOPLE_PER_PAGE
    );
  });
});

describe("parseApolloPerson", () => {
  it("parse un payload complet en ProspectContact", () => {
    const raw = {
      id: "p_123",
      first_name: "Jean",
      last_name: "Dupont",
      title: "Directeur Technique",
      email: "[email protected]",
      email_status: "verified",
      linkedin_url: "https://linkedin.com/in/jdupont",
      phone_numbers: [{ sanitized_number: "+33123456789" }],
      organization: { name: "Acme SAS", primary_domain: "acme.fr" },
    };
    const out = parseApolloPerson(raw);
    expect(out).not.toBeNull();
    expect(out?.fullName).toBe("Jean Dupont");
    expect(out?.title).toBe("Directeur Technique");
    expect(out?.email).toBe("[email protected]");
    expect(out?.emailStatus).toBe("verified");
    expect(out?.linkedinUrl).toBe("https://linkedin.com/in/jdupont");
    expect(out?.phone).toBe("+33123456789");
    expect(out?.organizationName).toBe("Acme SAS");
    expect(out?.organizationDomain).toBe("acme.fr");
    expect(out?.source).toBe("apollo");
    expect(out?.fetchedAt).toBeInstanceOf(Date);
  });

  it("utilise `name` quand first_name/last_name absents", () => {
    const raw = { name: "Marie Martin" };
    expect(parseApolloPerson(raw)?.fullName).toBe("Marie Martin");
  });

  it("retourne null sans nom exploitable", () => {
    expect(parseApolloPerson({ first_name: "", last_name: "" })).toBeNull();
    expect(parseApolloPerson({ name: "   " })).toBeNull();
    expect(parseApolloPerson({})).toBeNull();
    expect(parseApolloPerson(null)).toBeNull();
    expect(parseApolloPerson("nope")).toBeNull();
  });

  it("normalise les statuts d'email Apollo", () => {
    expect(parseApolloPerson({ name: "X Y", email_status: "valid" })?.emailStatus).toBe("verified");
    expect(parseApolloPerson({ name: "X Y", email_status: "extrapolated" })?.emailStatus).toBe("unverified");
    expect(parseApolloPerson({ name: "X Y", email_status: "likely" })?.emailStatus).toBe("guessed");
    expect(parseApolloPerson({ name: "X Y", email_status: "unknown" })?.emailStatus).toBeUndefined();
  });

  it("extrait le domaine depuis website_url quand primary_domain absent", () => {
    const raw = {
      name: "Z A",
      organization: { name: "Org", website_url: "https://www.zeta.fr/contact" },
    };
    expect(parseApolloPerson(raw)?.organizationDomain).toBe("zeta.fr");
  });
});

describe("prospectContactDedupeKey & mergeProspectContacts", () => {
  function makeContact(partial: Partial<ProspectContact> & { fullName: string }): ProspectContact {
    return { source: "apollo", ...partial };
  }

  it("priorise id, puis email, puis linkedinUrl, puis nom+poste", () => {
    expect(prospectContactDedupeKey(makeContact({ fullName: "A", id: "X" }))).toBe("id:X");
    expect(prospectContactDedupeKey(makeContact({ fullName: "A", email: "[email protected]" }))).toBe("email:[email protected]");
    expect(
      prospectContactDedupeKey(makeContact({ fullName: "A", linkedinUrl: "https://LI/Z" }))
    ).toBe("li:https://li/z");
    expect(
      prospectContactDedupeKey(makeContact({ fullName: "Marie Martin", title: "DG" }))
    ).toBe("name:marie martin|dg");
  });

  it("fusionne en gardant les nouveaux d'abord", () => {
    const oldC = makeContact({ fullName: "Jean", email: "[email protected]", title: "ancien" });
    const newC = makeContact({ fullName: "Jean", email: "[email protected]", title: "nouveau" });
    const out = mergeProspectContacts([oldC], [newC]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("nouveau");
  });

  it("garde les contacts uniques de chaque liste", () => {
    const a = makeContact({ fullName: "A", id: "1" });
    const b = makeContact({ fullName: "B", id: "2" });
    expect(mergeProspectContacts([a], [b])).toHaveLength(2);
  });

  it("supporte un existing undefined", () => {
    const c = makeContact({ fullName: "Solo" });
    expect(mergeProspectContacts(undefined, [c])).toEqual([c]);
  });
});
