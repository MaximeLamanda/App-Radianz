"use client";

import Image from "next/image";
import { Phone, User } from "lucide-react";
import { Cell, Label, Pie, PieChart } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

/** Même jaune que le bouton default (`components/ui/button.tsx` : bg-[#E4FE55]). */
const BUTTON_ACCENT = "#E4FE55";
const SCORE_TRACK = "#e5e5e5";

const chartConfig = {
  score: {
    label: "Score",
    color: BUTTON_ACCENT,
  },
  rest: {
    label: "Reste",
    color: SCORE_TRACK,
  },
} satisfies ChartConfig;

const chartData = [
  { name: "score" as const, value: 70 },
  { name: "rest" as const, value: 30 },
];

/** Donut shadcn / Recharts — score affiché au centre, sans légende ni tooltip. */
function WelcomeScoreDonut() {
  return (
    <ChartContainer
      config={chartConfig}
      className="mx-0 aspect-square h-[76px] w-[76px] min-h-0 shrink-0 [&_.recharts-responsive-container]:aspect-square"
    >
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          innerRadius={24}
          outerRadius={34}
          strokeWidth={0}
          startAngle={90}
          endAngle={-270}
          isAnimationActive
          animationDuration={900}
          animationEasing="ease-out"
        >
          {chartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={`var(--color-${entry.name})`} />
          ))}
          <Label
            content={({ viewBox }) => {
              if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                const { cx, cy } = viewBox as { cx: number; cy: number };
                return (
                  <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" className="fill-[#171717]">
                    <tspan className="text-[15px] font-semibold tabular-nums">70</tspan>
                  </text>
                );
              }
              return null;
            }}
          />
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

const badgeClass =
  "inline-flex max-w-[min(100vw-2rem,14rem)] items-center gap-1.5 rounded-full border border-black/20 bg-black px-2.5 py-1 text-xs text-white shadow-md";

/** Étape 1 : bienvenue — illustration avec score en overlay et badges contact. */
export function OnboardingWelcomeStep() {
  return (
    <div className="flex w-full flex-col gap-5">
      <div className="relative aspect-[16/10] w-full max-h-52 rounded-2xl border border-border bg-muted/40">
        <Image
          src="/onboarding/amazon-plateform-lyon.png"
          alt="Illustration plateforme logistique"
          fill
          className="object-cover rounded-2xl"
          sizes="(max-width: 768px) 100vw, 28rem"
          priority
        />
        {/* Donut : haut gauche, fond blanc, texte #171717 comme le bouton, arc #E4FE55 */}
        <div
          className="pointer-events-none absolute -left-2 top-3 z-10 flex size-[84px] items-center justify-center rounded-xl bg-white p-1 shadow-md ring-1 ring-black/10 sm:-left-3 sm:top-4 dark:bg-white"
          aria-hidden
        >
          <WelcomeScoreDonut />
        </div>
        {/* Un badge par ligne — bas droite, légèrement hors cadre */}
        <div className="absolute -right-1 bottom-3 z-10 flex flex-col items-end gap-1.5 sm:-right-2 sm:bottom-4">
          <div className={badgeClass}>
            <User className="size-3 shrink-0 text-white/80" aria-hidden />
            <span className="min-w-0 truncate font-medium text-white">Sophie Martin</span>
          </div>
          <div className={badgeClass}>
            <Phone className="size-3 shrink-0 text-white/80" aria-hidden />
            <span className="tabular-nums text-white/90">06 12 34 56 78</span>
          </div>
        </div>
      </div>
    </div>
  );
}
