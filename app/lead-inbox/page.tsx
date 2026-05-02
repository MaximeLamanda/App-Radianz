"use client";

import { Card, CardContent } from "@/components/ui/card";
import { MapPin } from "lucide-react";
import Image from "next/image";
import { useLeads } from "@/lib/swr-hooks";

export default function LeadInboxPage() {
  const { data: leads = [], isLoading: loading } = useLeads();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-5">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Lead Inbox</h1>
        
        <div className="space-y-4">
          {leads.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Aucun lead pour le moment
              </CardContent>
            </Card>
          ) : (
            leads.map((lead) => (
              <Card key={lead.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center gap-6">
                    {/* Colonne Property avec thumbnail */}
                    <div className="w-32 h-32 shrink-0 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                      {lead.thumbnailUrl ? (
                        <Image
                          src={lead.thumbnailUrl}
                          alt={lead.name}
                          width={128}
                          height={128}
                          className="object-cover w-full h-full"
                        />
                      ) : (
                        <MapPin className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>

                    {/* Informations du lead */}
                    <div className="flex-1 grid grid-cols-3 gap-6">
                      <div>
                        <div className="text-sm text-muted-foreground mb-1">
                          Nom du Lead
                        </div>
                        <div className="font-semibold">{lead.name}</div>
                      </div>

                      <div>
                        <div className="text-sm text-muted-foreground mb-1">
                          Quality Score
                        </div>
                        <div className="font-semibold">{lead.qualityScore}/100</div>
                      </div>

                      <div>
                        <div className="text-sm text-muted-foreground mb-1">
                          Contact
                        </div>
                        <div className="font-semibold">
                          {lead.contactName || "N/A"}
                        </div>
                      </div>
                    </div>
                    <div className="ml-6 min-w-[320px]">
                      <div className="text-sm text-muted-foreground mb-1">
                        Passerelle personne morale
                      </div>
                      <div className="font-semibold">
                        {lead.companyLegalName || "Non trouvé"}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {lead.companyLegalForm || "Forme juridique inconnue"}
                      </div>
                      <div className="text-sm mt-1">{lead.companyAddress || "Adresse inconnue"}</div>
                      <div className="text-xs text-muted-foreground mt-2">
                        SIREN: {lead.siren || "N/A"} · Parcelles: {lead.parcellesCount ?? 0}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
