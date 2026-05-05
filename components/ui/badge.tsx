import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Radianz DS — default = canvas + encre (pas lime).
 * `secondary` : même neutre que `default` en thème clair (rétrocompat shadcn) ;
 * préférer `lime` / `solid` pour l’emphase.
 */
const badgeVariants = cva(
  "inline-flex h-[22px] min-h-[22px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 font-geist-mono text-[10px] font-medium uppercase leading-none tracking-[0.1em] transition-colors focus:outline-hidden focus:ring-2 focus:ring-ring/40 focus:ring-offset-2 focus:ring-offset-background",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        lime: "border-transparent bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime-hover",
        solid:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
        muted:
          "border-border bg-transparent text-muted-foreground hover:bg-muted/40",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline:
          "border-border bg-transparent text-foreground hover:bg-muted/40",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
