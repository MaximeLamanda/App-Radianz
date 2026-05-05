"use client";

import { Badge } from "@/components/ui/badge";

const mockLeads = [
  {
    name: "Logistics Warehouse Lyon",
    addr: "Lyon • Auvergne-Rhône-Alpes",
    kwp: "420",
    status: "new",
    estProd: "525 MWh",
  },
  {
    name: "Amazon Platform Lyon",
    addr: "Saint-Priest • 69",
    kwp: "847",
    status: "add",
    estProd: "1059 MWh",
  },
  {
    name: "Industrial Zone Nantes",
    addr: "Nantes • Pays de la Loire",
    kwp: "312",
    status: "new",
    estProd: "390 MWh",
  },
];

export function IllustrationPipelineTable() {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[400px] text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
              <th className="w-12 px-2 py-2 font-medium text-zinc-500">Photo</th>
              <th className="max-w-[100px] px-2 py-2 font-medium text-zinc-500">Nom</th>
              <th className="max-w-[80px] px-2 py-2 font-medium text-zinc-500">Adresse</th>
              <th className="px-2 py-2 font-medium text-zinc-500">kWp</th>
              <th className="w-16 px-2 py-2 font-medium text-zinc-500">Statut</th>
              <th className="px-2 py-2 font-medium text-zinc-500">Prod. est.</th>
            </tr>
          </thead>
          <tbody>
            {mockLeads.map((lead, i) => (
              <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="w-12 px-2 py-2">
                  <div className="size-8 rounded bg-zinc-300 dark:bg-zinc-600 shrink-0" />
                </td>
                <td className="max-w-[100px] truncate px-2 py-2 font-medium">{lead.name}</td>
                <td className="max-w-[80px] truncate px-2 py-2 text-zinc-500">{lead.addr}</td>
                <td className="px-2 py-2 font-mono">{lead.kwp}</td>
                <td className="w-16 px-2 py-2">
                  <Badge
                    variant={lead.status === "add" ? "lime" : "secondary"}
                    className="text-[10px]"
                  >
                    {lead.status}
                  </Badge>
                </td>
                <td className="px-2 py-2 font-mono text-zinc-500">{lead.estProd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
