import { ReactNode } from "react";

interface FilterLabelProps {
  label: string;
  /** Valeur principale affichée à droite (ex. "Oct") */
  value?: ReactNode;
  /** Valeur secondaire (ex. "1050 – 3975 m²") */
  secondaryValue?: ReactNode;
}

export function FilterLabel({ label, value, secondaryValue }: FilterLabelProps) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span className="uppercase tracking-wide">{label}</span>
      <div className="flex items-center gap-1 text-right min-w-0">
        {value != null && (
          <span className="tabular-nums truncate">{value}</span>
        )}
        {secondaryValue != null && (
          <span className="tabular-nums text-muted-foreground/80 truncate">
            {secondaryValue}
          </span>
        )}
      </div>
    </div>
  );
}

