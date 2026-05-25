"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/** Racine slider-04 + traits via `**:data-[slot=slider-thumb]` ; track/plage en classes directes. */
export const slider04ClassName =
  "h-7 **:data-[slot=slider-thumb]:pointer-events-auto **:data-[slot=slider-thumb]:block **:data-[slot=slider-thumb]:h-2.5 **:data-[slot=slider-thumb]:w-0.5 **:data-[slot=slider-thumb]:rounded-sm **:data-[slot=slider-thumb]:border-0 **:data-[slot=slider-thumb]:bg-muted-foreground **:data-[slot=slider-thumb]:shadow-none **:data-[slot=slider-thumb]:cursor-ew-resize **:data-[slot=slider-thumb]:ring-0 **:data-[slot=slider-thumb]:hover:ring-0 **:data-[slot=slider-thumb]:focus-visible:ring-0 **:data-[slot=slider-thumb]:relative **:data-[slot=slider-thumb]:z-10"

const slider04TrackClassName =
  "pointer-events-none relative h-7 w-full grow overflow-hidden rounded-lg border border-border bg-muted shadow-[0_1px_2px_0px_rgba(0,0,0,0.08)] ring-1 ring-background ring-inset"

/** Plage active : gris discret (tokens muted / muted-foreground du DS). */
const slider04RangeFillClassName =
  "pointer-events-none absolute h-full overflow-hidden rounded-md border border-border/40 bg-muted-foreground/25 shadow-none"

function isSlider04ThumbPointerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest("[data-slot=slider-thumb]")) return true
  // Wrapper de positionnement Radix (parent du thumb)
  return target.querySelector?.("[data-slot=slider-thumb]") != null
}

/** Clic sur la piste / la racine : ignoré ; seuls les traits déplacent la valeur. */
function guardSlider04PointerDown(
  variant: string | null | undefined,
  e: React.PointerEvent
) {
  if (variant !== "slider04") return
  if (isSlider04ThumbPointerTarget(e.target)) return
  e.preventDefault()
}

/**
 * Décalage visuel du trait dans la capsule.
 * `translate` sur le thumb interne (pas `margin`) : Radix positionne un wrapper
 * externe avec `left: calc(…)` + `translateX(-50%)` + `thumbInBoundsOffset` déjà
 * asymétrique selon la largeur mesurée — la marge décalait surtout le boîte de hit.
 */
const slider04ThumbMinOffsetClassName = "translate-x-2.5"
const slider04ThumbMaxOffsetClassName = "-translate-x-2.5"
const slider04ThumbSingleOffsetClassName = "-translate-x-1.5"

/** @deprecated Utiliser `slider04ClassName`. */
export const slider04RangeClassName = slider04ClassName

const defaultThumbClassName =
  "block size-3.5 rounded-full border-2 border-primary bg-background shadow-[0_1px_3px_rgb(0_0_0/0.12)] ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"

const sliderRootVariants = cva(
  "relative flex w-full touch-none select-none items-center",
  {
    variants: {
      variant: {
        default: "",
        slider04: slider04ClassName,
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> &
    VariantProps<typeof sliderRootVariants>
>(({ className, variant, onPointerDownCapture, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(sliderRootVariants({ variant }), className)}
    onPointerDownCapture={(e) => {
      guardSlider04PointerDown(variant, e)
      onPointerDownCapture?.(e)
    }}
    {...props}
  >
    <SliderPrimitive.Track
      data-slot="slider-track"
      className={
        variant === "slider04"
          ? slider04TrackClassName
          : "relative h-2 w-full grow overflow-hidden rounded-full bg-secondary"
      }
    >
      <SliderPrimitive.Range
        data-slot="slider-range"
        className={
          variant === "slider04" ? slider04RangeFillClassName : "absolute h-full bg-primary"
        }
      />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      className={
        variant === "slider04" ? slider04ThumbSingleOffsetClassName : defaultThumbClassName
      }
    />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

type RangeSliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> &
  VariantProps<typeof sliderRootVariants>

/** Slider à deux curseurs (plage min–max). Variant `slider04` : style @shadcn-space/slider-04. */
const RangeSlider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  RangeSliderProps
>(({ className, variant, onPointerDownCapture, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(sliderRootVariants({ variant }), className)}
    onPointerDownCapture={(e) => {
      guardSlider04PointerDown(variant, e)
      onPointerDownCapture?.(e)
    }}
    {...props}
  >
    <SliderPrimitive.Track
      data-slot="slider-track"
      className={
        variant === "slider04"
          ? slider04TrackClassName
          : "relative h-1 w-full grow overflow-hidden rounded-full bg-secondary"
      }
    >
      <SliderPrimitive.Range
        data-slot="slider-range"
        className={
          variant === "slider04" ? slider04RangeFillClassName : "absolute h-full bg-primary"
        }
      />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      className={
        variant === "slider04" ? slider04ThumbMinOffsetClassName : defaultThumbClassName
      }
    />
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      className={
        variant === "slider04" ? slider04ThumbMaxOffsetClassName : defaultThumbClassName
      }
    />
  </SliderPrimitive.Root>
))
RangeSlider.displayName = "RangeSlider"

export { Slider, RangeSlider, sliderRootVariants }
